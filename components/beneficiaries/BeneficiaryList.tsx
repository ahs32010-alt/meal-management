'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Beneficiary, Meal } from '@/lib/types';
import { DAY_LABELS, DAYS_ORDER } from '@/lib/types';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import Pagination from '@/components/shared/Pagination';
import { usePagination } from '@/lib/use-pagination';
import { exportXLSX } from '@/lib/xlsx-utils';

const BeneficiaryModal = dynamic(() => import('./BeneficiaryModal'), { ssr: false });
const ImportModal = dynamic(() => import('@/components/shared/ImportModal'), { ssr: false });

// ─── Collapsible pills with popover ────────────────────────────────────────
function PillGroup({ pills, max = 3 }: {
  pills: { key: string; label: React.ReactNode; className: string }[];
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const extra = pills.length - max;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap gap-1.5 items-center">
        {pills.slice(0, max).map(p => (
          <span key={p.key} className={`text-xs px-2 py-0.5 rounded-full border ${p.className}`}>
            {p.label}
          </span>
        ))}
        {extra > 0 && (
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="text-xs px-2 py-0.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 font-semibold border border-slate-200 transition-colors"
          >
            +{extra} المزيد
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full mt-1.5 right-0 z-50 bg-white border border-slate-200 rounded-xl shadow-2xl p-3 flex flex-wrap gap-1.5 min-w-[220px] max-w-[340px]">
          <div className="w-full text-[10px] text-slate-400 font-semibold mb-1 border-b border-slate-100 pb-1">
            كل الأصناف ({pills.length})
          </div>
          {pills.map(p => (
            <span key={p.key} className={`text-xs px-2 py-0.5 rounded-full border ${p.className}`}>
              {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BeneficiaryList() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingBeneficiary, setEditingBeneficiary] = useState<Beneficiary | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'code' | 'villa'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);

  const supabase = useMemo(() => createClient(), []);

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      const [bensResult, mealsResult] = await Promise.all([
        supabase
          .from('beneficiaries')
          .select(`
            id, name, english_name, code, category, villa, diet_type,
            fixed_items, notes, created_at,
            exclusions(
              id, beneficiary_id, meal_id, alternative_meal_id,
              meals:meals!exclusions_meal_id_fkey(id, name, type, is_snack),
              alternative_meal:meals!exclusions_alternative_meal_id_fkey(id, name)
            ),
            fixed_meals:beneficiary_fixed_meals(
              id, beneficiary_id, day_of_week, meal_type, meal_id, quantity,
              meals(id, name, type, is_snack)
            )
          `)
          .order('name'),

        supabase
          .from('meals')
          .select('id, name, english_name, type, is_snack, created_at')
          .order('type')
          .order('is_snack')
          .order('name'),
      ]);

      // ✅ FIX 1: لازم نحفظ المستفيدين فعلياً
      if (bensResult.data) {
        setBeneficiaries((bensResult.data ?? []) as unknown as Beneficiary[]);
      }

      if (mealsResult.data) {
        setMeals(mealsResult.data as Meal[]);
      }

    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = (id: string) => {
    const ben = beneficiaries.find(b => b.id === id);
    setDialog({
      title: 'حذف مستفيد',
      message: `هل أنت متأكد من حذف "${ben?.name ?? 'هذا المستفيد'}"؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(id);
        await supabase.from('beneficiaries').delete().eq('id', id);
        void logActivity({
          action: 'delete',
          entity_type: 'beneficiary',
          entity_id: id,
          entity_name: ben?.name ?? null,
          details: ben ? { code: ben.code, villa: ben.villa } : null,
        });
        await fetchData();
        setDeleting(null);
      },
    });
  };

  const handleDeleteAll = () => {
    if (beneficiaries.length === 0) return;
    setDialog({
      title: 'حذف جميع المستفيدين',
      message: `هل أنت متأكد من حذف جميع المستفيدين (${beneficiaries.length})؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeletingAll(true);
        const ids = beneficiaries.map(b => b.id);
        const count = ids.length;
        await supabase.from('beneficiaries').delete().in('id', ids);
        void logActivity({
          action: 'delete',
          entity_type: 'beneficiary',
          entity_name: `حذف جماعي (${count} مستفيد)`,
          details: { count, scope: 'all' },
        });
        await fetchData();
        setDeletingAll(false);
      },
    });
  };

  const handleEdit = (b: Beneficiary) => {
    setEditingBeneficiary(b);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setEditingBeneficiary(null);
    setIsModalOpen(true);
  };

  const handleSaved = () => {
    setIsModalOpen(false);
    fetchData();
  };

  const handleExport = () => {
    const DAY_SHORT: Record<number, string> = {
      0: 'احد', 1: 'اثنين', 2: 'ثلاثاء', 3: 'اربعاء', 4: 'خميس', 5: 'جمعة', 6: 'سبت',
    };

    const buildExclStr = (excl: Beneficiary['exclusions'], type: string, isSnack: boolean) =>
      (excl ?? [])
        .filter(e => e.meals?.type === type && e.meals?.is_snack === isSnack)
        .map(e => {
          const mealName = e.meals?.name ?? '';
          const altName = (e as any).alternative_meal?.name ?? '';
          return altName ? `${mealName}؛${altName}` : mealName;
        })
        .filter(Boolean)
        .join(' - ');

    const buildFixedStr = (fixedMeals: Beneficiary['fixed_meals'], type: string, isSnack: boolean) => {
      const map = new Map<string, { name: string; days: number[]; quantity: number }>();
      for (const fm of fixedMeals ?? []) {
        const mealInfo = (fm as any).meals;
        if (mealInfo?.type !== type || mealInfo?.is_snack !== isSnack) continue;
        const mealName = mealInfo?.name ?? '';
        if (!mealName) continue;
        if (!map.has(fm.meal_id)) map.set(fm.meal_id, { name: mealName, days: [], quantity: (fm as any).quantity ?? 1 });
        map.get(fm.meal_id)!.days.push(fm.day_of_week);
      }
      return Array.from(map.values())
        .map(({ name, days, quantity }) => {
          const nameStr = quantity > 1 ? `${name}×${quantity}` : name;
          return `${nameStr}؛${days.map(d => DAY_SHORT[d]).join(' ')}`;
        })
        .join(' - ');
    };

    const rows = beneficiaries.map(b => ({
      'الاسم': b.name,
      'الاسم الإنجليزي': b.english_name ?? '',
      'الكود': b.code,
      'الفئة': b.category ?? '',
      'الفيلا': b.villa ?? '',
      'النظام الغذائي': b.diet_type ?? '',
      'محظورات الفطور':         buildExclStr(b.exclusions, 'breakfast', false),
      'محظورات سناكات الفطور':  buildExclStr(b.exclusions, 'breakfast', true),
      'محظورات الغداء':         buildExclStr(b.exclusions, 'lunch',     false),
      'محظورات سناكات الغداء':  buildExclStr(b.exclusions, 'lunch',     true),
      'محظورات العشاء':         buildExclStr(b.exclusions, 'dinner',    false),
      'محظورات سناكات العشاء':  buildExclStr(b.exclusions, 'dinner',    true),
      'ثابتة الفطور':           buildFixedStr(b.fixed_meals, 'breakfast', false),
      'ثابتة سناكات الفطور':    buildFixedStr(b.fixed_meals, 'breakfast', true),
      'ثابتة الغداء':           buildFixedStr(b.fixed_meals, 'lunch',     false),
      'ثابتة سناكات الغداء':    buildFixedStr(b.fixed_meals, 'lunch',     true),
      'ثابتة العشاء':           buildFixedStr(b.fixed_meals, 'dinner',    false),
      'ثابتة سناكات العشاء':    buildFixedStr(b.fixed_meals, 'dinner',    true),
      'ملاحظات': b.notes ?? '',
    }));
    exportXLSX(rows, `مستفيدون_${new Date().toISOString().slice(0, 10)}.xlsx`, 'المستفيدون');
  };

  const filtered = beneficiaries.filter(b => {
    if (!search.trim()) return true;

    const q = search.toLowerCase();

    const exclusionNames = (b.exclusions ?? [])
      .map(e => e.meals?.name ?? '')
      .join(' ');

    const fixedMealNames = (b.fixed_meals ?? [])
      .map(fm => (fm as any)?.meals?.name ?? '')
      .join(' ');

    return (
      b.name?.toLowerCase().includes(q) ||
      b.code?.toLowerCase().includes(q) ||
      (b.category ?? '').toLowerCase().includes(q) ||
      (b.villa ?? '').toLowerCase().includes(q) ||
      (b.english_name ?? '').toLowerCase().includes(q) ||
      exclusionNames.includes(q) ||
      fixedMealNames.includes(q)
    );
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...filtered].sort((a, b) => {
    let av = '', bv = '';
    if (sortKey === 'name')  { av = a.name ?? '';  bv = b.name ?? ''; }
    if (sortKey === 'code')  { av = a.code ?? '';  bv = b.code ?? ''; }
    if (sortKey === 'villa') { av = a.villa ?? ''; bv = b.villa ?? ''; }
    const cmp = av.localeCompare(bv, 'ar', { numeric: true });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const pagination = usePagination(sorted, {
    pageSize: 50,
    resetKey: `${search}|${sortKey}|${sortDir}`,
  });

  const SortIcon = ({ col }: { col: typeof sortKey }) => (
    <span className="inline-flex flex-col leading-none mr-1 opacity-50">
      <span className={sortKey === col && sortDir === 'asc'  ? 'opacity-100 text-emerald-600' : ''}>▲</span>
      <span className={sortKey === col && sortDir === 'desc' ? 'opacity-100 text-emerald-600' : ''}>▼</span>
    </span>
  );

  return (
    <div className="p-6 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-800">المستفيدون</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setImportOpen(true)} className="btn-secondary text-sm">استيراد Excel</button>
          <button onClick={handleExport} disabled={beneficiaries.length === 0} className="btn-secondary text-sm">تصدير Excel</button>
          <button
            onClick={handleDeleteAll}
            disabled={deletingAll || beneficiaries.length === 0}
            className="btn-secondary text-sm text-red-600 hover:bg-red-50 border-red-200"
          >
            {deletingAll ? 'جاري الحذف...' : 'حذف الكل'}
          </button>
          <button onClick={handleAdd} className="btn-primary text-sm">+ إضافة مستفيد</button>
        </div>
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث بالاسم أو الكود أو الفيلا..."
          className="input-field max-w-sm"
        />
        <span className="text-sm text-slate-500">{filtered.length} مستفيد</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <p className="font-medium">{search ? 'لا توجد نتائج' : 'لا يوجد مستفيدون بعد'}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 text-right">
                <th className="table-header">#</th>
                <th className="table-header">
                  <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الاسم <SortIcon col="name" />
                  </button>
                </th>
                <th className="table-header">
                  <button onClick={() => toggleSort('code')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الكود <SortIcon col="code" />
                  </button>
                </th>
                <th className="table-header">الفئة</th>
                <th className="table-header">
                  <button onClick={() => toggleSort('villa')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الفيلا <SortIcon col="villa" />
                  </button>
                </th>
                <th className="table-header">النظام الغذائي</th>
                <th className="table-header">الأصناف الثابتة</th>
                <th className="table-header">الأصناف المحظورة</th>
                <th className="table-header">ملاحظات</th>
                <th className="table-header text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {pagination.pageItems.map((b, idx) => (
                <tr key={b.id} className="hover:bg-slate-50 transition-colors border-t border-slate-100">
                  <td className="table-cell text-slate-400 text-xs">
                    {(pagination.page - 1) * pagination.pageSize + idx + 1}
                  </td>
                  <td className="table-cell">
                    <div className="font-semibold text-slate-800">{b.name}</div>
                    {b.english_name && <div className="text-xs text-slate-400">{b.english_name}</div>}
                  </td>
                  <td className="table-cell">
                    <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded">{b.code}</span>
                  </td>
                  <td className="table-cell text-slate-600">{b.category ?? '—'}</td>
                  <td className="table-cell text-slate-600">{b.villa ?? '—'}</td>
                  <td className="table-cell text-slate-600">{b.diet_type ?? '—'}</td>
                  <td className="table-cell">
                    {(b.fixed_meals ?? []).length === 0 ? (
                      <span className="text-slate-300 text-xs">لا يوجد</span>
                    ) : (() => {
                      const map = new Map<string, { name: string; days: number[] }>();
                      for (const fm of b.fixed_meals ?? []) {
                        const name = (fm as any).meals?.name ?? fm.meal_id;
                        if (!map.has(fm.meal_id)) map.set(fm.meal_id, { name, days: [] });
                        map.get(fm.meal_id)!.days.push(fm.day_of_week);
                      }
                      const pills = Array.from(map.values()).map(({ name, days }) => {
                        const sortedDays = DAYS_ORDER.filter(d => days.includes(d));
                        return {
                          key: name,
                          className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
                          label: (
                            <span className="inline-flex items-center gap-1">
                              <span className="font-semibold">{name}</span>
                              <span className="opacity-40">·</span>
                              <span className="opacity-75">{sortedDays.map(d => DAY_LABELS[d]).join('، ')}</span>
                            </span>
                          ),
                        };
                      });
                      return <PillGroup pills={pills} />;
                    })()}
                  </td>
                  <td className="table-cell">
                    {(b.exclusions ?? []).length === 0 ? (
                      <span className="text-slate-300 text-xs">لا يوجد</span>
                    ) : (
                      <PillGroup
                        pills={(b.exclusions ?? []).map(e => ({
                          key: e.id,
                          className: 'bg-red-50 text-red-700 border-red-100',
                          label: e.meals?.name ?? '—',
                        }))}
                      />
                    )}
                  </td>
                  <td className="table-cell text-slate-500 text-sm">{b.notes ?? '—'}</td>
                  <td className="table-cell">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleEdit(b)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="تعديل"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(b.id)}
                        disabled={deleting === b.id}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                        title="حذف"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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

      {isModalOpen && (
        <BeneficiaryModal
          beneficiary={editingBeneficiary}
          meals={meals}
          onClose={() => setIsModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {importOpen && (
        <ImportModal
          title="المستفيدون"
          templateHeaders={[
            'الاسم', 'الاسم الإنجليزي', 'الكود', 'الفئة', 'الفيلا', 'النظام الغذائي',
            'محظورات الفطور', 'محظورات سناكات الفطور',
            'محظورات الغداء', 'محظورات سناكات الغداء',
            'محظورات العشاء', 'محظورات سناكات العشاء',
            'ثابتة الفطور', 'ثابتة سناكات الفطور',
            'ثابتة الغداء', 'ثابتة سناكات الغداء',
            'ثابتة العشاء', 'ثابتة سناكات العشاء',
            'ملاحظات',
          ]}
          templateRow={[
            'محمد أحمد', 'Mohammad Ahmad', 'B001', 'عائلة', '5', '',
            'فول؛كبدة - شكشوكة؛تونة', '',
            '', '',
            '', '',
            'فول؛سبت احد اربعاء', '',
            '', '',
            '', '',
            '',
          ]}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); fetchData(); }}
          onImport={async (rows) => {
            const errors: string[] = [];

            const DAY_MAP: Record<string, number> = {
              'سبت': 6, 'السبت': 6,
              'احد': 0, 'أحد': 0, 'الأحد': 0, 'الاحد': 0,
              'اثنين': 1, 'إثنين': 1, 'الاثنين': 1, 'الإثنين': 1,
              'ثلاثاء': 2, 'الثلاثاء': 2,
              'اربعاء': 3, 'أربعاء': 3, 'الأربعاء': 3, 'الاربعاء': 3,
              'خميس': 4, 'الخميس': 4,
              'جمعة': 5, 'الجمعة': 5,
            };

            const EXCL_COLS = [
              { col: 'محظورات الفطور',        type: 'breakfast', isSnack: false },
              { col: 'محظورات سناكات الفطور',  type: 'breakfast', isSnack: true  },
              { col: 'محظورات الغداء',         type: 'lunch',     isSnack: false },
              { col: 'محظورات سناكات الغداء',  type: 'lunch',     isSnack: true  },
              { col: 'محظورات العشاء',         type: 'dinner',    isSnack: false },
              { col: 'محظورات سناكات العشاء',  type: 'dinner',    isSnack: true  },
            ] as const;

            const FIXED_COLS = [
              { col: 'ثابتة الفطور',        type: 'breakfast', isSnack: false },
              { col: 'ثابتة سناكات الفطور',  type: 'breakfast', isSnack: true  },
              { col: 'ثابتة الغداء',         type: 'lunch',     isSnack: false },
              { col: 'ثابتة سناكات الغداء',  type: 'lunch',     isSnack: true  },
              { col: 'ثابتة العشاء',         type: 'dinner',    isSnack: false },
              { col: 'ثابتة سناكات العشاء',  type: 'dinner',    isSnack: true  },
            ] as const;

            // ① حذف المستفيدين الحاليين + جلب الأصناف — بالتوازي
            const [, mealsResult] = await Promise.all([
              supabase.from('beneficiaries').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
              supabase.from('meals').select('id, name, type, is_snack'),
            ]);
            const mealsData = mealsResult.data ?? [];

            // مفتاح مركّب: اسم|نوع|سناك — يمنع تلخبط الأصناف بنفس الاسم في وجبات مختلفة
            const mealByKey = new Map(
              mealsData.map(m => [`${m.name.trim()}|${m.type}|${String(m.is_snack)}`, m] as const)
            );
            const lookupMeal = (name: string, type: string, isSnack: boolean) =>
              mealByKey.get(`${name}|${type}|${String(isSnack)}`);

            // ② تحليل الصفوف
            type ParsedRow = {
              rowIdx: number;
              payload: Record<string, unknown>;
              exclCols: { type: string; isSnack: boolean; raw: string }[];
              fixedCols: { type: string; isSnack: boolean; raw: string }[];
            };
            const parsed: ParsedRow[] = [];

            const seenCodes = new Map<string, number>(); // code → first row index
            for (let i = 0; i < rows.length; i++) {
              const row = rows[i];
              const name = row['الاسم']?.toString().trim();
              const code = row['الكود']?.toString().trim();
              if (!name && !code) continue;
              if (!name || !code) { errors.push(`صف ${i + 2}: الاسم والكود مطلوبان`); continue; }

              const previousRow = seenCodes.get(code);
              if (previousRow !== undefined) {
                errors.push(`صف ${i + 2} (${name}): الكود "${code}" مكرر — مستخدم مسبقاً في صف ${previousRow + 2}`);
                continue;
              }
              seenCodes.set(code, i);

              parsed.push({
                rowIdx: i,
                payload: {
                  name,
                  english_name: row['الاسم الإنجليزي']?.toString().trim() || null,
                  code,
                  category: row['الفئة']?.toString().trim() || '',
                  villa: row['الفيلا']?.toString().trim() || null,
                  diet_type: row['النظام الغذائي']?.toString().trim() || null,
                  notes: row['ملاحظات']?.toString().trim() || null,
                },
                exclCols:  EXCL_COLS.map(c => ({ type: c.type, isSnack: c.isSnack, raw: row[c.col]?.toString().trim() || '' })),
                fixedCols: FIXED_COLS.map(c => ({ type: c.type, isSnack: c.isSnack, raw: row[c.col]?.toString().trim() || '' })),
              });
            }

            if (parsed.length === 0) return { imported: 0, errors };

            // ③ bulk insert المستفيدين
            const CHUNK = 50;
            const codeToId = new Map<string, string>();

            for (let c = 0; c < parsed.length; c += CHUNK) {
              const chunk = parsed.slice(c, c + CHUNK);
              const { data, error } = await supabase
                .from('beneficiaries')
                .insert(chunk.map(r => r.payload))
                .select('id, code');
              if (error) {
                const msg = error.message.toLowerCase();
                if (msg.includes('beneficiaries_code_key') || (msg.includes('unique') && msg.includes('code'))) {
                  // Fall back to one-by-one inserts so we can pinpoint which code failed
                  for (const r of chunk) {
                    const { data: one, error: oneErr } = await supabase
                      .from('beneficiaries')
                      .insert(r.payload)
                      .select('id, code')
                      .single();
                    if (oneErr) {
                      const m = oneErr.message.toLowerCase();
                      if (m.includes('beneficiaries_code_key') || (m.includes('unique') && m.includes('code'))) {
                        errors.push(`صف ${r.rowIdx + 2} (${r.payload.name as string}): الكود "${r.payload.code as string}" مكرر`);
                      } else {
                        errors.push(`صف ${r.rowIdx + 2} (${r.payload.name as string}): ${oneErr.message}`);
                      }
                      continue;
                    }
                    if (one) codeToId.set(one.code, one.id);
                  }
                  continue;
                }
                errors.push(`خطأ في إدراج المجموعة ${Math.floor(c / CHUNK) + 1}: ${error.message}`);
                continue;
              }
              for (const b of data ?? []) codeToId.set(b.code, b.id);
            }

            // ④ بناء صفوف المحظورات والأصناف الثابتة
            const exclusionRows: Record<string, unknown>[] = [];
            const fixedRows:     Record<string, unknown>[] = [];

            for (const { rowIdx: i, payload, exclCols, fixedCols } of parsed) {
              const benId = codeToId.get(payload.code as string);
              if (!benId) continue;

              for (const { type, isSnack, raw } of exclCols) {
                if (!raw) continue;
                for (const pair of raw.split(/ - | -|- /).map(s => s.trim()).filter(Boolean)) {
                  const [mealName, altName] = pair.split('؛').map(s => s.trim());
                  if (!mealName) continue;
                  const meal = lookupMeal(mealName, type, isSnack);
                  if (!meal) { errors.push(`صف ${i + 2}: الصنف "${mealName}" غير موجود في هذه الوجبة`); continue; }
                  const altMeal = altName ? (lookupMeal(altName, type, isSnack) ?? null) : null;
                  if (altName && !altMeal) errors.push(`صف ${i + 2}: البديل "${altName}" غير موجود في هذه الوجبة`);
                  exclusionRows.push({ beneficiary_id: benId, meal_id: meal.id, alternative_meal_id: altMeal?.id ?? null });
                }
              }

              for (const { type, isSnack, raw } of fixedCols) {
                if (!raw) continue;
                for (const part of raw.split(/ - | -|- /).map(s => s.trim()).filter(Boolean)) {
                  const [mealPart, daysStr] = part.split('؛').map(s => s.trim());
                  if (!mealPart || !daysStr) continue;
                  // اسم الصنف قد يحتوي على كمية: فول×2
                  const qtyMatch = mealPart.match(/^(.+?)×(\d+)$/);
                  const mealName = qtyMatch ? qtyMatch[1].trim() : mealPart;
                  const quantity = qtyMatch ? parseInt(qtyMatch[2], 10) : 1;
                  const meal = lookupMeal(mealName, type, isSnack);
                  if (!meal) { errors.push(`صف ${i + 2}: الصنف الثابت "${mealName}" غير موجود في هذه الوجبة`); continue; }
                  for (const dayStr of daysStr.split(/[\s،,]+/).filter(Boolean)) {
                    const dayNum = DAY_MAP[dayStr];
                    if (dayNum === undefined) { errors.push(`صف ${i + 2}: اليوم "${dayStr}" غير معروف`); continue; }
                    fixedRows.push({ beneficiary_id: benId, day_of_week: dayNum, meal_type: meal.type, meal_id: meal.id, quantity });
                  }
                }
              }
            }

            // ⑤ bulk insert
            if (exclusionRows.length > 0) {
              for (let c = 0; c < exclusionRows.length; c += CHUNK) {
                const { error } = await supabase.from('exclusions').insert(exclusionRows.slice(c, c + CHUNK));
                if (error) errors.push(`خطأ في المحظورات: ${error.message}`);
              }
            }
            if (fixedRows.length > 0) {
              for (let c = 0; c < fixedRows.length; c += CHUNK) {
                const { error } = await supabase.from('beneficiary_fixed_meals').insert(fixedRows.slice(c, c + CHUNK));
                if (error) errors.push(`خطأ في الأصناف الثابتة: ${error.message}`);
              }
            }

            void logActivity({
              action: 'create',
              entity_type: 'beneficiary',
              entity_name: `استيراد (${codeToId.size} مستفيد)`,
              details: { imported: codeToId.size, errors_count: errors.length, source: 'excel_import' },
            });

            await fetchData();
            return { imported: codeToId.size, errors };
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        onConfirm={() => dialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      />

    </div>
  );
}