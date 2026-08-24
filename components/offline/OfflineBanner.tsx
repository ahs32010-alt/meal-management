'use client';

/**
 * شريط الحالة أعلى الصفحات.
 *
 * يظهر في حالتين فقط، وإلا فلا يشغل بكسلاً:
 *   • انقطاع الاتصال — ومعه **متى آخر مزامنة**. هذي ليست تفصيلة تجميلية: من
 *     يطبع ستيكرات من بيانات الأمس لازم يعرف أنها بيانات أمس.
 *   • توفّر إصدار جديد — بزر يختار المستخدم وقته.
 *
 * الارتفاع ثابت (h-9) ويُنشَر في `--kha-banner-h`، لأن الأشرطة العلوية في
 * التخطيط لاصقة هي أيضاً وتحتاج تعرف كم تنزل حتى لا تختفي تحته.
 */

import { useEffect, useState } from 'react';
import { useNetworkStatus } from '@/lib/offline/status';
import { formatLastSync } from '@/lib/offline/format';
import { applyUpdate, onUpdateAvailable } from '@/lib/offline/register-sw';

const BANNER_HEIGHT = '2.25rem'; // = h-9

export default function OfflineBanner() {
  const { online, lastSyncAt } = useNetworkStatus();
  const [updateReady, setUpdateReady] = useState(false);
  const [applying, setApplying] = useState(false);
  // يتحدّث كل دقيقة حتى لا يتجمّد نص «قبل ٣ دقائق» على قيمته الأولى.
  const [, setTick] = useState(0);

  useEffect(() => onUpdateAvailable(setUpdateReady), []);

  useEffect(() => {
    if (online) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [online]);

  const visible = !online || updateReady;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--kha-banner-h', visible ? BANNER_HEIGHT : '0px');
    return () => root.style.setProperty('--kha-banner-h', '0px');
  }, [visible]);

  if (!online) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-40 h-9 bg-amber-100 border-b border-amber-300 px-3 flex items-center gap-2 text-amber-900"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728M3 3l18 18" />
        </svg>
        <span className="text-sm font-bold flex-shrink-0">لا يوجد اتصال</span>
        <span className="text-xs opacity-90 truncate">
          — بيانات محفوظة على الجهاز، آخر مزامنة {formatLastSync(lastSyncAt)}. التعديل والحفظ غير متاحين.
        </span>
      </div>
    );
  }

  if (updateReady) {
    return (
      <div className="sticky top-0 z-40 h-9 bg-emerald-100 border-b border-emerald-300 px-3 flex items-center gap-3 text-emerald-900">
        <span className="text-sm font-bold flex-1 truncate">يتوفّر إصدار جديد من النظام</span>
        <button
          onClick={() => {
            setApplying(true);
            void applyUpdate();
          }}
          disabled={applying}
          className="text-xs font-bold bg-emerald-600 text-white px-3 py-1 rounded-md hover:bg-emerald-700 disabled:opacity-60 flex-shrink-0"
        >
          {applying ? 'جارٍ التحديث…' : 'تحديث الآن'}
        </button>
      </div>
    );
  }

  return null;
}
