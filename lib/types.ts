export type MealType = 'breakfast' | 'lunch' | 'dinner';

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'فطور',
  lunch: 'غداء',
  dinner: 'عشاء',
};

export const MEAL_TYPE_EN: Record<MealType, string> = {
  breakfast: 'BREAKFAST',
  lunch: 'LUNCH',
  dinner: 'DINNER',
};

// تصنيف الصنف داخل أمر التشغيل — يُستخدم لفصل الستيكرات (كل تصنيف = كيس)
export type ItemCategory = 'hot' | 'cold' | 'snack';

export const CATEGORY_LABELS: Record<ItemCategory, string> = {
  hot: 'حار',
  cold: 'بارد',
  snack: 'سناك',
};

export const CATEGORY_LABELS_EN: Record<ItemCategory, string> = {
  hot: 'HOT',
  cold: 'COLD',
  snack: 'SNACK',
};

export const CATEGORY_ORDER: ItemCategory[] = ['hot', 'cold', 'snack'];

export const DAY_LABELS: Record<number, string> = {
  0: 'الأحد',
  1: 'الاثنين',
  2: 'الثلاثاء',
  3: 'الأربعاء',
  4: 'الخميس',
  5: 'الجمعة',
  6: 'السبت',
};

export const DAYS_ORDER = [6, 0, 1, 2, 3, 4, 5]; // السبت أول

export interface Beneficiary {
  id: string;
  name: string;
  english_name?: string;
  code: string;
  category: string;
  villa?: string;
  diet_type?: string;
  fixed_items?: string;
  notes?: string;
  created_at: string;
  exclusions?: Exclusion[];
  fixed_meals?: BeneficiaryFixedMeal[];
}

export interface Meal {
  id: string;
  name: string;
  english_name?: string;
  type: MealType;
  is_snack: boolean;
  created_at: string;
}

export interface Exclusion {
  id: string;
  beneficiary_id: string;
  meal_id: string;
  alternative_meal_id?: string | null;
  meals?: Meal;
  alternative_meal?: Meal;
}

export interface BeneficiaryFixedMeal {
  id: string;
  beneficiary_id: string;
  day_of_week: number;
  meal_type: MealType;
  meal_id: string;
  quantity: number;
  category?: ItemCategory;
  meals?: Meal;
}

export interface DailyOrder {
  id: string;
  date: string;
  meal_type: MealType;
  week_number?: number | null;
  day_of_week?: number | null;
  // Legacy alias retained while older orders still hold this column.
  week_of_month?: number | null;
  created_at: string;
  order_items?: OrderItem[];
}

export interface MenuItem {
  id: string;
  week_number: number;     // 1..4
  day_of_week: number;     // 0..6 (Sun..Sat)
  meal_type: MealType;
  meal_id: string;
  category: ItemCategory;  // 'hot' | 'cold' | 'snack'
  position: number;
  multiplier: number;      // default 1 — copied to order_items on auto-fill
  created_at: string;
  meals?: Meal;
}

export interface OrderItem {
  id: string;
  order_id: string;
  meal_id: string;
  display_name?: string | null;
  extra_quantity?: number;
  category?: ItemCategory;
  /**
   * How many portions per beneficiary. Defaults to 1.
   * Multiplies only the cooking/order count — never per-beneficiary stickers
   * or alternative/fixed meal counts.
   */
  multiplier?: number;
  meals?: Meal;
}

export interface BeneficiaryReportDetail {
  beneficiary: Beneficiary;
  excludedItems: { meal: Meal; alternative: Meal | null; category: ItemCategory }[];
  fixedItems: { meal: Meal; quantity: number; category: ItemCategory }[];
}

export interface ReportData {
  order: DailyOrder;
  itemsSummary: { meal: Meal; quantity: number }[];
  beneficiaryDetails: BeneficiaryReportDetail[];
}

export interface StickerData {
  beneficiary: Beneficiary;
  order: DailyOrder;
  excludedItems: Meal[];
  alternativeItems: Meal[];
}
