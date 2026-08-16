'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import {
  deriveFactor,
  familyLabel,
  formatQty,
  newCustomFamily,
  parsePositiveNumber,
  unitsInFamily,
  type CostUnitDef,
} from '@/lib/costs';

interface Props {
  units: CostUnitDef[];
  value: string;
  onChange: (unitId: string) => void;
  /**
   * لو مُمرَّرة، الاختيار محصور في مجموعة هذه الوحدة — يُستخدم في أسطر الوصفة
   * حيث لازم تكون وحدة الكمية قابلة للتحويل لوحدة شراء المادة.
   */
  restrictToFamilyOf?: CostUnitDef;
  disabled?: boolean;
  className?: string;
  /** يُستدعى بعد إنشاء وحدة جديدة عشان الأب يعيد تحميل قائمة الوحدات */
  onUnitCreated: () => void | Promise<void>;
  canCreate: boolean;
}

const NEW_UNIT = '__new__';

export default function UnitPicker({
  units, value, onChange, restrictToFamilyOf, disabled, className,
  onUnitCreated, canCreate,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [qtyText, setQtyText] = useState('');
  const [refUnitId, setRefUnitId] = useState('');
  const [independent, setIndependent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const options = restrictToFamilyOf ? unitsInFamily(restrictToFamilyOf, units) : units;

  const sortedAll = units
    .slice()
    .sort((a, b) => a.family.localeCompare(b.family) || a.factor - b.factor);

  const openCreate = () => {
    setName('');
    setQtyText('');
    // داخل الوصفة المجموعة محصورة، فالمرجع الافتراضي من نفس المجموعة
    setRefUnitId(restrictToFamilyOf?.id ?? sortedAll[0]?.id ?? '');
    setIndependent(false);
    setError('');
    setCreating(true);
  };

  const refUnit = units.find(u => u.id === refUnitId);
  const parsedQty = parsePositiveNumber(qtyText);
  const previewFactor =
    !independent && refUnit && parsedQty !== null && parsedQty > 0
      ? deriveFactor(parsedQty, refUnit)
      : null;

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('أدخل اسم الوحدة'); return; }

    let family: string;
    let factor: number;

    if (independent) {
      // وحدة لا تتحوّل لغيرها — مجموعة خاصة بها ومعاملها الأساس
      family = newCustomFamily(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      );
      factor = 1;
    } else {
      if (!refUnit) { setError('اختر الوحدة المرجعية'); return; }
      if (parsedQty === null || parsedQty <= 0) { setError('أدخل كم تساوي — رقماً أكبر من صفر'); return; }
      family = refUnit.family;
      factor = deriveFactor(parsedQty, refUnit);
      if (!(factor > 0)) { setError('المعامل الناتج غير صالح'); return; }
    }

    setSaving(true);
    setError('');

    const { data, error: err } = await supabase
      .from('cost_units')
      .insert({ name: trimmed, family, factor, is_builtin: false })
      .select('id')
      .single();

    setSaving(false);

    if (err) {
      setError(/duplicate|unique/i.test(err.message) ? 'يوجد وحدة بنفس الاسم' : err.message);
      return;
    }

    void logActivity({
      action: 'create',
      entity_type: 'cost_unit',
      entity_id: data?.id ?? null,
      entity_name: trimmed,
      details: independent
        ? { independent: true }
        : { equals: `${formatQty(parsedQty!)} ${refUnit!.name}`, factor },
    });

    await onUnitCreated();
    if (data?.id) onChange(data.id);
    setCreating(false);
  };

  if (creating) {
    return (
      <div className="border-2 border-emerald-200 bg-emerald-50/50 rounded-xl p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-emerald-700">وحدة جديدة</span>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="text-slate-400 hover:text-slate-600 text-sm"
          >
            ✕
          </button>
        </div>

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          className="input-field py-2 text-sm"
          placeholder="اسم الوحدة — مثال: رطل، كرتون، صاع"
          autoFocus
        />

        {!independent ? (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 font-semibold whitespace-nowrap">تساوي</span>
              <input
                type="text"
                inputMode="decimal"
                value={qtyText}
                onChange={e => setQtyText(e.target.value)}
                className="input-field py-2 text-sm text-center w-24"
                placeholder="0"
                dir="ltr"
              />
              <select
                value={refUnitId}
                onChange={e => setRefUnitId(e.target.value)}
                className="input-field py-2 text-sm flex-1"
              >
                {(restrictToFamilyOf ? options : sortedAll).map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({familyLabel(u.family, units)})
                  </option>
                ))}
              </select>
            </div>

            {previewFactor !== null && refUnit && (
              <p className="text-[11px] text-emerald-700">
                ✓ &quot;{name.trim() || 'الوحدة'}&quot; = {formatQty(parsedQty!)} {refUnit.name} — تتحوّل تلقائياً مع {familyLabel(refUnit.family, units)}
              </p>
            )}
          </>
        ) : (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            وحدة مستقلة — ما تتحوّل لأي وحدة ثانية. لازم تشتري وتصرف بنفس الوحدة.
          </p>
        )}

        {!restrictToFamilyOf && (
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={independent}
              onChange={e => setIndependent(e.target.checked)}
              className="rounded"
            />
            وحدة مستقلة — ما تتحوّل لغيرها
          </label>
        )}

        {error && <p className="text-[11px] text-red-600">{error}</p>}

        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={saving}
          className="btn-primary w-full justify-center text-sm py-2"
        >
          {saving ? 'جاري الإضافة...' : 'إضافة الوحدة'}
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={e => {
        if (e.target.value === NEW_UNIT) openCreate();
        else onChange(e.target.value);
      }}
      disabled={disabled}
      className={className ?? 'input-field'}
    >
      {!value && <option value="">— اختر وحدة —</option>}
      {options.map(u => (
        <option key={u.id} value={u.id}>
          {u.name}
          {!restrictToFamilyOf && ` — ${familyLabel(u.family, units)}`}
        </option>
      ))}
      {canCreate && <option value={NEW_UNIT}>+ وحدة جديدة...</option>}
    </select>
  );
}
