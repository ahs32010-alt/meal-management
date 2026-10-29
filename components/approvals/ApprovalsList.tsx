'use client';

// قائمة طلبات الموافقة — تستخدم في لوحة التحكم (مختصرة) وفي صفحة /approvals
// (كاملة مع فلاتر وسجل). يتغيّر السلوك حسب دور المستخدم:
//   - الأدمن: يشوف الكل (طلبات الجميع) ويقدر يقبل/يرفض
//   - اليوزر: يشوف طلباته فقط (read-only)

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import { type PendingAction, PENDING_ENTITY_LABELS, approveAction, rejectAction } from '@/lib/pending-actions';
import { type ChangeSet, type PendingChange, loadChangeSet, approveSelected } from '@/lib/pending-changes';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `قبل ${min} د`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `قبل ${hr} س`;
  const d = Math.floor(hr / 24);
  return `قبل ${d} يوم`;
}

// تنسيق التوقيت بالكامل (تاريخ + ساعة + دقيقة + ثانية + ميلي)
function formatExact(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const STATUS_THEME: Record<PendingAction['status'], { label: string; cls: string }> = {
  pending:  { label: 'بانتظار الموافقة', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'مقبول',            cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  rejected: { label: 'مرفوض',           cls: 'bg-red-100 text-red-700 border-red-200' },
};

const KIND_THEME: Record<PendingChange['kind'], { icon: string; cls: string }> = {
  add:    { icon: '+', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  remove: { icon: '−', cls: 'text-red-700 bg-red-50 border-red-200' },
  change: { icon: '✎', cls: 'text-blue-700 bg-blue-50 border-blue-200' },
};

/**
 * مراجعة الطلب تغييراً تغييراً. للأدمن على طلب معلّق: خانة لكل تغيير
 * (محظور، بديل، صنف ثابت، حقل…) فيعتمد المختار ويُرفض الباقي.
 * للطلبات المنتهية أو لغير الأدمن: نفس القائمة للعرض فقط.
 */
function ChangeReview({
  pa,
  canDecide,
  busy,
  onApproveSelected,
}: {
  pa: PendingAction;
  canDecide: boolean;
  busy: boolean;
  onApproveSelected: (selected: Set<string>) => void;
}) {
  const [cs, setCs] = useState<ChangeSet | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCs(null);
    loadChangeSet(supabase, pa)
      .then(r => {
        if (cancelled) return;
        setCs(r);
        setSelected(new Set(r.changes.filter(c => !c.locked).map(c => c.id)));
      })
      .catch(e => { if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [pa]);

  if (loadErr) return <div className="text-xs text-red-600">تعذّر تحليل الطلب: {loadErr}</div>;
  if (!cs) return <div className="text-xs text-slate-400">جاري تحليل التغييرات...</div>;

  const context = cs.context && (
    <div className="rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-2 space-y-1">
      <p className="text-xs font-bold text-slate-700">{cs.context.title}</p>
      {cs.context.lines.map(l => (
        <p key={l.label} className="text-[11px] text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-700">{l.label}: </span>{l.value}
        </p>
      ))}
    </div>
  );

  // بعد التنفيذ، المقارنة مع القاعدة ما عاد لها معنى (التغييرات صارت هي الحالة)
  if (pa.status !== 'pending') {
    return (
      <p className="text-xs text-slate-500">
        {pa.status === 'approved' ? 'تم تنفيذ الطلب.' : 'الطلب مرفوض.'}
      </p>
    );
  }

  const optional = cs.changes.filter(c => !c.locked);
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-2">
      {context}
      {cs.note && <p className="text-xs text-amber-700">{cs.note}</p>}
      {cs.changes.length === 0 && !cs.note && (
        <p className="text-xs text-slate-500">— لا توجد تغييرات فعلية مقارنة بالبيانات الحالية.</p>
      )}

      {canDecide && optional.length > 1 && (
        <div className="flex items-center gap-2 text-[11px]">
          <button type="button" onClick={() => setSelected(new Set(optional.map(c => c.id)))}
            className="px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-100">تحديد الكل</button>
          <button type="button" onClick={() => setSelected(new Set())}
            className="px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-slate-100">إلغاء التحديد</button>
          <span className="text-slate-400">{selected.size} من {optional.length} محدد</span>
        </div>
      )}

      <ul className="space-y-1">
        {cs.changes.map(c => {
          const theme = KIND_THEME[c.kind];
          const on = c.locked || selected.has(c.id);
          return (
            <li key={c.id}>
              <label className={`flex items-start gap-2 text-xs rounded-lg border px-2 py-1.5 ${
                canDecide && !c.locked ? 'cursor-pointer' : ''
              } ${on ? 'bg-white border-slate-200' : 'bg-slate-100 border-slate-200 opacity-60'}`}>
                {canDecide && (
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-emerald-600"
                    checked={on}
                    disabled={c.locked || busy}
                    onChange={() => toggle(c.id)}
                  />
                )}
                <span className={`shrink-0 w-5 h-5 grid place-items-center rounded border font-bold ${theme.cls}`}>{theme.icon}</span>
                <span className={`flex-1 ${on ? 'text-slate-700' : 'text-slate-500 line-through'}`}>{c.label}</span>
                {c.locked && <span className="text-[10px] text-slate-400 shrink-0">أساسي</span>}
              </label>
            </li>
          );
        })}
      </ul>

      {canDecide && optional.length > 0 && selected.size < optional.length && (
        <button
          type="button"
          onClick={() => onApproveSelected(selected)}
          disabled={busy}
          className="w-full py-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
        >
          {busy ? '...' : selected.size === 0 && !cs.changes.some(c => c.locked)
            ? 'رفض كل التغييرات'
            : `اعتماد المحدد فقط (${selected.size}) ورفض الباقي (${optional.length - selected.size})`}
        </button>
      )}
    </div>
  );
}

interface Props {
  // لو محدود → نعرض فقط أحدث N للوحة التحكم
  limit?: number;
  // الفلتر على الحالة — يُستخدم في صفحة /approvals
  statusFilter?: 'all' | PendingAction['status'];
  // إخفاء الفلاتر المدمجة (للوحة التحكم)
  hideFilters?: boolean;
  // عند تغيير الحالة، نُبلِغ الـparent عشان يعيد قراءة العداد إن احتاج
  onChange?: () => void;
}

export default function ApprovalsList({ limit, statusFilter = 'all', hideFilters = false, onChange }: Props) {
  const { user } = useCurrentUser();
  const channelId = useId();
  const isAdmin = user?.is_admin === true;

  const [items, setItems] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | PendingAction['status']>(statusFilter);
  // الطلب المفتوح (تفاصيله ظاهرة)
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { setFilter(statusFilter); }, [statusFilter]);

  const fetchData = useCallback(async () => {
    if (!user) { setItems([]); setLoading(false); return; }
    let q = supabase.from('pending_actions').select('*').order('created_at', { ascending: false });
    // اليوزر يشوف طلباته فقط، الأدمن يشوف الكل
    if (!isAdmin) q = q.eq('user_id', user.id);
    if (filter !== 'all') q = q.eq('status', filter);
    if (limit) q = q.limit(limit);
    const { data, error: fetchErr } = await q;
    if (fetchErr) {
      // الـmigration ما اتشغّل → ما نكسر الواجهة، نظهر قائمة فاضية
      if (/pending_actions|relation|table/i.test(fetchErr.message)) {
        setItems([]);
      } else {
        setError(fetchErr.message);
      }
    } else {
      setItems((data ?? []) as PendingAction[]);
    }
    setLoading(false);
  }, [supabase, user, isAdmin, filter, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // realtime
  const fetchRef = useRef(fetchData);
  useEffect(() => { fetchRef.current = fetchData; }, [fetchData]);
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`approvals-list-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_actions' }, () => fetchRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, user, channelId]);

  const handleApprove = async (pa: PendingAction) => {
    if (!user) return;
    setBusyId(pa.id);
    setError(null);
    const r = await approveAction(supabase, user, pa);
    if (!r.ok) setError(r.error);
    setBusyId(null);
    fetchData();
    onChange?.();
  };

  const handleApproveSelected = async (pa: PendingAction, selected: Set<string>) => {
    if (!user) return;
    setBusyId(pa.id);
    setError(null);
    const r = await approveSelected(supabase, user, pa, selected);
    if (!r.ok) setError(r.error);
    setBusyId(null);
    fetchData();
    onChange?.();
  };

  const handleReject = async (pa: PendingAction) => {
    if (!user) return;
    const reason = window.prompt('سبب الرفض (اختياري):') ?? '';
    setBusyId(pa.id);
    setError(null);
    const { error: rejErr } = await rejectAction(supabase, user, pa, reason);
    if (rejErr) setError(rejErr.message);
    setBusyId(null);
    fetchData();
    onChange?.();
  };

  return (
    <div className="space-y-3" dir="rtl">
      {!hideFilters && (
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 w-fit">
          {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                filter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {f === 'all' ? 'الكل' : STATUS_THEME[f].label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">⚠ {error}</div>
      )}

      {loading ? (
        <div className="py-8 text-center text-slate-400 text-sm">جاري التحميل...</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          {filter === 'pending' ? 'لا توجد طلبات بانتظار المراجعة' : 'لا توجد طلبات'}
        </div>
      ) : (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl bg-white overflow-hidden">
          {items.map(pa => {
            const status = STATUS_THEME[pa.status];
            const isExpanded = expandedId === pa.id;
            return (
              <div key={pa.id} className="px-4 py-3 hover:bg-slate-50">
                <div className="flex items-start gap-2 mb-2 flex-wrap">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${
                    pa.action === 'create' ? 'bg-emerald-100 text-emerald-700'
                  : pa.action === 'update' ? 'bg-blue-100 text-blue-700'
                                            : 'bg-red-100 text-red-700'
                  }`}>
                    {pa.action === 'create' ? '+ إضافة' : pa.action === 'update' ? '✎ تعديل' : '✕ حذف'}
                  </span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border shrink-0 ${status.cls}`}>
                    {status.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{pa.entity_name ?? '—'}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      <span title={formatExact(pa.created_at)}>
                        {PENDING_ENTITY_LABELS[pa.entity_type] ?? pa.entity_type} · {pa.user_name ?? 'مستخدم'} · {timeAgo(pa.created_at)}
                      </span>
                    </p>
                    {pa.status === 'rejected' && pa.reject_reason && (
                      <p className="text-[11px] text-red-600 mt-1">سبب الرفض: {pa.reject_reason}</p>
                    )}
                    {pa.status === 'approved' && pa.reject_reason && (
                      <p className="text-[11px] text-amber-700 mt-1">{pa.reject_reason}</p>
                    )}
                    {pa.status !== 'pending' && pa.reviewed_at && (
                      <p className="text-[11px] text-slate-400 mt-0.5" title={formatExact(pa.reviewed_at)}>
                        روجِع {timeAgo(pa.reviewed_at)}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : pa.id)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-md hover:bg-slate-100 shrink-0"
                  >
                    {isExpanded ? 'إخفاء التفاصيل ▲' : isAdmin && pa.status === 'pending' ? 'مراجعة كل تغيير ▼' : 'تفاصيل العملية ▼'}
                  </button>
                </div>

                {/* ملخّص العملية — يبيّن وش الـuser يطلب بالضبط */}
                {isExpanded && (
                  <div className="mt-3 mb-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <ChangeReview
                      pa={pa}
                      canDecide={isAdmin && pa.status === 'pending'}
                      busy={busyId === pa.id}
                      onApproveSelected={sel => handleApproveSelected(pa, sel)}
                    />
                    <div className="text-[10px] text-slate-400 font-mono pt-2 border-t border-slate-200">
                      أُرسل: {formatExact(pa.created_at)}
                      {pa.reviewed_at && <> · روجِع: {formatExact(pa.reviewed_at)}</>}
                    </div>
                  </div>
                )}

                {isAdmin && pa.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleApprove(pa)}
                      disabled={busyId === pa.id}
                      className="flex-1 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busyId === pa.id ? '...' : 'قبول الكل'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(pa)}
                      disabled={busyId === pa.id}
                      className="flex-1 py-1.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                    >
                      رفض الكل
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
