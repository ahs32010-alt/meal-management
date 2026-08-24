import { describe, expect, it } from 'vitest';
import { numberToSaudiWords } from '@/lib/kitchen/numbers';
import { buildUtteranceText, arabicVoices, pickArabicVoice } from '@/lib/kitchen/speech';

/**
 * الأرقام تُكتب كلماتٍ بأنفسنا لا تُمرَّر أرقاماً، لأن محرّك النطق يقرأ «57»
 * فصحى: «سبعةٌ وخمسون». والمشغّل تعوّد على أذن المشرف: «سبعة وخمسين».
 */

describe('الأرقام بالعامية', () => {
  it('الآحاد', () => {
    expect(numberToSaudiWords(1)).toBe('واحد');
    expect(numberToSaudiWords(2)).toBe('اثنين');
    expect(numberToSaudiWords(8)).toBe('ثمانية');
  });

  it('العشرات تنتهي بـ«ـين» لا «ـون» — هذا هو الفرق العامي', () => {
    expect(numberToSaudiWords(20)).toBe('عشرين');
    expect(numberToSaudiWords(50)).toBe('خمسين');
    expect(numberToSaudiWords(90)).toBe('تسعين');
  });

  it('الآحاد قبل العشرات', () => {
    // «سبعة وخمسين» لا «خمسين وسبعة»
    expect(numberToSaudiWords(57)).toBe('سبعة وخمسين');
    expect(numberToSaudiWords(77)).toBe('سبعة وسبعين');
    expect(numberToSaudiWords(21)).toBe('واحد وعشرين');
    expect(numberToSaudiWords(88)).toBe('ثمانية وثمانين');
  });

  it('١١–١٩ بالصيغة المفهومة لا العامية المتعثّرة', () => {
    // «احدعش» ينطقها المحرّك مسخاً — والمقايضة رابحة لأنها نادرة في الأوامر.
    expect(numberToSaudiWords(11)).toBe('أحد عشر');
    expect(numberToSaudiWords(16)).toBe('ستة عشر');
    expect(numberToSaudiWords(10)).toBe('عشرة');
  });

  it('المئات عامية: مية وميتين', () => {
    expect(numberToSaudiWords(100)).toBe('مية');
    expect(numberToSaudiWords(200)).toBe('ميتين');
    expect(numberToSaudiWords(300)).toBe('ثلاثمية');
  });

  it('المركّب — ١٤٤ موجود فعلاً في أوامر التشغيل', () => {
    expect(numberToSaudiWords(144)).toBe('مية وأربعة وأربعين');
    expect(numberToSaudiWords(105)).toBe('مية وخمسة');
    expect(numberToSaudiWords(230)).toBe('ميتين وثلاثين');
  });

  it('كل الكميات الموجودة فعلاً في بياناتك تُنطق بلا فراغ ولا رقم خام', () => {
    const real = [1,2,3,4,5,6,7,8,11,16,28,29,30,31,32,33,34,37,39,41,42,43,44,53,54,55,56,57,59,60,
                  61,62,63,64,67,68,69,70,71,72,73,74,75,76,77,88,144];
    for (const n of real) {
      const words = numberToSaudiWords(n);
      expect(words.length, `الرقم ${n}`).toBeGreaterThan(0);
      expect(words, `الرقم ${n} خرج رقماً لا كلاماً`).not.toMatch(/\d/);
    }
  });

  it('يتعامل مع الحدود بلا انهيار', () => {
    expect(numberToSaudiWords(0)).toBe('صفر');
    expect(numberToSaudiWords(-5)).toBe('خمسة');
    expect(numberToSaudiWords(7.8)).toBe('سبعة');
    expect(numberToSaudiWords(Number.NaN)).toBe('');
  });
});

describe('صياغة البند', () => {
  it('فاصلة عربية لا نقطة — النقطة تجعل المحرّك يصمت طويلاً بين الكلمتين', () => {
    expect(buildUtteranceText('كبدة', 57)).toBe('كبدة، سبعة وخمسين');
    expect(buildUtteranceText('كبدة', 57)).not.toContain('.');
  });

  it('لا يكرّر العدد افتراضياً', () => {
    const text = buildUtteranceText('كبدة', 57);
    expect(text.match(/سبعة وخمسين/g)).toHaveLength(1);
  });

  it('يكرّر فقط حين يُطلب صراحةً', () => {
    expect(buildUtteranceText('كبدة', 57, true)).toBe('كبدة، سبعة وخمسين، سبعة وخمسين');
  });

  it('العدد كلمات لا رقم — وإلا قرأه المحرّك فصحى', () => {
    expect(buildUtteranceText('رز بخاري', 76)).toBe('رز بخاري، ستة وسبعين');
    expect(buildUtteranceText('رز بخاري', 76)).not.toMatch(/\d/);
  });
});

describe('ترتيب الأصوات', () => {
  const v = (name: string, lang: string, localService: boolean) =>
    ({ name, lang, localService, default: false, voiceURI: name }) as SpeechSynthesisVoice;

  it('الجودة تتقدّم على العمل بلا إنترنت — كان العكس فاختار الأسوأ', () => {
    const picked = pickArabicVoice([
      v('Arabic Basic', 'ar-SA', true),
      v('Arabic Neural', 'ar-SA', false),
    ]);
    // الأصوات الشبكية على أندرويد أجود بمراحل من المحلية.
    expect(picked?.name).toBe('Arabic Neural');
  });

  it('عند تساوي الجودة يرجّح المحلي — يشتغل بلا نت', () => {
    const picked = pickArabicVoice([
      v('Arabic A', 'ar-SA', false),
      v('Arabic B', 'ar-SA', true),
    ]);
    expect(picked?.name).toBe('Arabic B');
  });

  it('يرجّع كل الأصوات العربية للاختيار اليدوي، مرتَّبة', () => {
    const list = arabicVoices([
      v('English', 'en-US', true),
      v('Arabic Plain', 'ar-EG', true),
      v('Arabic Premium', 'ar-SA', false),
    ]);
    expect(list.map((x) => x.name)).toEqual(['Arabic Premium', 'Arabic Plain']);
  });

  it('يستبعد غير العربية تماماً', () => {
    expect(arabicVoices([v('Daniel', 'en-GB', true)])).toEqual([]);
  });
});
