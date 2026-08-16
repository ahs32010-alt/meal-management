'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import UnitPicker from './UnitPicker';
import {
  formatMoney,
  parsePositiveNumber,
  type CostUnitDef,
  type RawMaterial,
} from '@/lib/costs';

interface Props {
  materials: RawMaterial[];
  unitsById: Record<string, CostUnitDef>;
  units: CostUnitDef[];
  /** مواد موجودة في الوصفة أصلاً — تُعرض معطّلة بدل ما تختفي، عشان يفهم ليه ما تنضاف */
  usedIds: Set<string>;
  /** 'add' اختيار متعدّد | 'replace' اختيار واحد يبدّل سطراً قائماً */
  mode: 'add' | 'replace';
  /** اسم الصنف — يظهر في العنوان وفي سجل النشاط */
  mealName: string;
  canCreate: boolean;
  onConfirm: (materialIds: string[]) => void;
  onCancel: () => void;
  /** إعادة تحميل المواد بعد إنشاء واحدة جديدة */
  onDataChanged: () => Promise<void>;
}

export default function IngredientPicker({
  materials, unitsById, units, usedIds, mode, mealName, canCreate,
  onConfirm, onCancel, onDataChanged,
}: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // نموذج إنشاء مادة جديدة — داخل المنتقي نفسه فما تغادر الصنف
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUnitId, setNewUnitId] = useState(units[0]?.id ?? '');
  const [newCostText, setNewCostText] = useState('');
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials
      .filter(m => (q ? m.name.toLowerCase().includes(q) : true))
      .slice()
      .sort((a, b) => {
        // المتاحة أولاً، ثم أبجدياً — المستخدَمة تنزل تحت بدل ما تتخلل القائمة
        const aUsed = usedIds.has(a.id) ? 1 : 0;
        const bUsed = usedIds.has(b.id) ? 1 : 0;
        return aUsed - bUsed || a.name.localeCompare(b.name, 'ar');
      });
  }, [materials, search, usedIds]);

  const availableCount = materials.filter(m => !usedIds.has(m.id)).length;

  const toggle = (id: string) => {
    if (usedIds.has(id)) return;
    if (mode === 'replace') { onConfirm([id]); return; }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const openCreate = () => {
    setNewName(search.trim());   // اللي كتبه في البحث غالباً هو اسم المادة
    setNewUnitId(units[0]?.id ?? '');
    setNewCostText('');
    setCreateError('');
    setCreating(true);
  };

  /** ينشئ المادة ويضيفها للوصفة مباشرة */
  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { setCreateError('أدخل اسم المادة'); return; }
    if (!newUnitId) { setCreateError('اختر وحدة الشراء'); return; }
    const cost = parsePositiveNumber(newCostText);
    if (cost === null) { setCreateError('السعر غير صالح — أدخل رقماً موجباً'); return; }

    setSaving(true);
    setCreateError('');

    const { data, error } = await supabase
      .from('raw_materials')
      .insert({ name: trimmed, unit_id: newUnitId, unit_cost: cost, notes: null })
      .select('id')
      .single();

    setSaving(false);

    if (error) {
      setCreateError(/duplicate|unique/i.test(error.message) ? 'يوجد مادة أولية بنفس الاسم' : error.message);
      return;
    }

    void logActivity({
      action: 'create',
      entity_type: 'raw_material',
      entity_id: data?.id ?? null,
      entity_name: trimmed,
      details: { unit: unitsById[newUnitId]?.name, unit_cost: cost, source: 'recipe_inline', meal: mealName },
    });

    await onDataChanged();
    setCreating(false);
    // المادة الجديدة تدخل الوصفة فوراً — هذا سبب إنشائها أصلاً
    if (data?.id) onConfirm([...(mode === 'add' ? Array.from(selected) : []), data.id]);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h3 className="font-bold text-slate-800">
              {mode === 'replace' ? 'تبديل المادة الأولية' : 'اختر المواد الأولية'}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {mode === 'replace'
                ? 'اضغط على المادة البديلة'
                : `${availableCount} مادة متاحة — تقدر تختار أكثر من وحدة`}
            </p>
          </div>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        {/* البحث */}
        <div className="px-5 pt-4">
          <div className="relative">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input-field pr-10"
              placeholder="ابحث بالاسم..."
            />
            <svg className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* القائمة */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <p className="text-slate-400 text-sm">
                {materials.length === 0 ? 'ما فيه مواد أولية بعد' : 'ما فيه نتيجة للبحث'}
              </p>
              {canCreate && !creating && (
                <button onClick={openCreate} className="btn-primary mx-auto text-sm">
                  + أضف &quot;{search.trim() || 'مادة جديدة'}&quot;
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map(m => {
                const used = usedIds.has(m.id);
                const isSel = selected.has(m.id);
                const unitName = unitsById[m.unit_id]?.name ?? '؟';
                return (
                  <button
                    key={m.id}
                    onClick={() => toggle(m.id)}
                    disabled={used}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-right transition-colors ${
                      used
                        ? 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed'
                        : isSel
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
                    }`}
                  >
                    {mode === 'add' && (
                      <span
                        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${
                          isSel ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300'
                        }`}
                      >
                        {isSel && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </span>
                    )}

                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-slate-800 text-sm truncate">{m.name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {m.unit_cost > 0
                          ? <span dir="ltr">{formatMoney(m.unit_cost)} ريال / {unitName}</span>
                          : <span className="text-amber-600">بدون سعر — سعّرها عشان تُحتسب</span>}
                      </span>
                    </span>

                    {used && <span className="badge bg-slate-200 text-slate-500 text-[10px] shrink-0">مضافة</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* إنشاء مادة جديدة */}
        {creating && (
          <div className="border-t border-slate-100 px-5 py-3 bg-emerald-50/50 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-700">مادة أولية جديدة</span>
              <button onClick={() => setCreating(false)} className="text-slate-400 hover:text-slate-600 text-sm">✕</button>
            </div>

            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="input-field py-2 text-sm"
              placeholder="اسم المادة — مثال: كبدة"
              autoFocus
            />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">وحدة الشراء</label>
                <UnitPicker
                  units={units}
                  value={newUnitId}
                  onChange={setNewUnitId}
                  canCreate={canCreate}
                  onUnitCreated={onDataChanged}
                  className="input-field py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">
                  السعر / {unitsById[newUnitId]?.name ?? '—'}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={newCostText}
                  onChange={e => setNewCostText(e.target.value)}
                  className="input-field py-2 text-sm text-center"
                  placeholder="0"
                  dir="ltr"
                />
              </div>
            </div>

            {createError && <p className="text-[11px] text-red-600">{createError}</p>}

            <button
              onClick={() => void handleCreate()}
              disabled={saving}
              className="btn-primary w-full justify-center text-sm py-2"
            >
              {saving ? 'جاري الإضافة...' : 'إضافة المادة وإدخالها في الوصفة'}
            </button>
          </div>
        )}

        {/* الأزرار */}
        <div className="border-t border-slate-100 px-5 py-3 flex items-center gap-2">
          {canCreate && !creating && filtered.length > 0 && (
            <button onClick={openCreate} className="btn-secondary text-sm">
              + مادة جديدة
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onCancel} className="btn-secondary text-sm">إلغاء</button>
          {mode === 'add' && (
            <button
              onClick={() => onConfirm(Array.from(selected))}
              disabled={selected.size === 0}
              className="btn-primary text-sm"
            >
              إضافة {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
