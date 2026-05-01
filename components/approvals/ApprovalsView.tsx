'use client';

import { useState } from 'react';
import { useCurrentUser } from '@/lib/use-current-user';
import ApprovalsList from './ApprovalsList';
import type { PendingAction } from '@/lib/pending-actions';

type Filter = 'all' | PendingAction['status'];

export default function ApprovalsView() {
  const { user } = useCurrentUser();
  const isAdmin = user?.is_admin === true;
  const [filter, setFilter] = useState<Filter>('all');

  const TABS: { key: Filter; label: string }[] = [
    { key: 'all',      label: 'الكل' },
    { key: 'pending',  label: 'بانتظار المراجعة' },
    { key: 'approved', label: 'مقبول' },
    { key: 'rejected', label: 'مرفوض' },
  ];

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            الموافقات
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            {isAdmin
              ? 'سجل كامل لكل طلبات الإضافة والحذف من جميع المستخدمين — تقدر تقبل أو ترفض الطلبات pending'
              : 'سجل طلباتك الحالية والسابقة، وحالتهم  '}
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              filter === t.key
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ApprovalsList statusFilter={filter} hideFilters />
    </div>
  );
}
