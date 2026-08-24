'use client';

/**
 * صفحة الطوارئ — يخدمها الـservice worker حين تُطلب صفحة لم يزرها المستخدم قط
 * وهو متصل، فما عندنا نسخة منها. غرضها أن يفهم المستخدم ما الذي حدث وما الذي
 * يقدر يفعله، لا أن يواجه خطأ متصفح أبيض.
 */

import { useEffect, useState } from 'react';

export default function OfflinePage() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-amber-50 flex items-center justify-center mb-5">
          <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m-12.728 0a9 9 0 010-12.728m9.9 9.9a5 5 0 010-7.072m-7.072 0a5 5 0 010 7.072M3 3l18 18" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-slate-800 mb-2">هذه الصفحة غير محفوظة على الجهاز</h1>
        <p className="text-slate-600 text-sm leading-relaxed mb-6">
          لا يوجد اتصال بالإنترنت، وما زرت هذه الصفحة من قبل وأنت متصل — فما عندنا نسخة منها.
          <br />
          الصفحات التي فتحتها سابقاً ما زالت تعمل: افتحها من القائمة.
        </p>

        <div className="flex flex-col gap-2">
          <button onClick={() => window.location.reload()} className="btn-primary justify-center">
            {online ? 'رجع الاتصال — أعد المحاولة' : 'إعادة المحاولة'}
          </button>
          <a href="/" className="btn-secondary justify-center">الرئيسية</a>
        </div>

        <p className="text-xs text-slate-400 mt-6">
          {online ? 'الاتصال متاح الآن' : 'ما زال الجهاز غير متصل'}
        </p>
      </div>
    </div>
  );
}
