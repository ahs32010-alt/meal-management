/**
 * مفهرس الكيانات: يلقى أسماء **موجودة فعلاً في قاعدة بياناتك** داخل جملة حرّة.
 *
 * هذي النقلة الأساسية عن القوالب: بدل ما نطلب صياغة معيّنة، نمسح الجملة بحثاً
 * عن أسماء الأشخاص والأصناف المسجّلة. الاسم المطابَق هو نقطة ارتساء (anchor)،
 * وما تبقّى من الكلمات يُقرأ حوله. النتيجة: ترتيب الكلمات يصير شبه بلا أثر —
 * «بيض بدل الفول لأحمد» و«أحمد بدّل له الفول ببيض» يوصلان لنفس الفهم.
 *
 * طبقة نقية: لا تعرف Supabase، تستقبل المصفوفات جاهزة.
 */

import { matchKey, scoreMatch } from './normalize';

/**
 * صيغ الكلمة بعد نزع السوابق الملتصقة — «لعبدالله» يجب أن يجد «عبدالله».
 *
 * ونضيف صيغة مضغوطة التكرار عند وجود حرف مكرّر: الفهرس المقلوب يبحث ببادئة
 * ثلاثية، فـ«السممك» تعطي «سمم» ولا تصل لسلة «سمك» مهما كانت درجة التشابه
 * بعدها عالية. الضغط يعيدها للسلة الصحيحة.
 */
function prefixForms(word: string): string[] {
  const out = [word];
  if (word.length > 3) {
    if (/^[وفبك]/.test(word)) out.push(word.slice(1));
    if (word.startsWith('لل')) out.push('ال' + word.slice(2), word.slice(2));
    else if (word.startsWith('ل')) out.push(word.slice(1), 'ال' + word.slice(1));
    if (/^[وفبك]ال/.test(word)) out.push(word.slice(1));
  }
  if (/(.)\1/.test(word)) {
    for (const form of [...out]) {
      const sq = form.replace(/(.)\1+/g, '$1');
      if (sq.length >= 2 && !out.includes(sq)) out.push(sq);
    }
  }
  return out;
}

export interface Mention<T> {
  item: T;
  /** فهرس أول كلمة في الجملة. */
  start: number;
  /** فهرس آخر كلمة (شامل). */
  end: number;
  score: number;
  /** النص كما ورد في الجملة. */
  text: string;
}

export interface EntityIndex<T> {
  items: T[];
  /** بادئة كلمة (٣ أحرف) → فهارس العناصر التي تحتوي كلمة تبدأ بها. */
  buckets: Map<string, number[]>;
  texts: (item: T) => Array<string | null | undefined>;
}

const PREFIX_LEN = 3;

function prefixesOf(text: string): string[] {
  const key = matchKey(text);
  if (!key) return [];
  return key
    .split(' ')
    .filter((w) => w.length >= 2)
    .map((w) => w.slice(0, PREFIX_LEN));
}

/**
 * يبني فهرساً مقلوباً من بادئات الكلمات إلى العناصر — حتى لا نقارن كل كلمة
 * في الجملة بكل صنف/شخص في النظام.
 */
export function buildIndex<T>(
  items: T[],
  texts: (item: T) => Array<string | null | undefined>,
): EntityIndex<T> {
  const buckets = new Map<string, number[]>();
  items.forEach((item, i) => {
    const seen = new Set<string>();
    for (const t of texts(item)) {
      if (!t) continue;
      for (const p of prefixesOf(t)) {
        if (seen.has(p)) continue;
        seen.add(p);
        const list = buckets.get(p);
        if (list) list.push(i);
        else buckets.set(p, [i]);
      }
    }
  });
  return { items, buckets, texts };
}

export interface ScanOptions {
  /** أقل درجة تشابه لقبول الذكر. */
  threshold?: number;
  /** أقصى عدد كلمات في الاسم الواحد. */
  maxSpan?: number;
  /** فهارس كلمات محجوزة لا يجوز أن يبدأ عندها اسم (كلمات وظيفية معروفة). */
  blocked?: ReadonlySet<number>;
}

/**
 * يمسح الكلمات ويرجّع أفضل الأسماء المذكورة، بلا تداخل.
 *
 * الاختيار جشِع: الأعلى درجةً أولاً، ثم الأطول — فـ«أحمد العلي» تفوز على
 * «أحمد» وحدها، ولا تُحسب الكلمة مرتين.
 */
export function scanMentions<T>(
  words: string[],
  index: EntityIndex<T>,
  options: ScanOptions = {},
): Array<Mention<T>> {
  const threshold = options.threshold ?? 0.72;
  const maxSpan = options.maxSpan ?? 4;
  const blocked = options.blocked;

  const candidates: Array<Mention<T>> = [];

  for (let i = 0; i < words.length; i++) {
    if (blocked?.has(i)) continue;

    // المرشّحون: العناصر التي تشترك مع هذه الكلمة (أو صيغتها بلا سابقة) في بادئة
    const idxSet = new Set<number>();
    for (const form of prefixForms(words[i])) {
      const key = matchKey(form);
      if (!key) continue;
      for (const k of index.buckets.get(key.slice(0, PREFIX_LEN)) ?? []) idxSet.add(k);
    }
    if (idxSet.size === 0) continue;
    const idxs = Array.from(idxSet);

    for (let span = 1; span <= maxSpan && i + span <= words.length; span++) {
      const end = i + span - 1;
      // لا يمتد الاسم عبر كلمة وظيفية
      if (span > 1 && blocked?.has(end)) break;

      const rest = words.slice(i + 1, i + span);
      const phrases = prefixForms(words[i]).map((head) => [head, ...rest].join(' '));
      const phrase = words.slice(i, i + span).join(' ');
      let best: { item: T; score: number } | null = null;

      for (const k of idxs) {
        const item = index.items[k];
        for (const t of index.texts(item)) {
          if (!t) continue;
          for (const ph of phrases) {
            const sc = scoreMatch(ph, t);
            if (sc >= threshold && (!best || sc > best.score)) best = { item, score: sc };
          }
        }
      }

      if (best) candidates.push({ item: best.item, score: best.score, start: i, end, text: phrase });
    }
  }

  // اختيار جشِع بلا تداخل
  candidates.sort((a, b) => b.score - a.score || b.end - b.start - (a.end - a.start));
  const used = new Set<number>();
  const picked: Array<Mention<T>> = [];

  for (const c of candidates) {
    let clash = false;
    for (let i = c.start; i <= c.end; i++) {
      if (used.has(i)) { clash = true; break; }
    }
    if (clash) continue;
    for (let i = c.start; i <= c.end; i++) used.add(i);
    picked.push(c);
  }

  return picked.sort((a, b) => a.start - b.start);
}
