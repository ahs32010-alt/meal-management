/**
 * ذاكرة التحقّق من الهوية.
 *
 * الغرض منها الأداء وحده: `getUser()` رحلة شبكة (٣٣٥–٤٨٠ms في هذا المشروع)
 * والوسيط ينادونها في كل تنقّل. هذي الاختبارات تثبّت أنها **لا تغيّر النتيجة**
 * ولا تخفي رفضاً — ولا تخزّن فشلاً، حتى لا يتحوّل عطل شبكة عابر إلى منع دائم.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cachedByToken, clearAuthCache } from '@/lib/auth-cache';

beforeEach(() => { clearAuthCache(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ذاكرة التحقّق من الهوية', () => {
  it('تنادي الشبكة مرّة واحدة لنفس الرمز', async () => {
    const compute = vi.fn().mockResolvedValue({ id: 'u1' });
    const a = await cachedByToken('tok', compute);
    const b = await cachedByToken('tok', compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ id: 'u1' });
    expect(b).toEqual({ id: 'u1' });
  });

  it('كل رمز له نتيجته — لا يتسرّب مستخدم إلى رمز آخر', async () => {
    await cachedByToken('tok-a', async () => ({ id: 'a' }));
    const b = await cachedByToken('tok-b', async () => ({ id: 'b' }));
    expect(b).toEqual({ id: 'b' });
  });

  it('الرفض يُخزَّن أيضاً — الرمز المزوّر لا يُعاد سؤاله كل مرّة', async () => {
    const compute = vi.fn().mockResolvedValue(null); // getUser رفض الرمز
    expect(await cachedByToken('bad', compute)).toBeNull();
    expect(await cachedByToken('bad', compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('النداءات المتزامنة تشترك في طلب واحد — لا تدافع على الشبكة', async () => {
    let resolve!: (v: unknown) => void;
    const compute = vi.fn(() => new Promise(r => { resolve = r; }));
    const all = Promise.all([
      cachedByToken('tok', compute),
      cachedByToken('tok', compute),
      cachedByToken('tok', compute),
    ]);
    resolve({ id: 'u1' });
    expect(await all).toEqual([{ id: 'u1' }, { id: 'u1' }, { id: 'u1' }]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('تنتهي المدّة فيُعاد التحقّق — تعطيل المستخدم يسري', async () => {
    const compute = vi.fn()
      .mockResolvedValueOnce({ id: 'u1' })
      .mockResolvedValueOnce(null); // عُطِّل المستخدم بين النداءين
    expect(await cachedByToken('tok', compute)).toEqual({ id: 'u1' });

    await vi.advanceTimersByTimeAsync(16_000);
    expect(await cachedByToken('tok', compute)).toBeNull();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('الفشل لا يُخزَّن — عطل شبكة عابر لا يصير منعاً دائماً', async () => {
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'u1' });

    await expect(cachedByToken('tok', compute)).rejects.toThrow('network');
    expect(await cachedByToken('tok', compute)).toEqual({ id: 'u1' });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('clearAuthCache يُسقط كل شيء — لتسجيل الخروج', async () => {
    const compute = vi.fn().mockResolvedValue({ id: 'u1' });
    await cachedByToken('tok', compute);
    clearAuthCache();
    await cachedByToken('tok', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
