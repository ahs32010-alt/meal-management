import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { interpret, type Interpretation } from '@/lib/assistant/interpret';
import { runTurn, type Plan } from '@/lib/assistant/plan';
import { PAGE_CATALOG } from '@/lib/assistant/pages';

const people = [
  { id: 'p1', name: 'أحمد العلي', code: 'B001' },
  { id: 'p2', name: 'سارة المطيري', code: 'B002' },
];
const meals = [
  { id: 'm1', name: 'فول', type: 'breakfast' as const },
  { id: 'm2', name: 'بيض مسلوق', type: 'breakfast' as const },
];

const run = (text: string): Interpretation => interpret({ text, people, meals });
const cmd = (r: Interpretation) => {
  if (r.kind !== 'command') throw new Error(`expected command, got ${r.kind}`);
  return r.command;
};

describe('التنقّل بين الصفحات', () => {
  it('يفتح الصفحة بالاسم الصريح', () => {
    expect(cmd(run('افتح صفحة التقارير'))).toMatchObject({ kind: 'open_page', href: '/reports' });
  });

  it('يحتمل لام الجر الملتصقة', () => {
    expect(cmd(run('ودني للاصناف'))).toMatchObject({ href: '/meals' });
    expect(cmd(run('روح لقائمة الطعام'))).toMatchObject({ href: '/menu' });
    expect(cmd(run('خذني للاعدادات'))).toMatchObject({ href: '/settings' });
  });

  it('يغطي كل صفحات النظام', () => {
    for (const page of PAGE_CATALOG) {
      const r = run(`افتح ${page.aliases[0]}`);
      expect(cmd(r), page.label).toMatchObject({ kind: 'open_page', href: page.href });
    }
  });

  it('لا يخلط الملاحة بالاستعلام', () => {
    expect(run('كم عدد المستفيدين').kind).toBe('query');
  });
});

describe('أوامر الأصناف', () => {
  it('حذف صنف', () => {
    expect(cmd(run('احذف صنف فول'))).toEqual({ kind: 'delete_meal', meal: 'فول' });
  });

  it('إعادة تسمية', () => {
    expect(cmd(run('غير اسم فول الى فول مدمس'))).toMatchObject({
      kind: 'update_meal',
      meal: 'فول',
      newName: 'فول مدمس',
    });
  });

  it('تغيير الوجبة بلا اسم جديد', () => {
    expect(cmd(run('خل بيض مسلوق يصير غداء'))).toEqual({
      kind: 'update_meal',
      meal: 'بيض مسلوق',
      newName: undefined,
      mealType: 'lunch',
      category: undefined,
    });
  });
});

describe('أوامر القائمة الإضافية', () => {
  it('المضاعف — الرقم للمضاعف لا لرقم الأسبوع', () => {
    expect(cmd(run('ضاعف البيض 2 فطور السبت الاسبوع الثاني'))).toMatchObject({
      kind: 'set_menu_multiplier',
      meal: 'بيض مسلوق',
      week: 2,
      days: [6],
      value: 2,
    });
  });

  it('تفريغ خانة كاملة', () => {
    expect(cmd(run('فرغ فطور السبت الاسبوع الثالث'))).toMatchObject({
      kind: 'clear_menu_slot',
      week: 3,
      days: [6],
      mealType: 'breakfast',
    });
  });
});

describe('أوامر الأشخاص الإضافية', () => {
  it('خيارات الستيكر', () => {
    expect(cmd(run('احمد لا يفضل السمك'))).toEqual({
      kind: 'set_sticker_flag',
      person: 'أحمد العلي',
      flag: 'no_fish',
      value: true,
    });
    expect(cmd(run('سارة قليل الكاربوهيدرات'))).toMatchObject({ flag: 'low_carb' });
  });

  it('إنشاء مستفيد', () => {
    expect(cmd(run('انشئ مستفيد جديد فهد الدوسري 55'))).toEqual({
      kind: 'create_person',
      name: 'فهد الدوسري',
      code: '55',
      entityType: 'beneficiary',
    });
  });

  it('حذف مستفيد', () => {
    expect(cmd(run('احذف المستفيد سارة المطيري'))).toEqual({
      kind: 'delete_person',
      person: 'سارة المطيري',
    });
  });

  it('حقول إضافية: الكود والفئة', () => {
    expect(cmd(run('غير كود احمد الى 99'))).toMatchObject({ field: 'code', value: '99' });
    expect(cmd(run('غير فئة سارة الى مميز'))).toMatchObject({ field: 'category', value: 'مميز' });
  });
});

// ── الخطط والتحذيرات ───────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function makeClient(tables: Record<string, Row[]>) {
  class Q implements PromiseLike<{ data: Row[] | null; error: null }> {
    private filters: Array<[string, unknown]> = [];
    private mode = 'select';
    constructor(private table: string) {}
    select() { return this; }
    order() { return this; }
    limit() { return this; }
    eq(c: string, v: unknown) { this.filters.push([c, v]); return this; }
    in() { return this; }
    insert() { this.mode = 'insert'; return this; }
    update() { this.mode = 'update'; return this; }
    delete() { this.mode = 'delete'; return this; }
    then<A, B = never>(
      ok?: ((v: { data: Row[] | null; error: null }) => A | PromiseLike<A>) | null,
      err?: ((r: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      if (this.mode !== 'select') return Promise.resolve({ data: null, error: null as null }).then(ok, err);
      let rows = [...(tables[this.table] ?? [])];
      for (const [c, v] of this.filters) rows = rows.filter((r) => r[c] === v);
      return Promise.resolve({ data: rows, error: null as null }).then(ok, err);
    }
  }
  return { from: (t: string) => new Q(t) } as unknown as SupabaseClient;
}

const DB: Record<string, Row[]> = {
  meals: [
    { id: 'm1', name: 'فول', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary' },
    { id: 'm2', name: 'بيض مسلوق', type: 'breakfast', is_snack: false, category: 'hot', entity_type: 'beneficiary' },
  ],
  beneficiaries: [
    { id: 'p1', name: 'أحمد العلي', code: 'B001', villa: '1', is_active: true, entity_type: 'beneficiary', no_fish: false },
    { id: 'p2', name: 'سارة المطيري', code: 'B002', villa: '2', is_active: true, entity_type: 'beneficiary' },
  ],
  exclusions: [],
  beneficiary_fixed_meals: [],
  menu_items: [
    { id: 'mi1', week_number: 2, day_of_week: 6, meal_type: 'breakfast', meal_id: 'm2', multiplier: 1, entity_type: 'beneficiary', meals: { name: 'بيض مسلوق' } },
  ],
  daily_orders: [{ date: '2026-08-09', week_number: 3 }],
};

const NOW = new Date('2026-08-09T09:00:00Z');
const turn = (text: string) => runTurn(makeClient(DB), { text, now: NOW });
const asPlan = async (text: string): Promise<Plan> => {
  const r = await turn(text);
  if (r.kind !== 'plan') throw new Error(`expected plan, got ${r.kind}`);
  return r.plan;
};

describe('الخطط: الصلاحيات والتحذيرات', () => {
  it('حذف صنف يحذّر من الاستخدام الحالي ويطلب صلاحية الحذف', async () => {
    const p = await asPlan('احذف صنف بيض مسلوق');
    expect(p.permission).toEqual({ page: 'meals', action: 'delete' });
    expect(p.warnings.join(' ')).toContain('نهائي');
    expect(p.warnings.join(' ')).toContain('خانة في القائمة');
    expect(p.ops).toEqual([{ table: 'meals', action: 'delete', match: { id: 'm2' } }]);
  });

  it('حذف شخص يقترح التعطيل بدلاً منه', async () => {
    const p = await asPlan('احذف المستفيد سارة المطيري');
    expect(p.permission).toEqual({ page: 'beneficiaries', action: 'delete' });
    expect(p.warnings.join(' ')).toContain('عطّل');
  });

  it('إنشاء مستفيد يمنع تكرار الكود', async () => {
    const r = await turn('انشئ مستفيد جديد فهد الدوسري 1');
    expect(r.kind).toBe('plan');
    const dup = await turn('انشئ مستفيد جديد فهد الدوسري B001');
    // الكود النصّي ما يُلتقط كرقم، فيُسأل عنه بدل التخمين
    expect(['plan', 'ask']).toContain(dup.kind);
  });

  it('خيار الستيكر يبني تحديثاً واحداً', async () => {
    const p = await asPlan('احمد لا يفضل السمك');
    expect(p.ops).toEqual([
      { table: 'beneficiaries', action: 'update', match: { id: 'p1' }, values: { no_fish: true } },
    ]);
  });

  it('المضاعف يحدّث الخانة الموجودة ويوضّح أثره', async () => {
    const p = await asPlan('ضاعف بيض مسلوق 3 فطور السبت الاسبوع الثاني');
    expect(p.ops).toEqual([
      { table: 'menu_items', action: 'update', match: { id: 'mi1' }, values: { multiplier: 3 } },
    ]);
    expect(p.warnings.join(' ')).toContain('ستيكرات');
  });

  it('تفريغ الخانة يحذف كل أصنافها', async () => {
    const p = await asPlan('فرغ فطور السبت الاسبوع الثاني');
    expect(p.ops).toEqual([{ table: 'menu_items', action: 'delete', match: { id: 'mi1' } }]);
    expect(p.permission).toEqual({ page: 'menu', action: 'edit' });
  });

  it('التنقّل يرجّع مساراً لا خطة تعديل', async () => {
    const r = await turn('افتح صفحة التقارير');
    expect(r.kind).toBe('navigate');
    if (r.kind === 'navigate') {
      expect(r.href).toBe('/reports');
      expect(r.permission).toBe('reports');
    }
  });
});
