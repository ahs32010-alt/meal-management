import type { MenuPeriodReport } from '@/lib/menu-period-report';

/**
 * رابط صفحة تصدير تقرير الفترة — يُبنى من **التقرير المعروض** لا من حقول
 * الاختيار الحالية: لو غيّر المستخدم الأيام/الوجبة/الفئة بعد الحساب وما ضغط
 * «احسب» من جديد، كان الملف المصدَّر يطلع لفترة غير اللي على الشاشة.
 * الخادم يرجّع في التقرير الاختيارات التي حُسب بها بعد تنقيتها.
 */
export function periodPrintHref(
  report: Pick<MenuPeriodReport, 'selections' | 'mealType' | 'entityType'>,
): string {
  const params = new URLSearchParams({ s: JSON.stringify(report.selections) });
  if (report.mealType) params.set('meal', report.mealType);
  if (report.entityType) params.set('entity', report.entityType);
  return `/reports/period/print?${params}`;
}
