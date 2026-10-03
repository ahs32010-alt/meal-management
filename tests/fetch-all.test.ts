import { describe, expect, it } from 'vitest';
import { fetchAllRows } from '@/lib/fetch-all';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * حماية من تكرار العطل: PostgREST يرجّع ١٠٠٠ صف كحد أقصى بدون أي خطأ.
 * جدول exclusions تعدّى هذا السقف، فكانت صفحة المنيو وصفحة إنشاء أمر التشغيل
 * تقرأ جزءاً من المحظورات فقط → أعداد أعلى من الحقيقة، بينما التقرير يقرأها
 * كاملة (nested) ويطلع الرقم الصحيح. fetchAllRows تقرأ الجدول على دفعات.
 */

// جدول وهمي يطبّق سقف الصفحة تماماً مثل PostgREST
function table(total: number, cap = 1000) {
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const size = Math.min(to - from + 1, cap);
    const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
      .slice(from, from + size);
    return { data: rows, error: null };
  };
  return { page, calls };
}

describe('fetchAllRows', () => {
  it('يقرأ كل الصفوف حتى لو تعدّت سقف الـ١٠٠٠', async () => {
    const t = table(1678); // نفس حجم جدول exclusions الحقيقي وقت اكتشاف العطل
    const { data, error } = await fetchAllRows<{ id: number }>(t.page);
    expect(error).toBeNull();
    expect(data).toHaveLength(1678);
    expect(data?.[0].id).toBe(0);
    expect(data?.[1677].id).toBe(1677);
    // الدفعة الأولى وحدها، ثم موجة متوازية متتالية الإزاحات بلا فجوات
    expect(t.calls.slice(0, 2)).toEqual([[0, 999], [1000, 1999]]);
    t.calls.forEach(([from, to], i) => expect([from, to]).toEqual([i * 1000, i * 1000 + 999]));
  });

  it('يجلب ما بعد الدفعة الأولى بالتوازي لا رحلة بعد رحلة', async () => {
    let inFlight = 0;
    let peak = 0;
    const t = table(5500);
    const page = async (from: number, to: number) => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      try { return await t.page(from, to); } finally { inFlight--; }
    };
    const { data } = await fetchAllRows<{ id: number }>(page);
    expect(data).toHaveLength(5500);
    expect(data?.map(r => r.id)).toEqual(Array.from({ length: 5500 }, (_, i) => i));
    expect(peak).toBeGreaterThan(1);
  });

  it('ما يخسر ولا يكرّر صفاً عند حد الدفعة بالضبط', async () => {
    const t = table(2000);
    const { data } = await fetchAllRows<{ id: number }>(t.page);
    expect(data).toHaveLength(2000);
    expect(new Set(data?.map(r => r.id)).size).toBe(2000);
    // دفعة فاضية لازم تنهي الحلقة — الموجة قد تطلب دفعات بعدها، ولا تتجاوز موجة واحدة
    expect(t.calls.length).toBeGreaterThanOrEqual(3);
    expect(t.calls.length).toBeLessThanOrEqual(5);
  });

  it('يكتفي بطلب واحد للجداول الصغيرة', async () => {
    const t = table(77);
    const { data } = await fetchAllRows<{ id: number }>(t.page);
    expect(data).toHaveLength(77);
    expect(t.calls).toHaveLength(1);
  });

  it('يرجّع الخطأ وdata=null عشان يشتغل الرجوع للأعمدة الناقصة', async () => {
    const err = { message: 'column menu_items.extra_quantity does not exist' } as PostgrestError;
    const { data, error } = await fetchAllRows(async () => ({ data: null, error: err }));
    expect(data).toBeNull();
    expect(error).toBe(err);
  });
});
