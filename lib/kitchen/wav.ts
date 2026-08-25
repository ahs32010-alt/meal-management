/**
 * تغليف PCM الخام في ملف WAV.
 *
 * Gemini يرجّع الصوت PCM عارياً (`audio/l16; rate=24000; channels=1`) — بلا
 * ترويسة، فلا متصفح ولا `<audio>` يعرف كيف يقرأه. ترويسة RIFF من ٤٤ بايت
 * تحوّله إلى ملف قابل للتشغيل في كل مكان بلا مكتبة ولا ترميز.
 *
 * ولا نعيد ترميزه إلى MP3 عمداً: الترميز يحتاج مكتبة ووقت معالجة، ومقطع من
 * ثانيتين بصيغة WAV حجمه ~٩٦ كيلوبايت — لا شيء يُذكر، ويُخزَّن مرة واحدة.
 */

/** يقرأ معدّل العيّنة من نوع المحتوى الذي يرجّعه النموذج. */
export function parseSampleRate(mimeType: string | undefined, fallback = 24000): number {
  const match = /rate=(\d+)/i.exec(mimeType ?? '');
  if (!match) return fallback;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate > 0 ? rate : fallback;
}

export interface WavOptions {
  sampleRate?: number;
  channels?: number;
  /** عمق البتّ — Gemini يرجّع 16 بت موقَّعاً صغير النهاية. */
  bitsPerSample?: number;
}

/**
 * يبني ملف WAV من عيّنات PCM.
 *
 * @param pcm بيانات PCM الخام كما رجّعها النموذج
 */
export function pcmToWav(pcm: Uint8Array, options: WavOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 24000;
  const channels = options.channels ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true); // حجم الملف ناقص أول ٨ بايت
  ascii(8, 'WAVE');

  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // طول كتلة fmt
  view.setUint16(20, 1, true); // 1 = PCM غير مضغوط
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  ascii(36, 'data');
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);

  return out;
}

/** مدّة المقطع بالثواني — للتشخيص ولحساب الفواصل. */
export function wavDurationSeconds(pcmLength: number, sampleRate = 24000, channels = 1, bitsPerSample = 16): number {
  const bytesPerFrame = channels * (bitsPerSample / 8);
  return bytesPerFrame > 0 ? pcmLength / (sampleRate * bytesPerFrame) : 0;
}
