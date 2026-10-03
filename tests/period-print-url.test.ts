import { describe, expect, it } from 'vitest';
import { periodPrintHref } from '@/components/reports/period-print-url';

describe('periodPrintHref', () => {
  it('يبني الرابط من اختيارات التقرير المحسوب ومرشّحاته', () => {
    const href = periodPrintHref({ selections: { '1': [6, 0], '3': [2] }, mealType: 'lunch', entityType: 'companion' });
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe('/reports/period/print');
    expect(JSON.parse(url.searchParams.get('s')!)).toEqual({ '1': [6, 0], '3': [2] });
    expect(url.searchParams.get('meal')).toBe('lunch');
    expect(url.searchParams.get('entity')).toBe('companion');
  });

  it('بلا وجبة/فئة = الكل — لا يضيف المعامل', () => {
    const url = new URL(periodPrintHref({ selections: { '2': [1] } }), 'http://x');
    expect(url.searchParams.has('meal')).toBe(false);
    expect(url.searchParams.has('entity')).toBe(false);
  });
});
