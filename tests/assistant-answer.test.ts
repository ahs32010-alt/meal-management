import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ask } from '@/lib/assistant/answer';
import { buildMenuPeriodReport } from '@/lib/menu-period-report';
import type { AnswerBlock, StatItem } from '@/lib/assistant/types';

// ── عميل Supabase مزيّف ────────────────────────────────────────────────────
// يكفي لتشغيل نفس مسار الكود الحقيقي: select/order/limit/eq/in ثم await.

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  constructor(private rows: Row[]) {}
  select() { return this; }
  order() { return this; }
  limit(n: number) { this.rows = this.rows.slice(0, n); return this; }
  // يحاكي .range() الحقيقي — الكود يقرأ الجداول الكبيرة على دفعات
  range(from: number, to: number) { this.rows = this.rows.slice(from, to + 1); return this; }
  eq(col: string, val: unknown) { this.rows = this.rows.filter((r) => r[col] === val); return this; }
  in(col: string, vals: unknown[]) { this.rows = this.rows.filter((r) => vals.includes(r[col])); return this; }
  then<A, B = never>(
    onOk?: ((v: { data: Row[]; error: null }) => A | PromiseLike<A>) | null,
    onErr?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve({ data: this.rows, error: null as null }).then(onOk, onErr);
  }
}

function fakeClient(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from: (table: string) => new FakeQuery([...(tables[table] ?? [])]),
  } as unknown as SupabaseClient;
}

// ── بيانات الاختبار ────────────────────────────────────────────────────────
// برتقال يُقدَّم فطوراً في الأسبوع ٣ يوم الأحد.
// b1 يأكله، b2 ممنوع عليه وبديله تفاح، b3 ممنوع عليه بلا بديل، b4 معطّل مؤقتاً.

const ORANGE = { id: 'm1', name: 'برتقال', english_name: 'Orange', type: 'breakfast', is_snack: false, category: 'cold' };
const APPLE = { id: 'm2', name: 'تفاح', english_name: 'Apple', type: 'breakfast', is_snack: false, category: 'cold' };
const RICE = { id: 'm3', name: 'أرز بخاري', english_name: 'Bukhari Rice', type: 'lunch', is_snack: false, category: 'hot' };

const person = (
  id: string,
  name: string,
  over: Partial<Row> = {},
): Row => ({
  id,
  name,
  english_name: null,
  code: id.toUpperCase(),
  category: 'عام',
  villa: '1',
  diet_type: 'عادي',
  is_active: true,
  entity_type: 'beneficiary',
  exclusions: [],
  fixed_meals: [],
  ...over,
});

const TABLES: Record<string, Row[]> = {
  meals: [ORANGE, APPLE, RICE],
  beneficiaries: [
    person('b1', 'أحمد العلي'),
    person('b2', 'خالد السالم', {
      exclusions: [{ id: 'e1', meal_id: 'm1', alternative_meal_id: 'm2' }],
    }),
    person('b3', 'سعد المطيري', {
      exclusions: [{ id: 'e2', meal_id: 'm1', alternative_meal_id: null }],
    }),
    person('b4', 'فهد الدوسري', { is_active: false }),
    person('c1', 'مرافق واحد', { entity_type: 'companion', villa: '2' }),
  ],
  menu_items: [
    {
      id: 'mi1',
      week_number: 3,
      day_of_week: 0,
      meal_type: 'breakfast',
      meal_id: 'm1',
      category: 'cold',
      position: 1,
      multiplier: 1,
      entity_type: 'beneficiary',
      meals: ORANGE,
    },
  ],
  exclusions: [
    { id: 'e1', beneficiary_id: 'b2', meal_id: 'm1', alternative_meal_id: 'm2' },
    { id: 'e2', beneficiary_id: 'b3', meal_id: 'm1', alternative_meal_id: null },
  ],
  beneficiary_fixed_meals: [],
  daily_orders: [{ date: '2026-08-09', week_number: 3, day_of_week: 0, meal_type: 'breakfast' }],
};

const db = () => fakeClient(TABLES);
const NOW = new Date('2026-08-09T09:00:00Z'); // الأحد ضمن نفس أسبوع أمر التشغيل

function statValue(blocks: AnswerBlock[], label: string): string | undefined {
  for (const b of blocks) {
    if (b.type !== 'stats') continue;
    const hit = (b.items as StatItem[]).find((s) => s.label === label);
    if (hit) return hit.value;
  }
  return undefined;
}

function tableRows(blocks: AnswerBlock[]): Array<Array<string | number>> {
  const t = blocks.find((b) => b.type === 'table');
  return t && t.type === 'table' ? t.rows : [];
}

describe('ask — مواعيد تقديم صنف', () => {
  it('يجيب الأسبوع واليوم والوجبة', async () => {
    const a = await ask(db(), 'متى يُقدَّم البرتقال؟', NOW);
    expect(a.ok).toBe(true);
    expect(a.intent).toBe('meal_schedule');
    expect(a.title).toContain('برتقال');
    const rows = tableRows(a.blocks);
    expect(rows).toHaveLength(1);
    expect(rows[0][0]).toBe('الأسبوع 3');
    expect(rows[0][1]).toBe('الأحد');
    expect(rows[0][2]).toBe('فطور');
  });

  it('يقول بوضوح لما الصنف غير مُدرَج في القائمة', async () => {
    const a = await ask(db(), 'متى يُقدَّم التفاح؟', NOW);
    expect(a.ok).toBe(true);
    expect(a.summary).toContain('غير مُدرَج');
  });

  it('يعترف بعدم وجود الصنف بدل ما يخترع نتيجة', async () => {
    const a = await ask(db(), 'متى يُقدَّم الكافيار؟', NOW);
    expect(a.ok).toBe(false);
    expect(a.summary).toContain('ما لقيت');
  });
});

describe('ask — كميات صنف', () => {
  it('يطابق رقمه تماماً رقم تقرير الفترة', async () => {
    const a = await ask(db(), 'كم عدد المستفيدين اللي ياكلون برتقال الأسبوع الثالث؟', NOW);
    expect(a.ok).toBe(true);
    expect(a.intent).toBe('meal_consumption');

    // نفس الحساب مباشرةً من دالة التقارير — لازم يتطابقان
    const report = await buildMenuPeriodReport(db(), {
      selections: { '3': [0] },
      entity_type: 'beneficiary',
    });
    const expected = report?.aggregated.itemsSummary.find((x) => x.meal.id === 'm1')?.quantity ?? 0;

    expect(statValue(a.blocks, 'إجمالي الحصص')).toBe(String(expected));
  });

  it('يحسب المستثنين النشطين فقط ويستبعد المعطّل', async () => {
    const a = await ask(db(), 'كم عدد المستفيدين اللي ياكلون برتقال الأسبوع الثالث؟', NOW);
    // b1 فقط يأكله (b2 و b3 ممنوع عليهم، b4 معطّل)
    expect(statValue(a.blocks, 'إجمالي الحصص')).toBe('1');
    expect(statValue(a.blocks, 'مستثنون من الصنف')).toBe('2');
  });

  it('يرجّع صفراً بوضوح لو الصنف غير مجدول في الفترة', async () => {
    const a = await ask(db(), 'كم حصة من الأرز في الأسبوع الثاني؟', NOW);
    expect(a.ok).toBe(true);
    expect(a.summary).toContain('غير مُجدوَل');
  });
});

describe('ask — الممنوعات', () => {
  it('يسرد المستثنين وبدائلهم', async () => {
    const a = await ask(db(), 'مين ممنوع عليه البرتقال؟', NOW);
    expect(a.ok).toBe(true);
    expect(a.intent).toBe('meal_exclusions');
    const rows = tableRows(a.blocks);
    expect(rows).toHaveLength(2);
    const khaled = rows.find((r) => r[0] === 'خالد السالم');
    expect(khaled?.[4]).toBe('تفاح');
    const saad = rows.find((r) => r[0] === 'سعد المطيري');
    expect(saad?.[4]).toContain('بدون بديل');
  });
});

describe('ask — أعداد المستفيدين', () => {
  it('يعدّ المستفيدين ويفصل النشط عن المعطّل', async () => {
    const a = await ask(db(), 'كم عدد المستفيدين؟', NOW);
    expect(a.ok).toBe(true);
    expect(statValue(a.blocks, 'الإجمالي')).toBe('4'); // بدون المرافق
    expect(statValue(a.blocks, 'نشط')).toBe('3');
    expect(statValue(a.blocks, 'معطّل مؤقتاً')).toBe('1');
  });

  it('يحترم فلتر المرافقين', async () => {
    const a = await ask(db(), 'كم عدد المرافقين؟', NOW);
    expect(statValue(a.blocks, 'الإجمالي')).toBe('1');
  });
});

describe('ask — التوزيع والبطاقات', () => {
  it('يوزّع النشطين حسب الفيلا', async () => {
    const a = await ask(db(), 'توزيع المستفيدين حسب الفيلا', NOW);
    expect(a.ok).toBe(true);
    const rows = tableRows(a.blocks);
    expect(rows[0][0]).toBe('1');
    expect(rows[0][1]).toBe('3'); // b1,b2,b3 نشطون في فيلا 1
  });

  it('يعرض بطاقة مستفيد مع ممنوعاته', async () => {
    const a = await ask(db(), 'معلومات خالد السالم', NOW);
    expect(a.ok).toBe(true);
    expect(a.intent).toBe('entity_profile');
    expect(a.title).toBe('خالد السالم');
    expect(a.summary).toContain('1 ممنوع');
  });
});

describe('ask — أكثر الأصناف استهلاكاً', () => {
  it('يرتّب حسب الحصص المحسوبة', async () => {
    const a = await ask(db(), 'أكثر الأصناف استهلاكاً في الأسبوع الثالث', NOW);
    expect(a.ok).toBe(true);
    expect(a.intent).toBe('top_meals');
    const rows = tableRows(a.blocks);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0][1]).toBe('برتقال');
  });
});

describe('ask — الأسبوع النسبي', () => {
  it('يشتقّ الأسبوع الحالي من آخر أمر تشغيل ويوضّح المصدر', async () => {
    const a = await ask(db(), 'كم عدد المستفيدين اللي ياكلون برتقال هذا الأسبوع؟', NOW);
    expect(a.ok).toBe(true);
    expect(a.title).toContain('الأسبوع 3');
    const note = a.blocks.find((b) => b.type === 'note');
    expect(note && note.type === 'note' && note.text).toContain('2026-08-09');
  });

  it('يرفض التخمين لما ما فيه أمر تشغيل مرجعي', async () => {
    const empty = fakeClient({ ...TABLES, daily_orders: [] });
    const a = await ask(empty, 'كم عدد المستفيدين اللي ياكلون برتقال الأسبوع الجاي؟', NOW);
    expect(a.ok).toBe(false);
    expect(a.title).toBe('حدّد الأسبوع');
  });
});

describe('ask — الاستكشاف والمساعدة', () => {
  it('يفهم الاسم المجرّد كصنف', async () => {
    const a = await ask(db(), 'برتقال', NOW);
    expect(a.intent).toBe('meal_schedule');
  });

  it('يفهم الاسم المجرّد كشخص', async () => {
    const a = await ask(db(), 'أحمد العلي', NOW);
    expect(a.intent).toBe('entity_profile');
  });

  it('يعرض أمثلة لما ما يفهم السؤال', async () => {
    const a = await ask(db(), 'هل', NOW);
    expect(a.ok).toBe(false);
    expect(a.intent).toBe('help');
  });
});
