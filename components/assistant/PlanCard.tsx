'use client';

import type { Plan, PlanStep } from '@/lib/assistant/plan';

/** الخطة كما تصل للمتصفح — بلا العمليات الداخلية. */
export type ClientPlan = Omit<Plan, 'ops' | 'activity'> & { question: string };

const TONE: Record<PlanStep['tone'], { badge: string; box: string; label: string }> = {
  add: { badge: 'bg-emerald-100 text-emerald-700', box: 'border-emerald-200', label: 'إضافة' },
  remove: { badge: 'bg-red-100 text-red-700', box: 'border-red-200', label: 'حذف' },
  change: { badge: 'bg-amber-100 text-amber-700', box: 'border-amber-200', label: 'تعديل' },
};

interface Props {
  plan: ClientPlan;
  status: 'pending' | 'running' | 'done' | 'cancelled';
  appliedCount?: number;
  error?: string;
  /** يظهر زر التراجع فقط بعد تنفيذ ناجح وما دام الرمز صالحاً. */
  canUndo?: boolean;
  undoing?: boolean;
  undone?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onUndo?: () => void;
}

export default function PlanCard({ plan, status, appliedCount, error, canUndo, undoing, undone, onConfirm, onCancel, onUndo }: Props) {
  const settled = status === 'done' || status === 'cancelled';

  return (
    <div
      className={`rounded-2xl border-2 bg-white p-4 space-y-3 shadow-sm ${
        status === 'done'
          ? 'border-emerald-300'
          : status === 'cancelled'
            ? 'border-slate-200 opacity-70'
            : 'border-sky-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-semibold">
              أمر تنفيذي
            </span>
            <h3 className="font-bold text-slate-800 text-base">{plan.title}</h3>
          </div>
          <p className="text-sm text-slate-600 mt-1">{plan.summary}</p>
        </div>
        {status === 'done' && (
          <span className="text-emerald-600 text-sm font-bold whitespace-nowrap">✓ تم التنفيذ</span>
        )}
        {status === 'cancelled' && (
          <span className="text-slate-400 text-sm font-bold whitespace-nowrap">أُلغي</span>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-slate-500">سيتم تنفيذ التالي:</div>
        {plan.steps.map((s, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${TONE[s.tone].box}`}
          >
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 mt-0.5 ${TONE[s.tone].badge}`}>
              {TONE[s.tone].label}
            </span>
            <span className="text-sm text-slate-700 leading-relaxed">{s.text}</span>
          </div>
        ))}
      </div>

      {plan.warnings.length > 0 && (
        <div className="space-y-1">
          {plan.warnings.map((w, i) => (
            <div
              key={i}
              className="text-xs rounded-lg px-3 py-2 border border-amber-200 bg-amber-50 text-amber-800 leading-relaxed"
            >
              ⚠︎ {w}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="text-sm rounded-lg px-3 py-2 border border-red-200 bg-red-50 text-red-700">
          {error}
        </div>
      )}

      {status === 'done' && (
        <div className="flex items-center justify-between gap-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <span>
            {undone
              ? 'تم التراجع — رجعت البيانات كما كانت.'
              : `نُفِّذت ${appliedCount ?? plan.steps.length} عملية وسُجِّلت في سجل النشاطات.`}
          </span>
          {canUndo && !undone && onUndo && (
            <button
              type="button"
              onClick={onUndo}
              disabled={undoing}
              className="px-2.5 py-1 rounded-lg border border-emerald-300 bg-white text-emerald-700 font-semibold hover:bg-emerald-100 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {undoing ? 'جارٍ التراجع…' : '↺ تراجع'}
            </button>
          )}
        </div>
      )}

      {!settled && (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            disabled={status === 'running'}
            className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {status === 'running' ? 'جارٍ التنفيذ…' : 'تأكيد التنفيذ'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={status === 'running'}
            className="px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-600 text-sm hover:bg-slate-100 disabled:opacity-50 transition-colors"
          >
            إلغاء
          </button>
        </div>
      )}
    </div>
  );
}
