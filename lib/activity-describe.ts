// ============================================================================
// وصف عمليات سجل النشاط بصيغة مقروءة
//
// هذي الوحدة نقية (بدون 'use client') عشان تُستخدم من مُسجِّل النشاط
// ومن شاشة العرض معاً. مهمتها تحويل الصف الخام في activity_log إلى:
//   1. نوع العملية بالضبط (مش مجرد "تعديل")
//   2. الصفحة اللي صارت فيها العملية
//   3. تفاصيل مفهومة بأسماء عربية مع مقارنة قبل/بعد
// ============================================================================

import type { ActivityAction, ActivityEntityType } from '@/lib/activity-log';

/** مفتاح محجوز داخل details تُخزَّن فيه الصفحة — يُخفى من عرض التفاصيل العادي */
export const PAGE_DETAIL_KEY = '__page';

/**
 * مفتاح محجوز يحمل قاموس الحقول المتغيّرة: { حقل: { before, after } }.
 * هذا هو المصدر الرسمي لـ«ايش استبدل» — يُعرض كمقارنة قبل/بعد لكل حقل.
 */
export const CHANGES_DETAIL_KEY = '__changes';

/**
 * مفتاح محجوز يحمل قيم الحقول كما أُدخلت (إضافة) أو كما كانت (حذف):
 * { حقل: قيمة } — يُعرض صفاً لكل حقل باسمه العربي.
 */
export const FIELDS_DETAIL_KEY = '__fields';

// ── الصفحات ─────────────────────────────────────────────────────────────────

export const PAGE_LABELS: Record<string, string> = {
  '/': 'الرئيسية',
  '/beneficiaries/bulk': 'المستفيدون — التخصيص الجماعي',
  '/beneficiaries': 'المستفيدون',
  '/companions/bulk': 'المرافقون — التخصيص الجماعي',
  '/companions': 'المرافقون',
  '/meals': 'الأصناف',
  '/menu': 'قائمة الطعام',
  '/orders': 'أوامر التشغيل',
  '/delivery-orders': 'أوامر التسليم',
  '/costs': 'الأسعار والتكاليف',
  '/reports': 'التقارير',
  '/stickers': 'ستيكرات الفطور',
  '/lunch-dinner-stickers': 'ستيكرات الغداء والعشاء',
  '/approvals': 'الموافقات',
  '/settings': 'الإعدادات',
};

/**
 * اسم الصفحة العربي من المسار. الأطول أولاً عشان /beneficiaries/bulk
 * ما ينطبق عليه /beneficiaries.
 */
export function pageLabel(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path === '/') return PAGE_LABELS['/'];
  const match = Object.keys(PAGE_LABELS)
    .filter(k => k !== '/')
    .sort((a, b) => b.length - a.length)
    .find(k => path === k || path.startsWith(k + '/'));
  return match ? PAGE_LABELS[match] : path;
}

/** يقرأ الصفحة المخزّنة داخل details */
export function pageOf(details: Record<string, unknown> | null): string | null {
  const raw = details?.[PAGE_DETAIL_KEY];
  return typeof raw === 'string' ? raw : null;
}

// ── نوع العملية بالضبط ──────────────────────────────────────────────────────

/**
 * وصف دقيق للعملية حسب الـsource اللي تمرّره نقطة الاستدعاء.
 * الـsource يقول "من وين" صارت العملية داخل الصفحة (جدول، نافذة، استيراد…).
 */
export const OPERATION_LABELS: Record<string, string> = {
  excel_import: 'استيراد من ملف Excel',
  xlsx_import: 'استيراد من ملف Excel',
  menu_xlsx_import: 'استيراد قائمة من ملف Excel',
  inline_toggle: 'تبديل سريع من الجدول',
  duplicate: 'نسخ صنف قائم',
  bulk_add: 'إضافة جماعية',
  restore: 'استرجاع نسخة احتياطية',
  settings_translit_table: 'تعديل من جدول الترجمة الحرفية',
  menu_edit: 'تعديل خانة في القائمة',
  menu_clear: 'مسح خانة من القائمة',
  menu_clear_week: 'مسح أسبوع كامل',
  menu_multiplier: 'تعديل مضاعِف الصنف',
  menu_extra_qty: 'تعديل الكمية الإضافية',
  menu_position_repair: 'إصلاح ترتيب القائمة',
  costs_xlsx_import: 'استيراد التكاليف من ملف Excel',
  delivery_xlsx_import: 'استيراد أوامر تسليم من ملف Excel',
  recipe_inline: 'إنشاء سريع من داخل الوصفة',
  approval: 'تطبيق طلب موافقة',
  assistant: 'المساعد الذكي',
  full_db_dump: 'لقطة قاعدة بيانات كاملة',
};

const ACTION_VERBS: Record<ActivityAction, string> = {
  create: 'أضاف',
  update: 'عدّل',
  delete: 'حذف',
};

/** أسماء الأنواع مصرَّفة للمفعول به عشان الجملة تطلع سليمة */
const ENTITY_OBJECT_LABELS: Record<string, string> = {
  beneficiary: 'مستفيداً',
  companion: 'مرافقاً',
  meal: 'صنفاً',
  order: 'أمراً',
  user: 'مستخدماً',
  transliteration: 'ترجمة حرفية',
  fixed_meal: 'صنفاً ثابتاً',
  exclusion: 'محظوراً',
  backup: 'نسخة احتياطية',
  raw_material: 'مادة أولية',
  meal_price: 'سعر بيع صنف',
  cost_unit: 'وحدة قياس',
  recipe_item: 'مكوّناً في وصفة',
  order_cost: 'تكلفة أمر تشغيل',
};

export interface ActivityLike {
  action: ActivityAction;
  entity_type: ActivityEntityType | string;
  entity_name: string | null;
  user_name: string | null;
  user_email: string | null;
  details: Record<string, unknown> | null;
}

/**
 * نوع التحديث بالضبط — يجمع الإجراء مع الـsource.
 * مثال: "تعديل" وحدها غامضة، بينما "تعديل مضاعِف الصنف" واضحة.
 */
export function operationLabel(row: ActivityLike, actionLabel: string): string {
  const source = typeof row.details?.source === 'string' ? row.details.source : null;
  const precise = source ? OPERATION_LABELS[source] : null;
  return precise ?? actionLabel;
}

/**
 * جملة كاملة تصف العملية: مين، سوّى إيش، على إيش، وفي أي صفحة.
 * هذي اللي تخلي السجل يُقرأ كأنه كلام مش كأنه صفوف قاعدة بيانات.
 */
export function describeOperation(row: ActivityLike): string {
  const who = row.user_name || row.user_email || 'مستخدم غير معروف';
  const verb = ACTION_VERBS[row.action] ?? row.action;
  const what = ENTITY_OBJECT_LABELS[row.entity_type] ?? String(row.entity_type);
  const name = row.entity_name ? ` «${row.entity_name}»` : '';

  const source = typeof row.details?.source === 'string' ? row.details.source : null;
  const via = source && OPERATION_LABELS[source] ? ` عن طريق ${OPERATION_LABELS[source]}` : '';

  // اسم الصفحة يُقتبس بدل ما يجي بعد حرف جر مباشرة — أسماء الصفحات مرفوعة
  // ("المستفيدون")، فـ"من صفحة المستفيدون" تطلع ركيكة نحوياً.
  const page = pageLabel(pageOf(row.details));
  const where = page ? ` — صفحة «${page}»` : '';

  return `${who} ${verb} ${what}${name}${via}${where}`;
}

// ── تسميات مفاتيح التفاصيل ──────────────────────────────────────────────────

export const DETAIL_LABELS: Record<string, string> = {
  approval_required_changed: 'تغيير إلزام الموافقة',
  avatar_changed: 'تغيير الصورة الشخصية',
  avatar_removed: 'إزالة الصورة الشخصية',
  beneficiary_ids: 'المستفيدون المتأثرون',
  category: 'الفئة',
  code: 'الرمز',
  copied_exclusions: 'محظورات منسوخة',
  copied_fixed_meals: 'أصناف ثابتة منسوخة',
  count: 'العدد',
  counts: 'الأعداد',
  day_of_week: 'اليوم',
  email_changed: 'تغيير البريد',
  end_date: 'تاريخ النهاية',
  entity_type: 'نوع السجل',
  entries: 'السجلات',
  errors_count: 'عدد الأخطاء',
  exclusions_count: 'عدد المحظورات',
  extra_quantity_to: 'الكمية الإضافية',
  fixed_meals_count: 'عدد الأصناف الثابتة',
  for_entity: 'مطبَّق على',
  full_db_table_count: 'عدد الجداول',
  full_db_total_rows: 'إجمالي الصفوف',
  full_name_changed: 'تغيير الاسم',
  hour_ksa: 'الساعة (توقيت السعودية)',
  imported: 'المستورد',
  inserted: 'المُضاف',
  inserted_per_table: 'المُضاف لكل جدول',
  inserted_total: 'إجمالي المُضاف',
  is_admin: 'مدير',
  is_admin_changed: 'تغيير صلاحية المدير',
  is_snack: 'سناك',
  items_by_category: 'البنود حسب الفئة',
  items_count: 'عدد البنود',
  meal_ids: 'الأصناف المتأثرة',
  meal_type: 'نوع الوجبة',
  minute: 'الدقيقة',
  missing_meal: 'أصناف غير موجودة',
  multiplier_to: 'المضاعِف',
  original_meal_id: 'معرّف الصنف الأصلي',
  original_meal_name: 'الصنف الأصلي',
  password_changed: 'تغيير كلمة المرور',
  permissions_changed: 'تغيير الصلاحيات',
  previous_name: 'الاسم',
  rows_in_file: 'صفوف الملف',
  scope: 'النطاق',
  start_date: 'تاريخ البداية',
  target_entity_type: 'الفئة المستهدفة',
  total_rows: 'إجمالي الصفوف',
  transliteration: 'الترجمة الحرفية',
  translits_removed: 'ترجمات محذوفة',
  translits_updated: 'ترجمات محدّثة',
  trigger_type: 'طريقة التشغيل',
  type: 'النوع',
  types_updated: 'أنواع محدّثة',
  updated: 'المحدَّث',
  villa: 'الفيلا',
  warnings_count: 'عدد التنبيهات',
  week: 'الأسبوع',
  week_number: 'الأسبوع',

  // ── أسماء حقول السجلات نفسها — تُستخدم في مقارنة قبل/بعد وفي لقطة القيم ──
  name: 'الاسم',
  english_name: 'الاسم بالإنجليزية',
  diet_type: 'نوع الحمية',
  notes: 'الملاحظات',
  no_fish: 'بدون سمك',
  no_pasta_sandwich: 'بدون معكرونة/ساندويتش',
  low_carb: 'قليل الكربوهيدرات',
  is_active: 'نشط',
  is_alternative: 'صنف بديل',
  quantity: 'الكمية',
  qty: 'الكمية',
  unit: 'وحدة الشراء',
  unit_cost: 'سعر الوحدة',
  unit_id: 'الوحدة',
  selling_price: 'سعر البيع',
  portion_cost: 'تكلفة الحصة',
  multiplier: 'المضاعِف',
  extra_quantity: 'الكمية الإضافية',
  position: 'الترتيب',
  meal: 'الصنف',
  meal_id: 'الصنف',
  meal_name: 'الصنف',
  alternative_meal: 'الصنف البديل',
  raw_material: 'المادة الأولية',
  ingredients: 'عدد المكوّنات',
  email: 'البريد الإلكتروني',
  full_name: 'الاسم الكامل',
  password: 'كلمة المرور',
  permissions: 'الصلاحيات',
  approval_required: 'إلزام الموافقة',
  date: 'التاريخ',
  order_number: 'رقم الأمر',
  note: 'ملاحظة',
  requested_by: 'صاحب الطلب',
  factor: 'معامل التحويل',
  equals: 'يساوي',
  independent: 'وحدة مستقلة',
  verified: 'تم التحقق',
  verify_issues: 'مشاكل التحقق',
  atomic: 'استعادة ذرّية',
  repaired: 'صفوف مُصلَحة',
  unchanged: 'بلا تغيير',
  removed: 'المحذوف',
  deleted: 'المحذوف',
  weeks: 'الأسابيع',
  mode: 'طريقة الاستيراد',

  // ── فروقات القوائم المرتبطة (محظورات / ثابتة / قرارات منيو / مكوّنات) ──
  added_exclusions: 'محظورات مُضافة',
  removed_exclusions: 'محظورات مُزالة',
  added_fixed_meals: 'أصناف ثابتة مُضافة',
  removed_fixed_meals: 'أصناف ثابتة مُزالة',
  added_menu_overrides: 'قرارات منيو مُضافة',
  removed_menu_overrides: 'قرارات منيو مُزالة',
  added_ingredients: 'مكوّنات مُضافة',
  added_items: 'بنود مُضافة',
  removed_items: 'بنود مُزالة',
  added_menu_meals: 'أصناف مُضافة للمنيو',
  removed_menu_meals: 'أصناف مسحوبة من المنيو',
  items: 'البنود',
  granted_permissions: 'صلاحيات مُنِحت',
  revoked_permissions: 'صلاحيات سُحِبت',
  approval_enabled: 'إجراءات صارت تلزمها موافقة',
  approval_disabled: 'إجراءات لم تعد تلزمها موافقة',
  row: 'رقم الصف',
  section: 'القسم',
  removed_ingredients: 'مكوّنات مُزالة',
  exclusions: 'المحظورات',
  fixed_meals: 'الأصناف الثابتة',
  menu_overrides: 'قرارات المنيو',
  menu_overrides_count: 'عدد قرارات المنيو',
};

/** قيم معروفة تُترجم بدل ما تظهر كما هي بالإنجليزي */
const VALUE_LABELS: Record<string, string> = {
  bulk_exclusion: 'استبعاد جماعي',
  bulk_unexclude: 'إلغاء استبعاد جماعي',
  bulk_fixed_meal: 'أصناف ثابتة جماعية',
  bulk_unfixed: 'إلغاء أصناف ثابتة جماعي',
  schedule: 'جدولة',
  global: 'عام',
  section: 'قسم',
  slot: 'خانة',
  replace: 'استبدال',
  remove: 'إزالة',
  add: 'إضافة',
  beneficiaries: 'المستفيدون',
  companions: 'المرافقون',
  beneficiary: 'مستفيد',
  companion: 'مرافق',
  hot: 'ساخن',
  cold: 'بارد',
  snack: 'سناك',
  breakfast: 'فطور',
  lunch: 'غداء',
  dinner: 'عشاء',
  manual: 'يدوي',
  auto: 'تلقائي',
  all: 'الكل',
};

export function formatDetailValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return 'لا شيء';
    if (v.every(x => typeof x === 'string' || typeof x === 'number')) {
      // القوائم الطويلة تُختصر — عرض 200 معرّف ما يفيد أحد
      const shown = v.slice(0, 8).map(x => VALUE_LABELS[String(x)] ?? String(x));
      return v.length > 8 ? `${shown.join('، ')} … (${v.length} إجمالاً)` : shown.join('، ');
    }
    return `${v.length} عنصر`;
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) return 'لا شيء';
    return entries
      .map(([k, val]) => `${DETAIL_LABELS[k] ?? VALUE_LABELS[k] ?? k}: ${formatDetailValue(val)}`)
      .join('، ');
  }
  const s = String(v);
  return VALUE_LABELS[s] ?? s;
}

// ── بناء صفوف التفاصيل ──────────────────────────────────────────────────────

export interface DetailRow {
  label: string;
  /** 'change' = مقارنة قبل/بعد، 'value' = قيمة مفردة */
  kind: 'change' | 'value';
  /** القيمة المفردة — تكون null لو الصف مقارنة قبل/بعد */
  value: string | null;
  before: string | null;
  after: string | null;
  /** لو القيمة قائمة، عناصرها مفصولة عشان تُعرض سطراً سطراً بدل سطر طويل */
  items?: string[];
}

/**
 * المفاتيح اللي ما تنفع تظهر كتفصيل عادي:
 * - source: مستهلك أصلاً في "نوع العملية"
 * - __page: مستهلك في عمود الصفحة
 * - __changes / __fields: تُفكَّك لصفوف مستقلة قبل هذي المرحلة
 */
const HIDDEN_KEYS = new Set<string>([
  'source',
  PAGE_DETAIL_KEY,
  CHANGES_DETAIL_KEY,
  FIELDS_DETAIL_KEY,
]);

const labelOf = (k: string) => DETAIL_LABELS[k] ?? k;

/** صف قيمة مفردة — يفصل القوائم لعناصر عشان تُعرض كقائمة */
function valueRow(key: string, v: unknown): DetailRow {
  const items =
    Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' || typeof x === 'number')
      ? v.map(x => formatDetailValue(x))
      : undefined;
  return {
    label: labelOf(key),
    kind: 'value',
    value: formatDetailValue(v),
    before: null,
    after: null,
    ...(items ? { items } : {}),
  };
}

/**
 * يحوّل details الخام إلى صفوف مقروءة، ويلمّ أزواج قبل/بعد مع بعض.
 *
 * الصيغة المعتمدة اليوم:
 *   __changes: { حقل: { before, after } }   → مقارنة كاملة لكل حقل تغيّر
 *   __fields:  { حقل: قيمة }                → لقطة القيم عند الإضافة/الحذف
 *
 * وتبقى ثلاث صيغ قديمة مدعومة لأنها تراكمت في نقاط استدعاء كثيرة:
 *   previous / new                 → زوج واحد بدون اسم حقل
 *   previous_<field> / new_<field> → زوج لحقل محدد
 *   <field>_to                     → القيمة الجديدة فقط
 */
export function buildDetailRows(details: Record<string, unknown> | null): DetailRow[] {
  if (!details) return [];

  const rows: DetailRow[] = [];
  const consumed = new Set<string>();

  // 0) الحقول المتغيّرة — أهم قسم، فيجي أول
  const changes = details[CHANGES_DETAIL_KEY];
  if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
    for (const [field, pair] of Object.entries(changes as Record<string, unknown>)) {
      if (!pair || typeof pair !== 'object') continue;
      const { before, after } = pair as { before?: unknown; after?: unknown };
      rows.push({
        label: labelOf(field),
        kind: 'change',
        value: null,
        before: formatDetailValue(before),
        after: formatDetailValue(after),
      });
    }
  }

  // 1) الأزواج المسمّاة: previous_x / new_x
  for (const key of Object.keys(details)) {
    if (!key.startsWith('previous_')) continue;
    const field = key.slice('previous_'.length);
    const newKey = `new_${field}`;
    if (!(newKey in details)) continue;
    consumed.add(key);
    consumed.add(newKey);
    rows.push({
      label: DETAIL_LABELS[newKey] ?? DETAIL_LABELS[field] ?? labelOf(field),
      kind: 'change',
      value: null,
      before: formatDetailValue(details[key]),
      after: formatDetailValue(details[newKey]),
    });
  }

  // 2) الزوج المجرّد: previous / new
  if ('previous' in details && 'new' in details) {
    consumed.add('previous');
    consumed.add('new');
    rows.push({
      label: 'القيمة',
      kind: 'change',
      value: null,
      before: formatDetailValue(details.previous),
      after: formatDetailValue(details.new),
    });
  }

  // 3) لقطة القيم — القيم كما أُدخلت (إضافة) أو كما كانت (حذف)
  const fields = details[FIELDS_DETAIL_KEY];
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    for (const [key, v] of Object.entries(fields as Record<string, unknown>)) {
      if (v === null || v === undefined || v === '') continue;
      rows.push(valueRow(key, v));
    }
  }

  // 4) الباقي كصفوف مفردة
  for (const [key, v] of Object.entries(details)) {
    if (consumed.has(key) || HIDDEN_KEYS.has(key)) continue;
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    rows.push(valueRow(key, v));
  }

  return rows;
}
