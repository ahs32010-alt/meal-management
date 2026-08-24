/**
 * النطق العربي على الجهاز — عبر `speechSynthesis` المدمج في المتصفح.
 *
 * ── ليش المتصفح لا خدمة سحابية؟ ────────────────────────────────────────────
 * المشغّل في المطبخ يحتاج يعيد سماع البند عشر مرات، والواي‑فاي هناك ضعيف.
 * صوت الجهاز فوري، مجاني، بلا حصة ولا مفتاح، **ويشتغل بلا إنترنت** بعد تنزيل
 * حزمة الصوت مرة واحدة. أي خدمة سحابية تعني انتظاراً ورصيداً وانقطاعاً.
 *
 * ── ما نتحكّم فيه فعلاً ─────────────────────────────────────────────────────
 * جودة الصوت من الجهاز لا منّا. لكن نتحكّم في ثلاثة تصنع فرق الفهم:
 *   • **اختيار صوت عربي** صراحةً — الصوت الافتراضي قد يكون إنجليزياً فينطق
 *     «كبدة» حروفاً لاتينية بلا معنى.
 *   • **بطء النطق** — مطبخ فيه ضجيج، والسرعة الافتراضية تبتلع الأرقام.
 *   • **الوقفات** بين الاسم والعدد — بلا وقفة يلتصقان فيُسمعان كلمة واحدة.
 */

/**
 * سرعات النطق.
 *
 * الافتراضي **عادي** لا بطيء: التجربة الأولى كانت على 0.82 فطلعت مملّة —
 * والمشغّل يسمع ٢٠–٣٧ بنداً، فربع ثانية زائدة في كل بند تعني دقيقة ضائعة.
 * ومع ذلك نترك الخيار: جودة الأصوات تختلف بين الأجهزة، وبعضها يحتاج إبطاءً.
 */
export const SPEECH_RATES = { slow: 0.85, normal: 1, fast: 1.2 } as const;
export type SpeechRateKey = keyof typeof SPEECH_RATES;
export const DEFAULT_RATE_KEY: SpeechRateKey = 'normal';

import { numberToSaudiWords } from './numbers';

export interface SpeechVoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/**
 * أصوات المتصفح تُحمَّل غير متزامنة على بعض المنصّات: أول نداء يرجّع قائمة
 * فارغة ثم يُطلق `voiceschanged`. من ينتظر النداء الأول فقط يظن الجهاز بلا
 * أصوات عربية وهي موجودة.
 */
export function loadVoices(timeoutMs = 3000): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSpeechSupported()) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

const isArabic = (lang: string) => /^ar\b/i.test(lang.replace('_', '-'));

/** كل الأصوات العربية على الجهاز — يختار منها المستخدم بنفسه. */
export function arabicVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  return voices.filter((v) => isArabic(v.lang)).sort((a, b) => voiceScore(b) - voiceScore(a));
}

/**
 * ترتيب الأصوات العربية.
 *
 * ── تصحيح ──────────────────────────────────────────────────────────────────
 * كانت الأولوية للصوت المحلي (`localService`) بفارق كبير، بحجّة أنه يشتغل بلا
 * إنترنت. وكان خطأً: على أندرويد الأصوات الشبكية من Google أجود بمراحل من
 * المحلية، فكنا **نختار الأسوأ عمداً**. الجودة أولاً — والعمل بلا إنترنت
 * يبقى مرجّحاً عند التساوي، لا فوق كل شيء.
 *
 * وفوق ذلك يقدر المستخدم يختار الصوت بنفسه من الشاشة: لا خوارزمية تعرف صوت
 * أي جهاز أفضل من أذن من يسمعه.
 */
function voiceScore(v: SpeechSynthesisVoice): number {
  let n = 0;
  const name = v.name.toLowerCase();
  // إشارات الجودة في أسماء الأصوات على المنصّات الشائعة
  if (/neural|premium|enhanced|natural|wavenet|studio/.test(name)) n += 6;
  if (/ar[-_]sa/i.test(v.lang)) n += 3;
  if (/ar[-_](ae|kw|qa|bh|om)/i.test(v.lang)) n += 2;
  if (v.localService) n += 1;
  return n;
}

export function pickArabicVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  return arabicVoices(voices)[0] ?? null;
}

/**
 * نصّ البند كما يُنطق — «كبدة، سبعة وخمسين».
 *
 * ── تصحيحان بعد أول تجربة حقيقية ───────────────────────────────────────────
 * ① كانت الفواصل نقاطاً (`كبدة. 57.`) — والنقطة عند محرّك النطق نهاية جملة،
 *    فيصمت طويلاً بعد كل كلمة ويطلع الكلام متقطّعاً بطيئاً. الفاصلة العربية
 *    تعطي وقفة قصيرة تكفي لفصل الاسم عن العدد وتُبقي الجملة واحدة.
 * ② كان العدد يُنطق مرتين افتراضياً. مزعج، والتكرار يبقى خياراً لمن يريده
 *    في ضجيج شديد — لا سلوكاً مفروضاً.
 * ③ والعدد يُكتب كلماتٍ عامية لا رقماً، وإلا قرأه المحرّك بالفصحى.
 */
export function buildUtteranceText(name: string, count: number, repeatCount = false): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  const spoken = numberToSaudiWords(count);
  return repeatCount ? `${clean}، ${spoken}، ${spoken}` : `${clean}، ${spoken}`;
}

export interface SpeakOptions {
  voice?: SpeechSynthesisVoice | null;
  rate?: number;
  onEnd?: () => void;
  onError?: () => void;
}

/**
 * ينطق نصاً واحداً، ويلغي ما قبله.
 *
 * الإلغاء أولاً ليس تفصيلاً: الطابور الافتراضي يراكم النطق، فضغط المشغّل على
 * خمسة بنود بسرعة يعني انتظار خمس جمل قبل أن يسمع ما اختاره أخيراً.
 */
export function speak(text: string, options: SpeakOptions = {}): void {
  if (!isSpeechSupported()) {
    options.onError?.();
    return;
  }
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = options.rate ?? SPEECH_RATES[DEFAULT_RATE_KEY];
  utterance.lang = options.voice?.lang ?? 'ar-SA';
  if (options.voice) utterance.voice = options.voice;
  if (options.onEnd) utterance.onend = () => options.onEnd?.();
  if (options.onError) utterance.onerror = () => options.onError?.();

  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
