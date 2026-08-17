'use client';

import { useEffect } from 'react';

export type ImportMode = 'append' | 'replace' | 'update';

interface Props {
  isOpen: boolean;
  title?: string;
  description?: string;
  /** نص تحذيري إضافي يظهر تحت خيار الاستبدال (مثلاً تنبيه الحذف المتسلسل). */
  replaceWarning?: string;
  onChoose: (mode: ImportMode) => void;
  onCancel: () => void;
}

/**
 * حوار موحّد يسأل المستخدم عن طريقة الاستيراد قبل تنفيذه:
 *   • إضافة  — الإبقاء على البيانات الحالية وإضافة بيانات الملف فوقها.
 *   • استبدال — حذف البيانات الحالية بالكامل ووضع بيانات الملف فقط.
 */
export default function ImportModeDialog({
  isOpen,
  title = 'طريقة الاستيراد',
  description = 'كيف تريد التعامل مع البيانات الموجودة حالياً في هذه الصفحة؟',
  replaceWarning,
  onChoose,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 pt-6 pb-2 text-center">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed">{description}</p>
        </div>

        <div className="px-6 py-4 space-y-3">
          {/* إضافة */}
          <button
            onClick={() => onChoose('append')}
            className="w-full text-right rounded-xl border-2 border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/50 p-4 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">إضافة للموجود</p>
                <p className="text-xs text-slate-500 mt-0.5">الإبقاء على البيانات الحالية وإضافة بيانات الملف إليها</p>
              </div>
            </div>
          </button>

          {/* استبدال */}
          <button
            onClick={() => onChoose('replace')}
            className="w-full text-right rounded-xl border-2 border-amber-200 hover:border-amber-400 hover:bg-amber-50/50 p-4 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">استبدال الكل</p>
                <p className="text-xs text-slate-500 mt-0.5">حذف البيانات الحالية بالكامل ووضع بيانات الملف فقط</p>
                {replaceWarning && (
                  <p className="text-xs text-red-600 mt-1 font-medium leading-relaxed">⚠️ {replaceWarning}</p>
                )}
              </div>
            </div>
          </button>
        </div>

        <div className="px-6 pb-6 pt-1">
          <button
            onClick={onCancel}
            className="w-full py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold transition-colors"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
