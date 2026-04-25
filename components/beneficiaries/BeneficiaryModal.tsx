'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Beneficiary, Meal, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, DAY_LABELS, DAYS_ORDER } from '@/lib/types';

interface Props {
  beneficiary: Beneficiary | null;
  meals: Meal[];
  onClose: () => void;
  onSaved: () => void;
}

type Tab = 'info' | 'exclusions' | 'fixed';

interface ExclusionEntry {
  meal_id: string;
  alternative_meal_id: string;
}

type FixedEntry = { meal_id: string; meal_type: MealType; days: Set<number>; quantity: number };

function buildFixedEntries(fixedMeals: Beneficiary['fixed_meals']): FixedEntry[] {
  const map: Record<string, FixedEntry> = {};
  for (const fm of fixedMeals ?? []) {
    const key = `${fm.meal_id}_${fm.meal_type}`;
    if (!map[key]) map[key] = { meal_id: fm.meal_id, meal_type: fm.meal_type as MealType, days: new Set(), quantity: fm.quantity ?? 1 };
    map[key].days.add(fm.day_of_week);
  }
  return Object.values(map);
}

// ─── Searchable dropdown ────────────────────────────────────────────────────
function MealPicker({
  meals,
  placeholder,
  onSelect,
  excludeIds = [],
  customClass,
}: {
  meals: Meal[];
  placeholder: string;
  onSelect: (meal: Meal) => void;
  excludeIds?: string[];
  customClass?: string;
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

  const filtered = meals.filter(
    m => !excludeIds.includes(m.id) &&
      (m.name.includes(query) || (m.english_name ?? '').toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQuery(''); }}
        className={`flex items-center gap-1.5 px-3 py-1.5 border border-dashed rounded-lg text-xs transition-colors ${customClass ?? 'border-slate-300 text-slate-500 hover:border-emerald-400 hover:text-emerald-600'}`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {placeholder}
      </button>

      {open && (
        <div className="absolute top-full mt-1 right-0 z-50 bg-white border border-slate-200 rounded-xl shadow-lg w-56 overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="بحث..."
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-400"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">لا توجد نتائج</p>
            ) : (
              filtered.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onSelect(m); setOpen(false); setQuery(''); }}
                  className="w-full text-right px-3 py-2 text-sm hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
                >
                  {m.name}
                  {m.is_snack && <span className="text-xs text-amber-500 mr-1">(سناك)</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Meal type exclusion section ────────────────────────────────────────────
type SectionColorKey = 'amber' | 'amber-snack' | 'emerald' | 'emerald-snack' | 'blue' | 'blue-snack';

const SECTION_STYLES: Record<SectionColorKey, { header: string; badge: string; chip: string; addBtn: string; dot: string }> = {
  'amber':        { header: 'bg-amber-50 border-amber-200',      badge: 'bg-amber-100 text-amber-700',    chip: 'bg-amber-50 border-amber-200 text-amber-800',    addBtn: 'text-amber-600 hover:bg-amber-100 border-amber-300',    dot: 'bg-amber-400' },
  'amber-snack':  { header: 'bg-orange-50 border-orange-200',    badge: 'bg-orange-100 text-orange-700',  chip: 'bg-orange-50 border-orange-200 text-orange-800',  addBtn: 'text-orange-500 hover:bg-orange-100 border-orange-300', dot: 'bg-orange-300' },
  'emerald':      { header: 'bg-emerald-50 border-emerald-200',  badge: 'bg-emerald-100 text-emerald-700',chip: 'bg-emerald-50 border-emerald-200 text-emerald-800',addBtn: 'text-emerald-600 hover:bg-emerald-100 border-emerald-300',dot: 'bg-emerald-400' },
  'emerald-snack':{ header: 'bg-teal-50 border-teal-200',        badge: 'bg-teal-100 text-teal-700',      chip: 'bg-teal-50 border-teal-200 text-teal-800',        addBtn: 'text-teal-500 hover:bg-teal-100 border-teal-300',      dot: 'bg-teal-300' },
  'blue':         { header: 'bg-blue-50 border-blue-200',        badge: 'bg-blue-100 text-blue-700',      chip: 'bg-blue-50 border-blue-200 text-blue-800',        addBtn: 'text-blue-600 hover:bg-blue-100 border-blue-300',      dot: 'bg-blue-400' },
  'blue-snack':   { header: 'bg-indigo-50 border-indigo-200',    badge: 'bg-indigo-100 text-indigo-700',  chip: 'bg-indigo-50 border-indigo-200 text-indigo-800',  addBtn: 'text-indigo-500 hover:bg-indigo-100 border-indigo-300', dot: 'bg-indigo-300' },
};

function MealTypeSection({
  label, color, items, sectionMeals, excludedIds, allMeals,
  onAdd, onRemove, onSetAlt, mealById, isSnack,
}: {
  label: string; color: SectionColorKey; isSnack?: boolean;
  items: ExclusionEntry[]; sectionMeals: Meal[]; excludedIds: string[]; allMeals: Meal[];
  onAdd: (m: Meal) => void; onRemove: (id: string) => void;
  onSetAlt: (mealId: string, altId: string) => void;
  mealById: (id: string) => Meal | undefined;
}) {
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const availableMeals = sectionMeals.filter(m => !excludedIds.includes(m.id));
  const filteredMeals = availableMeals.filter(m =>
    m.name.includes(query) || (m.english_name ?? '').toLowerCase().includes(query.toLowerCase())
  );

  const openPicker = () => { setPicking(true); setQuery(''); setTimeout(() => inputRef.current?.focus(), 50); };
  const closePicker = () => { setPicking(false); setQuery(''); };

  const s = SECTION_STYLES[color];

  return (
    <div className={isSnack ? 'mr-5 border-r-2 border-r-slate-200' : ''}>
      <div className={`border rounded-xl ${s.header}`}>
      {/* Header */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${s.header}`}>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${isSnack ? 'opacity-60' : ''}`} />
          <span className={`font-semibold text-slate-700 ${isSnack ? 'text-xs' : 'text-sm'}`}>{label}</span>
          {items.length > 0 && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.badge}`}>
              {items.length} ممنوع
            </span>
          )}
        </div>
        {!picking && availableMeals.length > 0 && (
          <button
            type="button"
            onClick={openPicker}
            className={`flex items-center gap-1 px-3 py-1.5 border border-dashed rounded-lg text-xs font-medium transition-colors ${s.addBtn}`}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            إضافة
          </button>
        )}
        {picking && (
          <button type="button" onClick={closePicker} className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1 rounded">
            إغلاق
          </button>
        )}
      </div>

      {/* Selected chips */}
      {items.length > 0 && (
        <div className="px-4 pt-3 pb-2 flex flex-wrap gap-2">
          {items.map(ex => {
            const meal = mealById(ex.meal_id);
            if (!meal) return null;
            const candidates = allMeals.filter(m => m.type === meal.type && m.is_snack === meal.is_snack && m.id !== meal.id);
            return (
              <div key={ex.meal_id} className={`flex items-center gap-1.5 border rounded-lg px-2.5 py-1.5 text-xs font-medium bg-white ${s.chip}`}>
                <button type="button" onClick={() => onRemove(ex.meal_id)}
                  className="text-slate-300 hover:text-red-500 transition-colors leading-none font-bold">✕</button>
                <span className="line-through opacity-50">{meal.name}</span>
                {candidates.length > 0 && (
                  <>
                    <span className="text-slate-300 text-base leading-none">→</span>
                    <select
                      value={ex.alternative_meal_id}
                      onChange={e => onSetAlt(ex.meal_id, e.target.value)}
                      className="text-xs bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 focus:outline-none max-w-[110px]"
                    >
                      <option value="">بلا بديل</option>
                      {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {items.length === 0 && !picking && (
        <div className="px-4 py-3 text-center text-xs text-slate-400">
          {availableMeals.length === 0 ? 'لا توجد أصناف في هذه الوجبة' : 'لا يوجد محظورات'}
        </div>
      )}

      {/* Inline picker panel */}
      {picking && (
        <div className="border-t border-slate-200 bg-white px-4 pt-3 pb-3">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="ابحث عن صنف..."
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-3"
          />
          {filteredMeals.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">لا توجد نتائج</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto">
              {filteredMeals.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onAdd(m); closePicker(); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors bg-white hover:bg-opacity-80 ${s.chip} hover:shadow-sm`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────
export default function BeneficiaryModal({ beneficiary, meals, onClose, onSaved }: Props) {
  const [name, setName] = useState(beneficiary?.name ?? '');
  const [englishName, setEnglishName] = useState(beneficiary?.english_name ?? '');
  const [code, setCode] = useState(beneficiary?.code ?? '');
  const [category, setCategory] = useState(beneficiary?.category ?? '');
  const [villa, setVilla] = useState(beneficiary?.villa ?? '');
  const [dietType, setDietType] = useState(beneficiary?.diet_type ?? '');
  const [notes, setNotes] = useState(beneficiary?.notes ?? '');

  const [exclusions, setExclusions] = useState<ExclusionEntry[]>(
    beneficiary?.exclusions?.map(e => ({
      meal_id: e.meal_id,
      alternative_meal_id: e.alternative_meal_id ?? '',
    })) ?? []
  );

  const [fixedEntries, setFixedEntries] = useState<FixedEntry[]>(
    buildFixedEntries(beneficiary?.fixed_meals)
  );

  // For adding new fixed meal
  const [addingFixed, setAddingFixed] = useState(false);
  const [newFixedMealType, setNewFixedMealType] = useState<MealType>('breakfast');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const supabase = useMemo(() => createClient(), []);

  const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

  // exclusion helpers
  const addExclusion = (meal: Meal) => {
    if (!exclusions.find(e => e.meal_id === meal.id))
      setExclusions(prev => [...prev, { meal_id: meal.id, alternative_meal_id: '' }]);
  };
  const removeExclusion = (mealId: string) => setExclusions(prev => prev.filter(e => e.meal_id !== mealId));
  const setAlt = (mealId: string, altId: string) =>
    setExclusions(prev => prev.map(e => e.meal_id === mealId ? { ...e, alternative_meal_id: altId } : e));

  // fixed helpers
  const addFixedMeal = (meal: Meal) => {
    const key = `${meal.id}_${newFixedMealType}`;
    const exists = fixedEntries.find(fe => fe.meal_id === meal.id && fe.meal_type === newFixedMealType);
    if (!exists)
      setFixedEntries(prev => [...prev, { meal_id: meal.id, meal_type: newFixedMealType, days: new Set(), quantity: 1 }]);
    setAddingFixed(false);
  };
  const removeFixedEntry = (meal_id: string, meal_type: MealType) =>
    setFixedEntries(prev => prev.filter(fe => !(fe.meal_id === meal_id && fe.meal_type === meal_type)));
  const setFixedEntryQty = (meal_id: string, meal_type: MealType, quantity: number) =>
    setFixedEntries(prev => prev.map(fe =>
      fe.meal_id === meal_id && fe.meal_type === meal_type ? { ...fe, quantity } : fe
    ));
  const toggleDay = (meal_id: string, meal_type: MealType, day: number) =>
    setFixedEntries(prev => prev.map(fe => {
      if (fe.meal_id !== meal_id || fe.meal_type !== meal_type) return fe;
      const days = new Set(fe.days);
      days.has(day) ? days.delete(day) : days.add(day);
      return { ...fe, days };
    }));
  const toggleAllDays = (meal_id: string, meal_type: MealType) =>
    setFixedEntries(prev => prev.map(fe => {
      if (fe.meal_id !== meal_id || fe.meal_type !== meal_type) return fe;
      const days = fe.days.size === 7 ? new Set<number>() : new Set<number>(DAYS_ORDER);
      return { ...fe, days };
    }));

  const mealById = (id: string) => meals.find(m => m.id === id);
  const excludedMealIds = exclusions.map(e => e.meal_id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) { setError('الاسم والكود مطلوبان'); return; }
    setSaving(true); setError('');

    const payload = {
      name: name.trim(), english_name: englishName.trim() || null,
      code: code.trim(), category: category.trim(),
      villa: villa.trim() || null, diet_type: dietType.trim() || null,
      notes: notes.trim() || null,
    };

    const friendlyError = (msg: string) => {
      const m = msg.toLowerCase();
      if (m.includes('beneficiaries_code_key') || (m.includes('unique') && m.includes('code'))) {
        return `الكود "${payload.code}" مستخدم مسبقاً لمستفيد آخر — استخدم كود مختلف`;
      }
      if (m.includes('unique') || m.includes('duplicate key')) {
        return 'البيانات المدخلة مكررة — تحقق من الكود أو الاسم';
      }
      return msg;
    };

    try {
      let beneficiaryId = beneficiary?.id;
      const isEdit = !!beneficiary;
      if (beneficiary) {
        const { error } = await supabase.from('beneficiaries').update(payload).eq('id', beneficiary.id);
        if (error) { setError(friendlyError(error.message)); setSaving(false); return; }
      } else {
        const { data, error } = await supabase.from('beneficiaries').insert(payload).select().single();
        if (error) { setError(friendlyError(error.message)); setSaving(false); return; }
        beneficiaryId = data.id;
      }

      await supabase.from('exclusions').delete().eq('beneficiary_id', beneficiaryId);
      if (exclusions.length > 0)
        await supabase.from('exclusions').insert(
          exclusions.map(ex => ({ beneficiary_id: beneficiaryId, meal_id: ex.meal_id, alternative_meal_id: ex.alternative_meal_id || null }))
        );

      await supabase.from('beneficiary_fixed_meals').delete().eq('beneficiary_id', beneficiaryId);
      const fixedRows = fixedEntries.flatMap(fe =>
        Array.from(fe.days).map(day => ({
          beneficiary_id: beneficiaryId,
          day_of_week: day,
          meal_type: fe.meal_type,
          meal_id: fe.meal_id,
          quantity: fe.quantity,
        }))
      );
      if (fixedRows.length > 0) await supabase.from('beneficiary_fixed_meals').insert(fixedRows);

      void logActivity({
        action: isEdit ? 'update' : 'create',
        entity_type: 'beneficiary',
        entity_id: beneficiaryId,
        entity_name: payload.name,
        details: {
          code: payload.code,
          category: payload.category,
          villa: payload.villa,
          exclusions_count: exclusions.length,
          fixed_meals_count: fixedRows.length,
        },
      });

      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Failed to fetch') || msg.includes('fetch')) {
        setError('تعذّر الاتصال بالخادم — تأكد من اتصالك بالإنترنت أو أعد المحاولة لاحقاً');
      } else {
        setError(msg);
      }
      setSaving(false);
    }
  };

  const totalFixed = fixedEntries.reduce((s, fe) => s + fe.days.size, 0);
  const tabLabels: Record<Tab, string> = {
    info: 'البيانات',
    exclusions: `المحظورات${exclusions.length ? ` (${exclusions.length})` : ''}`,
    fixed: `الثابتة الأسبوعية${totalFixed ? ` (${totalFixed})` : ''}`,
  };

  // Group exclusions by section
  const exclBySection = {
    breakfast:       exclusions.filter(ex => mealById(ex.meal_id)?.type === 'breakfast' && !mealById(ex.meal_id)?.is_snack),
    breakfastSnack:  exclusions.filter(ex => mealById(ex.meal_id)?.type === 'breakfast' &&  mealById(ex.meal_id)?.is_snack),
    lunch:           exclusions.filter(ex => mealById(ex.meal_id)?.type === 'lunch'     && !mealById(ex.meal_id)?.is_snack),
    lunchSnack:      exclusions.filter(ex => mealById(ex.meal_id)?.type === 'lunch'     &&  mealById(ex.meal_id)?.is_snack),
    dinner:          exclusions.filter(ex => mealById(ex.meal_id)?.type === 'dinner'    && !mealById(ex.meal_id)?.is_snack),
    dinnerSnack:     exclusions.filter(ex => mealById(ex.meal_id)?.type === 'dinner'    &&  mealById(ex.meal_id)?.is_snack),
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[93vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">
            {beneficiary ? 'تعديل مستفيد' : 'إضافة مستفيد جديد'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="flex border-b border-slate-100 px-4">
          {(['info', 'exclusions', 'fixed'] as Tab[]).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors ${activeTab === tab ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {tabLabels[tab]}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">

          {/* ── Tab: Info ── */}
          {activeTab === 'info' && (
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">الاسم (عربي) *</label>
                  <input value={name} onChange={e => setName(e.target.value)} className="input-field" placeholder="الاسم الكامل" /></div>
                <div><label className="label">الاسم (إنجليزي)</label>
                  <input value={englishName} onChange={e => setEnglishName(e.target.value)} className="input-field" placeholder="Full Name" dir="ltr" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">رقم الكود *</label>
                  <input value={code} onChange={e => setCode(e.target.value)} className="input-field" placeholder="BEN-001" /></div>
                <div><label className="label">رقم الفيلا</label>
                  <input value={villa} onChange={e => setVilla(e.target.value)} className="input-field" placeholder="42" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">الفئة</label>
                  <input value={category} onChange={e => setCategory(e.target.value)} className="input-field" placeholder="موظف، طالب..." /></div>
                <div><label className="label">النظام الغذائي</label>
                  <input value={dietType} onChange={e => setDietType(e.target.value)} className="input-field" placeholder="نباتي، خالٍ من الغلوتين..." /></div>
              </div>
              <div><label className="label">ملاحظات</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input-field h-20 resize-none" placeholder="أي ملاحظات إضافية..." /></div>
            </div>
          )}

          {/* ── Tab: Exclusions ── */}
          {activeTab === 'exclusions' && (
            <div className="p-5 space-y-3">
              {/* Summary bar */}
              {exclusions.length > 0 && (
                <div className="flex flex-wrap gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5">
                  <span className="text-xs text-slate-500 font-medium ml-1">المحظورات:</span>
                  {exclusions.map(ex => {
                    const m = mealById(ex.meal_id);
                    if (!m) return null;
                    return (
                      <span key={ex.meal_id} className="text-xs bg-red-50 border border-red-200 text-red-600 px-2 py-0.5 rounded-full font-medium">
                        {m.name}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* الفطور */}
              <MealTypeSection
                label="الفطور"
                color="amber"
                items={exclBySection.breakfast}
                sectionMeals={meals.filter(m => m.type === 'breakfast' && !m.is_snack)}
                excludedIds={excludedMealIds}
                allMeals={meals}
                onAdd={addExclusion}
                onRemove={removeExclusion}
                onSetAlt={setAlt}
                mealById={mealById}
              />
              <MealTypeSection
                label="سناكات الفطور"
                color="amber-snack"
                isSnack
                items={exclBySection.breakfastSnack}
                sectionMeals={meals.filter(m => m.type === 'breakfast' && m.is_snack)}
                excludedIds={excludedMealIds}
                allMeals={meals}
                onAdd={addExclusion}
                onRemove={removeExclusion}
                onSetAlt={setAlt}
                mealById={mealById}
              />

              {/* الغداء */}
              <MealTypeSection
                label="الغداء"
                color="emerald"
                items={exclBySection.lunch}
                sectionMeals={meals.filter(m => m.type === 'lunch' && !m.is_snack)}
                excludedIds={excludedMealIds}
                allMeals={meals}
                onAdd={addExclusion}
                onRemove={removeExclusion}
                onSetAlt={setAlt}
                mealById={mealById}
              />
              <MealTypeSection
                label="سناكات الغداء"
                color="emerald-snack"
                isSnack
                items={exclBySection.lunchSnack}
                sectionMeals={meals.filter(m => m.type === 'lunch' && m.is_snack)}
                excludedIds={excludedMealIds}
                allMeals={meals}
                onAdd={addExclusion}
                onRemove={removeExclusion}
                onSetAlt={setAlt}
                mealById={mealById}
              />

              {/* العشاء */}
              <MealTypeSection
                label="العشاء"
                color="blue"
                items={exclBySection.dinner}
                sectionMeals={meals.filter(m => m.type === 'dinner' && !m.is_snack)}
                excludedIds={excludedMealIds}
                allMeals={meals}
                onAdd={addExclusion}
                onRemove={removeExclusion}
                onSetAlt={setAlt}
                mealById={mealById}
              />
              <MealTypeSection
                label="سناكات العشاء"
                color="blue-snack"
                isSnack
                items={exclBySection.dinnerSnack}
                sectionMeals={meals.filter(m => m.type === 'dinner' && m.is_snack)}
                excludedIds={excludedMealIds}
                allMeals={meals}
                onAdd={addExclusion}
                onRemove={removeExclusion}
                onSetAlt={setAlt}
                mealById={mealById}
              />
            </div>
          )}

          {/* ── Tab: Fixed Weekly ── */}
          {activeTab === 'fixed' && (
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">أضف صنف ثابت واختر الوجبة ثم حدّد الأيام.</p>
                {/* Add button */}
                <div className="flex items-center gap-2">
                  {addingFixed ? (
                    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                      <select
                        value={newFixedMealType}
                        onChange={e => setNewFixedMealType(e.target.value as MealType)}
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                      >
                        {MEAL_TYPES.map(t => <option key={t} value={t}>{MEAL_TYPE_LABELS[t]}</option>)}
                        <option value="snack">سناك</option>
                      </select>
                      <MealPicker
                        meals={meals.filter(m => newFixedMealType === ('snack' as string) ? m.is_snack : (m.type === newFixedMealType && !m.is_snack))}
                        placeholder="اختر صنف"
                        onSelect={addFixedMeal}
                        excludeIds={fixedEntries.filter(fe => fe.meal_type === newFixedMealType).map(fe => fe.meal_id)}
                      />
                      <button type="button" onClick={() => setAddingFixed(false)} className="text-slate-400 hover:text-slate-600 text-xs">إلغاء</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingFixed(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      إضافة صنف ثابت
                    </button>
                  )}
                </div>
              </div>

              {fixedEntries.length === 0 ? (
                <div className="border border-dashed border-slate-200 rounded-xl py-10 text-center text-slate-400 text-sm">
                  لا توجد أصناف ثابتة — اضغط &quot;إضافة صنف ثابت&quot;
                </div>
              ) : (
                <div className="space-y-3">
                  {fixedEntries.map(fe => {
                    const meal = mealById(fe.meal_id);
                    if (!meal) return null;
                    const isSnackEntry = meal.is_snack;
                    const labelColor = isSnackEntry ? 'text-purple-700 bg-purple-50' : {
                      breakfast: 'text-amber-700 bg-amber-50',
                      lunch: 'text-emerald-700 bg-emerald-50',
                      dinner: 'text-blue-700 bg-blue-50',
                    }[fe.meal_type] ?? 'text-slate-700 bg-slate-50';

                    return (
                      <div key={`${fe.meal_id}_${fe.meal_type}`} className="border border-slate-200 rounded-xl overflow-hidden">
                        {/* Meal header */}
                        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-slate-800">{meal.name}</span>
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${labelColor}`}>
                              {isSnackEntry ? 'سناك' : MEAL_TYPE_LABELS[fe.meal_type]}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">{fe.days.size} يوم</span>
                            {/* Quantity control */}
                            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-1.5 py-0.5">
                              <button type="button"
                                onClick={() => setFixedEntryQty(fe.meal_id, fe.meal_type, Math.max(1, fe.quantity - 1))}
                                className="w-4 h-4 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-sm font-bold leading-none">−</button>
                              <span className="text-xs font-bold text-slate-700 min-w-[1.25rem] text-center">{fe.quantity}</span>
                              <button type="button"
                                onClick={() => setFixedEntryQty(fe.meal_id, fe.meal_type, Math.min(99, fe.quantity + 1))}
                                className="w-4 h-4 flex items-center justify-center rounded text-slate-500 hover:bg-slate-100 text-sm font-bold leading-none">+</button>
                            </div>
                            <button type="button" onClick={() => toggleAllDays(fe.meal_id, fe.meal_type)}
                              className="text-xs text-emerald-600 hover:text-emerald-800 font-semibold px-2 py-0.5 rounded hover:bg-emerald-50 transition-colors">
                              {fe.days.size === 7 ? 'إلغاء الكل' : 'كل الأيام'}
                            </button>
                            <button type="button" onClick={() => removeFixedEntry(fe.meal_id, fe.meal_type)}
                              className="text-slate-300 hover:text-red-500 transition-colors">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                        {/* Days selector */}
                        <div className="flex flex-wrap gap-2 px-4 py-3">
                          {DAYS_ORDER.map(day => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => toggleDay(fe.meal_id, fe.meal_type, day)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                fe.days.has(day)
                                  ? 'bg-emerald-500 text-white shadow-sm'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                            >
                              {DAY_LABELS[day]}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mx-6 mb-2 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
          )}

          <div className="flex gap-3 px-6 pb-6 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? 'جاري الحفظ...' : beneficiary ? 'حفظ التعديلات' : 'إضافة المستفيد'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
