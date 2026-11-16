import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESIGN, addDaysISO, buildSampleItems, expandStickers, formatDMY, normalizeDesign,
  type SampleOrderItemRow,
} from '@/components/sample-stickers/sample-stickers';

const row = (id: string, name: string, opts: Partial<SampleOrderItemRow> & { snack?: boolean; en?: string } = {}): SampleOrderItemRow => ({
  id, meal_id: `m-${id}`, display_name: opts.display_name ?? null, category: opts.category ?? null,
  meals: { id: `m-${id}`, name, is_snack: !!opts.snack, english_name: opts.en ?? null },
});

describe('ستيكرات العينات', () => {
  it('الصلاحية: تاريخ الأمر + الأيام، وعبور نهاية الشهر والسنة', () => {
    expect(addDaysISO('2026-11-16', 3)).toBe('2026-11-19');
    expect(addDaysISO('2026-11-29', 3)).toBe('2026-12-02');
    expect(addDaysISO('2026-12-30T00:00:00', 3)).toBe('2027-01-02');
    expect(formatDMY('2026-11-19')).toBe('19/11/2026');
  });

  it('الرئيسية (حار ثم بارد) قبل السناكات، واسم العرض يغلب، والإنجليزي من الصنف أو النقحرة', () => {
    const items = buildSampleItems([
      row('1', 'بسكويت', { snack: true }),
      row('2', 'سلطة', { category: 'cold', en: 'Green Salad' }),
      row('3', 'كبسة', { category: 'hot', display_name: 'كبسة دجاج' }),
      row('4', 'عصير', { category: 'snack' }),
    ], { 'كبسة دجاج': 'chicken kabsa' });
    expect(items.map(i => i.nameAr)).toEqual(['كبسة دجاج', 'سلطة', 'بسكويت', 'عصير']);
    expect(items.map(i => i.isSnack)).toEqual([false, false, true, true]);
    expect(items[0].nameEn).toBe('Chicken Kabsa');
    expect(items[1].nameEn).toBe('Green Salad');
  });

  it('النسخ: المختار فقط، وكل صنف بعدد نسخه', () => {
    const items = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const out = expandStickers(items, new Set(['a', 'c']), { c: 3 });
    expect(out.map(x => x.uid)).toEqual(['a#1', 'c#1', 'c#2', 'c#3']);
  });

  it('التصميم المحفوظ التالف أو الناقص يرجع للافتراضي بأمان', () => {
    expect(normalizeDesign(null)).toEqual(DEFAULT_DESIGN);
    const d = normalizeDesign({ accent: 'red', expiryDays: 999, sizes: { item: 1000 }, show: { logo: false } });
    expect(d.accent).toBe(DEFAULT_DESIGN.accent);
    expect(d.expiryDays).toBe(60);
    expect(d.sizes.item).toBe(80);
    expect(d.show.logo).toBe(false);
    expect(d.show.expiry).toBe(true);
  });
});

describe('ستيكرات العينات — جنب بعض على A4', async () => {
  const { a4Fit } = await import('@/components/sample-stickers/sample-export');
  it('6.3×6.3 = ٣×٤، و10×10 = ١×٢، والمقاس الأكبر من الورقة = ١', () => {
    expect(a4Fit(6.3, 6.3)).toEqual({ cols: 3, rows: 4, perPage: 12 });
    expect(a4Fit(10, 10)).toEqual({ cols: 1, rows: 2, perPage: 2 });
    expect(a4Fit(30, 30).perPage).toBe(1);
  });
});
