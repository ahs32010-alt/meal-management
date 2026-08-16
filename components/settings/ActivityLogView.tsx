'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import {
  ENTITY_LABELS,
  ACTION_LABELS_AR,
  ACTION_STYLES,
  ENTITY_STYLES,
  type ActivityAction,
  type ActivityEntityType,
} from '@/lib/activity-log';
import {
  buildDetailRows,
  describeOperation,
  operationLabel,
  pageLabel,
  pageOf,
} from '@/lib/activity-describe';
import Pagination from '@/components/shared/Pagination';
import { usePagination } from '@/lib/use-pagination';

interface ActivityRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  action: ActivityAction;
  entity_type: ActivityEntityType | string;
  entity_id: string | null;
  entity_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

type DateRange = '24h' | '7d' | '30d' | 'all';

const DATE_RANGE_LABELS: Record<DateRange, string> = {
  '24h': 'آخر 24 ساعة',
  '7d': 'آخر 7 أيام',
  '30d': 'آخر 30 يوم',
  all: 'كل التاريخ',
};

const ENTITY_TYPES: ActivityEntityType[] = [
  'beneficiary',
  'meal',
  'order',
  'user',
  'transliteration',
  'fixed_meal',
  'exclusion',
];

const ACTIONS: ActivityAction[] = ['create', 'update', 'delete'];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'الآن';
  if (diffSec < 3600) return `قبل ${Math.floor(diffSec / 60)} دقيقة`;
  if (diffSec < 86400) return `قبل ${Math.floor(diffSec / 3600)} ساعة`;
  if (diffSec < 86400 * 7) return `قبل ${Math.floor(diffSec / 86400)} يوم`;
  return new Date(iso).toLocaleDateString('en-GB');
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function entityLabel(type: string): string {
  return ENTITY_LABELS[type as ActivityEntityType] ?? type;
}

function entityStyle(type: string): string {
  return ENTITY_STYLES[type as ActivityEntityType] ?? 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function ActivityLogView() {
  const { user: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.is_admin === true;

  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);

  const [dateRange, setDateRange] = useState<DateRange>('7d');
  const [entityFilter, setEntityFilter] = useState<'all' | ActivityEntityType>('all');
  const [actionFilter, setActionFilter] = useState<'all' | ActivityAction>('all');
  const [userFilter, setUserFilter] = useState<'all' | string>('all');
  const [pageFilter, setPageFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchRows = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('activity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (dateRange !== 'all') {
      const ms = dateRange === '24h' ? 86400e3 : dateRange === '7d' ? 7 * 86400e3 : 30 * 86400e3;
      const since = new Date(Date.now() - ms).toISOString();
      query = query.gte('created_at', since);
    }

    const { data } = await query;
    setRows((data as ActivityRow[]) ?? []);
    setLoading(false);
  }, [supabase, dateRange]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  // Build the user list from log rows so admins can filter by anyone who's done something
  useEffect(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (!r.user_id) continue;
      const display = r.user_name || r.user_email || r.user_id;
      if (!map.has(r.user_id)) map.set(r.user_id, display);
    }
    setUsers(Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar')));
  }, [rows]);

  // قائمة الصفحات المتاحة للفلترة، مبنية من السجلات نفسها
  const pages = Array.from(
    new Set(rows.map(r => pageOf(r.details)).filter((p): p is string => !!p))
  ).sort();

  const filtered = rows.filter(r => {
    if (entityFilter !== 'all' && r.entity_type !== entityFilter) return false;
    if (actionFilter !== 'all' && r.action !== actionFilter) return false;
    if (userFilter !== 'all' && r.user_id !== userFilter) return false;
    if (pageFilter !== 'all' && pageOf(r.details) !== pageFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      // البحث يغطي الجملة الوصفية كاملة، عشان تقدر تدوّر بنوع العملية
      // أو باسم الصفحة مش بس باسم العنصر
      const hay = [
        r.entity_name ?? '',
        r.user_name ?? '',
        r.user_email ?? '',
        describeOperation(r),
        pageLabel(pageOf(r.details)) ?? '',
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const pagination = usePagination(filtered, {
    pageSize: 25,
    resetKey: `${dateRange}|${entityFilter}|${actionFilter}|${userFilter}|${pageFilter}|${search}`,
  });

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderDetails = (r: ActivityRow) => {
    const detailRows = buildDetailRows(r.details);
    return (
      <div className="space-y-3">
        {/* الجملة الكاملة: مين سوّى إيش على إيش وفي أي صفحة */}
        <p className="text-sm text-slate-800 font-medium leading-relaxed">
          {describeOperation(r)}
        </p>

        {detailRows.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {detailRows.map(d => (
              <div key={d.label} className="text-xs flex items-start gap-2">
                <dt className="font-semibold text-slate-500 shrink-0">{d.label}:</dt>
                <dd className="text-slate-700 break-all">
                  {d.value !== null ? (
                    d.value
                  ) : (
                    <span className="inline-flex items-center gap-1.5 flex-wrap">
                      <span className="line-through text-slate-400">{d.before}</span>
                      <span className="text-slate-400">←</span>
                      <span className="font-semibold text-emerald-700">{d.after}</span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {r.entity_id && (
          <div className="text-[10px] text-slate-400 font-mono" dir="ltr">
            ID: {r.entity_id}
          </div>
        )}
      </div>
    );
  };

  const total = rows.length;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h2 className="font-bold text-slate-800">آخر التحديثات</h2>
          <p className="text-slate-500 text-xs mt-0.5">
            سجل بكل الإضافات والتعديلات والحذف على صفحات النظام مرتبط بالمستخدم الذي أجراها
          </p>
        </div>
        <span className="text-xs text-slate-400 font-medium">
          {filtered.length} من {total} سجل
        </span>
        <button
          onClick={fetchRows}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
          title="تحديث"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          تحديث
        </button>
      </div>

      <div className="px-5 py-3 border-b border-slate-100 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2">
        <select
          value={dateRange}
          onChange={e => setDateRange(e.target.value as DateRange)}
          className="input-field text-sm py-2"
        >
          {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map(k => (
            <option key={k} value={k}>{DATE_RANGE_LABELS[k]}</option>
          ))}
        </select>

        <select
          value={entityFilter}
          onChange={e => setEntityFilter(e.target.value as typeof entityFilter)}
          className="input-field text-sm py-2"
        >
          <option value="all">كل الأنواع</option>
          {ENTITY_TYPES.map(t => (
            <option key={t} value={t}>{ENTITY_LABELS[t]}</option>
          ))}
        </select>

        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value as typeof actionFilter)}
          className="input-field text-sm py-2"
        >
          <option value="all">كل العمليات</option>
          {ACTIONS.map(a => (
            <option key={a} value={a}>{ACTION_LABELS_AR[a]}</option>
          ))}
        </select>

        <select
          value={pageFilter}
          onChange={e => setPageFilter(e.target.value)}
          className="input-field text-sm py-2"
        >
          <option value="all">كل الصفحات</option>
          {pages.map(p => (
            <option key={p} value={p}>{pageLabel(p)}</option>
          ))}
        </select>

        {isAdmin ? (
          <select
            value={userFilter}
            onChange={e => setUserFilter(e.target.value)}
            className="input-field text-sm py-2"
          >
            <option value="all">كل المستخدمين</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        ) : (
          <div className="hidden lg:block" />
        )}

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث في العملية أو الاسم..."
          className="input-field text-sm py-2"
          dir="rtl"
        />
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <svg className="w-14 h-14 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="font-medium text-sm">لا توجد سجلات</p>
          <p className="text-xs mt-1">جرّب تغيير الفلاتر أو تمديد النطاق الزمني</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                <th className="table-header">الوقت</th>
                <th className="table-header">المستخدم</th>
                <th className="table-header">العملية</th>
                <th className="table-header">النوع</th>
                <th className="table-header">العنصر</th>
                <th className="table-header">الصفحة</th>
                <th className="table-header text-center">التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map(r => {
                const isOpen = expanded.has(r.id);
                // ملاحظة: details تحتوي دائماً على مفتاح الصفحة المحجوز، فالفحص
                // لازم يكون على الصفوف المعروضة فعلاً مش على عدد المفاتيح الخام.
                const detailCount = buildDetailRows(r.details).length;
                const opLabel = operationLabel(r, ACTION_LABELS_AR[r.action] ?? r.action);
                const where = pageLabel(pageOf(r.details));
                return (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-slate-50 transition-colors border-t border-slate-100">
                      <td className="table-cell">
                        <div className="text-sm font-semibold text-slate-800">{relativeTime(r.created_at)}</div>
                        <div className="text-[10px] text-slate-400 font-mono" dir="ltr">{formatTimestamp(r.created_at)}</div>
                      </td>
                      <td className="table-cell">
                        <div className="font-semibold text-slate-800 text-sm">{r.user_name ?? '—'}</div>
                        {r.user_email && r.user_email !== r.user_name && (
                          <div className="text-[10px] text-slate-400 font-mono" dir="ltr">{r.user_email}</div>
                        )}
                      </td>
                      <td className="table-cell">
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${ACTION_STYLES[r.action] ?? ''}`}>
                          {ACTION_LABELS_AR[r.action] ?? r.action}
                        </span>
                        {opLabel !== (ACTION_LABELS_AR[r.action] ?? r.action) && (
                          <div className="text-[11px] text-slate-500 mt-1 font-medium">{opLabel}</div>
                        )}
                      </td>
                      <td className="table-cell">
                        <span className={`text-xs font-semibold px-2 py-1 rounded border ${entityStyle(r.entity_type)}`}>
                          {entityLabel(r.entity_type)}
                        </span>
                      </td>
                      <td className="table-cell">
                        <span className="text-sm font-medium text-slate-700">{r.entity_name ?? '—'}</span>
                      </td>
                      <td className="table-cell">
                        {where ? (
                          <span className="text-xs font-medium text-slate-600">{where}</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="table-cell text-center">
                        {/* الزر معروض دائماً — حتى لو ما فيه حقول، الجملة الوصفية موجودة */}
                        <button
                          onClick={() => toggleExpand(r.id)}
                          className="inline-flex items-center gap-1 p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                          title={isOpen ? 'إخفاء التفاصيل' : 'عرض تفاصيل العملية'}
                        >
                          {detailCount > 0 && (
                            <span className="text-[10px] font-bold">{detailCount}</span>
                          )}
                          <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-50/60 border-t border-slate-100">
                        <td colSpan={7} className="px-5 py-3">
                          {renderDetails(r)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={pagination.page}
            pageCount={pagination.pageCount}
            pageSize={pagination.pageSize}
            total={pagination.total}
            onPageChange={pagination.setPage}
          />
        </div>
      )}
    </div>
  );
}
