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

// ── مراتب الفرز الثابتة (طلب التشغيل) ─────────────────────────────────────────
// ١ كل الأنظمة الغذائية ← ٢ الكاربوهيدرات (رمز Ⓡ) ← ٣ وجبات غداء وعشاء مخصصة.
// «الوجبات المخصصة» أقوى من Ⓡ: صاحبها في الآخر حتى لو كان كاربوهيدرات.

export const NORMAL_DIET = 'نظام غذائي عادي';

export const TIER_LABELS = ['الأنظمة الغذائية', 'الكاربوهيدرات Ⓡ', 'وجبات غداء وعشاء مخصصة'] as const;
export type StickerTier = 0 | 1 | 2;

export interface TierInput {
  diet_type?: string;
  low_carb?: boolean;
  custom_ld_meals?: boolean;
}

export function stickerTier(b: TierInput): StickerTier {
  if (b.custom_ld_meals) return 2;
  // الكاربوهيدرات = خيار «قليل الكاربوهيدرات» (يُطبع Ⓡ على الستيكر) فقط، لا اسم النظام
  if (b.low_carb) return 1;
  return 0;
}

// ── ترتيب الأنظمة داخل كل مرتبة ──────────────────────────────────────────────
// الترتيب المحفوظ مفاتيحه «مرتبة|نظام» — نفس النظام قد يظهر في أكثر من مرتبة
// (عادي بلا Ⓡ، عادي بـⓇ، عادي بوجبات مخصصة) ولكل مرتبة ترتيبها المستقل.

export const tierKey = (tier: StickerTier, diet: string) => `${tier}|${diet}`;
const dietOfKey = (key: string) => key.slice(key.indexOf('|') + 1);

/** الترتيب الافتراضي: النظام العادي أولاً، ثم أبجدياً. */
export function defaultDietOrder(diets: string[]): string[] {
  return [...diets].sort((a, b) =>
    a === NORMAL_DIET ? -1 : b === NORMAL_DIET ? 1 : a.localeCompare(b, 'ar'));
}

/**
 * الأنظمة الموجودة في كل مرتبة (٣ مجموعات) بالترتيب الفعلي مع عدد ستيكراتها —
 * هي نفسها ما تعرضه لوحة الترتيب وما يُفرز به، فلا يختلفان أبداً.
 * من ليس له نظام لا يظهر هنا، ويأتي آخر مرتبته.
 */
export function tierDietGroups<T>(
  items: T[], getBen: (item: T) => TierInput, saved: string[],
): { diet: string; count: number }[][] {
  const counts = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  for (const it of items) {
    const b = getBen(it);
    const diet = b.diet_type?.trim() ?? NO_DIET;
    if (!diet) continue;
    const m = counts[stickerTier(b)];
    m.set(diet, (m.get(diet) ?? 0) + 1);
  }
  return counts.map((m, t) => {
    const keys = defaultDietOrder([...m.keys()]).map(d => tierKey(t as StickerTier, d));
    return effectiveDietOrder(keys, saved).map(k => ({ diet: dietOfKey(k), count: m.get(dietOfKey(k)) ?? 0 }));
  });
}

/** فرز بالمرتبة أولاً، ثم بترتيب الأنظمة داخل المرتبة، ثم الترتيب الأصلي. */
export function sortByTierAndDiet<T>(items: T[], getBen: (item: T) => TierInput, saved: string[]): T[] {
  const rank = new Map<string, number>();
  tierDietGroups(items, getBen, saved).forEach((g, t) =>
    g.forEach((x, i) => rank.set(tierKey(t as StickerTier, x.diet), i)));
  return items
    .map((item, i) => {
      const b = getBen(item);
      const t = stickerTier(b);
      const diet = b.diet_type?.trim() ?? NO_DIET;
      return { item, i, t, r: diet ? rank.get(tierKey(t, diet)) ?? Infinity : Infinity };
    })
    .sort((a, b) => a.t - b.t || a.r - b.r || a.i - b.i)
    .map(x => x.item);
}
