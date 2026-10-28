import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LAYOUT, DEFAULT_SIZES, ALL_SHOWN, autoBaseScale, manualFromAuto, normalizeLayout, resolvePageLayout,
  type StickerData, type StickerLayout,
} from '@/components/stickers/sticker-layout';

const sticker = (over: Partial<StickerData> = {}): StickerData => ({
  ben: { id: 'b1', code: 'A12', villa: '7', name: 'محمد عبدالله الأحمد', english_name: 'Mohammed Abdullah' } as StickerData['ben'],
  groupIndex: 0,
  category: 'hot',
  excludedNames: 'رز، دجاج مشوي، سلطة خضراء',
  excludedTranslit: 'Rice | Grilled chicken | Green salad',
  altNames: 'معكرونة، سمك',
  altTranslit: 'Pasta | Fish',
  fixedItems: null,
  ...over,
});
const ctx = { hasOrderInfo: true, mealTypeAr: 'غداء', mealTypeEn: 'LUNCH' };

describe('resolvePageLayout', () => {
  it('auto: كبير المقاس = المعامل الأساسي حسب المقاس', () => {
    const p = resolvePageLayout(sticker(), DEFAULT_LAYOUT, 10, 10, ctx);
    expect(p.sizes.nameAr).toBeCloseTo(DEFAULT_SIZES.nameAr * autoBaseScale(10, 10));
  });

  it('auto: إخفاء العناصر يكبّر الباقي في المقاس الصغير', () => {
    const all = resolvePageLayout(sticker(), DEFAULT_LAYOUT, 6, 4, ctx);
    const few: StickerLayout = {
      ...DEFAULT_LAYOUT,
      show: { ...ALL_SHOWN, orderInfo: false, excluded: false, alt: false, noEn: false, nameEn: false },
    };
    const less = resolvePageLayout(sticker(), few, 6, 4, ctx);
    expect(less.sizes.nameAr).toBeGreaterThan(all.sizes.nameAr);
  });

  it('manual: الأحجام كما حددها المستخدم بالضبط حتى لو فاضت', () => {
    const manual: StickerLayout = { ...DEFAULT_LAYOUT, mode: 'manual', sizes: { ...DEFAULT_SIZES, nameAr: 30 }, marginMm: 2 };
    const p = resolvePageLayout(sticker(), manual, 6, 4, ctx);
    expect(p.sizes.nameAr).toBe(30);
    expect(p.marginMm).toBe(2);
  });

  it('manual + shrinkToFit: يصغّر الكل بنفس النسبة لو فاض', () => {
    const manual: StickerLayout = { ...DEFAULT_LAYOUT, mode: 'manual', sizes: { ...DEFAULT_SIZES, nameAr: 30 }, shrinkToFit: true };
    const p = resolvePageLayout(sticker(), manual, 6, 4, ctx);
    expect(p.sizes.nameAr).toBeLessThan(30);
    expect(p.sizes.nameAr / p.sizes.code).toBeCloseTo(30 / DEFAULT_SIZES.code);
  });
});

describe('normalizeLayout / manualFromAuto', () => {
  it('يكمّل الحقول الناقصة ويضبط القيم الشاذة', () => {
    const l = normalizeLayout({ mode: 'manual', show: { villa: false }, sizes: { nameAr: 999 } });
    expect(l.mode).toBe('manual');
    expect(l.show.villa).toBe(false);
    expect(l.show.code).toBe(true);
    expect(l.sizes.nameAr).toBe(72);
    expect(l.sizes.code).toBe(DEFAULT_SIZES.code);
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
  });

  it('نقطة بداية اليدوي = أحجام التلقائي للمقاس مقرّبة لنصف نقطة', () => {
    const m = manualFromAuto(10, 10);
    expect(m.sizes.nameAr * 2).toBe(Math.round(m.sizes.nameAr * 2));
    expect(m.sizes.nameAr).toBeCloseTo(DEFAULT_SIZES.nameAr * autoBaseScale(10, 10), 0);
  });
});
