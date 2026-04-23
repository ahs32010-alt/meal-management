'use client';

import { useState, useRef, useEffect } from 'react';
import { createClient } from '@/lib/supabase-client';
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

// fixed meals stored as: { mealId_mealType: Set<dayOfWeek> }
type FixedEntry = { meal_id: string; meal_type: MealType; days: Set<number> };

function buildFixedEntries(fixedMeals: Beneficiary['fixed_meals']): FixedEntry[] {
  const map: Record<string, FixedEntry> = {};
  for (const fm of fixedMeals ?? []) {
    const key = `${fm.meal_id}_${fm.meal_type}`;
    if (!map[key]) map[key] = { meal_id: fm.meal_id, meal_type: fm.meal_type as MealType, days: new Set() };
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
}: {
  meals: Meal[];
  placeholder: string;
  onSelect: (meal: Meal) => void;
  excludeIds?: string[];
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
        className="flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 rounded-lg text-xs text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
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

// ─── Alternative picker ─────────────────────────────────────────────────────
function AltPicker({ meal, meals, value, onChange }: {
  meal: Meal; meals: Meal[]; value: string; onChange: (v: string) => void;
}) {
  const candidates = meals.filter(m => m.type === meal.type && m.is_snack === meal.is_snack && m.id !== meal.id);
  if (candidates.length === 0) return <span className="text-xs text-slate-400">لا يوجد بدائل</span>;
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-400 max-w-[160px]">
      <option value="">— بلا بديل —</option>
      {candidates.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
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
  const supabase = createClient();

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
      setFixedEntries(prev => [...prev, { meal_id: meal.id, meal_type: newFixedMealType, days: new Set() }]);
    setAddingFixed(false);
  };
  const removeFixedEntry = (meal_id: string, meal_type: MealType) =>
    setFixedEntries(prev => prev.filter(fe => !(fe.meal_id === meal_id && fe.meal_type === meal_type)));
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

    let beneficiaryId = beneficiary?.id;
    if (beneficiary) {
      const { error } = await supabase.from('beneficiaries').update(payload).eq('id', beneficiary.id);
      if (error) { setError(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('beneficiaries').insert(payload).select().single();
      if (error) { setError(error.message.includes('unique') ? 'الكود مستخدم مسبقاً' : error.message); setSaving(false); return; }
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
      }))
    );
    if (fixedRows.length > 0) await supabase.from('beneficiary_fixed_meals').insert(fixedRows);

    onSaved();
  };

  const totalFixed = fixedEntries.reduce((s, fe) => s + fe.days.size, 0);
  const tabLabels: Record<Tab, string> = {
    info: 'البيانات',
    exclusions: `المحظورات${exclusions.length ? ` (${exclusions.length})` : ''}`,
    fixed: `الثابتة الأسبوعية${totalFixed ? ` (${totalFixed})` : ''}`,
  };

  // Group exclusions by section
  const exclBySection = {
    breakfast: exclusions.filter(ex => mealById(ex.meal_id)?.type === 'breakfast' && !mealById(ex.meal_id)?.is_snack),
    lunch: exclusions.filter(ex => mealById(ex.meal_id)?.type === 'lunch' && !mealById(ex.meal_id)?.is_snack),
    dinner: exclusions.filter(ex => mealById(ex.meal_id)?.type === 'dinner' && !mealById(ex.meal_id)?.is_snack),
    snacks: exclusions.filter(ex => mealById(ex.meal_id)?.is_snack),
  };

  const sectionColors: Record<string, string> = {
    breakfast: 'text-amber-700',
    lunch: 'text-emerald-700',
    dinner: 'text-blue-700',
    snacks: 'text-purple-700',
  };
  const sectionBg: Record<string, string> = {
    breakfast: 'bg-amber-50/60',
    lunch: 'bg-emerald-50/60',
    dinner: 'bg-blue-50/60',
    snacks: 'bg-purple-50/60',
  };

  const ExclusionSection = ({ key: _k, sectionKey, label, items }: { key: string; sectionKey: string; label: string; items: ExclusionEntry[] }) => {
    if (items.length === 0) return null;
    return (
      <div>
        <div className={`text-xs font-bold px-3 py-1.5 ${sectionColors[sectionKey]} bg-slate-50 border-b border-slate-100`}>{label}</div>
        <div className={`divide-y divide-slate-100`}>
          {items.map(ex => {
            const meal = mealById(ex.meal_id);
            if (!meal) return null;
            return (
              <div key={ex.meal_id} className={`flex items-center gap-3 px-4 py-2.5 ${sectionBg[sectionKey]}`}>
                <button type="button" onClick={() => removeExclusion(ex.meal_id)}
                  className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <span className="text-sm font-semibold text-red-700 flex-1 line-through">{meal.name}</span>
                <svg className="w-4 h-4 text-slate-300 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
                <AltPicker meal={meal} meals={meals} value={ex.alternative_meal_id} onChange={v => setAlt(ex.meal_id, v)} />
              </div>
            );
          })}
        </div>
      </div>
    );
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
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">الأصناف الممنوعة مقسّمة حسب الوجبة.</p>
                <MealPicker meals={meals} placeholder="إضافة صنف ممنوع" onSelect={addExclusion} excludeIds={excludedMealIds} />
              </div>

              {exclusions.length === 0 ? (
                <div className="border border-dashed border-slate-200 rounded-xl py-10 text-center text-slate-400 text-sm">
                  لا توجد محظورات — اضغط &quot;إضافة صنف ممنوع&quot;
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                  <ExclusionSection key="breakfast" sectionKey="breakfast" label="الفطور" items={exclBySection.breakfast} />
                  <ExclusionSection key="lunch" sectionKey="lunch" label="الغداء" items={exclBySection.lunch} />
                  <ExclusionSection key="dinner" sectionKey="dinner" label="العشاء" items={exclBySection.dinner} />
                  <ExclusionSection key="snacks" sectionKey="snacks" label="السناكات" items={exclBySection.snacks} />
                </div>
              )}
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
