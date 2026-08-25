'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import { readSnapshot, writeSnapshot } from '@/lib/view-snapshot';
import {
  BENEFICIARY_HEADERS,
  COL_ACTIVE,
  EXCLUSION_COLUMNS,
  FIXED_COLUMNS,
  STICKER_FLAG_COLUMNS,
  buildBeneficiaryRow,
  parseFixedToken,
  parseYesNo,
  splitCellTokens,
  DAY_FROM_AR,
  type SheetBeneficiary,
  type SheetExclusion,
  type SheetFixedMeal,
  type SheetMeal,
} from '@/lib/beneficiary-sheet';
import { logActivity } from '@/lib/activity-log';
import { valueDetails } from '@/lib/activity-diff';
import { useCurrentUser } from '@/lib/use-current-user';
import { can, needsApproval } from '@/lib/permissions';
import { enqueueDelete } from '@/lib/pending-actions';
import { useMyPending } from '@/lib/use-my-pending';
import type { Beneficiary, Meal, MealType, EntityType, ItemCategory } from '@/lib/types';
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
  // كل الأصناف بلا فلترة فئة — تُستخدم فقط في بناء/فحص ملف Excel
  const [allMealsForSheet, setAllMealsForSheet] = useState<{ id: string; name: string; type: MealType; is_snack: boolean }[]>([]);
  const [editingBeneficiary, setEditingBeneficiary] = useState<Beneficiary | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<'name' | 'code' | 'category' | 'villa' | 'diet_type' | 'fixed_count' | 'excluded_count' | 'notes'>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { user: currentUser } = useCurrentUser();
  // الصلاحيات على هذي الصفحة (page) للمستخدم الحالي:
  // - لو يقدر يحذف → الحذف فوري
  // - لو ما يقدر → يدخل نظام الموافقات
  const permPage = entityType === 'companion' ? 'companions' : 'beneficiaries';
  const canDelete = can(currentUser, permPage, 'delete');
  const deleteNeedsApproval = needsApproval(currentUser, permPage, 'delete');
  const isAdmin = currentUser?.is_admin === true;
  const myPending = useMyPending(entityType);


  // نصوص واجهة المستخدم تتغير حسب نوع الكيان (مستفيد/مرافق)
  const entitySingular = ENTITY_TYPE_LABELS[entityType];
  const entityPlural   = ENTITY_TYPE_LABELS_PLURAL[entityType];

  const fetchData = useCallback(async () => {
    // ارسم آخر لقطة فوراً بدل شاشة فاضية — الطلب ينطلق تحت ويستبدلها بمجرّد
    // وصوله، فالمعروض يبقى طازجاً والانتظار وحده هو الذي اختفى.
    const snapKey = `bens:${entityType}`;
    const snap = readSnapshot<{ bens: Beneficiary[]; meals: Meal[] }>(snapKey);
    if (snap) {
      setBeneficiaries(snap.bens);
      setMeals(snap.meals);
      setLoading(false);
    } else {
      setLoading(true);
    }

    try {
      // Try with the category column on fixed_meals first; if migration not run,
      // retry without it so the page still works.
      // Also tries to filter by entity_type — if that column doesn't exist yet
      // (companions migration not run), falls back to unfiltered query but
      // refuses to render companions data (we only want beneficiaries view safely).
      // قراءة على دفعات — القائمة تتجاوز سقف الـ١٠٠٠ صف الافتراضي فيقصّها
      // PostgREST بصمت، فيختفي مستفيدون من الصفحة بلا أي رسالة خطأ.
      // ⚠️ is_alternative لازم يُقرأ هنا: BeneficiaryModal يبني حالته من هذا
      // الصف، فلو ما انقرأ ظهرت كل الأصناف الثابتة «غير بديلة» وأي حفظ للمستفيد
      // يمسح العلامة — وتنتقل كميات في تقرير الأمر من خانة البدائل للثابتة.
      let withFixedAlt = true;
      const fetchBens = (withFixedCategory: boolean, withEntityType: boolean, withFlags: boolean) => {
        const flagCols = withFlags ? ', no_fish, no_pasta_sandwich, low_carb, is_active' : '';
        const fixedCols =
          `id, beneficiary_id, day_of_week, meal_type, meal_id, quantity` +
          `${withFixedCategory ? ', category, suppress_if_meal_ids' : ''}${withFixedAlt ? ', is_alternative' : ''}`;
        return fetchAllRows((from, to) => {
        const q = supabase
          .from('beneficiaries')
          .select(`
            id, name, english_name, code, category, villa, diet_type,
            fixed_items, notes, created_at${withEntityType ? ', entity_type' : ''}${flagCols},
            exclusions(
              id, beneficiary_id, meal_id, alternative_meal_id,
              meals:meals!exclusions_meal_id_fkey(id, name, type, is_snack),
              alternative_meal:meals!exclusions_alternative_meal_id_fkey(id, name, type, is_snack)
            ),
            fixed_meals:beneficiary_fixed_meals(
              ${fixedCols},
              meals!meal_id(id, name, type, is_snack)
            )
          `)
          .order('name')
          .order('id')
          .range(from, to);
        return withEntityType ? q.eq('entity_type', entityType) : q;
        });
      };

      // سلسلة إسقاط الأعمدة للمستفيدين — تُغلَّف في دالة حتى تنطلق **بالتوازي**
      // مع قراءة الأصناف. القراءتان مستقلّتان تماماً، وكانتا متسلسلتين فتدفع
      // الصفحة رحلة شبكة كاملة (~٤٥٠ms) بلا سبب.
      const loadBens = async (): Promise<{
        result: Awaited<ReturnType<typeof fetchBens>>;
        withFlags: boolean;
        companionsNeedMigration?: boolean;
      }> => {
        let res = await fetchBens(true, true, true);
        // عمود is_alternative غير موجود (الترقية ما اتشغّلت) → نسقطه وحده
        if (res.error && /is_alternative/i.test(res.error.message)) {
          withFixedAlt = false;
          res = await fetchBens(true, true, true);
        }
        // أعمدة خيارات الستيكر (no_fish...) غير موجودة → نعيد بدونها
        let withFlags = true;
        if (res.error && /no_fish|no_pasta_sandwich|low_carb|is_active/i.test(res.error.message)) {
          withFlags = false;
          res = await fetchBens(true, true, false);
        }
        // entity_type column missing → migration not yet run.
        if (res.error && /entity_type|column/i.test(res.error.message)) {
          // Companions view requires the migration. Show an empty state with hint.
          if (entityType === 'companion') return { result: res, withFlags, companionsNeedMigration: true };
          res = await fetchBens(true, false, withFlags);
        }
        if (res.error && /category|column/i.test(res.error.message)) {
          res = await fetchBens(false, true, withFlags);
          if (res.error && /entity_type|column/i.test(res.error.message)) {
            res = await fetchBens(false, false, withFlags);
          }
        }
        return { result: res, withFlags };
      };

      // الأصناف المعروضة في معالج التخصيصات لازم تكون من نفس فئة المستفيد،
      // ونجلب category كذلك عشان BeneficiaryModal يقرأ الفئة من الصنف نفسه
      // (المصدر الموحد). أي عمود ناقص (entity_type / category) نسقطه ونعيد المحاولة.
      const fetchMeals = (withEntity: boolean, withCategory: boolean) => {
        const cols = `id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}${withCategory ? ', category' : ''}, created_at`;
        const q = supabase.from('meals').select(cols).order('type').order('is_snack').order('name');
        return withEntity ? q.eq('entity_type', entityType) : q;
      };
      const loadMeals = async () => {
        let res = await fetchMeals(true, true);
        if (res.error && /category|column/i.test(res.error.message)) {
          res = await fetchMeals(true, false);
        }
        if (res.error && /entity_type|column/i.test(res.error.message)) {
          res = await fetchMeals(false, true);
          if (res.error && /category|column/i.test(res.error.message)) {
            res = await fetchMeals(false, false);
          }
        }
        return res;
      };

      // القراءتان معاً — لا واحدة تنتظر الأخرى
      const [bensOut, mealsResult] = await Promise.all([loadBens(), loadMeals()]);

      if (bensOut.companionsNeedMigration) {
        alert(
          'صفحة المرافقين تحتاج تشغيل ملف الترقية:\n' +
          'supabase/companions-migration.sql\n\n' +
          'شغّله مرة وحدة في Supabase SQL Editor ثم حدّث الصفحة.'
        );
        setBeneficiaries([]);
        setLoading(false);
        return;
      }
      const bensResult = bensOut.result;

      // كل الأصناف (الفئتين) لبناء ملف Excel — قراءة خفيفة على دفعات
      void (async () => {
        const r = await fetchAllRows<{ id: string; name: string; type: MealType; is_snack: boolean }>(
          (from, to) => supabase.from('meals').select('id, name, type, is_snack').order('id').range(from, to));
        if (!r.error && r.data) setAllMealsForSheet(r.data);
      })();

      // ✅ FIX 1: لازم نحفظ المستفيدين فعلياً
      const freshBens = bensResult.data ? (bensResult.data as unknown as Beneficiary[]) : null;
      const freshMeals = mealsResult.data ? (mealsResult.data as unknown as Meal[]) : null;
      if (freshBens) setBeneficiaries(freshBens);
      if (freshMeals) setMeals(freshMeals);
      if (freshBens && freshMeals) writeSnapshot(snapKey, { bens: freshBens, meals: freshMeals });

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
      message: deleteNeedsApproval
        ? `سيُرسَل طلب حذف "${targetName}" إلى الأدمن للموافقة. يحدث الحذف فعلياً بعد قبول الأدمن. متابعة؟`
        : `هل أنت متأكد من حذف "${targetName}"؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(id);
        if (deleteNeedsApproval && currentUser) {
          const r = await enqueueDelete(supabase, currentUser, entityType, id, ben?.name ?? null);
          if (!r.ok) {
            setNotice(r.duplicate ? `⚠ ${r.error}` : `⚠ تعذّر إرسال طلب الحذف: ${r.error}`);
          } else {
            myPending.refresh();
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
          // لقطة كاملة للسجل قبل اختفائه — الحذف ما يقبل مراجعة لاحقة،
          // فالسجل هو النسخة الوحيدة الباقية من بيانات المحذوف.
          details: ben
            ? {
                ...valueDetails(ben as unknown as Record<string, unknown>, [
                  'name', 'english_name', 'code', 'category', 'villa', 'diet_type',
                  'notes', 'no_fish', 'no_pasta_sandwich', 'low_carb', 'is_active',
                ]),
                exclusions_count: ben.exclusions?.length ?? 0,
                fixed_meals_count: ben.fixed_meals?.length ?? 0,
              }
            : null,
        });
        await fetchData();
        setDeleting(null);
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
    myPending.refresh();
  };

  /**
   * خريطة الأصناف كما يحتاجها بناء الصف. لازم تكون **شاملة**: قائمة الإلغاء
   * (suppress_if_meal_ids) عابرة للأنواع بحكم تصميمها، فلو بنيناها من أصناف
   * الفئة الحالية فقط لسقطت أسماء مشروعة من الملف — وأبلغ عنها زر التحقق
   * كأنها بيانات ضائعة. لذلك نضمّ `allMealsForSheet` (كل الأصناف بلا فلترة).
   */
  const buildSheetMealsMap = () => {
    const mealsById = new Map<string, SheetMeal>();
    const addMeal = (m: { id?: string; name?: string; type?: string; is_snack?: boolean } | null | undefined) => {
      if (!m?.id || !m.name || !m.type) return;
      if (!mealsById.has(m.id)) mealsById.set(m.id, { id: m.id, name: m.name, type: m.type as MealType, is_snack: m.is_snack === true });
    };
    for (const m of meals) addMeal(m);
    for (const m of allMealsForSheet) addMeal(m);
    // الأصناف المرتبطة تأتي مضمّنة مع المستفيد — نضيفها حتى لو غابت عن قائمة الصفحة
    for (const b of beneficiaries) {
      for (const e of b.exclusions ?? []) {
        addMeal((e as { meals?: { id?: string; name?: string; type?: string; is_snack?: boolean } }).meals);
        addMeal((e as { alternative_meal?: { id?: string; name?: string; type?: string; is_snack?: boolean } }).alternative_meal);
      }
      for (const fm of b.fixed_meals ?? []) {
        addMeal((fm as { meals?: { id?: string; name?: string; type?: string; is_snack?: boolean } }).meals);
      }
    }

    return mealsById;
  };

  const handleExport = () => {
    // الصيغة من lib/beneficiary-sheet — نفسها التي تستعملها ورقة النسخة
    // الاحتياطية، فما تعود الاثنتان تتباعدان.
    const mealsById = buildSheetMealsMap();
    const rows = beneficiaries.map(b => buildBeneficiaryRow(
      b as SheetBeneficiary,
      (b.exclusions ?? []) as SheetExclusion[],
      (b.fixed_meals ?? []) as unknown as SheetFixedMeal[],
      mealsById,
    ));
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
            </>
          )}
          {can(currentUser, permPage, 'add') && (
            <button onClick={handleAdd} className="btn-primary text-sm">+ إضافة {entitySingular}</button>
          )}
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
              {/* صفوف "شبح" لطلبات الإضافة pending — يقرأها الـpayload ويعرضها قبل الموافقة */}
              {myPending.getCreates().map((pa, i) => {
                const cp = pa.payload as { beneficiary?: Record<string, unknown> } | null;
                const b = cp?.beneficiary ?? {};
                return (
                  <tr key={`pending-create-${i}`} className="pending-create border-t border-slate-100">
                    <td className="table-cell text-slate-400 text-xs">⏳</td>
                    <td className="table-cell">
                      <div className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                        {String(b.name ?? '—')}
                        <span className="pending-badge pending-badge-create">⏳ إضافة بانتظار الموافقة</span>
                      </div>
                      {b.english_name ? <div className="text-xs text-slate-400">{String(b.english_name)}</div> : null}
                    </td>
                    <td className="table-cell text-slate-500 text-xs">{String(b.code ?? '—')}</td>
                    <td className="table-cell text-slate-500 text-xs">{String(b.category ?? '—')}</td>
                    <td className="table-cell text-slate-500 text-xs">{String(b.villa ?? '—')}</td>
                    <td className="table-cell text-slate-500 text-xs">{String(b.diet_type ?? '—')}</td>
                    <td className="table-cell text-slate-400 text-xs">—</td>
                    <td className="table-cell text-slate-400 text-xs">—</td>
                    <td className="table-cell text-slate-500 text-sm">{String(b.notes ?? '—')}</td>
                    <td className="table-cell text-slate-400 text-xs text-center">—</td>
                  </tr>
                );
              })}
              {pagination.pageItems.map((b, idx) => {
                const pendingCls = myPending.hasDelete(b.id)
                  ? 'pending-delete'
                  : myPending.hasUpdate(b.id) ? 'pending-update' : '';
                const pendingBadge = myPending.hasDelete(b.id)
                  ? { cls: 'pending-badge-delete', label: '⏳ حذف بانتظار الموافقة' }
                  : myPending.hasUpdate(b.id)
                  ? { cls: 'pending-badge-update', label: '⏳ تعديل بانتظار الموافقة' }
                  : null;
                const disabled = (b as { is_active?: boolean }).is_active === false;
                return (
                <tr key={b.id} className={`hover:bg-slate-50 transition-colors border-t border-slate-100 ${pendingCls} ${disabled ? 'opacity-60' : ''}`}>
                  <td className="table-cell text-slate-400 text-xs">
                    {(pagination.page - 1) * pagination.pageSize + idx + 1}
                  </td>
                  <td className="table-cell">
                    <div className="font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                      {b.name}
                      {disabled && <span className="text-[11px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">معطّل مؤقتاً</span>}
                      {pendingBadge && <span className={`pending-badge ${pendingBadge.cls}`}>{pendingBadge.label}</span>}
                    </div>
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
                      {can(currentUser, permPage, 'edit') && (
                        <button
                          onClick={() => handleEdit(b)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="تعديل"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      )}
                      {canDelete && (
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
                      )}
                    </div>
                  </td>
                </tr>
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
          templateHeaders={BENEFICIARY_HEADERS}
          // الأعمدة الاختيارية (مفعّل/خيارات الستيكر) مستثناة عمداً
          // عشان الملفات القديمة تبقى مقبولة
          requiredHeaders={['الاسم', 'الكود']}
          modes={['append', 'update', 'replace']}
          updateHint="يطابق بالكود: يحدّث الموجود ويضيف الجديد — بلا حذف أحد"

          templateRow={[
            'محمد أحمد', 'Mohammad Ahmad', 'B001', 'عائلة', '5', '',
            'فول؛كبدة - شكشوكة؛تونة', '',
            '', '',
            '', '',
            // أمثلة الأصناف الثابتة:
            //   فول×2؛سبت احد اربعاء  → كمية 2 (تصنيف افتراضي حار)
            //   سلطة؛سبت احد@بارد       → فئة بارد بدل الافتراضي
            //   مكرونة؛سبت↛فول,بيض     → تُلغى لو وُجد "فول" أو "بيض" في نفس الأمر
            //   تمر؛سبت@بديل            → يُحتسب مع البدائل بدل الأصناف الثابتة
            'فول×2؛سبت احد اربعاء - سلطة؛سبت احد@بارد - مكرونة؛سبت↛فول,بيض', '',
            '', '',
            '', '',
            '',
            // مفعّل + خيارات الستيكر — أعمدة اختيارية، غيابها يعني مفعّل/لا
            'نعم',
            ...STICKER_FLAG_COLUMNS.map(() => 'لا'),
          ]}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); fetchData(); }}
          replaceWarning={`سيتم حذف كل ${entityPlural} الحاليين (وما يرتبط بهم من محظورات وأصناف ثابتة) قبل إضافة بيانات الملف.`}
          onImport={async (rows, mode) => {
            const errors: string[] = [];
            const EXCL_COLS = EXCLUSION_COLUMNS;
            const FIXED_COLS = FIXED_COLUMNS;

            // ① (في وضع الاستبدال فقط) حذف بيانات هذا النوع + جلب الأصناف — بالتوازي
            // ⚠️ مهم جداً: الـdelete مقيّد بـentity_type عشان استيراد المرافقين ما يمسح المستفيدين والعكس.
            // في وضع الإضافة نُبقي على الموجود ونضيف صفوف الملف فوقه (الأكواد المكررة تُبلّغ كأخطاء).
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
              mode === 'replace'
                ? supabase.from('beneficiaries').delete().eq('entity_type', entityType)
                : Promise.resolve(),
              fetchImportMeals(),
            ]);
            const mealsData = mealsResult.data ?? [];

            // مفتاح مركّب: اسم|نوع|سناك — يمنع تلخبط الأصناف بنفس الاسم في وجبات مختلفة
            const mealByKey = new Map(
              mealsData.map(m => [`${m.name.trim()}|${m.type}|${String(m.is_snack)}`, m] as const)
            );
            const lookupMeal = (name: string, type: string, isSnack: boolean) =>
              mealByKey.get(`${name}|${type}|${String(isSnack)}`);

            // البحث بالاسم فقط — يُستخدم في suppress_if_meal_ids اللي يقبل أي صنف
            // باسم معيّن بغض النظر عن نوعه (لأن الـsuppress_if منطقياً عابر للأنواع).
            const mealsByName = new Map<string, typeof mealsData>();
            for (const m of mealsData) {
              const key = m.name.trim();
              const list = mealsByName.get(key) ?? [];
              list.push(m);
              mealsByName.set(key, list);
            }
            const lookupSuppressIds = (name: string): string[] => {
              const list = mealsByName.get(name.trim()) ?? [];
              return list.map(m => m.id);
            };

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
                  // أعمدة اختيارية — الملفات القديمة بدونها تُقرأ كما كانت تماماً
                  // (مفعّل، وكل خيارات الستيكر مطفأة).
                  is_active: parseYesNo(row[COL_ACTIVE], true),
                  ...Object.fromEntries(
                    STICKER_FLAG_COLUMNS.map(f => [f.key, parseYesNo(row[f.col], false)]),
                  ),
                },
                exclCols:  EXCL_COLS.map(c => ({ type: c.type, isSnack: c.isSnack, raw: row[c.col]?.toString().trim() || '' })),
                fixedCols: FIXED_COLS.map(c => ({ type: c.type, isSnack: c.isSnack, raw: row[c.col]?.toString().trim() || '' })),
              });
            }

            if (parsed.length === 0) return { imported: 0, errors };

            // ③ كتابة المستفيدين
            const CHUNK = 50;
            const codeToId = new Map<string, string>();

            // ── وضع «تحديث الموجود» ──────────────────────────────────────────
            // يطابق بالكود: يحدّث الموجود ويضيف الجديد، ولا يحذف أحداً. أبسط
            // وأقل خطراً من «استبدال الكل» لتصحيح دفعة بيانات، ولا يفشل على
            // الأكواد المكررة كما يفعل وضع «الإضافة».
            if (mode === 'update') {
              for (let c = 0; c < parsed.length; c += CHUNK) {
                const chunk = parsed.slice(c, c + CHUNK);
                const { data, error } = await supabase
                  .from('beneficiaries')
                  .upsert(chunk.map(r => r.payload), { onConflict: 'entity_type,code' })
                  .select('id, code');
                if (error) {
                  // القيد القديم على code وحده (قبل ترقية المرافقين)
                  if (/entity_type/i.test(error.message)) {
                    const { data: d2, error: e2 } = await supabase
                      .from('beneficiaries')
                      .upsert(chunk.map(r => r.payload), { onConflict: 'code' })
                      .select('id, code');
                    if (e2) { errors.push(`تعذّر تحديث المجموعة ${Math.floor(c / CHUNK) + 1}: ${e2.message}`); continue; }
                    for (const b of d2 ?? []) codeToId.set(b.code, b.id);
                    continue;
                  }
                  errors.push(`تعذّر تحديث المجموعة ${Math.floor(c / CHUNK) + 1}: ${error.message}`);
                  continue;
                }
                for (const b of data ?? []) codeToId.set(b.code, b.id);
              }

              // المحظورات والأصناف الثابتة تُستبدل بالكامل لمن ورد في الملف فقط
              // — نفس دلالة نافذة تخصيص المستفيد. من لم يرد في الملف لا يتأثر.
              const touchedIds = [...codeToId.values()];
              for (let c = 0; c < touchedIds.length; c += CHUNK) {
                const slice = touchedIds.slice(c, c + CHUNK);
                const [ex, fx] = await Promise.all([
                  supabase.from('exclusions').delete().in('beneficiary_id', slice),
                  supabase.from('beneficiary_fixed_meals').delete().in('beneficiary_id', slice),
                ]);
                if (ex.error) errors.push(`تعذّر تحديث المحظورات: ${ex.error.message}`);
                if (fx.error) errors.push(`تعذّر تحديث الأصناف الثابتة: ${fx.error.message}`);
              }
            }

            for (let c = 0; mode !== 'update' && c < parsed.length; c += CHUNK) {
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
                // التفكيك في lib/beneficiary-sheet — نفس الرموز التي يكتبها
                // التصدير: الكمية ×N، الفئة @بارد، البديل @بديل، الإلغاء ↛…
                for (const partRaw of splitCellTokens(raw)) {
                  const token = parseFixedToken(partRaw, sectionDefault);
                  if (!token) continue;

                  const seenIds = new Set<string>();
                  for (const n of token.suppressNames) {
                    const ids = lookupSuppressIds(n);
                    if (ids.length === 0) {
                      errors.push(`صف ${i + 2}: الصنف الـ"↛${n}" غير موجود — سيُتجاهل`);
                      continue;
                    }
                    for (const id of ids) seenIds.add(id);
                  }
                  const suppress_if_meal_ids = Array.from(seenIds);

                  const meal = lookupMeal(token.mealName, type, isSnack);
                  if (!meal) { errors.push(`صف ${i + 2}: الصنف الثابت "${token.mealName}" غير موجود في هذه الوجبة`); continue; }
                  for (const dayStr of token.dayTokens) {
                    const dayNum = DAY_FROM_AR[dayStr];
                    if (dayNum === undefined) { errors.push(`صف ${i + 2}: اليوم "${dayStr}" غير معروف`); continue; }
                    fixedRows.push({
                      beneficiary_id: benId,
                      day_of_week: dayNum,
                      meal_type: meal.type,
                      meal_id: meal.id,
                      quantity: token.quantity,
                      category: token.category,
                      suppress_if_meal_ids,
                      is_alternative: token.isAlternative,
                    });
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
                  // إذا أعمدة category أو suppress_if_meal_ids غير موجودة (الـmigrations
                  // ما اتشغّلت)، نعيد المحاولة بدونها عشان الاستيراد يكمل ويحفظ بقية الحقول.
                  if (/category|suppress_if|is_alternative|column/i.test(error.message)) {
                    const fallback = slice.map(row => {
                      const r = { ...row };
                      delete (r as Record<string, unknown>).category;
                      delete (r as Record<string, unknown>).suppress_if_meal_ids;
                      delete (r as Record<string, unknown>).is_alternative;
                      return r;
                    });
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