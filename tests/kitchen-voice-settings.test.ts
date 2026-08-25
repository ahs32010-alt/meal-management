import { describe, expect, it } from 'vitest';
import { clampRate, DEFAULT_RATE, MAX_RATE, MIN_RATE, SPEECH_RATE_PRESETS } from '@/lib/kitchen/speech';
import { ttsUrl } from '@/lib/kitchen/tts-client';

/**
 * السرعة والصوت خياران يضبطهما المشرف على الجهاز. الخلل فيهما لا يظهر خطأً —
 * يظهر صوتاً لا يتغيّر رغم الضغط، وهو أسوأ من رسالة فشل.
 */

describe('سرعة النطق', () => {
  it('المدى يصل إلى 1.8 — الصوت المولَّد يخرج متأنّياً', () => {
    expect(MIN_RATE).toBeLessThan(1);
    expect(MAX_RATE).toBeGreaterThanOrEqual(1.8);
    expect(SPEECH_RATE_PRESETS).toContain(DEFAULT_RATE);
  });

  it('يقصّ خارج المدى بدل تمريره — المتصفح يرفض القيم الشاذة صامتاً', () => {
    expect(clampRate(5)).toBe(MAX_RATE);
    expect(clampRate(0.1)).toBe(MIN_RATE);
  });

  it('القيم المستحيلة تُردّ للافتراضي لا لأبطأ سرعة', () => {
    // سالب أو صفر ليس «بطيئاً جداً» بل مدخل فاسد — وقصّه لأبطأ سرعة كان
    // يُنتج صوتاً بطيئاً بلا سبب ظاهر للمستخدم.
    expect(clampRate(-3)).toBe(DEFAULT_RATE);
    expect(clampRate(0)).toBe(DEFAULT_RATE);
    expect(clampRate('')).toBe(DEFAULT_RATE);
  });

  it('يقبل النص الرقمي — القيمة تعود من localStorage نصّاً', () => {
    expect(clampRate('1.4')).toBe(1.4);
  });

  it('يسقط للافتراضي عند القيم الفاسدة', () => {
    expect(clampRate('سريع')).toBe(DEFAULT_RATE);
    expect(clampRate(Number.NaN)).toBe(DEFAULT_RATE);
    expect(clampRate(null)).toBe(DEFAULT_RATE);
    expect(clampRate(undefined)).toBe(DEFAULT_RATE);
  });

  it('كل قيمة معروضة صالحة فعلاً', () => {
    for (const preset of SPEECH_RATE_PRESETS) {
      expect(clampRate(preset), `السرعة ${preset}`).toBe(preset);
    }
  });
});

/**
 * قائمة الأصوات انتقلت إلى طبقة المزوّدين (tests/kitchen-tts-providers.test.ts)
 * بعد إضافة Google Cloud: لكل مزوّد أصواته، وقائمة ثابتة في العميل تتقادم.
 */

describe('رابط المقطع', () => {
  it('يحمل النص والصوت — الصوت جزء من مفتاح التخزين', () => {
    const url = ttsUrl('كبدة', 'Iapetus');
    expect(url).toContain('voice=Iapetus');
    expect(url).toContain(encodeURIComponent('كبدة'));
  });

  it('يحمل المزوّد حين يُحدَّد — مقاطع مزوّد لا تُخلط بآخر', () => {
    expect(ttsUrl('كبدة', 'ar-XA-Wavenet-B', 'google')).toContain('provider=google');
    expect(ttsUrl('كبدة', 'Iapetus')).not.toContain('provider=');
  });

  it('يرمّز الفواصل والمسافات بدل كسر الرابط', () => {
    const url = ttsUrl('سبعة وخمسين', 'Orus');
    expect(url).not.toMatch(/text=[^&]*\s/);
  });

  it('يرمّز أسماء أصوات Google التي فيها شرطات', () => {
    expect(ttsUrl('رز', 'ar-XA-Wavenet-B', 'google')).toContain('ar-XA-Wavenet-B');
  });
});
