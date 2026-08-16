/**
 * تطبيع النص العربي ومطابقته الضبابية — طبقة نقية بلا أي وصول لقاعدة البيانات
 * حتى تكون قابلة للاختبار بالكامل.
 *
 * الهدف: أن يلقى المستخدم الصنف/الشخص حتى لو كتب بدون همزات، أو بتاء مربوطة،
 * أو بأرقام هندية، أو بخطأ إملائي بسيط.
 */

// التشكيل: U+064B–U+065F + الألف الخنجرية U+0670
const TASHKEEL = /[ً-ٰٟ]/g;
const TATWEEL = /ـ/g;
// نُبقي الحروف العربية واللاتينية والأرقام والمسافات فقط
const NON_WORD = /[^ء-يa-z0-9\s]/g;

/**
 * يحوّل النص إلى صيغة موحّدة للمقارنة:
 * أرقام هندية → لاتينية، إزالة التشكيل والتطويل، توحيد الألف/الياء/الهاء،
 * إزالة الترقيم، وضغط المسافات.
 */
export function normalizeArabic(input: string): string {
  if (!input) return '';
  let s = input.normalize('NFKC').toLowerCase();

  // الأرقام العربية-الهندية والفارسية → لاتينية
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  s = s.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  s = s.replace(TASHKEEL, '').replace(TATWEEL, '');

  s = s
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ى/g, 'ي') //          ى → ي
    .replace(/ؤ/g, 'و') //          ؤ → و
    .replace(/ئ/g, 'ي') //          ئ → ي
    .replace(/ة/g, 'ه') //          ة → ه
    .replace(/ء/g, ''); //               ء → (حذف)

  s = s.replace(NON_WORD, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

/** يشيل "ال" التعريف من بداية الكلمة لو بقي بعدها ٣ أحرف فأكثر. */
export function stripArticle(word: string): string {
  if (word.length >= 5 && word.startsWith('ال')) return word.slice(2);
  return word;
}

export function tokenize(input: string): string[] {
  const n = normalizeArabic(input);
  if (!n) return [];
  return n.split(' ').filter(Boolean);
}

/** نص مُطبَّع مع إزالة "ال" من كل كلمة — الصيغة المستخدمة في المطابقة. */
export function matchKey(input: string): string {
  return tokenize(input).map(stripArticle).filter(Boolean).join(' ');
}

/** مسافة ليفنشتاين مع قصّ مبكّر — الأسماء قصيرة فالتكلفة ضئيلة. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[b.length];
}

/** نسبة تشابه 0..1 مبنية على مسافة ليفنشتاين. */
export function editRatio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - editDistance(a, b) / max;
}

/** هل في الكلمة حرف مكرّر متتالٍ؟ («السممك»، «شييل») */
const hasRepeat = (w: string) => /(.)\1/.test(w);

/** يضغط كل تكرار حرفي إلى حرف واحد — للمقارنة فقط لا للعرض. */
const squeeze = (w: string) => w.replace(/(.)\1+/g, '$1');

/**
 * درجة تشابه كلمتين مفردتين.
 *
 * التكرار الحرفي يُعالَج بضغط الحرفين إلى واحد قبل المقارنة — فـ«السممك»
 * تلقى «سمك». ونشترط وجود تكرار فعلاً في إحداهما حتى لا تتغيّر نتيجة أي
 * كلمة سليمة عمّا كانت عليه.
 */
function tokenScore(t: string, u: string): number {
  if (u === t) return 1;
  if ((hasRepeat(t) || hasRepeat(u)) && squeeze(t) === squeeze(u)) return 0.95;
  if (u.startsWith(t) || t.startsWith(u)) return 0.85;
  return editRatio(t, u);
}

/**
 * درجة مطابقة استعلام مع نص مرشّح، من 0 إلى 1.
 *
 * الترتيب: تطابق تام ← احتواء ← تداخل الكلمات ← تشابه إملائي.
 * القيمة الأعلى من بين كل الطرق هي النتيجة.
 */
export function scoreMatch(query: string, candidate: string): number {
  const q = matchKey(query);
  const c = matchKey(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;

  let best = 0;

  // تكرار حرفي على النص كامل: «الاررز» ≈ «الأرز»
  if ((hasRepeat(q) || hasRepeat(c)) && squeeze(q) === squeeze(c)) best = 0.97;

  // احتواء على حدود الكلمات: «برتقال» داخل «برتقال طازج» نعم،
  // لكن «اول» داخل «يتناول» لا — الاحتواء الأعمى يولّد تطابقات كاذبة.
  const startsAtWord = (hay: string, needle: string) => ` ${hay}`.includes(` ${needle}`);
  if (startsAtWord(c, q)) best = Math.max(best, 0.78 + 0.17 * (q.length / c.length));
  if (startsAtWord(q, c)) best = Math.max(best, 0.72 + 0.17 * (c.length / q.length));

  // تداخل الكلمات: كل كلمة في الاستعلام تلقى أقرب كلمة في المرشّح
  const qt = q.split(' ');
  const ct = c.split(' ');
  if (qt.length && ct.length) {
    let sum = 0;
    for (const t of qt) {
      let m = 0;
      for (const u of ct) {
        const s = tokenScore(t, u);
        if (s > m) m = s;
      }
      sum += m;
    }
    best = Math.max(best, (sum / qt.length) * 0.92);
  }

  // تشابه إملائي على النص كامل — يلتقط الأخطاء المطبعية
  best = Math.max(best, editRatio(q, c) * 0.9);

  return Math.min(1, best);
}

export interface RankedMatch<T> {
  item: T;
  score: number;
}

export interface MatchOptions {
  /** أقل درجة تُقبل كمرشّح. */
  threshold?: number;
  /** أقصى عدد نتائج. */
  limit?: number;
}

/**
 * يرتّب المرشّحين حسب أفضل درجة مطابقة عبر كل النصوص المرتبطة بكل مرشّح
 * (مثلاً: الاسم العربي + الاسم الإنجليزي + الكود).
 */
export function rankMatches<T>(
  query: string,
  items: readonly T[],
  getTexts: (item: T) => Array<string | null | undefined>,
  options: MatchOptions = {},
): RankedMatch<T>[] {
  const threshold = options.threshold ?? 0.55;
  const limit = options.limit ?? 5;

  const scored: RankedMatch<T>[] = [];
  for (const item of items) {
    let best = 0;
    for (const text of getTexts(item)) {
      if (!text) continue;
      const s = scoreMatch(query, text);
      if (s > best) best = s;
      if (best === 1) break;
    }
    if (best >= threshold) scored.push({ item, score: best });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export type ResolveOutcome<T> =
  | { status: 'found'; item: T; score: number; alternatives: RankedMatch<T>[] }
  | { status: 'ambiguous'; candidates: RankedMatch<T>[] }
  | { status: 'none'; near: RankedMatch<T>[] };

/**
 * يحسم المطابقة: نتيجة واحدة واضحة، أو تعدد يحتاج توضيح، أو لا شيء.
 *
 * "تعدد" = أفضل نتيجتين متقاربتين جداً (فرق ≤ 0.04) وما فيه تطابق تام،
 * وقتها نسأل المستخدم بدل ما نخمّن.
 */
export function resolveOne<T>(
  query: string,
  items: readonly T[],
  getTexts: (item: T) => Array<string | null | undefined>,
  options: MatchOptions & { confident?: number } = {},
): ResolveOutcome<T> {
  const confident = options.confident ?? 0.62;
  const ranked = rankMatches(query, items, getTexts, {
    threshold: options.threshold ?? 0.45,
    limit: options.limit ?? 6,
  });

  if (ranked.length === 0) return { status: 'none', near: [] };

  const top = ranked[0];
  if (top.score < confident) {
    return { status: 'none', near: ranked.slice(0, 4) };
  }

  const second = ranked[1];
  if (top.score < 1 && second && top.score - second.score <= 0.04) {
    return { status: 'ambiguous', candidates: ranked.slice(0, 4) };
  }

  return { status: 'found', item: top.item, score: top.score, alternatives: ranked.slice(1, 4) };
}
