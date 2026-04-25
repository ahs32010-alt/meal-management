'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('App error boundary:', error);
    }
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-800 mb-2">حدث خطأ غير متوقع</h1>
            <p className="text-sm text-slate-500 mb-6">
              نعتذر عن هذه المشكلة. يمكنك المحاولة مجدداً.
            </p>
            {error.digest && (
              <p className="text-xs text-slate-400 mb-4 font-mono">معرّف الخطأ: {error.digest}</p>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={reset}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm"
              >
                المحاولة مجدداً
              </button>
              <a
                href="/"
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm"
              >
                الرئيسية
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
