import { describe, expect, it } from 'vitest';
import { formatBytes, formatLastSync } from '@/lib/offline/format';

/**
 * «آخر مزامنة» ليست تفصيلة تجميلية: من يطبع ستيكرات وهو مقطوع لازم يعرف عمر
 * البيانات التي بين يديه. فنختبر الصياغة كما يقرأها موظف المطبخ.
 */

// 2026-08-19 14:30 بتوقيت الرياض
const NOW = new Date('2026-08-19T11:30:00.000Z').getTime();
const MIN = 60_000;

describe('formatLastSync', () => {
  it('يقول صراحة حين لا توجد مزامنة بعد', () => {
    expect(formatLastSync(null, NOW)).toBe('لم تتم مزامنة بعد');
    expect(formatLastSync(0, NOW)).toBe('لم تتم مزامنة بعد');
  });

  it('يستخدم صيغة المثنّى العربية الصحيحة', () => {
    expect(formatLastSync(NOW - MIN, NOW)).toBe('قبل دقيقة');
    expect(formatLastSync(NOW - 2 * MIN, NOW)).toBe('قبل دقيقتين');
    expect(formatLastSync(NOW - 7 * MIN, NOW)).toBe('قبل 7 دقيقة');
  });

  it('أقل من دقيقة = الآن', () => {
    expect(formatLastSync(NOW - 30_000, NOW)).toBe('الآن');
    expect(formatLastSync(NOW, NOW)).toBe('الآن');
  });

  it('يعرض الساعة بتوقيت المطبخ بعد تجاوز الساعة', () => {
    // قبل ٣ ساعات = 11:30 بتوقيت الرياض، لا 08:30 بتوقيت UTC
    expect(formatLastSync(NOW - 180 * MIN, NOW)).toBe('اليوم 11:30');
  });

  it('يميّز الأمس عن التواريخ الأقدم', () => {
    expect(formatLastSync(NOW - 24 * 60 * MIN, NOW)).toBe('أمس 14:30');
    expect(formatLastSync(NOW - 5 * 24 * 60 * MIN, NOW)).toMatch(/14 Aug 14:30/);
  });

  it('لا ينهار على ختم من المستقبل (ساعة جهاز مضبوطة غلط)', () => {
    expect(formatLastSync(NOW + 10 * MIN, NOW)).toBe('الآن');
  });
});

describe('formatBytes', () => {
  it('يصيغ الأحجام بوحدات عربية', () => {
    expect(formatBytes(512)).toBe('512 بايت');
    expect(formatBytes(2048)).toBe('2.0 كيلوبايت');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 ميغابايت');
    expect(formatBytes(1536 * 1024 * 1024)).toBe('1.5 غيغابايت');
  });

  it('يتعامل مع الغياب بلا انهيار', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});
