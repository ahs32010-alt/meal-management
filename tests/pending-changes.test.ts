import { describe, it, expect, vi } from 'vitest';

// pending-actions يسحب activity-log ← عميل Supabase الحقيقي عند التحميل
vi.mock('@/lib/activity-log', () => ({ logActivity: vi.fn() }));
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadChangeSet } from '@/lib/pending-changes';
import type { PendingAction } from '@/lib/pending-actions';

/** Supabase وهمي: يرجّع صفوف الجدول كما هي بغض النظر عن الفلاتر */
function fakeSupabase(tables: Record<string, unknown[]>): SupabaseClient {
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    const chain = () => q;
    Object.assign(q, {
      select: chain, eq: chain, in: chain,
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res),
    });
    return q;
  };
  return { from: (t: string) => query(tables[t] ?? []) } as unknown as SupabaseClient;
}

const pa = (payload: Record<string, unknown>, extra: Partial<PendingAction> = {}): PendingAction => ({
  id: 'p1', user_id: 'u', user_name: 'u', action: 'update', entity_type: 'beneficiary',
  entity_id: 'b1', entity_name: 'أحمد', payload, status: 'pending',
  reviewed_by: null, reviewed_at: null, reject_reason: null, created_at: '', ...extra,
});

const meals = ['m1', 'm2', 'm3', 'm4', 'a1', 'a2', 'old'].map(id => ({ id, name: id.toUpperCase() }));

describe('loadChangeSet — المستفيد', () => {
  const db = fakeSupabase({
    beneficiaries: [{ id: 'b1', name: 'أحمد', villa: '1' }],
    exclusions: [
      { meal_id: 'old', alternative_meal_id: null, diet_id: null },
      { meal_id: 'm4', alternative_meal_id: null, diet_id: 'd1' }, // من نظام — لا يُحسب
    ],
    beneficiary_fixed_meals: [{ id: 'f1', meal_id: 'm1', meal_type: 'lunch', day_of_week: 0, quantity: 1, diet_id: 'd1' }],
    beneficiary_diets: [{ diet_id: 'd1' }],
    beneficiary_menu_overrides: [],
    meals,
    diet_systems: [{ id: 'd1', name: 'سكري' }],
  });
  const request = pa({
    beneficiary: { name: 'أحمد', villa: '2' },
    exclusions: [
      { meal_id: 'm1', alternative_meal_id: 'a1' },
      { meal_id: 'm2', alternative_meal_id: 'a2' },
      { meal_id: 'm3', alternative_meal_id: null },
    ],
    fixed_meals: [],
    diet_ids: ['d1'],
  });

  it('يفكّك كل محظور لتغيير مستقل ويتجاهل صفوف الأنظمة', async () => {
    const cs = await loadChangeSet(db, request);
    expect(cs.changes.map(c => c.id).sort()).toEqual(['ex:m1', 'ex:m2', 'ex:m3', 'ex:old', 'field:villa']);
  });

  it('الاعتماد الجزئي يبني الحالة الحالية + المختار فقط', async () => {
    const cs = await loadChangeSet(db, request);
    const out = cs.build(new Set(['ex:m1', 'ex:m3'])) as {
      beneficiary: Record<string, unknown>;
      exclusions: { meal_id: string; alternative_meal_id: string | null }[];
      fixed_meals: unknown[];
      diet_ids: string[];
    };
    expect(out.beneficiary).toEqual({}); // الفيلا مرفوضة
    expect(out.exclusions.map(e => e.meal_id).sort()).toEqual(['m1', 'm3', 'old']); // old باقٍ لأن إزالته ما اعتُمدت
    expect(out.exclusions.find(e => e.meal_id === 'm1')?.alternative_meal_id).toBe('a1');
    expect(out.fixed_meals).toEqual([]); // صف النظام ما يرجع كصف شخصي
    expect(out.diet_ids).toEqual(['d1']);
  });
});

describe('loadChangeSet — النظام الغذائي', () => {
  it('إنشاء: الأساس مقفول وكل استبعاد وصنف ثابت قابل للفصل', async () => {
    const db = fakeSupabase({ meals });
    const cs = await loadChangeSet(db, pa({
      diet: { name: 'سكري', description: null },
      exclusions: [{ meal_id: 'm1', alternative_meal_id: 'a1' }, { meal_id: 'm2', alternative_meal_id: null }],
      fixed_meals: [{ day_of_week: 1, meal_type: 'lunch', meal_id: 'm3', quantity: 2, is_alternative: false }],
    }, { action: 'create', entity_type: 'diet', entity_id: null }));
    expect(cs.changes.find(c => c.id === 'base')?.locked).toBe(true);
    const out = cs.build(new Set(['base', 'ex:m2'])) as { exclusions: { meal_id: string }[]; fixed_meals: unknown[] };
    expect(out.exclusions.map(e => e.meal_id)).toEqual(['m2']);
    expect(out.fixed_meals).toEqual([]);
  });
});
