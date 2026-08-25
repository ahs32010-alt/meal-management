/**
 * طبقة مزوّدي النطق — نفس فكرة مزوّدي المساعد: الشاشة لا تعرف من يولّد الصوت.
 *
 * وُجدت الحاجة إليها بعد درس عملي: حصة Gemini المجانية للنطق **عشرة طلبات في
 * اليوم**، وأمر تشغيل واحد يحتاج أربعين. فربط النظام بمزوّد واحد كان خطأً،
 * والحلّ ألّا يُربط بأحد.
 */

export type TtsProviderId = 'google' | 'gemini';

export interface TtsVoiceInfo {
  /** الاسم كما يقبله المزوّد. */
  id: string;
  /** وصف عربي مختصر يُعرض للمستخدم. */
  label: string;
  gender: 'male' | 'female' | 'unknown';
  /** ترجيح العرض — الأعلى أولاً. الذكورية أولاً بطلب المستخدم. */
  rank?: number;
}

export interface SynthesisResult {
  audio: Uint8Array;
  contentType: string;
  /** امتداد الملف في التخزين — يختلف بين المزوّدين (wav / mp3). */
  ext: 'wav' | 'mp3';
}

export interface TtsProvider {
  readonly id: TtsProviderId;
  readonly label: string;
  /** هل بيانات اعتماده متوفّرة على الخادم؟ */
  isConfigured(): boolean;
  /** الأصوات المتاحة — قد تأتي من الشبكة، فهي غير متزامنة. */
  listVoices(): Promise<TtsVoiceInfo[]>;
  defaultVoice(): string;
  /** يتحقّق أن الصوت من أصوات هذا المزوّد قبل تمريره. */
  isValidVoice(voice: string): Promise<boolean>;
  synthesize(text: string, voice: string): Promise<SynthesisResult>;
}

/** خطأ مزوّد مترجَم — يحمل حالة HTTP مناسبة ورسالة عربية. */
export class TtsProviderError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 402 | 502 | 503 | 500,
    /** نفاد حصة: إعادة المحاولة اليوم لا تفيد. */
    readonly quota = false,
  ) {
    super(message);
    this.name = 'TtsProviderError';
  }
}
