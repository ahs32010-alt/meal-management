import type { DeliveryMealType, DeliveryOrder, DeliveryOrderItem, EntityType } from '@/lib/types';
import { DELIVERY_MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';

/**
 * صيغة ملف أوامر التسليم — مصدر واحد للتصدير والاستيراد وورقة النسخة
 * الاحتياطية. الصفحة كانت بلا تصدير ولا استيراد إطلاقاً.
 *
 * صف واحد لكل أمر، وبنوده مجموعة في خلية واحدة بالصيغة:
 *   «اسم الصنف (الوجبة) ×الكمية | اسم آخر (الوجبة) ×الكمية»
 * وهي نفس الصيغة التي كانت تكتبها ورقة النسخة الاحتياطية، فصارت الآن مقروءة.
 */

export const COL_ORDER_NO   = 'رقم الأمر';
export const COL_DATE       = 'التاريخ';
export const COL_MEAL_TYPE  = 'نوع الوجبة';
export const COL_ENTITY     = 'الفئة';
export const COL_LOCATION   = 'موقع التسليم';
export const COL_CITY       = 'المدينة';
export const COL_CREATOR    = 'المُنشئ';
export const COL_PHONE      = 'جوال المُنشئ';
export const COL_DEL_DATE   = 'تاريخ التسليم';
export const COL_DEL_TIME   = 'وقت التسليم';
export const COL_ITEMS      = 'الأصناف';
export const COL_NOTES      = 'الملاحظات';
export const COL_CREATED_AT = 'تاريخ الإنشاء';

/** رقم الأمر وتاريخ الإنشاء للقراءة فقط — يولّدهما النظام عند الإنشاء. */
export const DELIVERY_ORDER_HEADERS: string[] = [
  COL_ORDER_NO, COL_DATE, COL_ENTITY, COL_MEAL_TYPE, COL_LOCATION, COL_CITY,
  COL_CREATOR, COL_PHONE, COL_DEL_DATE, COL_DEL_TIME,
  COL_ITEMS, COL_NOTES, COL_CREATED_AT,
];

export const DELIVERY_ORDER_REQUIRED_HEADERS = [COL_DATE, COL_MEAL_TYPE, COL_ITEMS];

/**
 * صف القالب مبنيّ بالاسم لا بالموضع — كان مصفوفة مكتوبة يدوياً سقط منها
 * عمود الفئة، فانزاحت كل القيم بعده خانة (الوجبة تحت «الفئة»، الموقع تحت
 * «نوع الوجبة»...) وفشل استيراد القالب نفسه.
 */
const TEMPLATE_VALUES: Record<string, string> = {
  [COL_ORDER_NO]:   '(يولّده النظام — اكتبه فقط لتحديث أمر موجود)',
  [COL_DATE]:       '2026-08-17',
  [COL_ENTITY]:     ENTITY_TYPE_LABELS_PLURAL.beneficiary,
  [COL_MEAL_TYPE]:  DELIVERY_MEAL_TYPE_LABELS.lunch,
  [COL_LOCATION]:   'مقر الشركة',
  [COL_CITY]:       'الدمام',
  [COL_CREATOR]:    '',
  [COL_PHONE]:      '',
  [COL_DEL_DATE]:   '',
  [COL_DEL_TIME]:   '',
  [COL_ITEMS]:      'كبسة (غداء) ×20 | سلطة (غداء) ×20',
  [COL_NOTES]:      'ملاحظة',
  [COL_CREATED_AT]: '(يولّده النظام)',
};
export const DELIVERY_ORDER_TEMPLATE_ROW: string[] = DELIVERY_ORDER_HEADERS.map(h => TEMPLATE_VALUES[h] ?? '');

const MEAL_TYPE_FROM_AR: Record<string, DeliveryMealType> = Object.fromEntries(
  (Object.entries(DELIVERY_MEAL_TYPE_LABELS) as [DeliveryMealType, string][])
    .map(([key, label]) => [label, key]),
);

/**
 * الفئة تُقرأ بالجمع («المستفيدون») كما تُكتب، ونقبل كذلك المفرد والإنجليزي
 * عشان ملفاً حُرِّر يدوياً ما يفشل على صيغة معقولة.
 */
const ENTITY_FROM_AR: Record<string, EntityType> = {
  [ENTITY_TYPE_LABELS_PLURAL.beneficiary]: 'beneficiary',
  [ENTITY_TYPE_LABELS_PLURAL.companion]: 'companion',
  'مستفيد': 'beneficiary',
  'مستفيدين': 'beneficiary',
  'مرافق': 'companion',
  'مرافقين': 'companion',
  beneficiary: 'beneficiary',
  companion: 'companion',
};

export function deliveryEntityLabel(order: Pick<DeliveryOrder, 'entity_type'>): string {
  return ENTITY_TYPE_LABELS_PLURAL[order.entity_type === 'companion' ? 'companion' : 'beneficiary'];
}

export function deliveryMealTypeLabel(mt: string): string {
  return DELIVERY_MEAL_TYPE_LABELS[mt as DeliveryMealType] ?? mt;
}

// ─── البنود ─────────────────────────────────────────────────────────────────

const ITEM_SEP = ' | ';

export function formatDeliveryItem(name: string, mealType: string, quantity: number): string {
  return `${name} (${deliveryMealTypeLabel(mealType)}) ×${quantity}`;
}

export function formatDeliveryItems(items: Pick<DeliveryOrderItem, 'display_name' | 'meal_type' | 'quantity' | 'position'>[]): string {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map(it => formatDeliveryItem(it.display_name, it.meal_type, it.quantity))
    .join(ITEM_SEP);
}

export interface ParsedDeliveryItem {
  display_name: string;
  meal_type: DeliveryMealType;
  quantity: number;
}

/**
 * يفكّ خلية البنود. اللاحقة مثبّتة بنهاية النص (`$`) فاسم الصنف يبقى كما هو
 * مهما احتوى أقواساً أو أرقاماً — نفس القاعدة المتبعة في ملف قائمة الطعام.
 */
export function parseDeliveryItems(
  raw: string,
  fallbackMealType: DeliveryMealType,
): { items: ParsedDeliveryItem[]; errors: string[] } {
  const items: ParsedDeliveryItem[] = [];
  const errors: string[] = [];

  for (const tokenRaw of String(raw ?? '').split(/\s*\|\s*/)) {
    const token = tokenRaw.trim();
    if (!token) continue;

    // «الاسم (الوجبة) ×الكمية» — الوجبة والكمية اختياريتان
    const full = token.match(/^(.*?)\s*\(([^()]+)\)\s*[×xX*]\s*(\d{1,6})$/);
    const noQty = token.match(/^(.*?)\s*\(([^()]+)\)$/);
    const noType = token.match(/^(.*?)\s*[×xX*]\s*(\d{1,6})$/);

    let name = token;
    let mealType: DeliveryMealType = fallbackMealType;
    let quantity = 1;

    if (full) {
      name = full[1].trim();
      const mt = MEAL_TYPE_FROM_AR[full[2].trim()];
      if (!mt) { errors.push(`نوع الوجبة "${full[2].trim()}" غير معروف في البند «${token}»`); continue; }
      mealType = mt;
      quantity = parseInt(full[3], 10);
    } else if (noQty) {
      name = noQty[1].trim();
      const mt = MEAL_TYPE_FROM_AR[noQty[2].trim()];
      if (!mt) { errors.push(`نوع الوجبة "${noQty[2].trim()}" غير معروف في البند «${token}»`); continue; }
      mealType = mt;
    } else if (noType) {
      name = noType[1].trim();
      quantity = parseInt(noType[2], 10);
    }

    if (!name) { errors.push(`بند بلا اسم: «${token}»`); continue; }
    // الكمية صفر مسموحة — نافذة الأمر تبدأ البند بصفر والواجهة تقبله، فرفضه
    // كان يُفشل استيراد ملف صدّرته الصفحة نفسها.
    if (!Number.isFinite(quantity) || quantity < 0) { errors.push(`كمية غير صالحة في البند «${token}»`); continue; }
    items.push({ display_name: name, meal_type: mealType, quantity });
  }

  return { items, errors };
}

// ─── الصف ───────────────────────────────────────────────────────────────────

export function buildDeliveryOrderRow(order: DeliveryOrder): Record<string, string> {
  const loc = order.delivery_locations ?? null;
  const city = (loc as { cities?: { name?: string } | null } | null)?.cities ?? null;
  return {
    [COL_ORDER_NO]:   order.order_number ?? '',
    [COL_DATE]:       order.date ?? '',
    [COL_ENTITY]:     deliveryEntityLabel(order),
    [COL_MEAL_TYPE]:  deliveryMealTypeLabel(order.meal_type),
    [COL_LOCATION]:   loc?.name ?? '',
    [COL_CITY]:       city?.name ?? '',
    [COL_CREATOR]:    order.delivery_creators?.name ?? order.created_by_name ?? '',
    [COL_PHONE]:      order.delivery_creators?.phone ?? order.created_by_phone ?? '',
    [COL_DEL_DATE]:   order.delivery_date ?? '',
    [COL_DEL_TIME]:   order.delivery_time ?? '',
    [COL_ITEMS]:      formatDeliveryItems(order.delivery_order_items ?? []),
    [COL_NOTES]:      order.notes ?? '',
    [COL_CREATED_AT]: order.created_at ?? '',
  };
}

// ─── الاستيراد ──────────────────────────────────────────────────────────────

export interface DeliveryImportRefs {
  /** اسم الموقع (بعد التنظيف) → معرّفه */
  locationIdByName: Map<string, string>;
  /** اسم المُنشئ → معرّفه */
  creatorIdByName: Map<string, string>;
  /**
   * «الاسم|الجوال» → معرّفه. الجدول فريد على (name, phone) فقد يتكرر الاسم
   * بجوالين؛ نطابق بالاثنين أولاً ثم بالاسم وحده.
   */
  creatorIdByNameAndPhone?: Map<string, string>;
}

export const creatorRefKey = (name: string, phone: string | null | undefined) =>
  `${clean(name)}|${clean(phone)}`;

export interface DeliveryOrderPayload {
  date: string;
  entity_type: EntityType;
  meal_type: DeliveryMealType;
  delivery_location_id: string | null;
  creator_id: string | null;
  created_by_name: string | null;
  created_by_phone: string | null;
  delivery_date: string | null;
  delivery_time: string | null;
  notes: string | null;
  items: ParsedDeliveryItem[];
}

const clean = (v: string | undefined | null) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** ISO date (YYYY-MM-DD) أو فراغ — نقبل ما يكتبه Excel بصيغته المحلية كذلك */
export function normalizeDate(raw: string | undefined | null): string | null {
  const s = clean(raw);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  // بالمكوّنات المحلية لا toISOString — هذا الأخير يحوّل لـUTC فيرجع اليوم
  // السابق في توقيت السعودية (+3) لتاريخ مقروء كمنتصف ليل محلي.
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return null;
}

/**
 * الوقت بصيغة HH:MM أو HH:MM:SS كما تشترطها الواجهة. نقبل الساعة برقم واحد
 * و«ص/م» أو AM/PM. undefined = قيمة غير مفهومة (خطأ)، null = خانة فارغة.
 */
export function normalizeTime(raw: string | undefined | null): string | null | undefined {
  const s = clean(raw);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(ص|م|am|pm|AM|PM)?$/);
  if (!m) return undefined;
  let h = parseInt(m[1], 10);
  const suffix = (m[4] ?? '').toLowerCase();
  if (suffix === 'م' || suffix === 'pm') { if (h < 12) h += 12; }
  else if ((suffix === 'ص' || suffix === 'am') && h === 12) h = 0;
  if (h > 23 || parseInt(m[2], 10) > 59) return undefined;
  return `${String(h).padStart(2, '0')}:${m[2]}${m[3] ? `:${m[3]}` : ''}`;
}

/**
 * يحوّل صف ملف إلى حِمل جاهز لواجهة `POST /api/delivery-orders`.
 * رقم الأمر يُتجاهل عمداً — النظام يولّده، فلا يُستورد رقم قد يتعارض.
 */
export function parseDeliveryOrderRow(
  row: Record<string, string>,
  refs: DeliveryImportRefs,
  rowLabel: string,
): { payload: DeliveryOrderPayload | null; errors: string[]; orderNumber: string | null } {
  const errors: string[] = [];
  // رقم الأمر لا يدخل الحِمل (النظام يولّده)، لكنه يُرجَع منفصلاً ليُطابَق
  // به أمر موجود في وضع «تحديث الموجود».
  const orderNumberRaw = clean(row[COL_ORDER_NO]);
  const orderNumber = orderNumberRaw && !orderNumberRaw.startsWith('(') ? orderNumberRaw : null;

  const date = normalizeDate(row[COL_DATE]);
  if (!date) { errors.push(`${rowLabel}: التاريخ مفقود أو غير مفهوم`); }

  // الفئة اختيارية: ملف قديم (صُدِّر قبل وجود العمود) يُستورد كمستفيدين،
  // وهي الفئة الوحيدة التي كانت موجودة وقتها.
  const entityRaw = clean(row[COL_ENTITY]);
  const entityType = entityRaw ? ENTITY_FROM_AR[entityRaw] : 'beneficiary';
  if (entityRaw && !entityType) {
    errors.push(`${rowLabel}: الفئة "${entityRaw}" غير معروفة — المقبول: ${ENTITY_TYPE_LABELS_PLURAL.beneficiary}، ${ENTITY_TYPE_LABELS_PLURAL.companion}`);
  }

  const mealTypeRaw = clean(row[COL_MEAL_TYPE]);
  const mealType = MEAL_TYPE_FROM_AR[mealTypeRaw];
  if (!mealType) {
    errors.push(`${rowLabel}: نوع الوجبة "${mealTypeRaw}" غير معروف — المقبول: ${Object.keys(MEAL_TYPE_FROM_AR).join('، ')}`);
  }

  const locName = clean(row[COL_LOCATION]);
  let locationId: string | null = null;
  if (locName) {
    locationId = refs.locationIdByName.get(locName) ?? null;
    if (!locationId) errors.push(`${rowLabel}: موقع التسليم "${locName}" غير موجود — أضفه أولاً`);
  }

  // ورقة «أوامر التسليم» في النسخة الاحتياطية تكتب الرأسين بلا ضمّة
  // («المنشئ»، «جوال المنشئ») — نقبلهما حتى لا يضيع المُنشئ بصمت.
  const creatorName = clean(row[COL_CREATOR] ?? row['المنشئ']);
  const creatorPhone = clean(row[COL_PHONE] ?? row['جوال المنشئ']);
  const creatorId = creatorName
    ? (refs.creatorIdByNameAndPhone?.get(creatorRefKey(creatorName, creatorPhone))
      ?? refs.creatorIdByName.get(creatorName) ?? null)
    : null;

  const deliveryDateRaw = clean(row[COL_DEL_DATE]);
  const deliveryDate = normalizeDate(deliveryDateRaw);
  if (deliveryDateRaw && !deliveryDate) errors.push(`${rowLabel}: تاريخ التسليم "${deliveryDateRaw}" غير مفهوم — استخدم الصيغة 2026-08-17`);

  const deliveryTimeRaw = clean(row[COL_DEL_TIME]);
  const deliveryTime = normalizeTime(deliveryTimeRaw);
  if (deliveryTime === undefined) errors.push(`${rowLabel}: وقت التسليم "${deliveryTimeRaw}" غير مفهوم — استخدم الصيغة 12:30`);

  const { items, errors: itemErrors } = mealType
    ? parseDeliveryItems(row[COL_ITEMS] ?? '', mealType)
    : { items: [], errors: [] };
  for (const e of itemErrors) errors.push(`${rowLabel}: ${e}`);
  if (items.length === 0) errors.push(`${rowLabel}: لا يوجد أي بند صالح في عمود «${COL_ITEMS}»`);

  if (errors.length > 0) return { payload: null, errors, orderNumber };

  return {
    payload: {
      date: date!,
      entity_type: entityType!,
      meal_type: mealType!,
      delivery_location_id: locationId,
      creator_id: creatorId,
      // لو المُنشئ غير مسجّل نحفظ اسمه وجواله كنص — نفس ما تفعله النافذة
      created_by_name: creatorId ? null : (creatorName || null),
      created_by_phone: creatorId ? null : (creatorPhone || null),
      delivery_date: deliveryDate,
      delivery_time: deliveryTime ?? null,
      notes: clean(row[COL_NOTES]) || null,
      items,
    },
    errors: [],
    orderNumber,
  };
}

/**
 * حِمل «تحديث الموجود»: واجهة PUT تكتب الأمر كاملاً، فما لا يحمله الملف
 * (ربط أمر التشغيل المصدر، التوقيعات) نأخذه من الأمر الحالي حتى لا يُمسح.
 * توقيع المستلم على البند يبقى ما دام البند في موضعه بنفس الاسم.
 */
export function buildDeliveryUpdateBody(existing: DeliveryOrder, payload: DeliveryOrderPayload) {
  const oldItems = [...(existing.delivery_order_items ?? [])].sort((a, b) => a.position - b.position);
  return {
    ...payload,
    source_order_id: existing.source_order_id ?? null,
    creator_signature_url: existing.creator_signature_url ?? null,
    receiver_signature_url: existing.receiver_signature_url ?? null,
    items: payload.items.map((it, idx) => ({
      ...it,
      receiver_signature_url: oldItems[idx]?.display_name === it.display_name
        ? (oldItems[idx].receiver_signature_url ?? null)
        : null,
    })),
  };
}
