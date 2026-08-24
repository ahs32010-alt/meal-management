'use client';

/**
 * نقطة التشغيل الوحيدة لمنظومة العمل بلا إنترنت. تُركَّب مرة في تخطيط لوحة
 * التحكم فتغطّي كل الصفحات:
 *   ① تبدأ مراقبة حالة الاتصال.
 *   ② تسجّل الـservice worker (قشرة التطبيق: صفحات، حِزم، خطوط).
 *   ③ تجهّز صفحات المستخدم المسموح له بها مرة واحدة كل جلسة، وهو متصل، في
 *      وقت خمول المتصفح — حتى يقدر يفتحها لاحقاً بلا نت ولو ما زارها.
 */

import { useEffect } from 'react';
import { useCurrentUser } from '@/lib/use-current-user';
import { initNetworkStatus } from '@/lib/offline/status';
import { registerServiceWorker, warmPages } from '@/lib/offline/register-sw';
import OfflineBanner from './OfflineBanner';

const WARMED_KEY = 'kha:warmed';

export default function OfflineProvider() {
  const { user, loading } = useCurrentUser();

  useEffect(() => {
    initNetworkStatus();
    void registerServiceWorker();
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === 'undefined' || navigator.onLine === false) return;

    // مرة واحدة لكل جلسة تبويب — التجهيز يسحب كل الصفحات، وتكراره عبث.
    try {
      if (window.sessionStorage.getItem(WARMED_KEY) === user.id) return;
      window.sessionStorage.setItem(WARMED_KEY, user.id);
    } catch {
      // تخزين محجوب — نجهّز مرة في هذه الحياة على الأقل.
    }

    const run = () => {
      void warmPages(user);
    };
    // ننتظر خمول المتصفح: التجهيز خلفي وما يستاهل يزاحم أول رسم للصفحة.
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (idle) {
      idle(run, { timeout: 10_000 });
    } else {
      const id = setTimeout(run, 4000);
      return () => clearTimeout(id);
    }
  }, [user, loading]);

  return <OfflineBanner />;
}
