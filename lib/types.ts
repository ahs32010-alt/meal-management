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

// نوع الكيان: مستفيد أو مرافق. الجداول مشتركة، والتمييز عبر العمود `entity_type`.
export type EntityType = 'beneficiary' | 'companion';

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  beneficiary: 'مستفيد',
  companion: 'مرافق',
};

export const ENTITY_TYPE_LABELS_PLURAL: Record<EntityType, string> = {
  beneficiary: 'المستفيدون',
  companion: 'المرافقون',
};

// لون مميز لكل نوع — يُستخدم في الشارات داخل قوائم الأوامر/التقارير
export const ENTITY_BADGE_STYLES: Record<EntityType, string> = {
  beneficiary: 'bg-emerald-100 text-emerald-700',
  companion: 'bg-indigo-100 text-indigo-700',
};

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
  // اختياري للحفاظ على التوافق مع البيانات القديمة قبل تشغيل الـ migration
  entity_type?: EntityType;
  exclusions?: Exclusion[];
  fixed_meals?: BeneficiaryFixedMeal[];
}

export interface Meal {
  id: string;
  name: string;
  english_name?: string;
  type: MealType;
  is_snack: boolean;
  // التصنيف يُحدَّد على الصنف ويُستخدم في كل مكان (الستيكرات/التقارير/الأوامر)
  // اختياري للحفاظ على التوافق قبل تشغيل meals-category-migration.sql
  category?: ItemCategory;
  // اختياري للحفاظ على التوافق قبل تشغيل companions-meals-migration.sql
  entity_type?: EntityType;
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
  // اختياري للحفاظ على التوافق مع البيانات القديمة قبل تشغيل الـ migration
  entity_type?: EntityType;
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
  // اختياري للحفاظ على التوافق قبل تشغيل companions-meals-migration.sql
  entity_type?: EntityType;
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

// ── أوامر التسليم ────────────────────────────────────────────────────────────
// نوع الوجبة في أوامر التسليم — يضيف 'all' (الثلاث وجبات) فوق الأنواع الأساسية.
// لا يُستخدم في أوامر التشغيل (daily_orders).
export type DeliveryMealType = MealType | 'all';

export const DELIVERY_MEAL_TYPE_LABELS: Record<DeliveryMealType, string> = {
  breakfast: 'فطور',
  lunch:     'غداء',
  dinner:    'عشاء',
  all:       'فطور + غداء + عشاء',
};

export interface City {
  id: string;
  name: string;
  created_at: string;
}

export interface DeliveryLocation {
  id: string;
  name: string;
  city_id?: string | null;
  created_at: string;
  cities?: City | null;
}

export interface DeliveryCreator {
  id: string;
  name: string;
  phone?: string | null;
  created_at: string;
}

// أصناف أوامر التسليم — جدول مستقل عن `meals` (الذي يخص قوائم المستفيدين/المرافقين).
export interface DeliveryMeal {
  id: string;
  name: string;
  meal_type: MealType;
  is_snack: boolean;
  created_at: string;
}

// بيانات هيدر طباعة أمر التسليم (صفّ واحد فقط في جدول delivery_print_header)
export interface DeliveryPrintHeader {
  id: number;
  company_name_en?: string | null;
  company_name_ar?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  cr_number?: string | null;
  vat_number?: string | null;
  logo_url?: string | null;
  title_ar?: string | null;
  title_en?: string | null;
  default_creator_signature_url?: string | null;
  updated_at: string;
}

export interface DeliveryOrderItem {
  id: string;
  delivery_order_id: string;
  display_name: string;
  meal_type: DeliveryMealType;
  quantity: number;
  receiver_signature_url?: string | null;
  position: number;
  created_at: string;
}

export interface DeliveryOrder {
  id: string;
  order_number: string;
  source_order_id?: string | null;
  date: string;
  meal_type: DeliveryMealType;
  delivery_location_id?: string | null;
  creator_id?: string | null;
  created_by_name?: string | null;
  created_by_phone?: string | null;
  delivery_date?: string | null;
  delivery_time?: string | null;
  notes?: string | null;
  creator_signature_url?: string | null;
  receiver_signature_url?: string | null;
  created_at: string;
  updated_at: string;
  delivery_locations?: DeliveryLocation | null;
  delivery_creators?: DeliveryCreator | null;
  delivery_order_items?: DeliveryOrderItem[];
}
