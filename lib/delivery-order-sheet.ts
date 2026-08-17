import type { DeliveryMealType, DeliveryOrder, DeliveryOrderItem } from '@/lib/types';
import { DELIVERY_MEAL_TYPE_LABELS } from '@/lib/types';

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
  COL_ORDER_NO, COL_DATE, COL_MEAL_TYPE, COL_LOCATION, COL_CITY,
  COL_CREATOR, COL_PHONE, COL_DEL_DATE, COL_DEL_TIME,
  COL_ITEMS, COL_NOTES, COL_CREATED_AT,
];

export const DELIVERY_ORDER_REQUIRED_HEADERS = [COL_DATE, COL_MEAL_TYPE, COL_ITEMS];

const MEAL_TYPE_FROM_AR: Record<string, DeliveryMealType> = Object.fromEntries(
  (Object.entries(DELIVERY_MEAL_TYPE_LABELS) as [DeliveryMealType, string][])
    .map(([key, label]) => [label, key]),
);

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
    if (!Number.isFinite(quantity) || quantity < 1) { errors.push(`كمية غير صالحة في البند «${token}»`); continue; }
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
}

export interface DeliveryOrderPayload {
  date: string;
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
function normalizeDate(raw: string): string | null {
  const s = clean(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

/**
 * يحوّل صف ملف إلى حِمل جاهز لواجهة `POST /api/delivery-orders`.
 * رقم الأمر يُتجاهل عمداً — النظام يولّده، فلا يُستورد رقم قد يتعارض.
 */
export function parseDeliveryOrderRow(
  row: Record<string, string>,
  refs: DeliveryImportRefs,
  rowLabel: string,
): { payload: DeliveryOrderPayload | null; errors: string[] } {
  const errors: string[] = [];

  const date = normalizeDate(row[COL_DATE]);
  if (!date) { errors.push(`${rowLabel}: التاريخ مفقود أو غير مفهوم`); }

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

  const creatorName = clean(row[COL_CREATOR]);
  const creatorId = creatorName ? (refs.creatorIdByName.get(creatorName) ?? null) : null;

  const { items, errors: itemErrors } = mealType
    ? parseDeliveryItems(row[COL_ITEMS] ?? '', mealType)
    : { items: [], errors: [] };
  for (const e of itemErrors) errors.push(`${rowLabel}: ${e}`);
  if (items.length === 0) errors.push(`${rowLabel}: لا يوجد أي بند صالح في عمود «${COL_ITEMS}»`);

  if (errors.length > 0) return { payload: null, errors };

  return {
    payload: {
      date: date!,
      meal_type: mealType!,
      delivery_location_id: locationId,
      creator_id: creatorId,
      // لو المُنشئ غير مسجّل نحفظ اسمه وجواله كنص — نفس ما تفعله النافذة
      created_by_name: creatorId ? null : (creatorName || null),
      created_by_phone: creatorId ? null : (clean(row[COL_PHONE]) || null),
      delivery_date: normalizeDate(row[COL_DEL_DATE]),
      delivery_time: clean(row[COL_DEL_TIME]) || null,
      notes: clean(row[COL_NOTES]) || null,
      items,
    },
    errors: [],
  };
}
