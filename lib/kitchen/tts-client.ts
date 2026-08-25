'use client';

/**
 * تشغيل الصوت المولَّد على الخادم.
 *
 * ── لماذا مقطعان لا مقطع واحد؟ ─────────────────────────────────────────────
 * نطلب اسم الصنف وعدده **منفصلين** ونشغّلهما بالتتابع. السبب اقتصادي بحت:
 * الجملة الكاملة تعني ٨٠٠٠ تركيب ممكن، والمقاطع تعني ٢١٩ مقطعاً تُولَّد مرة
 * واحدة في عمر النظام. والفاصل الطبيعي بينهما مفيد أصلاً — يفصل الاسم عن
 * العدد في أذن المشغّل.
 *
 * ── التحميل المسبق ─────────────────────────────────────────────────────────
 * نحمّل مقاطع الأمر كله عند فتح الشاشة. بلا ذلك ينتظر المشغّل ثانيتين عند كل
 * ضغطة أول مرة — وهو يضغط عشرات المرات. وبعد التحميل تعمل الشاشة بلا إنترنت،
 * لأن الـservice worker يخزّن ردود `/api` (راجع public/sw.js).
 */

export const ttsUrl = (text: string, voice: string, provider?: string) => {
  const params = new URLSearchParams({ text, voice });
  if (provider) params.set('provider', provider);
  return `/api/kitchen/tts?${params.toString()}`;
};

export interface TtsVoiceOption {
  id: string;
  label: string;
  gender: 'male' | 'female' | 'unknown';
}

export interface TtsProviderOption {
  id: string;
  label: string;
  defaultVoice: string;
  voices: TtsVoiceOption[];
  available: boolean;
}

export interface TtsCatalog {
  providers: TtsProviderOption[];
  active: string | null;
  anyConfigured: boolean;
}

/** يقرأ المزوّدين وأصواتهم من الخادم — لا قائمة ثابتة في العميل تتقادم. */
export async function fetchTtsCatalog(): Promise<TtsCatalog | null> {
  try {
    const res = await fetch('/api/kitchen/tts/voices');
    if (!res.ok) return null;
    return (await res.json()) as TtsCatalog;
  } catch {
    return null;
  }
}

/**
 * خطأ يحمل رسالة الخادم العربية بدل «فشل التحميل».
 *
 * و`quota` تميّز نفاد الحصة عن غيره: نفادها يعني أن إعادة المحاولة عبث حتى
 * الغد، فنتوقّف فوراً بدل أن نطرق الباب أربعين مرة.
 */
export class TtsError extends Error {
  constructor(message: string, readonly quota = false) {
    super(message);
    this.name = 'TtsError';
  }
}

async function fetchClip(text: string, voice: string, provider?: string): Promise<string> {
  const res = await fetch(ttsUrl(text, voice, provider));
  if (!res.ok) {
    const message = await res
      .json()
      .then((j: { error?: string }) => j?.error)
      .catch(() => null);
    throw new TtsError(message ?? 'تعذّر تحميل الصوت', res.status === 429);
  }
  return URL.createObjectURL(await res.blob());
}

/**
 * ذاكرة مقاطع لهذه الجلسة.
 *
 * تحتفظ بـobject URLs — ولازم تُحرَّر عند مغادرة الشاشة وإلا تسرّبت الذاكرة
 * على تابلت يبقى مفتوحاً طول اليوم.
 */
export class ClipCache {
  private urls = new Map<string, string>();
  private inflight = new Map<string, Promise<string>>();

  constructor(private voice: string, private provider?: string) {}

  /**
   * تبديل الصوت أو المزوّد يبطل كل المقاطع المحمّلة — هي بالقديم. إبقاؤها
   * يعني أن المستخدم يبدّل ويسمع القديم فيظن التبديل لا يعمل.
   */
  setVoice(voice: string, provider?: string): void {
    if (voice === this.voice && provider === this.provider) return;
    this.voice = voice;
    this.provider = provider;
    this.release();
  }

  async get(text: string): Promise<string> {
    const ready = this.urls.get(text);
    if (ready) return ready;

    // نداءان متزامنان لنفس النص يتشاركان طلباً واحداً — الضغط السريع لا
    // يستهلك الحصة مرتين.
    const pending = this.inflight.get(text);
    if (pending) return pending;

    const task = fetchClip(text, this.voice, this.provider)
      .then((url) => {
        this.urls.set(text, url);
        return url;
      })
      .finally(() => this.inflight.delete(text));

    this.inflight.set(text, task);
    return task;
  }

  has(text: string): boolean {
    return this.urls.has(text);
  }

  release(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.inflight.clear();
  }
}

export interface SequencePlayer {
  /** يشغّل النصوص بالتتابع. يلغي أي تشغيل جارٍ. */
  play(texts: string[], onDone?: () => void, onError?: (error: TtsError) => void): Promise<void>;
  /** سرعة التشغيل — تسري فوراً على المقاطع المخزّنة بلا إعادة توليد. */
  setRate(rate: number): void;
  stop(): void;
}

/**
 * مشغّل تتابعي بعنصر `<audio>` واحد يُعاد استعماله.
 *
 * عنصر واحد لا عنصر لكل مقطع: إنشاء عنصر جديد في كل ضغطة يترك عناصر معلّقة
 * قد تُشغَّل فوق بعضها، فيسمع المشغّل صنفين معاً.
 */
export function createSequencePlayer(cache: ClipCache): SequencePlayer {
  const audio = typeof Audio !== 'undefined' ? new Audio() : null;
  let token = 0;
  let rate = 1;

  const stop = () => {
    token++;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  };

  const playOne = (url: string) =>
    new Promise<void>((resolve, reject) => {
      if (!audio) {
        reject(new TtsError('تشغيل الصوت غير مدعوم'));
        return;
      }
      const cleanup = () => {
        audio.onended = null;
        audio.onerror = null;
      };
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new TtsError('تعذّر تشغيل المقطع'));
      };
      audio.src = url;
      audio.playbackRate = rate;
      // بلا هذا يرتفع طبقة الصوت مع السرعة فيصير صريراً. المتصفحات الحديثة
      // تحفظ الطبقة افتراضياً، لكن التصريح يضمنها على القديم منها.
      audio.preservesPitch = true;
      void audio.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });

  return {
    stop,
    setRate(next) {
      rate = next;
      if (audio) audio.playbackRate = next;
    },
    async play(texts, onDone, onError) {
      stop();
      const mine = token;
      try {
        for (const text of texts) {
          const url = await cache.get(text);
          if (mine !== token) return; // أُلغي أثناء التحميل
          await playOne(url);
          if (mine !== token) return;
        }
        onDone?.();
      } catch (err) {
        if (mine !== token) return;
        onError?.(err instanceof TtsError ? err : new TtsError('تعذّر تشغيل الصوت'));
      }
    },
  };
}
