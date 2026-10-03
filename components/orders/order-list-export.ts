import type { DailyOrder, EntityType, ItemCategory, OrderItem } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL, CATEGORY_LABELS, DAY_LABELS } from '@/lib/types';
import type { SheetRow } from '@/lib/xlsx-utils';

/**
 * عدد المستفيدين/المرافقين وعدد المحظورات لكل صنف — مفصول حسب نوع الكيان.
 * altCounts[alt_meal_id][excl_meal_id] = عدد المستفيدين الذين يأخذون alt بديلاً عن excl
 */
export type EntityCounts = {
  total: number;
  exclusions: Record<string, number>;
  altCounts: Record<string, Record<string, number>>;
};

type ListOrder = DailyOrder & { itemFinalCounts?: Record<string, number> | null };

/** يوم الأسبوع من تاريخ الأمر (YYYY-MM-DD) — مستقل عن منطقة المتصفح الزمنية */
export const orderWeekday = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/**
 * العدد النهائي لصنف داخل أمر في قائمة الأوامر — **مصدر واحد** للجدول وملف
 * Excel حتى لا يختلف الرقمان.
 *  - المحفوظ في لقطة الأمر (`snapshot->itemFinalCounts`) يغلب: هو رقم التقرير.
 *  - وإلا حساب حيّ: (العدد − المحظورين) × المضاعف + الكمية الإضافية + البدائل
 *    (كل محظور موجود في نفس الأمر × مضاعفه).
 */
export function orderItemFinalCount(
  order: ListOrder,
  item: Pick<OrderItem, 'meal_id' | 'extra_quantity' | 'multiplier'>,
  counts: EntityCounts,
): { count: number; frozen: boolean } {
  const snap = order.itemFinalCounts?.[item.meal_id];
  if (snap != null) return { count: snap, frozen: true };
  const items = order.order_items ?? [];
  const mult = item.multiplier ?? 1;
  const base = Math.max(0, counts.total - (counts.exclusions[item.meal_id] ?? 0));
  const orderMealIds = new Set(items.map(oi => oi.meal_id));
  const altBonus = Object.entries(counts.altCounts[item.meal_id] ?? {})
    .filter(([exclId]) => orderMealIds.has(exclId))
    .reduce((sum, [exclId, cnt]) => sum + cnt * (items.find(oi => oi.meal_id === exclId)?.multiplier ?? 1), 0);
  return { count: base * mult + (item.extra_quantity ?? 0) + altBonus, frozen: false };
}

export const ORDERS_SHEET_HEADERS = [
  'التاريخ', 'اليوم', 'الأسبوع', 'الفئة', 'الوجبة',
  'الصنف', 'الاسم الأصلي', 'التصنيف', 'المضاعف', 'الكمية الإضافية',
  'العدد النهائي', 'مصدر العدد',
] as const;

/**
 * صفوف ملف Excel لقائمة أوامر التشغيل: صف لكل صنف في كل أمر، بنفس الأرقام
 * المعروضة في الجدول (اسم الصنف في الأمر، المضاعف، الكمية الإضافية، التصنيف).
 * أمر بلا أصناف يطلع صفاً واحداً حتى لا يختفي من الملف.
 */
export function buildOrdersSheetRows(
  orders: ListOrder[],
  counts: Record<EntityType, EntityCounts>,
): SheetRow[] {
  const rows: SheetRow[] = [];
  for (const order of orders) {
    const entity: EntityType = order.entity_type === 'companion' ? 'companion' : 'beneficiary';
    const head: SheetRow = {
      'التاريخ': order.date,
      'اليوم': DAY_LABELS[orderWeekday(order.date)] ?? '',
      'الأسبوع': order.week_number ?? order.week_of_month ?? '',
      'الفئة': ENTITY_TYPE_LABELS_PLURAL[entity],
      'الوجبة': MEAL_TYPE_LABELS[order.meal_type] ?? order.meal_type,
    };
    const items = order.order_items ?? [];
    if (items.length === 0) { rows.push({ ...head, 'الصنف': '—' }); continue; }
    for (const item of items) {
      const original = item.meals?.name ?? '';
      const name = item.display_name ?? original;
      const category: ItemCategory = item.category ?? (item.meals?.is_snack ? 'snack' : 'hot');
      const { count, frozen } = orderItemFinalCount(order, item, counts[entity]);
      rows.push({
        ...head,
        'الصنف': name,
        'الاسم الأصلي': name !== original ? original : '',
        'التصنيف': CATEGORY_LABELS[category],
        'المضاعف': item.multiplier ?? 1,
        'الكمية الإضافية': item.extra_quantity ?? 0,
        'العدد النهائي': count,
        'مصدر العدد': frozen ? 'محفوظ مع الأمر' : 'محسوب الآن',
      });
    }
  }
  return rows;
}
