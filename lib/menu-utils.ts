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

export function categoryRank(c: ItemCategory): number {
  return c === 'hot' ? 0 : c === 'cold' ? 1 : 2;
}

// Order items inside a (week, day, meal_type) slot:
// hot first, then cold, then snack — by position then meal name.
export function sortMenuItems(items: MenuItem[]): MenuItem[] {
  return [...items].sort((a, b) => {
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    if (a.position !== b.position) return a.position - b.position;
    return (a.meals?.name ?? '').localeCompare(b.meals?.name ?? '', 'ar');
  });
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
  for (const [, list] of map) list.sort((a, b) => {
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    return a.position - b.position;
  });
  return map;
}
