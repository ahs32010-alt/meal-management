import { describe, expect, it } from 'vitest';
import type { Meal } from '@/lib/types';
import { customizationCells, customSectionTitle, fetchOrderReports, sumBy } from '@/components/orders/order-print-utils';

const meal = (id: string, name: string) => ({ id, name, is_snack: false } as unknown as Meal);

describe('customizationCells', () => {
  it('المستبعد، ثم البدائل والأصناف الإضافية بكمياتها بصيغة الصفحة', () => {
    const r = customizationCells({
      excludedItems: [
        { meal: meal('fish', 'سمك'), alternative: meal('chicken', 'دجاج') },
        { meal: meal('egg', 'بيض'), alternative: null },
      ],
      fixedItems: [{ meal: meal('dates', 'تمر'), quantity: 3 }, { meal: meal('milk', 'حليب'), quantity: 1 }],
    });
    expect(r.excluded).toBe('سمك | بيض');
    expect(r.extras).toBe('دجاج | تمر ×3 | حليب');
  });
  it('فارغ بلا تخصيصات', () => {
    expect(customizationCells({ excludedItems: [], fixedItems: [] })).toEqual({ excluded: '', extras: '' });
  });
});

describe('customSectionTitle', () => {
  it('أمر المرافقين يُعنون بالمرافقين', () => {
    expect(customSectionTitle('companion')).toBe('تخصيصات المرافقين');
    expect(customSectionTitle('beneficiary')).toBe('تخصيصات المستفيدين');
    expect(customSectionTitle(undefined)).toBe('تخصيصات المستفيدين');
  });
});

describe('sumBy', () => {
  it('يجمع العمود ويتجاهل الناقص', () => {
    expect(sumBy([{ qty: 2 }, { qty: 5 }, {} as { qty?: number }], 'qty')).toBe(7);
  });
});

describe('fetchOrderReports', () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

  it('يحافظ على الترتيب ويحدّ التوازي', async () => {
    let inFlight = 0, peak = 0;
    const fetchImpl = async (url: string) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return json({ id: url.split('/')[3] });
    };
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const progress: number[] = [];
    const { results, errors } = await fetchOrderReports<{ id: string }>(ids, { fetchImpl, concurrency: 2, onProgress: d => progress.push(d) });
    expect(results.map(r => r!.id)).toEqual(ids);
    expect(errors).toBe(0);
    expect(peak).toBeLessThanOrEqual(2);
    expect(progress.at(-1)).toBe(6);
  });

  it('ينتظر Retry-After عند 429 ثم يعيد المحاولة — لا يُسقط الأمر', async () => {
    const calls: Record<string, number> = {};
    const slept: number[] = [];
    const fetchImpl = async (url: string) => {
      calls[url] = (calls[url] ?? 0) + 1;
      return calls[url] === 1 ? json({ error: 'x' }, 429, { 'Retry-After': '7' }) : json({ ok: url });
    };
    const { results, errors } = await fetchOrderReports(['a'], { fetchImpl, sleep: async ms => { slept.push(ms); } });
    expect(errors).toBe(0);
    expect(results[0]).toEqual({ ok: '/api/orders/a/report' });
    expect(slept).toEqual([7000]);
  });

  it('خطأ غير 429 يُحسب فشلاً بلا إعادة', async () => {
    let n = 0;
    const fetchImpl = async () => { n++; return json({}, 404); };
    const { results, errors } = await fetchOrderReports(['a', 'b'], { fetchImpl });
    expect(results).toEqual([null, null]);
    expect(errors).toBe(2);
    expect(n).toBe(2);
  });
});
