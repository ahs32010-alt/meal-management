/**
 * تحويل تقرير أمر التشغيل إلى قائمة النطق.
 *
 * المصدر `itemsSummary` — وهو **حرفياً** قسم «إحصاء الأصناف» في التقرير
 * المطبوع (راجع components/orders/OrderPrintView.tsx). نأخذه بترتيبه كما هو،
 * تنازلياً بالكمية، بلا إعادة ترتيب: المشرف يقرأه اليوم بهذا التسلسل، وتغييره
 * يعني أن ما يسمعه المشغّل لا يطابق الورقة التي بيد المشرف.
 */

import { transliterate } from '@/lib/transliterate';

export interface KitchenItem {
  /** مفتاح ثابت عبر التحميلات — اسم الصنف هو ما يوحّده التقرير أصلاً. */
  key: string;
  name: string;
  /** الاسم بالحروف اللاتينية — للمشرف لا للمشغّل، ليطابق ما ينطقه. */
  latin: string;
  count: number;
}

interface SummaryRow {
  meal?: { name?: string | null } | null;
  quantity?: number | null;
}

/**
 * يستخرج البنود من حمولة التقرير.
 *
 * الحمولة قد تكون لقطة محفوظة (snapshot) لأمر قديم أو حساباً حيّاً لأمر قادم —
 * والشكل واحد في الحالتين، فما نفرّق.
 */
export function kitchenItemsFromReport(
  report: unknown,
  customDict?: Record<string, string>,
): KitchenItem[] {
  const rows = (report as { itemsSummary?: SummaryRow[] } | null)?.itemsSummary;
  if (!Array.isArray(rows)) return [];

  const out: KitchenItem[] = [];
  for (const row of rows) {
    const name = row?.meal?.name?.trim();
    const count = row?.quantity;
    // بند بلا اسم أو بكمية صفر لا يُنطق: المشغّل ينتظر عدداً يطبخه.
    if (!name || typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue;
    out.push({ key: name, name, latin: transliterate(name, customDict), count });
  }
  return out;
}

// ── تتبّع التقدّم ────────────────────────────────────────────────────────────
// المشغّل لا يقرأ، فلا يقدر يتذكّر أين وقف من ورقة. نحفظ ما أنجزه على الجهاز
// حتى لا يضيع بإغلاق الصفحة أو انقطاع الكهرباء عن التابلت.

export const progressKey = (orderId: string) => `kha:kitchen-done:${orderId}`;

export function readProgress(orderId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(progressKey(orderId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

export function writeProgress(orderId: string, done: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(progressKey(orderId), JSON.stringify([...done]));
  } catch {
    // تخزين ممتلئ أو محجوب — التقدّم تحسين لا شرط للعمل.
  }
}

/**
 * البند التالي غير المنجَز بعد موقع معيّن، ثم من البداية.
 *
 * اللفّ من البداية مقصود: المشغّل قد يتخطّى بنداً ويرجع له، وبلا اللفّ ينتهي
 * «تشغيل الكل» عند آخر بند تاركاً المتخطَّى بلا تنبيه.
 */
export function nextPendingIndex(
  items: KitchenItem[],
  done: Set<string>,
  after: number,
): number | null {
  for (let i = after + 1; i < items.length; i++) {
    if (!done.has(items[i].key)) return i;
  }
  for (let i = 0; i <= after && i < items.length; i++) {
    if (!done.has(items[i].key)) return i;
  }
  return null;
}

/** ملخص للعرض: كم أُنجز من كم. */
export function progressSummary(items: KitchenItem[], done: Set<string>) {
  const completed = items.filter((i) => done.has(i.key)).length;
  return { completed, total: items.length, allDone: items.length > 0 && completed === items.length };
}
