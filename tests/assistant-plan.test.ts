import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { planFromText, type Plan } from '@/lib/assistant/plan';
import { executePlan } from '@/lib/assistant/execute';

// ── عميل Supabase مزيّف يقرأ من ثوابت ويسجّل عمليات الكتابة ────────────────

type Row = Record<string, unknown>;

interface Write {
  table: string;
  action: 'insert' | 'update' | 'delete';
  values?: Row;
  match?: Row;
}

function makeClient(tables: Record<string, Row[]>) {
  const writes: Write[] = [];

  class Q implements PromiseLike<{ data: Row[] | null; error: null }> {
    private filters: Array<[string, unknown]> = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload?: Row;
    constructor(private table: string) {}

    select() { return this; }
    order() { return this; }
    limit(n: number) { this.take = n; return this; }
    private take?: number;
    eq(col: string, val: unknown) { this.filters.push([col, val]); return this; }
    in(col: string, vals: unknown[]) { this.filters.push([col, { __in: vals }]); return this; }
    insert(values: Row) { this.mode = 'insert'; this.payload = values; return this; }
    update(values: Row) { this.mode = 'update'; this.payload = values; return this; }
    delete() { this.mode = 'delete'; return this; }

    private rows(): Row[] {
      let rows = [...(tables[this.table] ?? [])];
      for (const [col, val] of this.filters) {
        rows = val && typeof val === 'object' && '__in' in (val as object)
          ? rows.filter((r) => (val as { __in: unknown[] }).__in.includes(r[col]))
          : rows.filter((r) => r[col] === val);
      }
      return this.take ? rows.slice(0, this.take) : rows;
    }

    then<A, B = never>(
      onOk?: ((v: { data: Row[] | null; error: null }) => A | PromiseLike<A>) | null,
      onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      if (this.mode !== 'select') {
        writes.push({
          table: this.table,
          action: this.mode,
          values: this.payload,
          match: Object.fromEntries(this.filters as Array<[string, unknown]>),
        });
        return Promise.resolve({ data: null, error: null as null }).then(onOk, onErr);
      }
      return Promise.resolve({ data: this.rows(), error: null as null }).then(onOk, onErr);
    }
  }

  const client = { from: (t: string) => new Q(t) } as unknown as SupabaseClient;
  return { client, writes };
}

// ── بيانات ────────────────────────────────────────────────────────────────

const FOUL = { id: 'm-foul', name: 'فول', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary' };
const EGG = { id: 'm-egg', name: 'بيض', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary' };
const RICE = { id: 'm-rice', name: 'أرز بخاري', type: 'lunch', is_snack: false, category: 'hot', entity_type: 'beneficiary' };

const AHMED = {
  id: 'p-1', name: 'أحمد العلي', code: 'B001', villa: '1',
  diet_type: 'عادي', is_active: true, entity_type: 'beneficiary',
};
const SARA = {
  id: 'p-2', name: 'سارة المطيري', code: 'B002', villa: '2',
  diet_type: 'عادي', is_active: false, entity_type: 'beneficiary',
};

const BASE: Record<string, Row[]> = {
  meals: [FOUL, EGG, RICE],
  beneficiaries: [AHMED, SARA],
  exclusions: [],
  beneficiary_fixed_meals: [],
  menu_items: [],
  daily_orders: [{ date: '2026-08-09', week_number: 3 }],
};

const NOW = new Date('2026-08-09T09:00:00Z');
const db = (over: Record<string, Row[]> = {}) => makeClient({ ...BASE, ...over });

const asPlan = (r: unknown): Plan => {
  const p = r as Plan;
  if (!p || p.type !== 'plan') throw new Error(`expected plan, got ${JSON.stringify(r)}`);
  return p;
};

// ── الاستبدال ──────────────────────────────────────────────────────────────

describe('planFromText — استبدال صنف', () => {
  it('يبني خطة منع الفول وإعطاء البيض بديلاً', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'خلّي أحمد العلي ياكل بيض بدل الفول', NOW));

    expect(plan.command).toBe('set_exclusion');
    expect(plan.summary).toContain('أحمد العلي');
    expect(plan.permission).toEqual({ page: 'beneficiaries', action: 'edit' });
    expect(plan.ops).toEqual([
      {
        table: 'exclusions',
        action: 'insert',
        values: { beneficiary_id: 'p-1', meal_id: 'm-foul', alternative_meal_id: 'm-egg' },
      },
    ]);
    expect(plan.steps[0].tone).toBe('add');
    expect(plan.steps[0].text).toContain('فول');
    expect(plan.steps[0].text).toContain('بيض');
  });

  it('يحدّث البديل بدل ما يكرّر الصف لو المنع موجود', async () => {
    const { client } = db({
      exclusions: [{ id: 'e-1', beneficiary_id: 'p-1', meal_id: 'm-foul', alternative_meal_id: null }],
    });
    const plan = asPlan(await planFromText(client, 'خلّي أحمد العلي ياكل بيض بدل الفول', NOW));

    expect(plan.ops).toEqual([
      { table: 'exclusions', action: 'update', match: { id: 'e-1' }, values: { alternative_meal_id: 'm-egg' } },
    ]);
  });

  it('يحذّر لو الشخص معطّل مؤقتاً', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'خلّي سارة المطيري تاكل بيض بدل الفول', NOW));
    expect(plan.warnings.join(' ')).toContain('معطّل');
  });

  it('يرفض لو البديل هو نفسه الممنوع', async () => {
    const { client } = db();
    const r = await planFromText(client, 'خلّي أحمد العلي ياكل فول بدل الفول', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'أمر غير منطقي' });
  });

  it('يعترف بعدم وجود الصنف بدل ما ينفّذ شيئاً', async () => {
    const { client } = db();
    const r = await planFromText(client, 'خلّي أحمد العلي ياكل كافيار بدل الفول', NOW);
    expect(r).toMatchObject({ type: 'problem' });
    expect((r as { summary: string }).summary).toContain('كافيار');
  });

  it('يعترف بعدم وجود الشخص', async () => {
    const { client } = db();
    const r = await planFromText(client, 'خلّي خالد الغامدي ياكل بيض بدل الفول', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'الشخص غير موجود' });
  });
});

describe('planFromText — رفع المنع', () => {
  it('يحذف صف الاستثناء الموجود', async () => {
    const { client } = db({
      exclusions: [{ id: 'e-1', beneficiary_id: 'p-1', meal_id: 'm-foul', alternative_meal_id: 'm-egg' }],
    });
    const plan = asPlan(await planFromText(client, 'احذف منع الفول عن أحمد العلي', NOW));
    expect(plan.ops).toEqual([{ table: 'exclusions', action: 'delete', match: { id: 'e-1' } }]);
  });

  it('يقول لا يوجد ما يُحذف لو ما فيه منع', async () => {
    const { client } = db();
    const r = await planFromText(client, 'احذف منع الفول عن أحمد العلي', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'لا يوجد ما يُحذف' });
  });
});

// ── الأصناف الثابتة ────────────────────────────────────────────────────────

describe('planFromText — صنف ثابت', () => {
  it('ينشئ صفاً لكل يوم مطلوب', async () => {
    const { client } = db();
    const plan = asPlan(
      await planFromText(client, 'حط لأحمد العلي صنف ثابت بيض يوم السبت والثلاثاء فطور', NOW),
    );

    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[0]).toEqual({
      table: 'beneficiary_fixed_meals',
      action: 'insert',
      values: {
        beneficiary_id: 'p-1',
        day_of_week: 6,
        meal_type: 'breakfast',
        meal_id: 'm-egg',
        quantity: 1,
        category: 'hot',
      },
    });
    expect((plan.ops[1] as { values: Row }).values.day_of_week).toBe(2);
    expect(plan.steps).toHaveLength(2);
  });

  it('يعدّل الكمية بدل التكرار لو الصف موجود', async () => {
    const { client } = db({
      beneficiary_fixed_meals: [
        { id: 'f-1', beneficiary_id: 'p-1', meal_id: 'm-egg', day_of_week: 6, meal_type: 'breakfast', quantity: 1 },
      ],
    });
    const plan = asPlan(
      await planFromText(client, 'حط لأحمد العلي صنف ثابت بيض يوم السبت فطور عدد 3', NOW),
    );
    expect(plan.ops).toEqual([
      { table: 'beneficiary_fixed_meals', action: 'update', match: { id: 'f-1' }, values: { quantity: 3 } },
    ]);
  });

  it('يوقف الأمر لو ما فيه أي تغيير فعلي', async () => {
    const { client } = db({
      beneficiary_fixed_meals: [
        { id: 'f-1', beneficiary_id: 'p-1', meal_id: 'm-egg', day_of_week: 6, meal_type: 'breakfast', quantity: 1 },
      ],
    });
    const r = await planFromText(client, 'حط لأحمد العلي صنف ثابت بيض يوم السبت فطور', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'لا جديد' });
  });

  it('يستنتج الوجبة من نوع الصنف مع تحذير', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'حط لأحمد العلي صنف ثابت أرز بخاري يوم السبت', NOW));
    expect((plan.ops[0] as { values: Row }).values.meal_type).toBe('lunch');
    expect(plan.warnings.join(' ')).toContain('الوجبة');
  });

  it('يحذف الصف الثابت المطلوب', async () => {
    const { client } = db({
      beneficiary_fixed_meals: [
        { id: 'f-1', beneficiary_id: 'p-1', meal_id: 'm-egg', day_of_week: 6, meal_type: 'breakfast', quantity: 1 },
      ],
    });
    const plan = asPlan(await planFromText(client, 'احذف الصنف الثابت بيض عن أحمد العلي', NOW));
    expect(plan.ops).toEqual([
      { table: 'beneficiary_fixed_meals', action: 'delete', match: { id: 'f-1' } },
    ]);
  });
});

// ── الحالة والحقول ─────────────────────────────────────────────────────────

describe('planFromText — حالة الشخص وحقوله', () => {
  it('يعطّل شخصاً نشطاً', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'عطّل أحمد العلي', NOW));
    expect(plan.ops).toEqual([
      { table: 'beneficiaries', action: 'update', match: { id: 'p-1' }, values: { is_active: false } },
    ]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('يرفض التعطيل لو معطّل أصلاً', async () => {
    const { client } = db();
    const r = await planFromText(client, 'عطّل سارة المطيري', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'لا تغيير' });
  });

  it('يغيّر الفيلا ويعرض القيمة قبل وبعد', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'غيّر فيلا أحمد العلي إلى 3', NOW));
    expect(plan.ops).toEqual([
      { table: 'beneficiaries', action: 'update', match: { id: 'p-1' }, values: { villa: '3' } },
    ]);
    expect(plan.summary).toContain('1');
    expect(plan.summary).toContain('3');
  });
});

// ── قائمة الطعام ───────────────────────────────────────────────────────────

describe('planFromText — قائمة الطعام', () => {
  it('يضيف صنفاً لخانة محددة', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'أضف بيض لفطور السبت الأسبوع الثاني', NOW));
    expect(plan.permission).toEqual({ page: 'menu', action: 'edit' });
    expect(plan.ops).toEqual([
      {
        table: 'menu_items',
        action: 'insert',
        values: {
          week_number: 2,
          day_of_week: 6,
          meal_type: 'breakfast',
          meal_id: 'm-egg',
          category: 'hot',
          position: 0,
          entity_type: 'beneficiary',
        },
      },
    ]);
  });

  it('يشتقّ الأسبوع الحالي من آخر أمر تشغيل', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'أضف بيض لفطور السبت هذا الأسبوع', NOW));
    expect((plan.ops[0] as { values: Row }).values.week_number).toBe(3);
    expect(plan.warnings.join(' ')).toContain('2026-08-09');
  });

  it('لا يكرّر صنفاً موجوداً في نفس الخانة', async () => {
    const { client } = db({
      menu_items: [
        { id: 'mi-1', week_number: 2, day_of_week: 6, meal_type: 'breakfast', meal_id: 'm-egg', entity_type: 'beneficiary' },
      ],
    });
    const r = await planFromText(client, 'أضف بيض لفطور السبت الأسبوع الثاني', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'لا جديد' });
  });

  it('يحذف من القائمة', async () => {
    const { client } = db({
      menu_items: [
        { id: 'mi-1', week_number: 2, day_of_week: 6, meal_type: 'breakfast', meal_id: 'm-egg', entity_type: 'beneficiary' },
      ],
    });
    const plan = asPlan(await planFromText(client, 'احذف بيض من فطور السبت الأسبوع الثاني', NOW));
    expect(plan.ops).toEqual([{ table: 'menu_items', action: 'delete', match: { id: 'mi-1' } }]);
  });
});

describe('planFromText — صنف جديد', () => {
  it('ينشئ الصنف بالنوع الصحيح', async () => {
    const { client } = db();
    const plan = asPlan(await planFromText(client, 'أضف صنف جديد اسمه شوربة عدس غداء', NOW));
    expect(plan.permission).toEqual({ page: 'meals', action: 'add' });
    expect((plan.ops[0] as { values: Row }).values).toMatchObject({
      name: 'شوربة عدس',
      type: 'lunch',
      is_snack: false,
    });
  });

  it('يمنع التكرار لو الاسم موجود', async () => {
    const { client } = db();
    const r = await planFromText(client, 'أضف صنف جديد اسمه بيض فطور', NOW);
    expect(r).toMatchObject({ type: 'problem', title: 'الصنف موجود' });
  });
});

// ── التوقيع والتنفيذ ───────────────────────────────────────────────────────

describe('توقيع الخطة', () => {
  it('ثابت لنفس الأمر على نفس البيانات', async () => {
    const a = asPlan(await planFromText(db().client, 'خلّي أحمد العلي ياكل بيض بدل الفول', NOW));
    const b = asPlan(await planFromText(db().client, 'خلّي أحمد العلي ياكل بيض بدل الفول', NOW));
    expect(a.signature).toBe(b.signature);
  });

  it('يتغيّر لو تغيّرت البيانات تحت المعاينة', async () => {
    const a = asPlan(await planFromText(db().client, 'خلّي أحمد العلي ياكل بيض بدل الفول', NOW));
    const changed = db({
      exclusions: [{ id: 'e-1', beneficiary_id: 'p-1', meal_id: 'm-foul', alternative_meal_id: null }],
    });
    const b = asPlan(await planFromText(changed.client, 'خلّي أحمد العلي ياكل بيض بدل الفول', NOW));
    expect(a.signature).not.toBe(b.signature);
  });
});

describe('executePlan', () => {
  it('ينفّذ كل العمليات ويرجّع العدد', async () => {
    const { client, writes } = db();
    const plan = asPlan(
      await planFromText(client, 'حط لأحمد العلي صنف ثابت بيض يوم السبت والثلاثاء فطور', NOW),
    );

    const out = await executePlan(client, plan, { userId: 'u-1' });
    expect(out.ok).toBe(true);
    expect(out.applied).toBe(2);

    const inserts = writes.filter((w) => w.action === 'insert' && w.table === 'beneficiary_fixed_meals');
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values).toMatchObject({ beneficiary_id: 'p-1', meal_id: 'm-egg', day_of_week: 6 });
  });

  it('ينفّذ التحديث بالمطابقة الصحيحة', async () => {
    const { client, writes } = db();
    const plan = asPlan(await planFromText(client, 'غيّر فيلا أحمد العلي إلى 3', NOW));
    await executePlan(client, plan, { userId: 'u-1' });

    const upd = writes.find((w) => w.action === 'update' && w.table === 'beneficiaries');
    expect(upd?.values).toEqual({ villa: '3' });
    expect(upd?.match).toEqual({ id: 'p-1' });
  });
});
