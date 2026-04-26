'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Beneficiary, Meal, ItemCategory, EntityType } from '@/lib/types';
import {
  MEAL_TYPE_LABELS,
  DAY_LABELS,
  DAYS_ORDER,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_LABELS_PLURAL,
  ENTITY_BADGE_STYLES,
} from '@/lib/types';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

interface Props {
  entityType: EntityType;
}

type Mode = 'exclusion' | 'fixed';

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
  const supabase = useMemo(() => createClient(), []);

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
  // Exclusion
  const [exclMealId, setExclMealId] = useState('');
  const [exclAltId, setExclAltId] = useState(''); // empty = no alternative
  // Fixed
  const [fixMealId, setFixMealId] = useState('');
  const [fixDays, setFixDays] = useState<Set<number>>(new Set());
  const [fixQty, setFixQty] = useState(1);
  const [fixCategory, setFixCategory] = useState<ItemCategory>('hot');

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
      const fetchMeals = async (withEntity: boolean) => {
        const q = supabase
          .from('meals')
          .select('id, name, english_name, type, is_snack, created_at')
          .order('type').order('is_snack').order('name');
        return withEntity ? q.eq('entity_type', entityType) : q;
      };
      let mealsRes = await fetchMeals(true);
      if (mealsRes.error && /entity_type|column/i.test(mealsRes.error.message)) {
        mealsRes = await fetchMeals(false);
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

  // ── Day toggles for fixed meal ─────────────────────────────────────────────
  const toggleDay = (d: number) => {
    setFixDays(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };
  const toggleAllDays = () => {
    setFixDays(prev => prev.size === 7 ? new Set<number>() : new Set<number>(DAYS_ORDER));
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  const canApply = useMemo(() => {
    if (selectedIds.size === 0) return false;
    if (mode === 'exclusion') return !!exclMealId;
    if (mode === 'fixed')     return !!fixMealId && fixDays.size > 0 && fixQty > 0;
    return false;
  }, [selectedIds.size, mode, exclMealId, fixMealId, fixDays.size, fixQty]);

  // Used for both confirmation message + apply log
  const exclMeal   = useMemo(() => meals.find(m => m.id === exclMealId), [meals, exclMealId]);
  const exclAlt    = useMemo(() => meals.find(m => m.id === exclAltId),  [meals, exclAltId]);
  const fixMeal    = useMemo(() => meals.find(m => m.id === fixMealId),  [meals, fixMealId]);

  // عند اختيار صنف ثابت، نقترح التصنيف تلقائياً:
  //   - الصنف من فئة سناك → "سناك"
  //   - عدا ذلك → "حار" (المستخدم ممكن يغيّره يدوياً لـ"بارد")
  // المستخدم يقدر يعدّل الاختيار يدوياً بعد الاقتراح.
  const lastAutoMealRef = useRef<string | null>(null);
  useEffect(() => {
    if (!fixMeal) { lastAutoMealRef.current = null; return; }
    if (lastAutoMealRef.current === fixMeal.id) return;
    lastAutoMealRef.current = fixMeal.id;
    setFixCategory(fixMeal.is_snack ? 'snack' : 'hot');
  }, [fixMeal]);

  const confirmMessage = useMemo(() => {
    const target = `${selectedIds.size} ${entityLabel}${selectedIds.size === 1 ? '' : 'اً'}`;
    if (mode === 'exclusion') {
      const altPart = exclAlt ? ` مع البديل "${exclAlt.name}"` : ' بدون بديل';
      return `سيتم استبعاد "${exclMeal?.name ?? ''}"${altPart} لـ${target}. لو الشخص عنده محظور لنفس الصنف ببديل مختلف، سيُستبدل بهذا التخصيص. متابعة؟`;
    }
    return `سيتم تثبيت الصنف "${fixMeal?.name ?? ''}" بكمية ${fixQty} في ${fixDays.size} يوم لـ${target}. لو الشخص عنده نفس الصنف الثابت في يوم من نفس الأيام، ستُحدَّث الكمية والتصنيف فقط؛ باقي أصنافه ما تتغيّر. متابعة؟`;
  }, [mode, selectedIds.size, entityLabel, exclMeal, exclAlt, fixMeal, fixQty, fixDays.size]);

  // ── Apply ──────────────────────────────────────────────────────────────────
  const handleApply = async () => {
    setApplying(true);
    setResult(null);
    try {
      const ids = Array.from(selectedIds);

      if (mode === 'exclusion') {
        // Upsert على (beneficiary_id, meal_id) — يضيف للي ما عنده،
        // ويحدّث alternative_meal_id للي عنده الصنف بالفعل.
        // بقية محظوراته وأصنافه الثابتة ما تتأثر.
        const rows = ids.map(bid => ({
          beneficiary_id: bid,
          meal_id: exclMealId,
          alternative_meal_id: exclAltId || null,
        }));
        const { error } = await supabase
          .from('exclusions')
          .upsert(rows, { onConflict: 'beneficiary_id,meal_id' });
        if (error) throw error;

        void logActivity({
          action: 'create',
          entity_type: entityType,
          entity_name: `تخصيص جماعي — استبعاد "${exclMeal?.name ?? ''}"${exclAlt ? ` ببديل "${exclAlt.name}"` : ' بدون بديل'} (${ids.length})`,
          details: {
            scope: 'bulk_exclusion',
            count: ids.length,
            meal_id: exclMealId,
            meal_name: exclMeal?.name,
            alternative_meal_id: exclAltId || null,
            alternative_meal_name: exclAlt?.name ?? null,
            for_entity: entityType,
            beneficiary_ids: ids,
          },
        });

        setResult({
          ok: true,
          message: `تم التطبيق على ${ids.length} ${entityLabel}${ids.length === 1 ? '' : 'اً'}.`,
        });
        // Keep selection so user can apply another customization to the same group;
        // only reset the customization fields.
        setExclMealId('');
        setExclAltId('');
      } else {
        // Fixed meal — لكل (beneficiary, day) موجود نحدّث، وإلا ندرج جديد.
        // ما نحذف أي شيء آخر.
        if (!fixMeal) throw new Error('الصنف غير موجود');
        const mealType = fixMeal.type;
        const days = Array.from(fixDays);

        const existingRes = await supabase
          .from('beneficiary_fixed_meals')
          .select('id, beneficiary_id, day_of_week')
          .in('beneficiary_id', ids)
          .in('day_of_week', days)
          .eq('meal_id', fixMealId)
          .eq('meal_type', mealType);
        if (existingRes.error) throw existingRes.error;

        const existing = (existingRes.data ?? []) as Array<{ id: string; beneficiary_id: string; day_of_week: number }>;
        const existingKeys = new Set(existing.map(r => `${r.beneficiary_id}|${r.day_of_week}`));
        const existingIds = existing.map(r => r.id);

        // Update existing rows — quantity/category may change.
        if (existingIds.length > 0) {
          const { error: upErr } = await supabase
            .from('beneficiary_fixed_meals')
            .update({ quantity: fixQty, category: fixCategory })
            .in('id', existingIds);
          if (upErr) {
            // Migration not applied — fall back to updating quantity only.
            if (/category|column/i.test(upErr.message)) {
              const { error: upErr2 } = await supabase
                .from('beneficiary_fixed_meals')
                .update({ quantity: fixQty })
                .in('id', existingIds);
              if (upErr2) throw upErr2;
            } else {
              throw upErr;
            }
          }
        }

        // Insert missing combos
        const newRows: Record<string, unknown>[] = [];
        for (const bid of ids) {
          for (const day of days) {
            if (!existingKeys.has(`${bid}|${day}`)) {
              newRows.push({
                beneficiary_id: bid,
                day_of_week: day,
                meal_type: mealType,
                meal_id: fixMealId,
                quantity: fixQty,
                category: fixCategory,
              });
            }
          }
        }
        if (newRows.length > 0) {
          const { error: insErr } = await supabase.from('beneficiary_fixed_meals').insert(newRows);
          if (insErr) {
            if (/category|column/i.test(insErr.message)) {
              const fallback = newRows.map(({ category: _omit, ...rest }) => rest);
              const { error: insErr2 } = await supabase.from('beneficiary_fixed_meals').insert(fallback);
              if (insErr2) throw insErr2;
            } else {
              throw insErr;
            }
          }
        }

        void logActivity({
          action: 'create',
          entity_type: entityType,
          entity_name: `تخصيص جماعي — صنف ثابت "${fixMeal.name}" (${ids.length} × ${days.length} يوم)`,
          details: {
            scope: 'bulk_fixed_meal',
            count: ids.length,
            meal_id: fixMealId,
            meal_name: fixMeal.name,
            days,
            quantity: fixQty,
            category: fixCategory,
            for_entity: entityType,
            updated: existingIds.length,
            inserted: newRows.length,
            beneficiary_ids: ids,
          },
        });

        setResult({
          ok: true,
          message:
            `تم التطبيق على ${ids.length} ${entityLabel}${ids.length === 1 ? '' : 'اً'} ` +
            `(${newRows.length} إضافة، ${existingIds.length} تحديث).`,
        });
        // Reset only the customization, keep selection.
        setFixMealId('');
        setFixDays(new Set());
        setFixQty(1);
        setFixCategory('hot');
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
            {(['exclusion', 'fixed'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setResult(null); }}
                className={`py-2.5 rounded-xl border-2 font-semibold text-sm transition-all ${
                  mode === m
                    ? (m === 'exclusion'
                        ? 'border-red-500 bg-red-50 text-red-700'
                        : 'border-emerald-500 bg-emerald-50 text-emerald-700')
                    : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {m === 'exclusion' ? 'إضافة محظور' : 'إضافة صنف ثابت'}
              </button>
            ))}
          </div>

          {/* Exclusion form */}
          {mode === 'exclusion' && (
            <div className="space-y-3">
              <div>
                <label className="label">الصنف المحظور <span className="text-red-500">*</span></label>
                <MealSearchPicker
                  meals={meals}
                  value={exclMealId}
                  onChange={setExclMealId}
                  placeholder="اختر الصنف الذي سيُستبعد"
                />
              </div>

              <div>
                <label className="label">البديل (اختياري)</label>
                <MealSearchPicker
                  meals={
                    // البديل من نفس نوع الوجبة وحالة السناك
                    exclMeal
                      ? meals.filter(m => m.type === exclMeal.type && m.is_snack === exclMeal.is_snack && m.id !== exclMeal.id)
                      : []
                  }
                  value={exclAltId}
                  onChange={setExclAltId}
                  placeholder={exclMeal ? 'اختر بديلاً (أو اتركه فارغاً)' : 'اختر الصنف المحظور أولاً'}
                  allowClear
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  لو ما اخترت بديل، الشخص يتم استبعاد الصنف عنده فقط بدون استبدال.
                </p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed">
                💡 سياسة عدم اللمس: لو الشخص أصلاً عنده هذا الصنف محظور بنفس البديل — يُترك كما هو.
                لو محظور ببديل مختلف (أو بدون بديل) — يُحدَّث للبديل الجديد فقط. باقي محظوراته وأصنافه الثابتة لا تتغيّر.
              </div>
            </div>
          )}

          {/* Fixed meal form */}
          {mode === 'fixed' && (
            <div className="space-y-3">
              <div>
                <label className="label">الصنف الثابت <span className="text-red-500">*</span></label>
                <MealSearchPicker
                  meals={meals}
                  value={fixMealId}
                  onChange={setFixMealId}
                  placeholder="اختر الصنف الذي سيتكرر"
                />
              </div>

              {/* Category — صف مستقل وبارز عشان المستخدم يضبطه قبل ما يطبّق */}
              <div>
                <label className="label flex items-center gap-2">
                  التصنيف <span className="text-red-500">*</span>
                  <span className="text-[11px] font-normal text-slate-400">— يحدّد الكيس في الستيكرات</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {CATEGORY_ORDER.map(cat => {
                    const t = CATEGORY_THEME[cat];
                    const active = fixCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFixCategory(cat)}
                        className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                          active
                            ? `${t.bg} ${t.textOn} border-transparent shadow-md scale-[1.02]`
                            : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-lg leading-none">{t.icon}</span>
                        <span>{CATEGORY_LABELS[cat]}</span>
                      </button>
                    );
                  })}
                </div>
                {fixMeal && (
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    💡 اقتُرح <span className="font-semibold text-slate-600">{CATEGORY_LABELS[fixMeal.is_snack ? 'snack' : 'hot']}</span>{' '}
                    تلقائياً بناءً على نوع الصنف. غيّره لو تبي.
                  </p>
                )}
              </div>

              {/* Quantity */}
              <div>
                <label className="label">الكمية لكل شخص</label>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 max-w-[180px]">
                  <button
                    type="button"
                    onClick={() => setFixQty(q => Math.max(1, q - 1))}
                    className="w-7 h-7 rounded text-slate-500 hover:bg-slate-100 font-bold"
                  >−</button>
                  <input
                    type="number"
                    min={1} max={99}
                    value={fixQty}
                    onChange={e => setFixQty(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))}
                    className="flex-1 text-center font-bold text-sm bg-transparent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setFixQty(q => Math.min(99, q + 1))}
                    className="w-7 h-7 rounded text-slate-500 hover:bg-slate-100 font-bold"
                  >+</button>
                </div>
              </div>

              {/* Days */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label mb-0">الأيام <span className="text-red-500">*</span></label>
                  <button
                    type="button"
                    onClick={toggleAllDays}
                    className="text-xs font-semibold text-emerald-700 hover:underline"
                  >
                    {fixDays.size === 7 ? 'إلغاء الكل' : 'كل الأيام'}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DAYS_ORDER.map(d => {
                    const active = fixDays.has(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          active
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {DAY_LABELS[d]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 leading-relaxed">
                💡 لو الشخص أصلاً عنده نفس الصنف الثابت في يوم من الأيام المختارة، تتحدّث له الكمية والتصنيف فقط.
                باقي أصنافه الثابتة في الأيام الأخرى لا تتأثر.
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
                : !((mode === 'exclusion' && exclMealId) || (mode === 'fixed' && fixMealId && fixDays.size > 0))
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
