import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, ItemCategory, MealType } from '@/lib/types';
import { fetchAllRows } from '@/lib/fetch-all';
import { isSnackPosition, mainPosition, positionRowIndex, snackPosition } from '@/lib/menu-utils';

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

export type ExistingMenuRow = {
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
    return fetchAllRows<ExistingMenuRow>((from, to) => {
      const q = supabase.from('menu_items').select(sel).in('week_number', weeks).order('id').range(from, to);
      // الـselect نصّه ديناميكي (أعمدة اختيارية) فما يقدر supabase يستنتج النوع
      return (withEntity ? q.eq('entity_type', entityType) : q) as unknown as
        PromiseLike<{ data: ExistingMenuRow[] | null; error: PostgrestError | null }>;
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

  // ── 2. ما الذي تغيّر فعلاً؟ ───────────────────────────────────────────────
  const plan = planMenuImport(existingRes.data ?? [], rows, entityType, mode, { withExtraQty, withEntity });
  const { toWrite, staleIds } = plan;
  const { inserted, updated, unchanged } = plan;

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
  for (const part of chunk(staleIds, WRITE_CHUNK)) {
    const { error } = await supabase.from('menu_items').delete().in('id', part);
    if (error) throw error;
    deleted += part.length;
  }

  return { inserted, updated, deleted, unchanged };
}

export interface MenuImportPlan {
  toWrite:   Record<string, unknown>[];
  staleIds:  string[];
  inserted:  number;
  updated:   number;
  unchanged: number;
}

/**
 * الجزء الحسابي من الاستيراد (بلا قاعدة بيانات) — قابل للاختبار مباشرة.
 *
 * وضع الإضافة: أصناف الملف تأخذ ترتيبها من الملف (0،1،2…)، والأصناف الموجودة في
 * نفس الخانة وغير المذكورة في الملف تبقى — لكن كانت تحتفظ بأرقامها القديمة
 * فيتصادم رقمان على نفس الصف ويتحدّد الترتيب عشوائياً (حسب المعرّف). الآن تُرحَّل
 * بعد أصناف الملف بنفس ترتيبها النسبي.
 */
export function planMenuImport(
  existing: ExistingMenuRow[],
  rows: MenuImportRow[],
  entityType: EntityType,
  mode: MenuImportMode,
  flags: { withExtraQty: boolean; withEntity: boolean } = { withExtraQty: true, withEntity: true },
): MenuImportPlan {
  const { withExtraQty, withEntity } = flags;
  const existingByKey = new Map<string, ExistingMenuRow>();
  for (const r of existing) existingByKey.set(rowKey(r), r);

  const targetKeys = new Set<string>();
  const toWrite: Record<string, unknown>[] = [];
  let inserted = 0, updated = 0, unchanged = 0;

  const writeIfChanged = (r: MenuImportRow, countNew: boolean) => {
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

    const prev = existingByKey.get(rowKey(r));
    if (!prev) { if (countNew) inserted++; toWrite.push(payload); return; }

    const same =
      prev.category === r.category &&
      prev.position === r.position &&
      (prev.multiplier ?? 1) === r.multiplier &&
      (!withExtraQty || (prev.extra_quantity ?? 0) === r.extra_quantity) &&
      (!withEntity || (prev.entity_type ?? entityType) === entityType);

    if (same) { unchanged++; return; }
    updated++;
    toWrite.push(payload);
  };

  // عدد الأصناف الأساسية/السناك لكل خانة في الملف — لترحيل الأصناف الباقية بعدها
  const slotOf = (r: { week_number: number; day_of_week: number; meal_type: string }) =>
    `${r.week_number}|${r.day_of_week}|${r.meal_type}`;
  const fileCounts = new Map<string, { mains: number; snacks: number }>();

  for (const r of rows) {
    const key = rowKey(r);
    if (targetKeys.has(key)) continue; // حارس أخير — القارئ يمنع التكرار أصلاً
    targetKeys.add(key);
    const c = fileCounts.get(slotOf(r)) ?? { mains: 0, snacks: 0 };
    if (r.category === 'snack') c.snacks++; else c.mains++;
    fileCounts.set(slotOf(r), c);
    writeIfChanged(r, true);
  }

  const leftovers = existing.filter(r => !targetKeys.has(rowKey(r)));

  if (mode === 'append') {
    // ترحيل الأصناف الباقية في الخانات التي لمسها الملف — بترتيبها الحالي
    const bySlot = new Map<string, ExistingMenuRow[]>();
    for (const r of leftovers) {
      if (!fileCounts.has(slotOf(r))) continue;
      const list = bySlot.get(slotOf(r)) ?? [];
      list.push(r);
      bySlot.set(slotOf(r), list);
    }
    for (const [slot, list] of bySlot) {
      const counts = fileCounts.get(slot)!;
      const isSnack = (r: ExistingMenuRow) => r.category === 'snack' || isSnackPosition(r.position);
      const ordered = [...list].sort((a, b) =>
        positionRowIndex(a.position) - positionRowIndex(b.position) || String(a.id).localeCompare(String(b.id)));
      let nextMain = counts.mains, nextSnack = counts.snacks;
      for (const r of ordered) {
        const snack = isSnack(r);
        writeIfChanged({
          week_number:    r.week_number,
          day_of_week:    r.day_of_week,
          meal_type:      r.meal_type,
          meal_id:        r.meal_id,
          category:       r.category,
          position:       snack ? snackPosition(nextSnack++) : mainPosition(nextMain++),
          multiplier:     r.multiplier ?? 1,
          extra_quantity: r.extra_quantity ?? 0,
        }, false);
      }
    }
  }

  // وضع الاستبدال فقط: ما ليس في الملف يُحذف (بالمعرّف، بعد نجاح الكتابة)
  const staleIds = mode === 'replace' ? leftovers.map(r => r.id) : [];

  return { toWrite, staleIds, inserted, updated, unchanged };
}
