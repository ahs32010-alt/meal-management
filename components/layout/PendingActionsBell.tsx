'use client';

// جرس إشعارات للأدمن: يبيّن طلبات الإضافة/الحذف pending مع زرّي قبول/رفض.
// realtime على pending_actions لتحديث العداد فوراً.

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import { ENTITY_TYPE_LABELS } from '@/lib/types';
import {
  type PendingAction,
  approveAction,
  rejectAction,
} from '@/lib/pending-actions';

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

export default function PendingActionsBell() {
  const { user } = useCurrentUser();
  const supabase = useMemo(() => createClient(), []);
  // اسم قناة realtime فريد لكل instance — يمنع التصادم لما الجرس يُرسم
  // في عدّة أماكن (الـsidebar وشريط الموبايل والديسكتوب).
  const channelId = useId();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<PendingAction[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = user?.is_admin === true;

  const fetchPending = useCallback(async () => {
    if (!isAdmin) { setItems([]); return; }
    const { data } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setItems((data ?? []) as PendingAction[]);
  }, [isAdmin, supabase]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  // realtime — نستخدم ref للـcallback عشان ما نعيد إنشاء القناة كل ما تتغيّر
  // الحالة (الذي كان يسبّب: cannot add `postgres_changes` callbacks after subscribe).
  const fetchRef = useRef(fetchPending);
  useEffect(() => { fetchRef.current = fetchPending; }, [fetchPending]);

  useEffect(() => {
    if (!isAdmin) return;
    const channel = supabase
      .channel(`pending-actions-bell-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_actions' }, () => fetchRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, isAdmin, channelId]);

  // close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleApprove = async (pa: PendingAction) => {
    if (!user) return;
    setBusyId(pa.id);
    setError(null);
    const r = await approveAction(supabase, user, pa);
    if (!r.ok) setError(r.error);
    setBusyId(null);
    fetchPending();
  };

  const handleReject = async (pa: PendingAction) => {
    if (!user) return;
    const reason = window.prompt('سبب الرفض (اختياري):') ?? '';
    setBusyId(pa.id);
    setError(null);
    const { error: rejErr } = await rejectAction(supabase, user, pa, reason);
    if (rejErr) setError(rejErr.message);
    setBusyId(null);
    fetchPending();
  };

  if (!isAdmin) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="relative w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title="طلبات الموافقة"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {items.length > 0 && (
          <span className="absolute -top-0.5 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-[360px] max-h-[80vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl z-50" dir="rtl">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-sm">طلبات الموافقة</h3>
            <span className="text-xs text-slate-400">{items.length} بانتظار المراجعة</span>
          </div>

          {error && (
            <div className="mx-3 mt-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">
              ⚠ {error}
            </div>
          )}

          {items.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-sm">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
              </svg>
              لا توجد طلبات بانتظار المراجعة
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {items.map(pa => {
                const isCreate = pa.action === 'create';
                return (
                  <div key={pa.id} className="px-4 py-3 hover:bg-slate-50">
                    <div className="flex items-start gap-2 mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-md shrink-0 ${
                        isCreate ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {isCreate ? '+ إضافة' : '✕ حذف'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {pa.entity_name ?? '—'}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {ENTITY_TYPE_LABELS[pa.entity_type]} · {pa.user_name ?? 'مستخدم'} · {timeAgo(pa.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
