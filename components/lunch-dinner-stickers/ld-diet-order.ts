/**
 * ترتيب الستيكرات حسب الأنظمة الغذائية — دوال نقيّة مختبَرة في tests/ld-diet-order.test.ts.
 *
 * الترتيب المحفوظ قد يحوي أنظمة غير موجودة في القائمة الحالية (من التبويب الآخر
 * أو من أمر تشغيل سابق)، وقد تظهر أنظمة جديدة لم تُرتَّب بعد — تذهب للآخر أبجدياً.
 */

export const NO_DIET = '';

/** الترتيب الفعلي للأنظمة الموجودة: المحفوظ أولاً، ثم الجديد بترتيبه الوارد. */
export function effectiveDietOrder(dietTypes: string[], saved: string[]): string[] {
  const present = new Set(dietTypes);
  const head = saved.filter(d => present.has(d));
  const seen = new Set(head);
  return [...head, ...dietTypes.filter(d => !seen.has(d))];
}

/**
 * تحريك نظام خطوة لأعلى/لأسفل ضمن الترتيب الفعلي، مع الإبقاء على الأنظمة المحفوظة
 * غير الموجودة حالياً في آخر القائمة حتى لا يضيع ترتيبها.
 */
export function moveDiet(dietTypes: string[], saved: string[], diet: string, delta: -1 | 1): string[] {
  const order = effectiveDietOrder(dietTypes, saved);
  const i = order.indexOf(diet);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return saved;
  [order[i], order[j]] = [order[j], order[i]];
  const inOrder = new Set(order);
  return [...order, ...saved.filter(d => !inOrder.has(d))];
}

/**
 * فرز ثابت حسب ترتيب الأنظمة — داخل النظام الواحد يبقى الترتيب الأصلي كما هو،
 * ومن ليس له نظام غذائي يأتي في الآخر.
 */
export function sortByDietOrder<T>(items: T[], getDiet: (item: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((d, i) => [d, i]));
  const rankOf = (item: T) => {
    const d = getDiet(item);
    return d === NO_DIET ? Infinity : rank.get(d) ?? order.length;
  };
  return items
    .map((item, i) => ({ item, i, r: rankOf(item) }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map(x => x.item);
}

/**
 * نقل نظام إلى موضع محدد (سحب وإفلات، أو «للأعلى/للأسفل» مباشرة) — مع
 * الإبقاء على الأنظمة المحفوظة غير الموجودة حالياً في آخر القائمة.
 */
export function moveDietTo(dietTypes: string[], saved: string[], diet: string, toIndex: number): string[] {
  const order = effectiveDietOrder(dietTypes, saved);
  const i = order.indexOf(diet);
  if (i < 0) return saved;
  const j = Math.max(0, Math.min(order.length - 1, toIndex));
  if (i === j) return saved;
  order.splice(i, 1);
  order.splice(j, 0, diet);
  const inOrder = new Set(order);
  return [...order, ...saved.filter(d => !inOrder.has(d))];
}

/** مفتاح لون الستيكر: لون نظامه الغذائي (بحروف صغيرة)، أو NO_DIET للأبيض */
export function stickerColorKey(diet: string, dietColors: Record<string, string>): string {
  const c = diet ? dietColors[diet] : undefined;
  return c ? c.toLowerCase() : NO_DIET;
}

/**
 * الألوان المستخدمة فعلاً مع عدد ستيكراتها والأنظمة التي تحملها — لقائمة
 * «إخفاء لون». الأبيض (بلا لون) مفتاحه NO_DIET ويأتي أولاً.
 */
export function colorsInUse<T>(
  items: T[],
  getDiet: (item: T) => string,
  dietColors: Record<string, string>,
): { key: string; count: number; diets: string[] }[] {
  const map = new Map<string, { count: number; diets: Set<string> }>();
  for (const it of items) {
    const diet = getDiet(it);
    const key = stickerColorKey(diet, dietColors);
    const e = map.get(key) ?? { count: 0, diets: new Set<string>() };
    e.count++;
    if (diet) e.diets.add(diet);
    map.set(key, e);
  }
  return [...map.entries()]
    .map(([key, e]) => ({ key, count: e.count, diets: [...e.diets] }))
    .sort((a, b) => (a.key === NO_DIET ? -1 : b.key === NO_DIET ? 1 : b.count - a.count));
}
