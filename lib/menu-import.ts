import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, ItemCategory, MealType } from '@/lib/types';
import { fetchAllRows } from '@/lib/fetch-all';

/** صف منيو جاهز للكتابة، ناتج عن قراءة ملف الاستيراد. */
export interface MenuImportRow {
  week_number:    number;
  day_of_week:    number;
  meal_type:      MealType;
  meal_id:        string;
  category:       ItemCategory;
  position:       number;
  multiplier:     number;
  extra_quantity: number;
}

export type MenuImportMode = 'append' | 'replace';

export interface MenuImportResult {
  inserted:  number;
  updated:   number;
  deleted:   number;
  unchanged: number;
}

/** مفتاح التفرّد في قاعدة البيانات: unique (week_number, day_of_week, meal_type, meal_id) */
const CONFLICT_TARGET = 'week_number,day_of_week,meal_type,meal_id';

function rowKey(r: { week_number: number; day_of_week: number; meal_type: string; meal_id: string }) {
  return `${r.week_number}|${r.day_of_week}|${r.meal_type}|${r.meal_id}`;
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const WRITE_CHUNK = 400;

type ExistingRow = {
  id: string;
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  meal_id: string;
  category: ItemCategory;
  position: number;
  multiplier: number | null;
  extra_quantity?: number | null;
  entity_type?: EntityType | null;
};

/**
 * يطبّق استيراد قائمة الطعام كـ«فرق» بدل حذف الأسبوع ثم إدراجه من جديد.
 *
 * لماذا: الطريقة القديمة كانت `delete(week) → insert(rows)`. أي فشل في الإدراج
 * (تعارض مفتاح فريد في وضع الإضافة مثلاً) يترك الأسبوع محذوفاً بلا بديل، وأي صنف
 * ما قدر الملف يعبّر عنه يختفي نهائياً. النتيجة كانت أعداد أصناف تزيد وتنقص بعد
 * كل تنزيل/رفع.
 *
 * الطريقة الحالية:
 *   1. نقرأ الحالة الحالية للأسابيع المعنية (على دفعات — الجدول قد يتجاوز ١٠٠٠ صف).
 *   2. نكتب فقط الصفوف الجديدة أو التي تغيّرت فعلاً (upsert على المفتاح الفريد).
 *   3. في وضع الاستبدال فقط: نحذف — بالمعرّف — الصفوف التي لم يعد لها وجود في الملف.
 *
 * أثر ذلك أن «تنزيل ثم رفع بدون تعديل» عملية محايدة تماماً: 0 إضافة، 0 تعديل، 0 حذف.
 */
export async function applyMenuImport(
  supabase: SupabaseClient,
  rows: MenuImportRow[],
  weeks: number[],
  entityType: EntityType,
  mode: MenuImportMode,
): Promise<MenuImportResult> {
  if (weeks.length === 0) return { inserted: 0, updated: 0, deleted: 0, unchanged: 0 };

  // ── 1. الحالة الحالية ─────────────────────────────────────────────────────
  let withExtraQty = true;
  let withEntity = true;

  const fetchExisting = async () => {
    const sel =
      `id, week_number, day_of_week, meal_type, meal_id, category, position, multiplier` +
      `${withExtraQty ? ', extra_quantity' : ''}${withEntity ? ', entity_type' : ''}`;
    return fetchAllRows<ExistingRow>((from, to) => {
      const q = supabase.from('menu_items').select(sel).in('week_number', weeks).order('id').range(from, to);
      // الـselect نصّه ديناميكي (أعمدة اختيارية) فما يقدر supabase يستنتج النوع
      return (withEntity ? q.eq('entity_type', entityType) : q) as unknown as
        PromiseLike<{ data: ExistingRow[] | null; error: PostgrestError | null }>;
    });
  };

  let existingRes = await fetchExisting();
  if (existingRes.error && /extra_quantity/i.test(existingRes.error.message)) {
    withExtraQty = false;
    existingRes = await fetchExisting();
  }
  if (existingRes.error && /entity_type/i.test(existingRes.error.message)) {
    withEntity = false;
    existingRes = await fetchExisting();
  }
  if (existingRes.error) throw existingRes.error;

  const existingByKey = new Map<string, ExistingRow>();
  for (const r of existingRes.data ?? []) existingByKey.set(rowKey(r), r);

  // ── 2. ما الذي تغيّر فعلاً؟ ───────────────────────────────────────────────
  const targetKeys = new Set<string>();
  const toWrite: Record<string, unknown>[] = [];
  let inserted = 0, updated = 0, unchanged = 0;

  for (const r of rows) {
    const key = rowKey(r);
    if (targetKeys.has(key)) continue; // حارس أخير — القارئ يمنع التكرار أصلاً
    targetKeys.add(key);

    const payload: Record<string, unknown> = {
      week_number: r.week_number,
      day_of_week: r.day_of_week,
      meal_type:   r.meal_type,
      meal_id:     r.meal_id,
      category:    r.category,
      position:    r.position,
      multiplier:  r.multiplier,
    };
    if (withExtraQty) payload.extra_quantity = r.extra_quantity;
    if (withEntity)   payload.entity_type = entityType;

    const prev = existingByKey.get(key);
    if (!prev) { inserted++; toWrite.push(payload); continue; }

    const same =
      prev.category === r.category &&
      prev.position === r.position &&
      (prev.multiplier ?? 1) === r.multiplier &&
      (!withExtraQty || (prev.extra_quantity ?? 0) === r.extra_quantity) &&
      (!withEntity || (prev.entity_type ?? entityType) === entityType);

    if (same) { unchanged++; continue; }
    updated++;
    toWrite.push(payload);
  }

  // ── 3. الكتابة ────────────────────────────────────────────────────────────
  for (const part of chunk(toWrite, WRITE_CHUNK)) {
    let { error } = await supabase.from('menu_items').upsert(part, { onConflict: CONFLICT_TARGET });
    if (error && /extra_quantity|entity_type/i.test(error.message)) {
      // عمود اختياري غير موجود (ترقية ما اتشغّلت) — نُسقطه ونعيد المحاولة
      const stripped = part.map(p => {
        const c = { ...p };
        if (/extra_quantity/i.test(error!.message)) delete c.extra_quantity;
        if (/entity_type/i.test(error!.message))    delete c.entity_type;
        return c;
      });
      ({ error } = await supabase.from('menu_items').upsert(stripped, { onConflict: CONFLICT_TARGET }));
    }
    if (error) throw error;
  }

  // ── 4. الحذف (وضع الاستبدال فقط) — بالمعرّف، بعد نجاح الكتابة ─────────────
  let deleted = 0;
  if (mode === 'replace') {
    const staleIds = [...existingByKey.entries()]
      .filter(([key]) => !targetKeys.has(key))
      .map(([, row]) => row.id);

    for (const part of chunk(staleIds, WRITE_CHUNK)) {
      const { error } = await supabase.from('menu_items').delete().in('id', part);
      if (error) throw error;
      deleted += part.length;
    }
  }

  return { inserted, updated, deleted, unchanged };
}
