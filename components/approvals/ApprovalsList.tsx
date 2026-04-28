'use client';

// قائمة طلبات الموافقة — تستخدم في لوحة التحكم (مختصرة) وفي صفحة /approvals
// (كاملة مع فلاتر وسجل). يتغيّر السلوك حسب دور المستخدم:
//   - الأدمن: يشوف الكل (طلبات الجميع) ويقدر يقبل/يرفض
//   - اليوزر: يشوف طلباته فقط (read-only)

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import { ENTITY_TYPE_LABELS } from '@/lib/types';
import { type PendingAction, approveAction, rejectAction } from '@/lib/pending-actions';

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

const STATUS_THEME: Record<PendingAction['status'], { label: string; cls: string }> = {
  pending:  { label: 'بانتظار الموافقة', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'مقبول',            cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  rejected: { label: 'مرفوض',           cls: 'bg-red-100 text-red-700 border-red-200' },
};

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
  const supabase = useMemo(() => createClient(), []);
  const channelId = useId();
  const isAdmin = user?.is_admin === true;

  const [items, setItems] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | PendingAction['status']>(statusFilter);

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
                      {ENTITY_TYPE_LABELS[pa.entity_type]} · {pa.user_name ?? 'مستخدم'} · {timeAgo(pa.created_at)}
                    </p>
                    {pa.status === 'rejected' && pa.reject_reason && (
                      <p className="text-[11px] text-red-600 mt-1">سبب الرفض: {pa.reject_reason}</p>
                    )}
                    {pa.status !== 'pending' && pa.reviewed_at && (
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        روجِع {timeAgo(pa.reviewed_at)}
                      </p>
                    )}
                  </div>
                </div>
                {isAdmin && pa.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => handleApprove(pa)}
                      disabled={busyId === pa.id}
                      className="flex-1 py-1.5 text-xs font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busyId === pa.id ? '...' : 'قبول'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject(pa)}
                      disabled={busyId === pa.id}
                      className="flex-1 py-1.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                    >
                      رفض
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
