'use client';

import { useEffect, useRef } from 'react';

/**
 * يفتح نافذة التعديل مباشرة لما توصل الصفحة برابط فيه `?edit=<id>`
 * (مثلاً من «آخر المستفيدين المضافين» في لوحة التحكم).
 *
 * نقرأ window.location بدل useSearchParams عشان ما نحتاج Suspense حول
 * صفحات كاملة. بعد الفتح (أو لو العنصر ما انوجد بعد انتهاء التحميل) نشيل
 * الباراميتر من الرابط، فالتحديث أو الرجوع ما يعيد فتح النافذة.
 */
export function useEditParam<T extends { id: string }>(
  items: T[],
  /** true بعد وصول البيانات الطازجة من القاعدة (مو اللقطة المحفوظة) */
  fresh: boolean,
  open: (item: T) => void,
) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const id = url.searchParams.get('edit');
    if (!id) { done.current = true; return; }

    const item = items.find(i => i.id === id);
    // اللقطة المحفوظة تُرسم قبل وصول البيانات الطازجة — ننتظر الطازجة قبل ما
    // نستسلم، لأن العنصر المضاف حديثاً غالباً مو في اللقطة.
    if (!item && !fresh) return;

    done.current = true;
    if (item) open(item);
    url.searchParams.delete('edit');
    url.searchParams.delete('entity');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [items, fresh, open]);
}
