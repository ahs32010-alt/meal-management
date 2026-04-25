'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('Dashboard error boundary:', error);
    }
  }, [error]);

  return (
    <div className="p-6">
      <div className="bg-white border border-red-100 rounded-2xl shadow-sm p-6 max-w-2xl mx-auto">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 shrink-0 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-slate-800 mb-1">تعذّر تحميل هذه الصفحة</h2>
            <p className="text-sm text-slate-500 mb-4">حدث خطأ أثناء معالجة طلبك. حاول مرة أخرى.</p>
            {error.digest && (
              <p className="text-xs text-slate-400 mb-3 font-mono">معرّف: {error.digest}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm"
              >
                إعادة المحاولة
              </button>
              <a
                href="/"
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm"
              >
                العودة للرئيسية
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
