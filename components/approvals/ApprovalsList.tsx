'use client';

// قائمة طلبات الموافقة — تستخدم في لوحة التحكم (مختصرة) وفي صفحة /approvals
// (كاملة مع فلاتر وسجل). يتغيّر السلوك حسب دور المستخدم:
//   - الأدمن: يشوف الكل (طلبات الجميع) ويقدر يقبل/يرفض
//   - اليوزر: يشوف طلباته فقط (read-only)

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import { ENTITY_TYPE_LABELS, MEAL_TYPE_LABELS, DAY_LABELS } from '@/lib/types';
import type { Meal } from '@/lib/types';
import { type PendingAction, type CreatePayload, approveAction, rejectAction } from '@/lib/pending-actions';

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

const CAT_LABELS: Record<string, string> = { hot: '🔥 حار', cold: '❄️ بارد', snack: '🍿 سناك' };

// تسميات حقول المستفيد الأساسية للعرض في فروقات التعديل
const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  english_name: 'الاسم بالإنجليزي',
  code: 'الكود',
  category: 'الفئة',
  villa: 'الفيلا',
  diet_type: 'النظام الغذائي',
  notes: 'الملاحظات',
};

// مفتاح الصنف الثابت = صنف + وجبة + يوم
const fmKey = (fm: { meal_id: string; meal_type: string; day_of_week: number }) =>
  `${fm.meal_id}|${fm.meal_type}|${fm.day_of_week}`;

const STATUS_THEME: Record<PendingAction['status'], { label: string; cls: string }> = {
  pending:  { label: 'بانتظار الموافقة', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  approved: { label: 'مقبول',            cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  rejected: { label: 'مرفوض',           cls: 'bg-red-100 text-red-700 border-red-200' },
};

// ملخّص العملية بكلام بشري — يحلّل الـdiff للتعديل ويصف الإضافة/الحذف
import type { SupabaseClient } from '@supabase/supabase-js';

function ActionSummary({
  pa,
  mealsById,
  supabase,
}: {
  pa: PendingAction;
  mealsById: Record<string, Meal>;
  supabase: SupabaseClient;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [computing, setComputing] = useState(true);

  const mealName = (id: string | null | undefined) => (id && mealsById[id]?.name) || '—';
  const dayLabel = (d: number) => DAY_LABELS[d] ?? String(d);
  const mealTypeLabel = (t: string) => MEAL_TYPE_LABELS[t as 'breakfast' | 'lunch' | 'dinner'] ?? t;
  const catLabel = (c: string | undefined) => (c ? CAT_LABELS[c] ?? c : '');

  useEffect(() => {
    let cancelled = false;
    const target = pa.entity_name ?? '—';
    const entityNoun = pa.entity_type === 'companion' ? 'المرافق' : 'المستفيد';

    if (pa.action === 'delete') {
      setLines([`يطلب حذف ${entityNoun} «${target}»`]);
      setComputing(false);
      return;
    }

    const cp = pa.payload as unknown as CreatePayload | null;

    if (pa.action === 'create') {
      const out: string[] = [`يطلب إضافة ${entityNoun} جديد «${target}»`];
      if (cp?.exclusions?.length) {
        const names = cp.exclusions.slice(0, 4).map(e => mealName(e.meal_id));
        const more = cp.exclusions.length > 4 ? ` و${cp.exclusions.length - 4} غيرها` : '';
        out.push(`مع ${cp.exclusions.length} محظور: ${names.join('، ')}${more}`);
      }
      if (cp?.fixed_meals?.length) {
        out.push(`و ${cp.fixed_meals.length} صنف ثابت في الجدول الأسبوعي`);
      }
      setLines(out);
      setComputing(false);
      return;
    }

    // update — نجلب الحالة الحالية ونحسب الفرق
    if (pa.action === 'update' && pa.entity_id && cp) {
      (async () => {
        const { data: cur } = await supabase
          .from('beneficiaries')
          .select(`name, english_name, code, category, villa, diet_type, notes,
                   exclusions(meal_id, alternative_meal_id),
                   fixed_meals:beneficiary_fixed_meals(day_of_week, meal_type, meal_id, quantity, category)`)
          .eq('id', pa.entity_id!)
          .maybeSingle();

        if (cancelled) return;

        const out: string[] = [`يطلب تعديل ${entityNoun} «${target}»`];

        if (!cur) {
          out.push('⚠ تعذّر جلب البيانات الحالية للمقارنة — يحتمل أن المستفيد محذوف.');
          setLines(out);
          setComputing(false);
          return;
        }

        // الحقول الأساسية
        const curRecord = cur as unknown as Record<string, unknown>;
        for (const [k, label] of Object.entries(FIELD_LABELS)) {
          const oldV = String(curRecord[k] ?? '').trim();
          const newV = String((cp.beneficiary[k] as string | undefined) ?? '').trim();
          if (oldV !== newV) {
            out.push(`تغيير ${label}: «${oldV || '—'}» ← «${newV || '—'}»`);
          }
        }

        // المحظورات
        type ExRow = { meal_id: string; alternative_meal_id: string | null };
        const oldEx = ((cur as { exclusions?: ExRow[] }).exclusions ?? []);
        const newEx = cp.exclusions ?? [];
        const oldExMap = new Map(oldEx.map(e => [e.meal_id, e.alternative_meal_id ?? null]));
        const newExMap = new Map(newEx.map(e => [e.meal_id, e.alternative_meal_id ?? null]));

        for (const [mid, newAlt] of newExMap) {
          if (!oldExMap.has(mid)) {
            const part = newAlt ? `استبعاد جديد: ${mealName(mid)} (بديل: ${mealName(newAlt)})` : `استبعاد جديد: ${mealName(mid)} بدون بديل`;
            out.push(part);
          } else {
            const oldAlt = oldExMap.get(mid) ?? null;
            if ((oldAlt ?? null) !== (newAlt ?? null)) {
              const oldS = oldAlt ? mealName(oldAlt) : 'بدون بديل';
              const newS = newAlt ? mealName(newAlt) : 'بدون بديل';
              out.push(`تغيير بديل ${mealName(mid)}: ${oldS} ← ${newS}`);
            }
          }
        }
        for (const mid of oldExMap.keys()) {
          if (!newExMap.has(mid)) out.push(`إزالة استبعاد: ${mealName(mid)}`);
        }

        // الأصناف الثابتة
        type FmRow = { meal_id: string; meal_type: string; day_of_week: number; quantity: number; category?: string };
        const oldFm = ((cur as { fixed_meals?: FmRow[] }).fixed_meals ?? []);
        const newFm = cp.fixed_meals ?? [];
        const oldFmMap = new Map(oldFm.map(f => [fmKey(f), f]));
        const newFmMap = new Map(newFm.map(f => [fmKey(f), f]));

        for (const [k, fm] of newFmMap) {
          if (!oldFmMap.has(k)) {
            out.push(
              `إضافة صنف ثابت: ${mealName(fm.meal_id)} — ${dayLabel(fm.day_of_week)} ${mealTypeLabel(fm.meal_type)} ×${fm.quantity}${fm.category ? ` ${catLabel(fm.category)}` : ''}`
            );
          } else {
            const old = oldFmMap.get(k)!;
            const qtyChanged = old.quantity !== fm.quantity;
            const catChanged = (old.category ?? null) !== (fm.category ?? null);
            if (qtyChanged) {
              out.push(`تغيير كمية ${mealName(fm.meal_id)} (${dayLabel(fm.day_of_week)} ${mealTypeLabel(fm.meal_type)}): ${old.quantity} ← ${fm.quantity}`);
            }
            if (catChanged) {
              out.push(`تغيير فئة ${mealName(fm.meal_id)} (${dayLabel(fm.day_of_week)} ${mealTypeLabel(fm.meal_type)}): ${catLabel(old.category)} ← ${catLabel(fm.category)}`);
            }
          }
        }
        for (const [k, fm] of oldFmMap) {
          if (!newFmMap.has(k)) {
            out.push(`إزالة صنف ثابت: ${mealName(fm.meal_id)} (${dayLabel(fm.day_of_week)} ${mealTypeLabel(fm.meal_type)})`);
          }
        }

        if (out.length === 1) out.push('— لا توجد تغييرات فعلية في البيانات.');

        setLines(out);
        setComputing(false);
      })();
    }

    return () => { cancelled = true; };
  }, [pa, mealsById, supabase]);

  if (computing) {
    return <div className="text-xs text-slate-400">جاري تحليل التغييرات...</div>;
  }

  return (
    <ul className="text-xs text-slate-700 space-y-1 list-disc pr-5">
      {(lines ?? []).map((l, i) => (
        <li key={i} className={i === 0 ? 'font-semibold text-slate-800 list-none -mr-5' : ''}>{l}</li>
      ))}
    </ul>
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
  const supabase = useMemo(() => createClient(), []);
  const channelId = useId();
  const isAdmin = user?.is_admin === true;

  const [items, setItems] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | PendingAction['status']>(statusFilter);
  // الأصناف لتحويل meal_id → اسم في تفاصيل الطلب
  const [mealsById, setMealsById] = useState<Record<string, Meal>>({});
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

  // جلب الأصناف مرة واحدة لاستخدامها في عرض تفاصيل الطلب (meal_id → name)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('meals').select('id, name, type, is_snack');
      if (cancelled) return;
      const map: Record<string, Meal> = {};
      for (const m of (data ?? []) as Meal[]) map[m.id] = m;
      setMealsById(map);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

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
                        {ENTITY_TYPE_LABELS[pa.entity_type]} · {pa.user_name ?? 'مستخدم'} · {timeAgo(pa.created_at)}
                      </span>
                    </p>
                    {pa.status === 'rejected' && pa.reject_reason && (
                      <p className="text-[11px] text-red-600 mt-1">سبب الرفض: {pa.reject_reason}</p>
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
                    {isExpanded ? 'إخفاء التفاصيل ▲' : 'تفاصيل العملية ▼'}
                  </button>
                </div>

                {/* ملخّص العملية — يبيّن وش الـuser يطلب بالضبط */}
                {isExpanded && (
                  <div className="mt-3 mb-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                    <ActionSummary pa={pa} mealsById={mealsById} supabase={supabase} />
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
