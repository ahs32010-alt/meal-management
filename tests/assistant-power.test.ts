import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { interpret, type Interpretation } from '@/lib/assistant/interpret';
import { runTurn, type Op, type Plan } from '@/lib/assistant/plan';
import { captureAfterInsert, captureBefore, decodeUndo, encodeUndo } from '@/lib/assistant/undo';

const people = [
  { id: 'p1', name: 'أحمد العلي', code: 'B001' },
  { id: 'p2', name: 'سارة المطيري', code: 'B002' },
  { id: 'p3', name: 'عبدالله الشمري', code: 'B003' },
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

// ── فهم أوامر التشغيل والجماعية ────────────────────────────────────────────

describe('interpret — أوامر التشغيل', () => {
  it('إنشاء أمر بتاريخ نسبي', () => {
    expect(cmd(run('انشئ امر تشغيل فطور بكرة'))).toMatchObject({
      kind: 'create_order',
      date: 'tomorrow',
      mealType: 'breakfast',
    });
  });

  it('إنشاء أمر بتاريخ صريح', () => {
    expect(cmd(run('انشئ امر عشاء 2026-08-15'))).toMatchObject({
      kind: 'create_order',
      date: '2026-08-15',
      mealType: 'dinner',
    });
  });

  it('إضافة صنف لأمر اليوم', () => {
    expect(cmd(run('اضف بيض مسلوق لامر فطور اليوم'))).toMatchObject({
      kind: 'add_order_item',
      date: 'today',
      mealType: 'breakfast',
      meal: 'بيض مسلوق',
    });
  });

  it('حذف صنف من أمر', () => {
    expect(cmd(run('شيل الفول من امر فطور اليوم'))).toMatchObject({
      kind: 'remove_order_item',
      meal: 'فول',
    });
  });

  it('حذف الأمر كاملاً', () => {
    expect(cmd(run('احذف امر التشغيل فطور بكرة'))).toMatchObject({
      kind: 'delete_order',
      date: 'tomorrow',
    });
  });
});

describe('interpret — الأوامر الجماعية', () => {
  it('منع صنف عن فيلا كاملة', () => {
    expect(cmd(run('امنع الفول عن فيلا 3'))).toMatchObject({
      kind: 'bulk_exclusion',
      meal: 'فول',
      group: { villa: '3' },
    });
  });

  it('منع مع بديل عن الجميع', () => {
    expect(cmd(run('خلي الجميع ياكلون بيض مسلوق بدل الفول'))).toMatchObject({
      kind: 'bulk_exclusion',
      meal: 'فول',
      alternative: 'بيض مسلوق',
      group: { all: true },
    });
  });

  it('تعطيل جماعي بالفيلا', () => {
    expect(cmd(run('عطل كل المستفيدين في فيلا 2'))).toMatchObject({
      kind: 'bulk_status',
      active: false,
      group: { villa: '2', entityType: 'beneficiary' },
    });
  });

  it('لا يخلط «فيلا» كفلتر مع «فيلا» كحقل لشخص محدّد', () => {
    expect(cmd(run('غير فيلا احمد الى 3'))).toMatchObject({
      kind: 'set_person_field',
      field: 'villa',
      value: '3',
    });
  });
});

// ── التراجع ────────────────────────────────────────────────────────────────

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
    { id: 'p1', name: 'أحمد العلي', code: 'B001', villa: '3', is_active: true, entity_type: 'beneficiary' },
    { id: 'p2', name: 'سارة المطيري', code: 'B002', villa: '3', is_active: true, entity_type: 'beneficiary' },
    { id: 'p3', name: 'عبدالله الشمري', code: 'B003', villa: '1', is_active: true, entity_type: 'beneficiary' },
  ],
  exclusions: [],
  beneficiary_fixed_meals: [],
  menu_items: [],
  order_items: [{ id: 'oi1', order_id: 'o1', meal_id: 'm1' }],
  daily_orders: [
    { id: 'o1', date: '2026-08-09', meal_type: 'breakfast', week_number: 3, day_of_week: 0, entity_type: 'beneficiary' },
  ],
};

const NOW = new Date('2026-08-09T09:00:00Z');
const turn = (text: string) => runTurn(makeClient(DB), { text, now: NOW });
const asPlan = async (text: string): Promise<Plan> => {
  const r = await turn(text);
  if (r.kind !== 'plan') throw new Error(`expected plan, got ${r.kind}`);
  return r.plan;
};

describe('التقاط العمليات العكسية', () => {
  it('الحذف يُعكس بإعادة إدراج الصف كاملاً', async () => {
    const client = makeClient(DB);
    const op: Op = { table: 'order_items', action: 'delete', match: { id: 'oi1' } };
    const inverse = await captureBefore(client, op);
    expect(inverse).toEqual([
      { table: 'order_items', action: 'insert', values: { id: 'oi1', order_id: 'o1', meal_id: 'm1' } },
    ]);
  });

  it('التحديث يُعكس بالقيم السابقة للأعمدة الممسوسة فقط', async () => {
    const client = makeClient(DB);
    const op: Op = {
      table: 'beneficiaries',
      action: 'update',
      match: { id: 'p1' },
      values: { villa: '9' },
    };
    const inverse = await captureBefore(client, op);
    expect(inverse).toEqual([
      { table: 'beneficiaries', action: 'update', match: { id: 'p1' }, values: { villa: '3' } },
    ]);
  });

  it('الإدراج يُعكس بحذف المعرّف الراجع', () => {
    const op: Op = { table: 'exclusions', action: 'insert', values: { meal_id: 'm1' } };
    expect(captureAfterInsert(op, ['x1', 'x2'])).toEqual([
      { table: 'exclusions', action: 'delete', match: { id: 'x1' } },
      { table: 'exclusions', action: 'delete', match: { id: 'x2' } },
    ]);
  });
});

describe('توقيع رمز التراجع', () => {
  const payload = {
    ops: [{ table: 'meals', action: 'delete' as const, match: { id: 'm1' } }],
    permission: { page: 'meals' as const, action: 'delete' as const },
    label: 'اختبار',
    issuedAt: Date.now(),
  };

  it('يتحقّق من الرمز السليم', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key-1234567890';
    const token = encodeUndo(payload);
    expect(token).toBeTruthy();
    expect(decodeUndo(token)).toMatchObject({ label: 'اختبار' });
  });

  it('يرفض الرمز المعبوث', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key-1234567890';
    const token = encodeUndo(payload)!;
    const [body] = token.split('.');
    expect(decodeUndo(`${body}.forged`)).toBeNull();
    expect(decodeUndo('غير صالح')).toBeNull();
    expect(decodeUndo(undefined)).toBeNull();
  });

  it('يرفض الرمز المنتهي', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-secret-key-1234567890';
    const old = encodeUndo({ ...payload, issuedAt: Date.now() - 2 * 60 * 60 * 1000 })!;
    expect(decodeUndo(old)).toBeNull();
  });

  it('يرفض رمزاً وُقِّع بمفتاح آخر', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'first-secret-key-1234567890';
    const token = encodeUndo(payload)!;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'other-secret-key-0987654321';
    expect(decodeUndo(token)).toBeNull();
  });
});

// ── خطط الأوامر الجديدة ────────────────────────────────────────────────────

describe('خطط أوامر التشغيل', () => {
  it('تمنع تكرار أمر موجود', async () => {
    const r = await turn('انشئ امر تشغيل فطور اليوم');
    expect(r).toMatchObject({ kind: 'problem' });
    if (r.kind === 'problem') expect(r.problem.title).toBe('الأمر موجود');
  });

  it('تضيف صنفاً لأمر قائم', async () => {
    const p = await asPlan('اضف بيض مسلوق لامر فطور اليوم');
    expect(p.permission).toEqual({ page: 'orders', action: 'edit' });
    expect(p.ops).toEqual([
      {
        table: 'order_items',
        action: 'insert',
        values: { order_id: 'o1', meal_id: 'm2', category: 'hot', multiplier: 1, extra_quantity: 0 },
      },
    ]);
  });

  it('ترفض إضافة صنف موجود مسبقاً', async () => {
    const r = await turn('اضف فول لامر فطور اليوم');
    expect(r).toMatchObject({ kind: 'problem' });
  });

  it('تحذّر عند حذف الأمر وتعدّ بنوده', async () => {
    const p = await asPlan('احذف امر التشغيل فطور اليوم');
    expect(p.permission).toEqual({ page: 'orders', action: 'delete' });
    expect(p.warnings.join(' ')).toContain('بند');
  });
});

describe('خطط الأوامر الجماعية', () => {
  it('تمنع الصنف عن كل من في الفيلا وتسرد أسماءهم', async () => {
    const p = await asPlan('امنع الفول عن فيلا 3');
    expect(p.command).toBe('bulk_exclusion');
    expect(p.ops).toHaveLength(2); // أحمد وسارة فقط
    expect(p.warnings.join(' ')).toContain('أحمد العلي');
    expect(p.warnings.join(' ')).toContain('سارة المطيري');
    expect(p.summary).toContain('فيلا 3');
  });

  it('تعطّل مجموعة وتستثني من هو معطّل أصلاً', async () => {
    const p = await asPlan('عطل كل المستفيدين في فيلا 3');
    expect(p.command).toBe('bulk_status');
    expect(p.ops).toHaveLength(2);
    expect(p.ops.every((o) => o.action === 'update')).toBe(true);
  });

  it('ترفض المجموعة الفارغة', async () => {
    const r = await turn('امنع الفول عن فيلا 99');
    expect(r).toMatchObject({ kind: 'problem' });
  });
});
