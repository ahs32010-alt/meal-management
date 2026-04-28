'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { useCurrentUser } from '@/lib/use-current-user';
import { can } from '@/lib/permissions';
import { enqueueDelete } from '@/lib/pending-actions';
import type { Beneficiary, Meal, EntityType, ItemCategory } from '@/lib/types';
import { DAY_LABELS, DAYS_ORDER, ENTITY_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
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

interface BeneficiaryListProps {
  entityType?: EntityType;
}

export default function BeneficiaryList({ entityType = 'beneficiary' }: BeneficiaryListProps = {}) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingBeneficiary, setEditingBeneficiary] = useState<Beneficiary | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'code' | 'category' | 'villa' | 'diet_type' | 'fixed_count' | 'excluded_count' | 'notes'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { user: currentUser } = useCurrentUser();
  // الصلاحيات على هذي الصفحة (page) للمستخدم الحالي:
  // - لو يقدر يحذف → الحذف فوري
  // - لو ما يقدر → يدخل نظام الموافقات
  const canDelete = can(currentUser, entityType === 'companion' ? 'companions' : 'beneficiaries', 'delete');
  const isAdmin = currentUser?.is_admin === true;

  const supabase = useMemo(() => createClient(), []);

  // نصوص واجهة المستخدم تتغير حسب نوع الكيان (مستفيد/مرافق)
  const entitySingular = ENTITY_TYPE_LABELS[entityType];
  const entityPlural   = ENTITY_TYPE_LABELS_PLURAL[entityType];

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      // Try with the category column on fixed_meals first; if migration not run,
      // retry without it so the page still works.
      // Also tries to filter by entity_type — if that column doesn't exist yet
      // (companions migration not run), falls back to unfiltered query but
      // refuses to render companions data (we only want beneficiaries view safely).
      const fetchBens = (withFixedCategory: boolean, withEntityType: boolean) => {
        const q = supabase
          .from('beneficiaries')
          .select(`
            id, name, english_name, code, category, villa, diet_type,
            fixed_items, notes, created_at${withEntityType ? ', entity_type' : ''},
            exclusions(
              id, beneficiary_id, meal_id, alternative_meal_id,
              meals:meals!exclusions_meal_id_fkey(id, name, type, is_snack),
              alternative_meal:meals!exclusions_alternative_meal_id_fkey(id, name)
            ),
            fixed_meals:beneficiary_fixed_meals(
              id, beneficiary_id, day_of_week, meal_type, meal_id, quantity${withFixedCategory ? ', category' : ''},
              meals(id, name, type, is_snack)
            )
          `)
          .order('name');
        return withEntityType ? q.eq('entity_type', entityType) : q;
      };

      let bensResult = await fetchBens(true, true);
      // entity_type column missing → migration not yet run.
      if (bensResult.error && /entity_type|column/i.test(bensResult.error.message)) {
        // Companions view requires the migration. Show an empty state with hint.
        if (entityType === 'companion') {
          alert(
            'صفحة المرافقين تحتاج تشغيل ملف الترقية:\n' +
            'supabase/companions-migration.sql\n\n' +
            'شغّله مرة وحدة في Supabase SQL Editor ثم حدّث الصفحة.'
          );
          setBeneficiaries([]);
          setLoading(false);
          return;
        }
        bensResult = await fetchBens(true, false);
      }
      if (bensResult.error && /category|column/i.test(bensResult.error.message)) {
        bensResult = await fetchBens(false, true);
        if (bensResult.error && /entity_type|column/i.test(bensResult.error.message)) {
          bensResult = await fetchBens(false, false);
        }
      }

      // الأصناف المعروضة في معالج التخصيصات لازم تكون من نفس فئة المستفيد،
      // ونجلب category كذلك عشان BeneficiaryModal يقرأ الفئة من الصنف نفسه
      // (المصدر الموحد). أي عمود ناقص (entity_type / category) نسقطه ونعيد المحاولة.
      const fetchMeals = (withEntity: boolean, withCategory: boolean) => {
        const cols = `id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}${withCategory ? ', category' : ''}, created_at`;
        const q = supabase.from('meals').select(cols).order('type').order('is_snack').order('name');
        return withEntity ? q.eq('entity_type', entityType) : q;
      };
      let mealsResult = await fetchMeals(true, true);
      if (mealsResult.error && /category|column/i.test(mealsResult.error.message)) {
        mealsResult = await fetchMeals(true, false);
      }
      if (mealsResult.error && /entity_type|column/i.test(mealsResult.error.message)) {
        mealsResult = await fetchMeals(false, true);
        if (mealsResult.error && /category|column/i.test(mealsResult.error.message)) {
          mealsResult = await fetchMeals(false, false);
        }
      }

      // ✅ FIX 1: لازم نحفظ المستفيدين فعلياً
      if (bensResult.data) {
        setBeneficiaries((bensResult.data ?? []) as unknown as Beneficiary[]);
      }

      if (mealsResult.data) {
        setMeals(mealsResult.data as unknown as Meal[]);
      }

    } catch (err) {
      console.error('Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, entityType]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = (id: string) => {
    const ben = beneficiaries.find(b => b.id === id);
    const targetName = ben?.name ?? `هذا ال${entitySingular}`;
    setDialog({
      title: `حذف ${entitySingular}`,
      message: canDelete
        ? `هل أنت متأكد من حذف "${targetName}"؟ لا يمكن التراجع عن هذه العملية.`
        : `سيُرسَل طلب حذف "${targetName}" إلى الأدمن للموافقة. يحدث الحذف فعلياً بعد قبول الأدمن. متابعة؟`,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(id);
        if (!canDelete && currentUser) {
          const r = await enqueueDelete(supabase, currentUser, entityType, id, ben?.name ?? null);
          if (!r.ok) {
            setNotice(r.duplicate ? `⚠ ${r.error}` : `⚠ تعذّر إرسال طلب الحذف: ${r.error}`);
          } else {
            setNotice('✓ تم إرسال طلب الحذف للأدمن بانتظار الموافقة.');
          }
          setDeleting(null);
          return;
        }
        await supabase.from('beneficiaries').delete().eq('id', id);
        void logActivity({
          action: 'delete',
          entity_type: entityType,
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
      title: `حذف جميع ال${entityPlural.replace(/^ال/, '')}`,
      message: `هل أنت متأكد من حذف جميع ال${entityPlural.replace(/^ال/, '')} (${beneficiaries.length})؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeletingAll(true);
        const ids = beneficiaries.map(b => b.id);
        const count = ids.length;
        // نحذف فقط الـIDs اللي عرضناها (وكلها من نفس entity_type)
        await supabase.from('beneficiaries').delete().in('id', ids);
        void logActivity({
          action: 'delete',
          entity_type: entityType,
          entity_name: `حذف جماعي (${count} ${entitySingular})`,
          details: { count, scope: 'all', entity_type: entityType },
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

    // العمود "ثابتة الفطور" مثلاً افتراضه "حار"، أما "ثابتة سناكات الفطور" فافتراضه "سناك".
    // نضيف لاحقة `@بارد/@حار/@سناك` فقط لو فئة الصف تختلف عن افتراض العمود،
    // عشان الملفات القديمة تبقى مقروءة، والجديد يحفظ الفئة بدقة.
    const CAT_AR: Record<ItemCategory, string> = { hot: 'حار', cold: 'بارد', snack: 'سناك' };
    const buildFixedStr = (fixedMeals: Beneficiary['fixed_meals'], type: string, isSnack: boolean) => {
      const sectionDefault: ItemCategory = isSnack ? 'snack' : 'hot';
      // نُجمع حسب (meal_id, category) — صفوف نفس الصنف بفئتين مختلفتين تظهر منفصلة.
      const map = new Map<string, { name: string; days: number[]; quantity: number; category: ItemCategory }>();
      for (const fm of fixedMeals ?? []) {
        const mealInfo = (fm as any).meals;
        if (mealInfo?.type !== type || mealInfo?.is_snack !== isSnack) continue;
        const mealName = mealInfo?.name ?? '';
        if (!mealName) continue;
        const cat = ((fm as any).category as ItemCategory | undefined) ?? sectionDefault;
        const key = `${fm.meal_id}|${cat}`;
        if (!map.has(key)) {
          map.set(key, { name: mealName, days: [], quantity: (fm as any).quantity ?? 1, category: cat });
        }
        map.get(key)!.days.push(fm.day_of_week);
      }
      return Array.from(map.values())
        .map(({ name, days, quantity, category }) => {
          const nameStr = quantity > 1 ? `${name}×${quantity}` : name;
          const daysStr = days.map(d => DAY_SHORT[d]).join(' ');
          const catSuffix = category !== sectionDefault ? `@${CAT_AR[category]}` : '';
          return `${nameStr}؛${daysStr}${catSuffix}`;
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
    const fileLabel = entityType === 'companion' ? 'مرافقون' : 'مستفيدون';
    exportXLSX(rows, `${fileLabel}_${new Date().toISOString().slice(0, 10)}.xlsx`, entityPlural);
  };

  const filtered = beneficiaries.filter(b => {
    if (!search.trim()) return true;

    const q = search.trim().toLowerCase();

    const exclusionMealNames = (b.exclusions ?? [])
      .map(e => e.meals?.name ?? '').join(' ');
    const alternativeMealNames = (b.exclusions ?? [])
      .map(e => (e as any).alternative_meal?.name ?? '').join(' ');
    const fixedMealNames = (b.fixed_meals ?? [])
      .map(fm => (fm as any)?.meals?.name ?? '').join(' ');

    const haystack = [
      b.name,
      b.english_name,
      b.code,
      b.category,
      b.villa,
      b.diet_type,
      b.notes,
      b.fixed_items,
      exclusionMealNames,
      alternativeMealNames,
      fixedMealNames,
    ].filter(Boolean).join(' ').toLowerCase();

    return haystack.includes(q);
  });

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const sorted = [...filtered].sort((a, b) => {
    // Numeric sorts (counts)
    if (sortKey === 'fixed_count') {
      const av = (a.fixed_meals ?? []).length;
      const bv = (b.fixed_meals ?? []).length;
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    if (sortKey === 'excluded_count') {
      const av = (a.exclusions ?? []).length;
      const bv = (b.exclusions ?? []).length;
      return sortDir === 'asc' ? av - bv : bv - av;
    }

    // String sorts — empty values always go to the bottom regardless of direction
    let av = '', bv = '';
    if (sortKey === 'name')      { av = a.name ?? '';      bv = b.name ?? ''; }
    if (sortKey === 'code')      { av = a.code ?? '';      bv = b.code ?? ''; }
    if (sortKey === 'category')  { av = a.category ?? '';  bv = b.category ?? ''; }
    if (sortKey === 'villa')     { av = a.villa ?? '';     bv = b.villa ?? ''; }
    if (sortKey === 'diet_type') { av = a.diet_type ?? ''; bv = b.diet_type ?? ''; }
    if (sortKey === 'notes')     { av = a.notes ?? '';     bv = b.notes ?? ''; }

    const aEmpty = !av.trim();
    const bEmpty = !bv.trim();
    if (aEmpty && !bEmpty) return 1;
    if (!aEmpty && bEmpty) return -1;

    const cmp = av.localeCompare(bv, 'ar', { numeric: true, sensitivity: 'base' });
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

      {/* Pending notice */}
      {notice && (
        <div className={`px-4 py-3 rounded-xl text-sm font-medium border flex items-center justify-between gap-3 ${
          notice.startsWith('✓')
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-current opacity-60 hover:opacity-100 text-lg leading-none">✕</button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-slate-800">{entityPlural}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* العمليات الجماعية والاستيراد/التصدير — للأدمن فقط */}
          {isAdmin && (
            <>
              <Link
                href={entityType === 'companion' ? '/companions/bulk' : '/beneficiaries/bulk'}
                className="btn-secondary text-sm flex items-center gap-1.5"
                title="تطبيق محظور أو صنف ثابت على مجموعة كبيرة دفعة واحدة"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                تخصيص جماعي
              </Link>
              <button onClick={() => setImportOpen(true)} className="btn-secondary text-sm">استيراد Excel</button>
              <button onClick={handleExport} disabled={beneficiaries.length === 0} className="btn-secondary text-sm">تصدير Excel</button>
              <button
                onClick={handleDeleteAll}
                disabled={deletingAll || beneficiaries.length === 0}
                className="btn-secondary text-sm text-red-600 hover:bg-red-50 border-red-200"
              >
                {deletingAll ? 'جاري الحذف...' : 'حذف الكل'}
              </button>
            </>
          )}
          <button onClick={handleAdd} className="btn-primary text-sm">+ إضافة {entitySingular}</button>
        </div>
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ابحث في أي حقل: اسم، كود، فيلا، نظام غذائي، ملاحظات، صنف..."
            className="input-field pr-10"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full transition-colors"
              title="مسح البحث"
            >
              ✕
            </button>
          )}
        </div>
        <span className="text-sm text-slate-500">{filtered.length} {entitySingular}</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <p className="font-medium">{search ? 'لا توجد نتائج' : `لا يوجد ${entityPlural.replace(/^ال/, '')} بعد`}</p>
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
                <th className="table-header">
                  <button onClick={() => toggleSort('category')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الفئة <SortIcon col="category" />
                  </button>
                </th>
                <th className="table-header">
                  <button onClick={() => toggleSort('villa')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الفيلا <SortIcon col="villa" />
                  </button>
                </th>
                <th className="table-header">
                  <button onClick={() => toggleSort('diet_type')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    النظام الغذائي <SortIcon col="diet_type" />
                  </button>
                </th>
                <th className="table-header">
                  <button onClick={() => toggleSort('fixed_count')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الأصناف الثابتة <SortIcon col="fixed_count" />
                  </button>
                </th>
                <th className="table-header">
                  <button onClick={() => toggleSort('excluded_count')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    الأصناف المحظورة <SortIcon col="excluded_count" />
                  </button>
                </th>
                <th className="table-header">
                  <button onClick={() => toggleSort('notes')} className="flex items-center gap-1 hover:text-emerald-700 transition-colors">
                    ملاحظات <SortIcon col="notes" />
                  </button>
                </th>
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
          entityType={entityType}
          onClose={() => setIsModalOpen(false)}
          onSaved={handleSaved}
        />
      )}

      {importOpen && (
        <ImportModal
          title={entityPlural}
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
            // مثال صنف ثابت بتصنيف افتراضي (حار) + مثال آخر مُحدَّد كـ"بارد" بإضافة @بارد
            'فول؛سبت احد اربعاء - سلطة؛سبت احد@بارد', '',
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

            // ① حذف بيانات هذا النوع فقط (مستفيدين أو مرافقين) + جلب الأصناف — بالتوازي
            // ⚠️ مهم جداً: الـdelete مقيّد بـentity_type عشان استيراد المرافقين ما يمسح المستفيدين والعكس.
            // وجلب الأصناف مقيّد بنفس الـentity_type عشان أسماء المحظورات/الثوابت تُربط
            // بأصناف الفئة الصحيحة فقط.
            const fetchImportMeals = async () => {
              const r = await supabase
                .from('meals')
                .select('id, name, type, is_snack')
                .eq('entity_type', entityType);
              if (r.error && /entity_type|column/i.test(r.error.message)) {
                return supabase.from('meals').select('id, name, type, is_snack');
              }
              return r;
            };
            const [, mealsResult] = await Promise.all([
              supabase.from('beneficiaries').delete().eq('entity_type', entityType),
              fetchImportMeals(),
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
                  entity_type: entityType,
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
                if (msg.includes('beneficiaries_code_key') || msg.includes('beneficiaries_entity_code_unique') || (msg.includes('unique') && msg.includes('code'))) {
                  // Fall back to one-by-one inserts so we can pinpoint which code failed
                  for (const r of chunk) {
                    const { data: one, error: oneErr } = await supabase
                      .from('beneficiaries')
                      .insert(r.payload)
                      .select('id, code')
                      .single();
                    if (oneErr) {
                      const m = oneErr.message.toLowerCase();
                      if (m.includes('beneficiaries_code_key') || m.includes('beneficiaries_entity_code_unique') || (m.includes('unique') && m.includes('code'))) {
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
                const sectionDefault: ItemCategory = isSnack ? 'snack' : 'hot';
                for (const partRaw of raw.split(/ - | -|- /).map(s => s.trim()).filter(Boolean)) {
                  // نستخرج لاحقة @بارد/@حار/@سناك أينما كانت في النص ونحذفها قبل بقية المعالجة.
                  // الملفات القديمة بدون اللاحقة تستخدم افتراض العمود.
                  let category: ItemCategory = sectionDefault;
                  let part = partRaw;
                  const catMatch = part.match(/@\s*(حار|بارد|سناك)\b/);
                  if (catMatch) {
                    category = catMatch[1] === 'حار' ? 'hot' : catMatch[1] === 'بارد' ? 'cold' : 'snack';
                    part = part.replace(catMatch[0], '').trim();
                  }

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
                    fixedRows.push({ beneficiary_id: benId, day_of_week: dayNum, meal_type: meal.type, meal_id: meal.id, quantity, category });
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
                const slice = fixedRows.slice(c, c + CHUNK);
                const { error } = await supabase.from('beneficiary_fixed_meals').insert(slice);
                if (error) {
                  // لو عمود category غير موجود (fixed-meals-category-migration.sql ما اتشغّل)،
                  // نعيد المحاولة بدونه عشان الاستيراد يكمل ويُحفظ على الأقل ما عدا الفئة.
                  if (/category|column/i.test(error.message)) {
                    const fallback = slice.map(({ category: _omit, ...rest }) => rest);
                    const { error: e2 } = await supabase.from('beneficiary_fixed_meals').insert(fallback);
                    if (e2) errors.push(`خطأ في الأصناف الثابتة: ${e2.message}`);
                  } else {
                    errors.push(`خطأ في الأصناف الثابتة: ${error.message}`);
                  }
                }
              }
            }

            void logActivity({
              action: 'create',
              entity_type: entityType,
              entity_name: `استيراد (${codeToId.size} ${entitySingular})`,
              details: { imported: codeToId.size, errors_count: errors.length, source: 'excel_import', entity_type: entityType },
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