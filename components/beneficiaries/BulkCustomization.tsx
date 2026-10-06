'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Beneficiary, Meal, MealType, ItemCategory, EntityType } from '@/lib/types';
import {
  MEAL_TYPE_LABELS,
  DAY_LABELS,
  DAYS_ORDER,
  CATEGORY_LABELS,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_LABELS_PLURAL,
  ENTITY_BADGE_STYLES,
} from '@/lib/types';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

interface Props {
  entityType: EntityType;
}

type Mode = 'exclusion' | 'unexclude' | 'fixed' | 'unfixed' | 'cancelMeals';

/** نطاق «إلغاء وجبات»: كل الأصناف، أو الأساسية بس، أو السناكات بس */
type CancelScope = 'all' | 'mains' | 'snacks';
const CANCEL_SCOPE_LABELS: Record<CancelScope, string> = {
  all: 'كل الأصناف',
  mains: 'الأصناف الأساسية فقط',
  snacks: 'السناكات فقط',
};
const MEAL_TYPES_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];

/** دفعات الكتابة — مئات المستفيدين × عشرات الأصناف تطلع آلاف الصفوف */
const WRITE_CHUNK = 500;
function chunk<T>(arr: T[], size = WRITE_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const CATEGORY_THEME: Record<ItemCategory, { icon: string; bg: string; textOn: string }> = {
  hot:   { icon: '🔥', bg: 'bg-red-500',   textOn: 'text-white' },
  cold:  { icon: '❄️', bg: 'bg-sky-500',   textOn: 'text-white' },
  snack: { icon: '🍿', bg: 'bg-amber-500', textOn: 'text-white' },
};

// ─── Searchable meal dropdown ─────────────────────────────────────────────────
function MealSearchPicker({
  meals,
  value,
  onChange,
  placeholder,
  allowClear = false,
}: {
  meals: Meal[];
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = meals.find(m => m.id === value);
  const filtered = meals.filter(m =>
    !query.trim() ||
    m.name.includes(query.trim()) ||
    (m.english_name ?? '').toLowerCase().includes(query.toLowerCase())
  );

  // Group by meal type for visual scan
  const groups = filtered.reduce<Record<string, Meal[]>>((acc, m) => {
    const key = `${m.type}|${m.is_snack ? 'snack' : 'main'}`;
    (acc[key] = acc[key] ?? []).push(m);
    return acc;
  }, {});

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white hover:border-emerald-400 transition-colors ${
          selected ? 'text-slate-800 font-medium' : 'text-slate-400'
        }`}
      >
        <span className="truncate">
          {selected
            ? `${selected.name}${selected.is_snack ? ' (سناك)' : ''} — ${MEAL_TYPE_LABELS[selected.type]}`
            : placeholder}
        </span>
        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 left-0 z-50 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="ابحث في الأصناف..."
              className="w-full px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {allowClear && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
                className="w-full text-right px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 border-b border-slate-100"
              >
                — بدون اختيار —
              </button>
            )}
            {Object.keys(groups).length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">لا توجد نتائج</p>
            ) : (
              Object.entries(groups).map(([key, items]) => {
                const [type, kind] = key.split('|');
                const label = `${MEAL_TYPE_LABELS[type as keyof typeof MEAL_TYPE_LABELS]}${kind === 'snack' ? ' — سناك' : ''}`;
                return (
                  <div key={key}>
                    <div className="text-[10px] font-bold text-slate-400 px-3 py-1 bg-slate-50 sticky top-0 border-b border-slate-100">
                      {label}
                    </div>
                    {items.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { onChange(m.id); setOpen(false); setQuery(''); }}
                        className={`w-full text-right px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors ${
                          m.id === value ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700'
                        }`}
                      >
                        {m.name}
                        {m.english_name && <span className="text-xs text-slate-400 mr-2">({m.english_name})</span>}
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function BulkCustomization({ entityType }: Props) {

  const entityLabel = ENTITY_TYPE_LABELS[entityType];
  const entityPlural = ENTITY_TYPE_LABELS_PLURAL[entityType];
  const listHref = entityType === 'companion' ? '/companions' : '/beneficiaries';

  // ── Data ────────────────────────────────────────────────────────────────────
  const [bens, setBens] = useState<Beneficiary[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Selection ───────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [activeDietTypes, setActiveDietTypes] = useState<Set<string>>(new Set());
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());

  // ── Customization ───────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('exclusion');
  // Exclusion — قائمة محظورات، كل عنصر: صنف + بديل اختياري
  const [exclEntries, setExclEntries] = useState<{ mealId: string; altId: string }[]>([{ mealId: '', altId: '' }]);
  // Unexclude — قائمة أصناف مراد إزالة استبعادها
  const [unexclMealIds, setUnexclMealIds] = useState<string[]>(['']);
  // Fixed — قائمة أصناف ثابتة، كل عنصر: صنف + أيام + كمية + تصنيف + شرط إلغاء
  const [fixedEntries, setFixedEntries] = useState<{ mealId: string; days: Set<number>; qty: number; category: ItemCategory; suppressIfMealIds: string[]; isAlternative: boolean }[]>(
    [{ mealId: '', days: new Set<number>(), qty: 1, category: 'hot' as ItemCategory, suppressIfMealIds: [], isAlternative: false }]
  );
  // Unfixed — قائمة أصناف مراد حذف تثبيتها (days فارغة = كل الأيام)
  const [unfixedEntries, setUnfixedEntries] = useState<{ mealId: string; days: Set<number> }[]>(
    [{ mealId: '', days: new Set<number>() }]
  );

  // إلغاء وجبات — «إلغاء» يحظر كل أصناف الوجبات المختارة بلا بديل، و«إرجاع» يشيلها
  const [cancelAction, setCancelAction] = useState<'cancel' | 'restore'>('cancel');
  const [cancelTypes, setCancelTypes] = useState<Set<MealType>>(new Set());
  const [cancelScope, setCancelScope] = useState<CancelScope>('all');
  const [cancelFixedToo, setCancelFixedToo] = useState(true);

  // ── Apply state ─────────────────────────────────────────────────────────────
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError('');

    try {
      // Beneficiaries — only fields we need for picking
      const fetchBens = async (withEntity: boolean) => {
        const q = supabase
          .from('beneficiaries')
          .select('id, name, code, category, villa, diet_type')
          .order('name');
        return withEntity ? q.eq('entity_type', entityType) : q;
      };
      let bensRes = await fetchBens(true);
      if (bensRes.error && /entity_type|column/i.test(bensRes.error.message)) {
        if (entityType === 'companion') {
          setLoadError('شغّل supabase/companions-migration.sql أولاً قبل استخدام التخصيص الجماعي للمرافقين.');
          setLoading(false);
          return;
        }
        bensRes = await fetchBens(false);
      }
      if (bensRes.error) throw bensRes.error;

      // Meals — scoped to entity for both pickers (excluded item, alternative, fixed item)
      const fetchMeals = async (withEntity: boolean, withCategory: boolean) => {
        const cols = `id, name, english_name, type, is_snack${withCategory ? ', category' : ''}, created_at`;
        const q = supabase.from('meals').select(cols).order('type').order('is_snack').order('name');
        return withEntity ? q.eq('entity_type', entityType) : q;
      };
      let mealsRes = await fetchMeals(true, true);
      if (mealsRes.error && /category|column/i.test(mealsRes.error.message)) {
        mealsRes = await fetchMeals(true, false);
      }
      if (mealsRes.error && /entity_type|column/i.test(mealsRes.error.message)) {
        mealsRes = await fetchMeals(false, true);
        if (mealsRes.error && /category|column/i.test(mealsRes.error.message)) {
          mealsRes = await fetchMeals(false, false);
        }
      }
      if (mealsRes.error) throw mealsRes.error;

      setBens((bensRes.data ?? []) as unknown as Beneficiary[]);
      setMeals((mealsRes.data ?? []) as unknown as Meal[]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [supabase, entityType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived: filter chips ──────────────────────────────────────────────────
  const dietTypes = useMemo(() => {
    const s = new Set<string>();
    bens.forEach(b => { if (b.diet_type?.trim()) s.add(b.diet_type.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [bens]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    bens.forEach(b => { if (b.category?.trim()) s.add(b.category.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [bens]);

  // ── Visible (after search) ─────────────────────────────────────────────────
  const visibleBens = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bens;
    return bens.filter(b => {
      const hay = [b.name, b.code, b.category, b.villa, b.diet_type, b.english_name]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [bens, search]);

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleId = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleDietType = (dt: string) => {
    const isActive = activeDietTypes.has(dt);
    setActiveDietTypes(prev => {
      const next = new Set(prev);
      if (isActive) next.delete(dt); else next.add(dt);
      return next;
    });
    // Toggle membership in selection: turning ON adds all; turning OFF removes all
    setSelectedIds(prev => {
      const next = new Set(prev);
      bens.filter(b => (b.diet_type ?? '').trim() === dt).forEach(b => {
        if (isActive) next.delete(b.id); else next.add(b.id);
      });
      return next;
    });
  };

  const toggleCategory = (cat: string) => {
    const isActive = activeCategories.has(cat);
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (isActive) next.delete(cat); else next.add(cat);
      return next;
    });
    setSelectedIds(prev => {
      const next = new Set(prev);
      bens.filter(b => (b.category ?? '').trim() === cat).forEach(b => {
        if (isActive) next.delete(b.id); else next.add(b.id);
      });
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      visibleBens.forEach(b => next.add(b.id));
      return next;
    });
  };

  const clearAll = () => {
    setSelectedIds(new Set());
    setActiveDietTypes(new Set());
    setActiveCategories(new Set());
  };

  // الأصناف اللي يشملها «إلغاء وجبات» حسب الوجبات والنطاق المختار
  const cancelTargetMeals = useMemo(() => meals.filter(m =>
    cancelTypes.has(m.type) &&
    (cancelScope === 'all' || (cancelScope === 'snacks') === m.is_snack)
  ), [meals, cancelTypes, cancelScope]);

  const cancelSummary = useMemo(() => {
    const types = MEAL_TYPES_ORDER.filter(t => cancelTypes.has(t)).map(t => MEAL_TYPE_LABELS[t]).join(' و');
    return `${CANCEL_SCOPE_LABELS[cancelScope]} في ${types || '—'}`;
  }, [cancelTypes, cancelScope]);

  // ── Validation ─────────────────────────────────────────────────────────────
  const canApply = useMemo(() => {
    if (selectedIds.size === 0) return false;
    if (mode === 'exclusion')  return exclEntries.some(e => !!e.mealId);
    if (mode === 'unexclude')  return unexclMealIds.some(Boolean);
    if (mode === 'fixed')      return fixedEntries.some(e => !!e.mealId && e.days.size > 0 && e.qty > 0);
    if (mode === 'unfixed')    return unfixedEntries.some(e => !!e.mealId);
    if (mode === 'cancelMeals') return cancelTargetMeals.length > 0;
    return false;
  }, [selectedIds.size, mode, exclEntries, unexclMealIds, fixedEntries, unfixedEntries, cancelTargetMeals.length]);

  const confirmMessage = useMemo(() => {
    const target = `${selectedIds.size} ${entityLabel}${selectedIds.size === 1 ? '' : 'اً'}`;
    if (mode === 'cancelMeals') {
      return cancelAction === 'cancel'
        ? `سيتم إلغاء ${cancelSummary} (${cancelTargetMeals.length} صنف) لـ${target} — تُحظر بلا بديل` +
          `${cancelFixedToo ? '، وتُحذف أصنافهم الثابتة في هذه الوجبات' : ''}. متابعة؟`
        : `سيتم إرجاع ${cancelSummary} (${cancelTargetMeals.length} صنف) لـ${target} — يُشال الحظر بلا بديل عنها. متابعة؟`;
    }
    if (mode === 'exclusion') {
      const valid = exclEntries.filter(e => !!e.mealId);
      const names = valid.map(e => {
        const m = meals.find(x => x.id === e.mealId);
        const alt = meals.find(x => x.id === e.altId);
        return `"${m?.name ?? ''}"${alt ? ` ببديل "${alt.name}"` : ''}`;
      }).join('، ');
      return `سيتم استبعاد ${names} لـ${target}. لو الشخص عنده أياً منها ببديل مختلف سيُحدَّث. متابعة؟`;
    }
    if (mode === 'unexclude') {
      const valid = unexclMealIds.filter(Boolean);
      const names = valid.map(id => `"${meals.find(x => x.id === id)?.name ?? ''}"`).join('، ');
      return `سيتم إزالة استبعاد ${names} من ${target}. من ما كان عنده الصنف يُتجاهل. متابعة؟`;
    }
    if (mode === 'unfixed') {
      const valid = unfixedEntries.filter(e => !!e.mealId);
      const names = valid.map(e => {
        const m = meals.find(x => x.id === e.mealId);
        const daysLabel = e.days.size === 0 ? 'كل الأيام' : `${e.days.size} يوم`;
        return `"${m?.name ?? ''}" (${daysLabel})`;
      }).join('، ');
      return `سيتم حذف الصنف الثابت ${names} من ${target}. متابعة؟`;
    }
    const valid = fixedEntries.filter(e => !!e.mealId && e.days.size > 0);
    const names = valid.map(e => {
      const m = meals.find(x => x.id === e.mealId);
      return `"${m?.name ?? ''}" (${e.days.size} يوم × ${e.qty}${e.isAlternative ? ' — صنف بديل' : ''})`;
    }).join('، ');
    return `سيتم تثبيت ${names} لـ${target}. لو الشخص عنده أياً منها في نفس الأيام تتحدّث الكمية فقط. متابعة؟`;
  }, [mode, selectedIds.size, entityLabel, exclEntries, unexclMealIds, fixedEntries, unfixedEntries, meals, cancelAction, cancelSummary, cancelTargetMeals.length, cancelFixedToo]);

  // ── Apply ──────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    setApplying(true);
    setResult(null);
    try {
      const ids = Array.from(selectedIds);

      if (mode === 'cancelMeals') {
        const mealIds = cancelTargetMeals.map(m => m.id);
        const types = MEAL_TYPES_ORDER.filter(t => cancelTypes.has(t));
        const peopleLabel = `${ids.length} ${entityLabel}${ids.length === 1 ? '' : 'اً'}`;

        if (cancelAction === 'cancel') {
          // محظور بلا بديل لكل صنف × كل شخص — نفس آلية «إضافة محظور» فيظهر في
          // تبويب المحظورات لكل مستفيد، ويُطبَّق في الأوامر والستيكرات والتقارير.
          const rows = ids.flatMap(bid => mealIds.map(mid => ({
            beneficiary_id: bid, meal_id: mid, alternative_meal_id: null,
          })));
          for (const part of chunk(rows)) {
            const { error } = await supabase.from('exclusions').upsert(part, { onConflict: 'beneficiary_id,meal_id' });
            if (error) throw error;
          }
          // الأصناف الثابتة تنضاف فوق المنيو، فلو بقيت ما «تنلغي» الوجبة فعلاً
          let fixedDeleted = 0;
          if (cancelFixedToo) {
            for (const idsPart of chunk(ids, 100)) {
              for (const mealsPart of chunk(mealIds, 100)) {
                const { data, error } = await supabase.from('beneficiary_fixed_meals').delete()
                  .in('beneficiary_id', idsPart).in('meal_id', mealsPart).in('meal_type', types)
                  .select('id');
                if (error) throw error;
                fixedDeleted += (data ?? []).length;
              }
            }
          }
          void logActivity({
            action: 'create',
            entity_type: entityType,
            entity_name: `تخصيص جماعي — إلغاء ${cancelSummary} (${ids.length})`,
            details: {
              scope: 'bulk_cancel_meals', count: ids.length, meal_types: types, cancel_scope: cancelScope,
              meal_ids: mealIds, fixed_deleted: fixedDeleted, for_entity: entityType, beneficiary_ids: ids,
            },
          });
          setResult({
            ok: true,
            message: `تم إلغاء ${cancelSummary} (${mealIds.length} صنف) لـ${peopleLabel}` +
              (cancelFixedToo ? ` — وحُذف ${fixedDeleted} صنف ثابت.` : '.'),
          });
        } else {
          // نشيل بس المحظورات الشخصية «بلا بديل» — اللي لها بديل أو جاية من
          // نظام غذائي تبقى كما هي.
          const affected = new Set<string>();
          let removed = 0;
          for (const idsPart of chunk(ids, 100)) {
            for (const mealsPart of chunk(mealIds, 100)) {
              const del = (personalOnly: boolean) => {
                const q = supabase.from('exclusions').delete()
                  .in('beneficiary_id', idsPart).in('meal_id', mealsPart).is('alternative_meal_id', null);
                return (personalOnly ? q.is('diet_id', null) : q).select('id, beneficiary_id');
              };
              let { data, error } = await del(true);
              if (error && /diet_id/i.test(error.message)) ({ data, error } = await del(false));
              if (error) throw error;
              (data ?? []).forEach((r: { beneficiary_id: string }) => affected.add(r.beneficiary_id));
              removed += (data ?? []).length;
            }
          }
          void logActivity({
            action: 'delete',
            entity_type: entityType,
            entity_name: `تخصيص جماعي — إرجاع ${cancelSummary} (${affected.size})`,
            details: {
              scope: 'bulk_restore_meals', count: affected.size, removed, meal_types: types, cancel_scope: cancelScope,
              meal_ids: mealIds, for_entity: entityType, beneficiary_ids: ids,
            },
          });
          setResult({
            ok: true,
            message: removed === 0
              ? 'لا أحد من المختارين كانت هذه الوجبات ملغاة عنده.'
              : `تم إرجاع ${cancelSummary} لـ${affected.size} ${entityLabel}${affected.size === 1 ? '' : 'اً'} (${removed} صنف).`,
          });
        }
      } else if (mode === 'unexclude') {
        const validMealIds = unexclMealIds.filter(Boolean);
        const allAffected = new Set<string>();
        for (const mealId of validMealIds) {
          // الشخصية فقط — صف النظام الغذائي يرجع بالمزامنة فوراً، فحذفه لا
          // يزيل شيئاً فعلياً (diet_id اختياري قبل diet-systems-migration)
          const del = (personalOnly: boolean) => {
            const q = supabase.from('exclusions').delete().eq('meal_id', mealId).in('beneficiary_id', ids);
            return (personalOnly ? q.is('diet_id', null) : q).select('id, beneficiary_id');
          };
          let { data, error } = await del(true);
          if (error && /diet_id/i.test(error.message)) ({ data, error } = await del(false));
          if (error) throw error;
          (data ?? []).forEach((r: { id: string; beneficiary_id: string }) => allAffected.add(r.beneficiary_id));
        }
        const mealNames = validMealIds.map(id => meals.find(m => m.id === id)?.name ?? '').join('، ');
        const affectedCount = allAffected.size;
        void logActivity({
          action: 'delete',
          entity_type: entityType,
          entity_name: `حذف جماعي — استبعاد [${mealNames}] (${affectedCount})`,
          details: { scope: 'bulk_unexclude', count: affectedCount, meal_ids: validMealIds, for_entity: entityType, beneficiary_ids: ids },
        });
        setResult({
          ok: true,
          message: affectedCount === 0
            ? `لا أحد من المختارين كان عنده استبعاد لهذه الأصناف.`
            : `تم إزالة الاستبعاد لـ ${validMealIds.length} صنف عن ${affectedCount} ${entityLabel}${affectedCount === 1 ? '' : 'اً'}.`,
        });
        setUnexclMealIds(['']);
      } else if (mode === 'exclusion') {
        const validEntries = exclEntries.filter(e => !!e.mealId);
        for (const entry of validEntries) {
          const rows = ids.map(bid => ({
            beneficiary_id: bid,
            meal_id: entry.mealId,
            alternative_meal_id: entry.altId || null,
          }));
          const { error } = await supabase
            .from('exclusions')
            .upsert(rows, { onConflict: 'beneficiary_id,meal_id' });
          if (error) throw error;
        }
        const entryNames = validEntries.map(e => {
          const m = meals.find(x => x.id === e.mealId);
          const alt = meals.find(x => x.id === e.altId);
          return `${m?.name ?? ''}${alt ? ` ببديل ${alt.name}` : ''}`;
        }).join('، ');
        void logActivity({
          action: 'create',
          entity_type: entityType,
          entity_name: `تخصيص جماعي — استبعاد [${entryNames}] (${ids.length})`,
          details: {
            scope: 'bulk_exclusion',
            count: ids.length,
            entries: validEntries.map(e => ({ meal_id: e.mealId, alt_id: e.altId || null })),
            for_entity: entityType,
            beneficiary_ids: ids,
          },
        });
        setResult({
          ok: true,
          message: `تم تطبيق ${validEntries.length} محظور${validEntries.length === 1 ? '' : 'ات'} على ${ids.length} ${entityLabel}${ids.length === 1 ? '' : 'اً'}.`,
        });
        setExclEntries([{ mealId: '', altId: '' }]);
      } else if (mode === 'unfixed') {
        const validEntries = unfixedEntries.filter(e => !!e.mealId);
        let totalDeleted = 0;
        for (const entry of validEntries) {
          let q = supabase
            .from('beneficiary_fixed_meals')
            .delete()
            .eq('meal_id', entry.mealId)
            .in('beneficiary_id', ids);
          if (entry.days.size > 0) {
            q = q.in('day_of_week', Array.from(entry.days));
          }
          const { data, error } = await q.select('id');
          if (error) throw error;
          totalDeleted += (data ?? []).length;
        }
        const mealNames = validEntries.map(e => meals.find(m => m.id === e.mealId)?.name ?? '').join('، ');
        void logActivity({
          action: 'delete',
          entity_type: entityType,
          entity_name: `حذف جماعي — صنف ثابت [${mealNames}] (${totalDeleted})`,
          details: { scope: 'bulk_unfixed', count: totalDeleted, entries: validEntries.map(e => ({ meal_id: e.mealId, days: Array.from(e.days) })), for_entity: entityType, beneficiary_ids: ids },
        });
        setResult({
          ok: true,
          message: totalDeleted === 0
            ? `لا أحد من المختارين كان عنده هذه الأصناف ثابتة في الأيام المحددة.`
            : `تم حذف ${totalDeleted} صنف ثابت من ${ids.length} ${entityLabel}${ids.length === 1 ? '' : 'اً'}.`,
        });
        setUnfixedEntries([{ mealId: '', days: new Set<number>() }]);
      } else {
        const validFixed = fixedEntries.filter(e => !!e.mealId && e.days.size > 0);
        let totalInserted = 0;
        let totalUpdated = 0;
        for (const entry of validFixed) {
          const entryMeal = meals.find(m => m.id === entry.mealId);
          if (!entryMeal) continue;
          const mealType = entryMeal.type;
          const days = Array.from(entry.days);
          const existingRes = await supabase
            .from('beneficiary_fixed_meals')
            .select('id, beneficiary_id, day_of_week')
            .in('beneficiary_id', ids)
            .in('day_of_week', days)
            .eq('meal_id', entry.mealId)
            .eq('meal_type', mealType);
          if (existingRes.error) throw existingRes.error;
          const existing = (existingRes.data ?? []) as Array<{ id: string; beneficiary_id: string; day_of_week: number }>;
          const existingKeys = new Set(existing.map(r => `${r.beneficiary_id}|${r.day_of_week}`));
          const existingIds = existing.map(r => r.id);
          if (existingIds.length > 0) {
            const { error: upErr } = await supabase
              .from('beneficiary_fixed_meals')
              .update({ quantity: entry.qty, category: entry.category, suppress_if_meal_ids: entry.suppressIfMealIds, is_alternative: entry.isAlternative })
              .in('id', existingIds);
            if (upErr) {
              if (/column/i.test(upErr.message)) {
                const { error: upErr2 } = await supabase
                  .from('beneficiary_fixed_meals')
                  .update({ quantity: entry.qty })
                  .in('id', existingIds);
                if (upErr2) throw upErr2;
              } else { throw upErr; }
            }
          }
          const newRows: Record<string, unknown>[] = [];
          for (const bid of ids) {
            for (const day of days) {
              if (!existingKeys.has(`${bid}|${day}`)) {
                newRows.push({ beneficiary_id: bid, day_of_week: day, meal_type: mealType, meal_id: entry.mealId, quantity: entry.qty, category: entry.category, suppress_if_meal_ids: entry.suppressIfMealIds, is_alternative: entry.isAlternative });
              }
            }
          }
          if (newRows.length > 0) {
            const { error: insErr } = await supabase.from('beneficiary_fixed_meals').insert(newRows);
            if (insErr) {
              if (/column/i.test(insErr.message)) {
                const fallback = newRows.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'category' && k !== 'suppress_if_meal_ids' && k !== 'is_alternative')));
                const { error: insErr2 } = await supabase.from('beneficiary_fixed_meals').insert(fallback);
                if (insErr2) throw insErr2;
              } else { throw insErr; }
            }
          }
          totalInserted += newRows.length;
          totalUpdated += existingIds.length;
        }
        const entryNames = validFixed.map(e => meals.find(m => m.id === e.mealId)?.name ?? '').join('، ');
        void logActivity({
          action: 'create',
          entity_type: entityType,
          entity_name: `تخصيص جماعي — أصناف ثابتة [${entryNames}] (${ids.length})`,
          details: {
            scope: 'bulk_fixed_meal',
            count: ids.length,
            entries: validFixed.map(e => ({ meal_id: e.mealId, days: Array.from(e.days), qty: e.qty, is_alternative: e.isAlternative })),
            for_entity: entityType,
            inserted: totalInserted,
            updated: totalUpdated,
            beneficiary_ids: ids,
          },
        });
        setResult({
          ok: true,
          message:
            `تم تطبيق ${validFixed.length} صنف ثابت على ${ids.length} ${entityLabel}${ids.length === 1 ? '' : 'اً'} ` +
            `(${totalInserted} إضافة، ${totalUpdated} تحديث).`,
        });
        setFixedEntries([{ mealId: '', days: new Set<number>(), qty: 1, category: 'hot' as ItemCategory, suppressIfMealIds: [], isAlternative: false }]);
      }
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setApplying(false);
      setConfirmOpen(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-12 bg-slate-200 rounded-xl w-1/3" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-96 bg-slate-200 rounded-xl" />
            <div className="h-96 bg-slate-200 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5">
          <p className="font-bold mb-1">تعذّر تحميل البيانات</p>
          <p className="text-sm">{loadError}</p>
          <Link href={listHref} className="inline-block mt-3 text-sm font-semibold text-red-700 hover:underline">
            ← الرجوع
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href={listHref}
            className="text-slate-500 hover:text-slate-700 text-sm font-semibold flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            الرجوع
          </Link>
          <h1 className="text-2xl font-bold text-slate-800">التخصيص الجماعي</h1>
          <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>{entityPlural}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-500">
            المحدد:{' '}
            <span className={`font-bold ${selectedIds.size > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
              {selectedIds.size}
            </span>{' '}
            من {bens.length}
          </span>
          {selectedIds.size > 0 && (
            <button
              onClick={clearAll}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              مسح الاختيار
            </button>
          )}
        </div>
      </div>

      {/* Result message */}
      {result && (
        <div
          className={`px-4 py-3 rounded-xl text-sm font-medium border ${
            result.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {result.ok ? '✓ ' : '⚠ '} {result.message}
        </div>
      )}

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Left: target picker ───────────────────────────────────────────── */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 text-sm">الأشخاص المستهدفون</h2>
            <button
              onClick={selectAllVisible}
              className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              title={search ? `تحديد ${visibleBens.length} ظاهر` : 'تحديد كل المعروضين'}
            >
              تحديد {search ? 'الظاهرين' : 'الكل'} ({visibleBens.length})
            </button>
          </div>

          {/* Filter chips */}
          {(dietTypes.length > 0 || categories.length > 0) && (
            <div className="space-y-2 border-b border-slate-100 pb-3">
              {dietTypes.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 mb-1.5">النظام الغذائي (الضغط يحدّد كل المجموعة):</p>
                  <div className="flex flex-wrap gap-1.5">
                    {dietTypes.map(dt => {
                      const groupCount = bens.filter(b => (b.diet_type ?? '').trim() === dt).length;
                      const active = activeDietTypes.has(dt);
                      return (
                        <button
                          key={dt}
                          onClick={() => toggleDietType(dt)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                            active
                              ? 'bg-violet-500 border-violet-600 text-white'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-violet-400 hover:text-violet-700'
                          }`}
                        >
                          {dt} <span className={active ? 'opacity-90' : 'opacity-50'}>({groupCount})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {categories.length > 0 && (
                <div>
                  <p className="text-[11px] font-bold text-slate-400 mb-1.5">الفئة:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {categories.map(cat => {
                      const groupCount = bens.filter(b => (b.category ?? '').trim() === cat).length;
                      const active = activeCategories.has(cat);
                      return (
                        <button
                          key={cat}
                          onClick={() => toggleCategory(cat)}
                          className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                            active
                              ? 'bg-blue-500 border-blue-600 text-white'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-700'
                          }`}
                        >
                          {cat} <span className={active ? 'opacity-90' : 'opacity-50'}>({groupCount})</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث بالاسم، الكود، الفيلا، الفئة..."
              className="input-field pr-10 text-sm"
            />
          </div>

          {/* List */}
          <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {visibleBens.length === 0 ? (
              <p className="text-center text-sm text-slate-400 py-10">لا توجد نتائج</p>
            ) : (
              visibleBens.map(b => {
                const checked = selectedIds.has(b.id);
                return (
                  <label
                    key={b.id}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      checked ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleId(b.id)}
                      className="w-4 h-4 accent-emerald-600 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-800 truncate">{b.name}</span>
                        <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {b.code}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 flex-wrap">
                        {b.category && <span>{b.category}</span>}
                        {b.villa && <span>· فيلا {b.villa}</span>}
                        {b.diet_type && (
                          <span className="text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">
                            {b.diet_type}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: customization picker ───────────────────────────────────── */}
        <div className="card p-4 space-y-4">
          <h2 className="font-bold text-slate-800 text-sm">التخصيص المراد تطبيقه</h2>

          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            {([
              { m: 'exclusion', label: 'إضافة محظور',    active: 'border-red-500 bg-red-50 text-red-700' },
              { m: 'unexclude', label: 'حذف محظور',      active: 'border-amber-500 bg-amber-50 text-amber-700' },
              { m: 'fixed',     label: 'إضافة صنف ثابت', active: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
              { m: 'unfixed',   label: 'حذف صنف ثابت',   active: 'border-rose-500 bg-rose-50 text-rose-700' },
              { m: 'cancelMeals', label: 'إلغاء / إرجاع وجبات كاملة', active: 'border-slate-700 bg-slate-100 text-slate-800' },
            ] as { m: Mode; label: string; active: string }[]).map(({ m, label, active: activeCls }) => (
              <button
                key={m}
                onClick={() => { setMode(m); setResult(null); }}
                className={`py-2.5 rounded-xl border-2 font-semibold text-xs sm:text-sm transition-all ${m === 'cancelMeals' ? 'col-span-2 ' : ''}${
                  mode === m ? activeCls : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Exclusion form */}
          {mode === 'exclusion' && (
            <div className="space-y-3">
              <div className="space-y-2">
                {exclEntries.map((entry, idx) => {
                  const entryMeal = meals.find(m => m.id === entry.mealId);
                  return (
                    <div key={idx} className="border border-slate-200 rounded-xl p-3 space-y-2 bg-slate-50/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-500">
                          {exclEntries.length > 1 ? `محظور #${idx + 1}` : 'الصنف المحظور'}
                        </span>
                        {exclEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setExclEntries(prev => prev.filter((_, i) => i !== idx))}
                            className="text-xs text-red-500 hover:text-red-700 font-semibold"
                          >
                            حذف
                          </button>
                        )}
                      </div>
                      <MealSearchPicker
                        meals={meals}
                        value={entry.mealId}
                        onChange={id => setExclEntries(prev => prev.map((e, i) => i === idx ? { ...e, mealId: id, altId: '' } : e))}
                        placeholder="اختر الصنف الذي سيُستبعد"
                      />
                      <MealSearchPicker
                        meals={entryMeal ? meals.filter(m => m.type === entryMeal.type && m.is_snack === entryMeal.is_snack && m.id !== entryMeal.id) : []}
                        value={entry.altId}
                        onChange={id => setExclEntries(prev => prev.map((e, i) => i === idx ? { ...e, altId: id } : e))}
                        placeholder={entryMeal ? 'بديل (اختياري)' : 'اختر الصنف أولاً'}
                        allowClear
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setExclEntries(prev => [...prev, { mealId: '', altId: '' }])}
                className="text-xs font-semibold text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> إضافة محظور آخر
              </button>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed">
                💡 لو الشخص عنده أي من هذه الأصناف محظوراً ببديل مختلف، يُحدَّث فقط. باقي محظوراته وأصنافه الثابتة لا تتغيّر.
              </div>
            </div>
          )}

          {/* Unexclude form */}
          {mode === 'unexclude' && (
            <div className="space-y-3">
              <div className="space-y-2">
                {unexclMealIds.map((mealId, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="flex-1">
                      <MealSearchPicker
                        meals={meals}
                        value={mealId}
                        onChange={id => setUnexclMealIds(prev => prev.map((v, i) => i === idx ? id : v))}
                        placeholder="اختر الصنف المراد إزالته"
                      />
                    </div>
                    {unexclMealIds.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setUnexclMealIds(prev => prev.filter((_, i) => i !== idx))}
                        className="text-xs text-red-500 hover:text-red-700 font-semibold shrink-0"
                      >
                        حذف
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setUnexclMealIds(prev => [...prev, ''])}
                className="text-xs font-semibold text-amber-700 hover:text-amber-800 flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> إضافة صنف آخر
              </button>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 leading-relaxed">
                💡 سيُحذف كل صنف محدد من قائمة محظورات الأشخاص المختارين. من ما كان عنده الصنف أصلاً يُتجاهل.
              </div>
            </div>
          )}

          {/* Unfixed form */}
          {mode === 'unfixed' && (
            <div className="space-y-3">
              <div className="space-y-2">
                {unfixedEntries.map((entry, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-xl p-3 space-y-2.5 bg-rose-50/30">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-500">
                        {unfixedEntries.length > 1 ? `صنف ثابت #${idx + 1}` : 'الصنف الثابت المراد حذفه'}
                      </span>
                      {unfixedEntries.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setUnfixedEntries(prev => prev.filter((_, i) => i !== idx))}
                          className="text-xs text-red-500 hover:text-red-700 font-semibold"
                        >
                          حذف
                        </button>
                      )}
                    </div>
                    <MealSearchPicker
                      meals={meals}
                      value={entry.mealId}
                      onChange={id => setUnfixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, mealId: id } : e))}
                      placeholder="اختر الصنف الثابت المراد حذفه"
                    />
                    {entry.mealId && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-bold text-slate-500">
                            الأيام <span className="text-xs font-normal text-slate-400">(فارغ = كل الأيام)</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => setUnfixedEntries(prev => prev.map((e, i) => i === idx
                              ? { ...e, days: e.days.size > 0 ? new Set<number>() : new Set<number>(DAYS_ORDER) }
                              : e))}
                            className="text-xs font-semibold text-rose-600 hover:underline"
                          >
                            {entry.days.size > 0 ? 'مسح (كل الأيام)' : 'تحديد كل الأيام'}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {DAYS_ORDER.map(d => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setUnfixedEntries(prev => prev.map((e, i) => {
                                if (i !== idx) return e;
                                const next = new Set(e.days);
                                if (next.has(d)) next.delete(d); else next.add(d);
                                return { ...e, days: next };
                              }))}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                entry.days.has(d)
                                  ? 'bg-rose-500 text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              {DAY_LABELS[d]}
                            </button>
                          ))}
                        </div>
                        {entry.days.size === 0 && (
                          <p className="text-xs text-rose-600 mt-1.5">سيتم حذف الصنف من جميع الأيام</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setUnfixedEntries(prev => [...prev, { mealId: '', days: new Set<number>() }])}
                className="text-xs font-semibold text-rose-600 hover:text-rose-700 flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> إضافة صنف آخر للحذف
              </button>
              <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-800 leading-relaxed">
                💡 سيتم حذف الصنف الثابت المحدد من الأيام المختارة. من ما كان عنده الصنف يُتجاهل. باقي أصنافه الثابتة لا تتأثر.
              </div>
            </div>
          )}

          {/* Fixed meal form */}
          {mode === 'fixed' && (
            <div className="space-y-3">
              <div className="space-y-3">
                {fixedEntries.map((entry, idx) => {
                  const entryMeal = meals.find(m => m.id === entry.mealId);
                  const cat = entry.category;
                  return (
                    <div key={idx} className="border border-slate-200 rounded-xl p-3 space-y-2.5 bg-slate-50/50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-500">
                          {fixedEntries.length > 1 ? `صنف ثابت #${idx + 1}` : 'الصنف الثابت'}
                        </span>
                        {fixedEntries.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setFixedEntries(prev => prev.filter((_, i) => i !== idx))}
                            className="text-xs text-red-500 hover:text-red-700 font-semibold"
                          >
                            حذف
                          </button>
                        )}
                      </div>
                      <MealSearchPicker
                        meals={meals}
                        value={entry.mealId}
                        onChange={id => {
                          const m = meals.find(x => x.id === id);
                          const autoCategory: ItemCategory = m ? (m.category ?? (m.is_snack ? 'snack' : 'hot')) : 'hot';
                          setFixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, mealId: id, category: autoCategory } : e));
                        }}
                        placeholder="اختر الصنف الذي سيتكرر"
                      />
                      {entryMeal && (
                        <>
                          <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
                            <div className="flex items-center gap-1.5">
                              <span>الفئة:</span>
                              <span className={`inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded ${
                                cat === 'hot' ? 'bg-red-100 text-red-700'
                              : cat === 'cold' ? 'bg-sky-100 text-sky-700'
                                              : 'bg-amber-100 text-amber-700'
                              }`}>
                                {CATEGORY_THEME[cat].icon} {CATEGORY_LABELS[cat]}
                              </span>
                            </div>
                            {/* علامة «صنف بديل» — ينتقل لجدول الأصناف البديلة في أمر التشغيل */}
                            <button
                              type="button"
                              onClick={() => setFixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, isAlternative: !e.isAlternative } : e))}
                              title={entry.isAlternative
                                ? 'مُحتسب مع الأصناف البديلة في أمر التشغيل — اضغط لإرجاعه للأصناف اليومية الثابتة'
                                : 'اضغط لتعليمه كصنف بديل — ينتقل لجدول الأصناف البديلة في أمر التشغيل'}
                              className={`font-bold px-2 py-0.5 rounded border transition-colors ${
                                entry.isAlternative
                                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                                  : 'bg-white border-dashed border-slate-300 text-slate-400 hover:border-emerald-400 hover:text-emerald-600'
                              }`}
                            >
                              {entry.isAlternative ? '✓ صنف بديل' : 'صنف بديل'}
                            </button>
                            <div className="flex items-center gap-1.5 mr-auto">
                              <span>الكمية:</span>
                              <button type="button" onClick={() => setFixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, qty: Math.max(1, e.qty - 1) } : e))} className="w-6 h-6 rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 font-bold">−</button>
                              <span className="w-7 text-center font-bold text-sm">{entry.qty}</span>
                              <button type="button" onClick={() => setFixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, qty: Math.min(99, e.qty + 1) } : e))} className="w-6 h-6 rounded bg-white border border-slate-200 text-slate-500 hover:bg-slate-100 font-bold">+</button>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-xs font-bold text-slate-500">الأيام <span className="text-red-500">*</span></span>
                              <button
                                type="button"
                                onClick={() => setFixedEntries(prev => prev.map((e, i) => i === idx
                                  ? { ...e, days: e.days.size === 7 ? new Set<number>() : new Set<number>(DAYS_ORDER) }
                                  : e))}
                                className="text-xs font-semibold text-emerald-700 hover:underline"
                              >
                                {entry.days.size === 7 ? 'إلغاء الكل' : 'كل الأيام'}
                              </button>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {DAYS_ORDER.map(d => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setFixedEntries(prev => prev.map((e, i) => {
                                    if (i !== idx) return e;
                                    const next = new Set(e.days);
                                    if (next.has(d)) next.delete(d); else next.add(d);
                                    return { ...e, days: next };
                                  }))}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                    entry.days.has(d) ? 'bg-emerald-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                  }`}
                                >
                                  {DAY_LABELS[d]}
                                </button>
                              ))}
                            </div>
                          </div>
                          {/* Suppress if meal present */}
                          <div className="pt-1 border-t border-slate-100">
                            <div className="flex items-center flex-wrap gap-1.5">
                              <span className="text-xs text-slate-400 whitespace-nowrap shrink-0">يُلغى إذا وُجد:</span>
                              {entry.suppressIfMealIds.map(sid => {
                                const sm = meals.find(m => m.id === sid);
                                return sm ? (
                                  <div key={sid} className="flex items-center gap-1 bg-orange-50 border border-orange-200 text-orange-700 rounded-lg px-2 py-0.5 text-xs font-medium">
                                    <span>{sm.name}</span>
                                    <button type="button" onClick={() => setFixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, suppressIfMealIds: e.suppressIfMealIds.filter(id => id !== sid) } : e))} className="text-slate-300 hover:text-red-500 leading-none font-bold">✕</button>
                                  </div>
                                ) : null;
                              })}
                              <MealSearchPicker
                                meals={meals.filter(m => !entry.suppressIfMealIds.includes(m.id))}
                                value=""
                                onChange={id => { if (id) setFixedEntries(prev => prev.map((e, i) => i === idx ? { ...e, suppressIfMealIds: [...e.suppressIfMealIds, id] } : e)); }}
                                placeholder="+ إضافة..."
                                allowClear={false}
                              />
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setFixedEntries(prev => [...prev, { mealId: '', days: new Set<number>(), qty: 1, category: 'hot' as ItemCategory, suppressIfMealIds: [], isAlternative: false }])}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> إضافة صنف ثابت آخر
              </button>
              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed">
                💡 لو الشخص عنده أي من هذه الأصناف ثابتاً في يوم من الأيام المختارة، تتحدّث الكمية والتصنيف وعلامة البديل فقط. باقي أصنافه الثابتة لا تتأثر.
              </div>
            </div>
          )}

          {/* Cancel whole meals form */}
          {mode === 'cancelMeals' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1">
                {([
                  { a: 'cancel',  label: 'إلغاء الأصناف' },
                  { a: 'restore', label: 'إرجاعها' },
                ] as const).map(({ a, label }) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => { setCancelAction(a); setResult(null); }}
                    className={`py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                      cancelAction === a
                        ? a === 'cancel' ? 'bg-white text-red-700 shadow-sm' : 'bg-white text-emerald-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 mb-1.5">الوجبات <span className="text-red-500">*</span></p>
                <div className="grid grid-cols-3 gap-2">
                  {MEAL_TYPES_ORDER.map(t => {
                    const on = cancelTypes.has(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setCancelTypes(prev => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t); else next.add(t);
                          return next;
                        })}
                        className={`py-2 rounded-lg border-2 text-sm font-semibold transition-colors ${
                          on ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        {on ? '✓ ' : ''}{MEAL_TYPE_LABELS[t]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 mb-1.5">وش ينلغي؟</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(CANCEL_SCOPE_LABELS) as CancelScope[]).map(sc => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setCancelScope(sc)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        cancelScope === sc ? 'bg-slate-700 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {CANCEL_SCOPE_LABELS[sc]}
                    </button>
                  ))}
                </div>
              </div>

              {cancelAction === 'cancel' && (
                <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={cancelFixedToo}
                    onChange={e => setCancelFixedToo(e.target.checked)}
                    className="w-4 h-4 mt-0.5 accent-slate-700"
                  />
                  <span>
                    احذف كمان <span className="font-semibold">أصنافهم الثابتة</span> في هذي الوجبات
                    <span className="block text-slate-400">بدونها الأصناف الثابتة تظل تنضاف فوق المنيو</span>
                  </span>
                </label>
              )}

              {cancelTypes.size > 0 && (
                <div className="border border-slate-200 rounded-lg px-3 py-2 bg-slate-50/60">
                  <p className="text-xs font-semibold text-slate-700">
                    يشمل {cancelTargetMeals.length} صنف — {cancelSummary}
                  </p>
                  {cancelTargetMeals.length > 0 && (
                    <p className="text-[11px] text-slate-400 mt-1 leading-relaxed line-clamp-2">
                      {cancelTargetMeals.map(m => m.name).join('، ')}
                    </p>
                  )}
                </div>
              )}

              <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed border ${
                cancelAction === 'cancel' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}>
                {cancelAction === 'cancel'
                  ? '💡 كل صنف من هذي الأصناف ينضاف كمحظور بلا بديل للمختارين، فما ينحسب لهم في أوامر التشغيل والستيكرات والتقارير، ويظهر في تبويب المحظورات لكل واحد. لو عنده بديل لصنف منها، يُلغى البديل. ⚠️ الأصناف اللي تنضاف لاحقاً للنظام ما تنلغي تلقائياً — طبّق مرة ثانية بعد إضافتها.'
                  : '💡 يشيل الحظر «بلا بديل» عن هذي الأصناف للمختارين فترجع تنحسب لهم. المحظورات اللي لها بديل أو جاية من نظام غذائي ما تتأثر. الأصناف الثابتة المحذوفة ما ترجع تلقائياً.'}
              </div>
            </div>
          )}

          {/* Apply button */}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canApply || applying}
            className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${
              canApply && !applying
                ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          >
            {applying
              ? 'جاري التطبيق...'
              : selectedIds.size === 0
                ? 'حدد الأشخاص أولاً'
                : !canApply
                  ? 'أكمل تفاصيل التخصيص'
                  : `تطبيق على ${selectedIds.size} ${entityLabel}${selectedIds.size === 1 ? '' : 'اً'}`}
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="تأكيد التخصيص الجماعي"
        message={confirmMessage}
        confirmLabel="نعم، طبّق"
        onConfirm={handleApply}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
