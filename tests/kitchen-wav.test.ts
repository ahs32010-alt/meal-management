import { describe, expect, it } from 'vitest';
import { parseSampleRate, pcmToWav, wavDurationSeconds } from '@/lib/kitchen/wav';

/**
 * Gemini يرجّع الصوت PCM عارياً بلا ترويسة. ترويسة خاطئة تعني ملفاً لا يشغّله
 * أحد — أو أسوأ: يشتغل بسرعة غلط فيطلع الصوت كصرير.
 */

const ascii = (bytes: Uint8Array, from: number, len: number) =>
  String.fromCharCode(...bytes.slice(from, from + len));

const read32 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint32(at, true);
const read16 = (b: Uint8Array, at: number) => new DataView(b.buffer).getUint16(at, true);

describe('parseSampleRate', () => {
  it('يقرأ المعدّل من نوع المحتوى الذي يرجّعه النموذج', () => {
    expect(parseSampleRate('audio/l16; rate=24000; channels=1')).toBe(24000);
    expect(parseSampleRate('audio/L16;rate=16000')).toBe(16000);
  });

  it('يسقط للافتراضي عند الغياب أو الفساد', () => {
    // معدّل خاطئ يعني صوتاً بسرعة خاطئة — الافتراضي أأمن من التخمين.
    expect(parseSampleRate(undefined)).toBe(24000);
    expect(parseSampleRate('audio/wav')).toBe(24000);
    expect(parseSampleRate('audio/l16; rate=abc')).toBe(24000);
    expect(parseSampleRate('audio/l16; rate=0')).toBe(24000);
  });
});

describe('pcmToWav', () => {
  const pcm = new Uint8Array(1000).fill(7);
  const wav = pcmToWav(pcm, { sampleRate: 24000 });

  it('يبني ترويسة RIFF/WAVE صحيحة', () => {
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(ascii(wav, 36, 4)).toBe('data');
  });

  it('يضبط الأحجام — الخطأ هنا يقطع نهاية المقطع', () => {
    expect(wav.length).toBe(44 + pcm.length);
    expect(read32(wav, 4)).toBe(36 + pcm.length);
    expect(read32(wav, 40)).toBe(pcm.length);
  });

  it('يعلن PCM غير مضغوط بالمواصفات التي يرجّعها النموذج', () => {
    expect(read16(wav, 20)).toBe(1); // PCM
    expect(read16(wav, 22)).toBe(1); // قناة واحدة
    expect(read32(wav, 24)).toBe(24000);
    expect(read16(wav, 34)).toBe(16); // 16 بت
  });

  it('يحسب byteRate و blockAlign — بهما يعرف المشغّل السرعة', () => {
    // معدّل بايت خاطئ = صوت مسرّع أو مبطّأ، وهو أسوأ من ملف لا يشتغل.
    expect(read32(wav, 28)).toBe(24000 * 1 * 2);
    expect(read16(wav, 32)).toBe(1 * 2);
  });

  it('يحافظ على العيّنات كما هي بعد الترويسة', () => {
    expect(wav.slice(44)).toEqual(pcm);
  });

  it('يحترم معدّلاً مختلفاً', () => {
    const other = pcmToWav(pcm, { sampleRate: 16000 });
    expect(read32(other, 24)).toBe(16000);
    expect(read32(other, 28)).toBe(16000 * 2);
  });

  it('يتعامل مع مدخل فارغ بلا انهيار', () => {
    const empty = pcmToWav(new Uint8Array(0));
    expect(empty.length).toBe(44);
    expect(read32(empty, 40)).toBe(0);
  });
});

describe('wavDurationSeconds', () => {
  it('يحسب المدّة من حجم العيّنات', () => {
    // ثانية واحدة = 24000 عيّنة × 2 بايت
    expect(wavDurationSeconds(48000, 24000)).toBe(1);
    expect(wavDurationSeconds(24000, 24000)).toBe(0.5);
  });

  it('يرجّع صفراً بدل قسمة على صفر', () => {
    expect(wavDurationSeconds(1000, 24000, 0)).toBe(0);
  });
});
