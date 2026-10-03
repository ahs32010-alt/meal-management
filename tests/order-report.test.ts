import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildOrderReport } from '@/lib/order-report';

/**
 * عميل Supabase وهمي: كل جدول يرجّع صفوفه كما هي (الفلاتر تُتجاهل)، و`range`
 * يقطع، و`single` يرجّع أول صف — يكفي لحساب التقرير بلا قاعدة بيانات.
 */
function fakeSupabase(tables: Record<string, unknown[]>): SupabaseClient {
  const builder = (rows: unknown[]) => {
    let out = rows;
    let single = false;
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'in', 'order', 'gte', 'lte']) b[m] = chain;
    b.range = (from: number, to: number) => { out = rows.slice(from, to + 1); return b; };
    b.single = () => { single = true; return b; };
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: single ? out[0] ?? null : out, error: null });
    return b;
  };
  return { from: (t: string) => builder(tables[t] ?? []) } as unknown as SupabaseClient;
}

const meal = (id: string, name: string, is_snack = false) => ({ id, name, english_name: '', type: 'main', is_snack });

describe('buildOrderReport — اسم الصنف في الأمر (display_name)', () => {
  it('الاسم المعدّل يبقى في إحصاء الأصناف حتى لو كان الصنف بديلاً لمستفيد', async () => {
    const rice = meal('rice', 'رز');
    const soup = meal('soup', 'شوربة');
    const supabase = fakeSupabase({
      daily_orders: [{
        id: 'o1', date: '2026-10-01', meal_type: 'lunch', day_of_week: 4, week_number: null, entity_type: 'beneficiary',
        order_items: [
          { id: 'i1', meal_id: 'rice', display_name: 'رز بخاري', extra_quantity: 0, category: 'hot', multiplier: 1, meals: rice },
          { id: 'i2', meal_id: 'soup', display_name: null, extra_quantity: 0, category: 'hot', multiplier: 1, meals: soup },
        ],
      }],
      beneficiaries: [
        // الأخير في الترتيب يأخذ الرز بديلاً عن الشوربة — كان يُرجع الاسم الخام «رز»
        { id: 'a', name: 'أ', code: '1', category: '', created_at: '', exclusions: [], fixed_meals: [] },
        { id: 'b', name: 'ب', code: '2', category: '', created_at: '', fixed_meals: [],
          exclusions: [{ id: 'e1', meal_id: 'soup', alternative_meal_id: 'rice' }] },
      ],
      meals: [rice, soup],
    });

    const r = await buildOrderReport(supabase, 'o1') as {
      itemsSummary: { meal: { id: string; name: string }; quantity: number }[];
      altSummary: { meal: { id: string; name: string }; qty: number }[];
    };
    const riceRow = r.itemsSummary.find(x => x.meal.id === 'rice')!;
    expect(riceRow.meal.name).toBe('رز بخاري');
    expect(riceRow.quantity).toBe(3); // ٢ مباشر + ١ بديل
    expect(r.altSummary.map(x => x.meal.name)).toEqual(['رز بخاري']);
    // ما ينقسم الصنف الواحد على بندين باسمين مختلفين
    expect(r.itemsSummary.filter(x => x.meal.name.startsWith('رز'))).toHaveLength(1);
  });
});
