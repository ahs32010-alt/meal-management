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
  meals?: Meal;
}

export interface DailyOrder {
  id: string;
  date: string;
  meal_type: MealType;
  week_of_month?: number | null;
  created_at: string;
  order_items?: OrderItem[];
}

export interface OrderItem {
  id: string;
  order_id: string;
  meal_id: string;
  display_name?: string | null;
  extra_quantity?: number;
  meals?: Meal;
}

export interface BeneficiaryReportDetail {
  beneficiary: Beneficiary;
  excludedItems: { meal: Meal; alternative: Meal | null }[];
  fixedItems: { meal: Meal; quantity: number }[];
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
