import type { MealType, ItemCategory, MenuItem } from '@/lib/types';

export const WEEK_NUMBERS = [1, 2, 3, 4] as const;
export type WeekNumber = typeof WEEK_NUMBERS[number];

export const WEEK_TITLES: Record<WeekNumber, string> = {
  1: 'الأسبوع الأول',
  2: 'الأسبوع الثاني',
  3: 'الأسبوع الثالث',
  4: 'الأسبوع الرابع',
};

// Display order matching the menu image: Sat → Fri
export const MENU_DAYS: { value: number; label: string }[] = [
  { value: 6, label: 'السبت' },
  { value: 0, label: 'الأحد' },
  { value: 1, label: 'الإثنين' },
  { value: 2, label: 'الثلاثاء' },
  { value: 3, label: 'الأربعاء' },
  { value: 4, label: 'الخميس' },
  { value: 5, label: 'الجمعة' },
];

export const MEAL_SECTIONS: { meal_type: MealType; label: string }[] = [
  { meal_type: 'breakfast', label: 'الفطور' },
  { meal_type: 'lunch',     label: 'الغداء' },
  { meal_type: 'dinner',    label: 'العشاء' },
];

export const MAIN_ROWS_PER_MEAL = 8;
export const SNACK_ROWS_PER_MEAL = 4;

/**
 * اصطلاح `position` في جدول menu_items — مصدر واحد لكل الشاشات والاستيراد:
 *   • الصفوف الأساسية (حار + بارد): 0 .. MAIN_ROWS_PER_MEAL-1
 *   • صفوف السناك:                  100 .. 100+SNACK_ROWS_PER_MEAL-1
 *
 * كان الاستيراد يكتب أرقاماً بمنطق مختلف (رقم الصف داخل قسم الشيت) بينما
 * التحرير اليدوي يكتب المنطق أعلاه، فتختلط الأرقام وتتبدّل صفوف الأصناف بعد
 * كل عملية تنزيل/رفع. أي كود يكتب position لازم يمرّ من هذه الدوال.
 */
export const SNACK_POSITION_OFFSET = 100;

export function mainPosition(rowIndex: number): number {
  return rowIndex;
}

export function snackPosition(rowIndex: number): number {
  return SNACK_POSITION_OFFSET + rowIndex;
}

export function isSnackPosition(position: number): boolean {
  return position >= SNACK_POSITION_OFFSET;
}

/** رقم الصف داخل القسم (أساسي أو سناك) من قيمة position مهما كان اصطلاحها. */
export function positionRowIndex(position: number): number {
  const p = Number.isFinite(position) ? Math.trunc(position) : 0;
  return Math.max(0, p) % SNACK_POSITION_OFFSET;
}

export function categoryRank(c: ItemCategory): number {
  return c === 'hot' ? 0 : c === 'cold' ? 1 : 2;
}

type Categorisable = { category?: ItemCategory | null; meals?: { category?: ItemCategory | null; is_snack?: boolean | null } | null };

/**
 * الفئة المعتمدة للصنف داخل المنيو. `meals.category` هو المصدر الموحّد
 * (نفس ما تستخدمه أوامر التشغيل والستيكرات والتقارير)، و`menu_items.category`
 * نسخة قد تتقادم — لو اختلفا كان الصنف يظهر بأيقونة فئة ويُحسب في قسم آخر.
 *
 * ملاحظة: لو عمود `meals.category` غير موجود (الترقية ما اتشغّلت) نحافظ على
 * القيمة المخزّنة كما هي بدل ما نهبط «بارد» إلى «حار».
 */
export function effectiveCategory(item: Categorisable): ItemCategory {
  const mealCat = item.meals?.category;
  if (mealCat === 'hot' || mealCat === 'cold' || mealCat === 'snack') return mealCat;
  if (item.meals?.is_snack) return 'snack';
  const stored = item.category;
  if (stored === 'hot' || stored === 'cold') return stored;
  // مخزّن 'snack' لكن الصنف نفسه ليس سناكاً → نعتبره أساسياً
  if (stored === 'snack') return item.meals ? 'hot' : 'snack';
  return 'hot';
}

export function isSnackItem(item: Categorisable): boolean {
  return effectiveCategory(item) === 'snack';
}

/**
 * ترتيب ثابت لأصناف الخانة الواحدة: الفئة، ثم position، ثم id.
 * كسر التعادل بـid مهم — بدونه كان صنفان بنفس position يتبادلان الصفوف بين
 * تحديث وآخر حسب ترتيب وصول الصفوف من قاعدة البيانات.
 */
export function compareMenuItems(a: MenuItem, b: MenuItem): number {
  const ca = categoryRank(effectiveCategory(a));
  const cb = categoryRank(effectiveCategory(b));
  if (ca !== cb) return ca - cb;
  const pa = positionRowIndex(a.position);
  const pb = positionRowIndex(b.position);
  if (pa !== pb) return pa - pb;
  return String(a.id).localeCompare(String(b.id));
}

// Order items inside a (week, day, meal_type) slot:
// hot first, then cold, then snack — by position then id.
export function sortMenuItems(items: MenuItem[]): MenuItem[] {
  return [...items].sort(compareMenuItems);
}

/** يفصل أصناف الخانة إلى الصفوف الأساسية وصفوف السناك، بترتيب ثابت. */
export function splitSlot(items: MenuItem[]): { mains: MenuItem[]; snacks: MenuItem[] } {
  const sorted = sortMenuItems(items);
  return {
    mains:  sorted.filter(i => !isSnackItem(i)),
    snacks: sorted.filter(i => isSnackItem(i)),
  };
}

// Lookup map keyed by `${week}|${day}|${meal_type}` → list of items in that slot
export type MenuSlotMap = Map<string, MenuItem[]>;

export function slotKey(week: number, day: number, mealType: MealType) {
  return `${week}|${day}|${mealType}`;
}

export function buildSlotMap(items: MenuItem[]): MenuSlotMap {
  const map: MenuSlotMap = new Map();
  for (const it of items) {
    const k = slotKey(it.week_number, it.day_of_week, it.meal_type);
    const list = map.get(k) ?? [];
    list.push(it);
    map.set(k, list);
  }
  for (const [, list] of map) list.sort(compareMenuItems);
  return map;
}

/**
 * الحالة «الصحيحة» لأصناف خانة واحدة: الفئة مأخوذة من الصنف، والـposition
 * متسلسل بلا فجوات ولا تكرار حسب الاصطلاح أعلاه. تُستخدم في:
 *   • ترتيب صفوف الاستيراد قبل الكتابة.
 *   • الإصلاح الذاتي في صفحة المنيو لصفوف قديمة بأرقام متضاربة.
 * الترتيب الناتج مطابق تماماً للترتيب المعروض حالياً، فما فيه أي حركة بصرية.
 */
export function normalizeSlot(items: MenuItem[]): Array<{ item: MenuItem; category: ItemCategory; position: number }> {
  const { mains, snacks } = splitSlot(items);
  return [
    ...mains.map((item, i)  => ({ item, category: effectiveCategory(item), position: mainPosition(i) })),
    ...snacks.map((item, i) => ({ item, category: effectiveCategory(item), position: snackPosition(i) })),
  ];
}
