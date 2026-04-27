'use client';

import { useCuteTheme } from '@/lib/use-cute-theme';

export default function ExtrasView() {
  const { enabled, setEnabled, ready } = useCuteTheme();

  return (
    <div className="space-y-4">
      {/* ── ثيم الدلع ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
          <h2 className="font-bold text-slate-800">ثيم الدلع 🍰</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            ايقونات أكل لطيفة في الخلفية وكروت شفافة. التفعيل يخصّك أنت فقط — ما يطبَّق على بقية المستخدمين.
          </p>
        </div>

        <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 text-sm">تفعيل ثيم الدلع</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {enabled
                ? 'الثيم مفعَّل حالياً ✨ — يُحفظ التفعيل لين تلغيه يدوياً.'
                : 'فعّله عشان تشوف ايقونات أكل لطيفة وألوان دافية.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            disabled={!ready}
            role="switch"
            aria-checked={enabled}
            className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
              enabled ? 'bg-emerald-500' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                enabled ? '-translate-x-1' : '-translate-x-6'
              }`}
            />
          </button>
        </div>
      </div>

    </div>
  );
}
