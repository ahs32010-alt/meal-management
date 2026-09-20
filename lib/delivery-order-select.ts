// ============================================================================
// أعمدة قراءة أمر التسليم — مصدر واحد لواجهتَي القائمة والأمر المفرد
//
// العمودان كانا منسوخين حرفياً في ملفَّي الـroute، فأي عمود جديد لازم يُضاف
// مرّتين — وهذا بالضبط ما نسي عند إضافة الفئة. صار مصدراً واحداً.
// ============================================================================

/**
 * `withEntityType = false` تُستخدم كخطة بديلة لو الترقية ما اتشغّلت بعد:
 * PostgREST يفشل الطلب كاملاً على عمود غير موجود، فتختفي الصفحة كلها بدل
 * أن تفقد خانة واحدة.
 */
export function deliveryOrderSelect(withEntityType: boolean): string {
  return `
  id, order_number, source_order_id, date, meal_type,
  delivery_location_id, creator_id, created_by_name, created_by_phone,
  delivery_date, delivery_time, notes,
  creator_signature_url, receiver_signature_url,
  created_at, updated_at${withEntityType ? ',\n  entity_type' : ''},
  delivery_locations(id, name, city_id, created_at, cities(id, name, created_at)),
  delivery_creators(id, name, phone, created_at),
  delivery_order_items(id, delivery_order_id, display_name, meal_type, quantity, receiver_signature_url, position, created_at)
`;
}

/** خطأ «عمود entity_type غير موجود» — أي خطأ آخر يُرفع كما هو */
export function isMissingEntityTypeColumn(message: string | undefined | null): boolean {
  const m = String(message ?? '');
  return /entity_type/i.test(m) && /column|schema cache|does not exist/i.test(m);
}
