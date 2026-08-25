'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { changeDetails, valueDetails } from '@/lib/activity-diff';
import UnitPicker from './UnitPicker';
import {
  familyLabel,
  formatMoney,
  parsePositiveNumber,
  type CostUnitDef,
  type RawMaterial,
} from '@/lib/costs';

interface Props {
  material: RawMaterial | null;
  units: CostUnitDef[];
  /** عدد الوصفات التي تستخدم هذه المادة — تغيير وحدة الشراء يؤثر عليها كلها */
  usageCount?: number;
  canCreateUnits: boolean;
  onUnitCreated: () => void | Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}

export default function RawMaterialModal({
  material, units, usageCount = 0, canCreateUnits, onUnitCreated, onClose, onSaved,
}: Props) {
  const [name, setName] = useState(material?.name ?? '');
  const [unitId, setUnitId] = useState(material?.unit_id ?? units[0]?.id ?? '');
  const [costText, setCostText] = useState(material ? String(material.unit_cost) : '');
  const [notes, setNotes] = useState(material?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const parsedCost = parsePositiveNumber(costText);
  const unit = units.find(u => u.id === unitId);
  const originalUnit = material ? units.find(u => u.id === material.unit_id) : undefined;

  const unitChanged = !!material && material.unit_id !== unitId;
  // تغيير المجموعة (وزن ↔ حجم ↔ عدد) يكسر كل أسطر الوصفات المرتبطة
  const familyChanged = !!originalUnit && !!unit && originalUnit.family !== unit.family;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('يرجى إدخال اسم المادة'); return; }
    if (!unitId) { setError('اختر وحدة الشراء'); return; }
    if (parsedCost === null) { setError('السعر غير صالح — أدخل رقماً موجباً'); return; }

    setSaving(true);
    setError('');

    const payload = {
      name: trimmed,
      unit_id: unitId,
      unit_cost: parsedCost,
      notes: notes.trim() || null,
    };

    if (material) {
      const { error: err } = await supabase.from('raw_materials').update(payload).eq('id', material.id);
      if (err) {
        setError(/duplicate|unique/i.test(err.message) ? 'يوجد مادة أولية بنفس الاسم' : err.message);
        setSaving(false);
        return;
      }
      void logActivity({
        action: 'update',
        entity_type: 'raw_material',
        entity_id: material.id,
        entity_name: trimmed,
        // الوحدة تُقارَن بالاسم لا بالمعرّف — «كيلو ← جرام» تُقرأ، والـUUID لا.
        details: changeDetails(
          { name: material.name, unit: originalUnit?.name ?? null, unit_cost: material.unit_cost },
          { name: trimmed, unit: unit?.name ?? null, unit_cost: parsedCost },
          ['name', 'unit', 'unit_cost'],
        ),
      });
    } else {
      const { data, error: err } = await supabase.from('raw_materials').insert(payload).select('id').single();
      if (err) {
        setError(/duplicate|unique/i.test(err.message) ? 'يوجد مادة أولية بنفس الاسم' : err.message);
        setSaving(false);
        return;
      }
      void logActivity({
        action: 'create',
        entity_type: 'raw_material',
        entity_id: data?.id ?? null,
        entity_name: trimmed,
        details: valueDetails({ name: trimmed, unit: unit?.name, unit_cost: parsedCost }),
      });
    }

    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="text-lg font-bold text-slate-800">
            {material ? 'تعديل مادة أولية' : 'إضافة مادة أولية'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">اسم المادة *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="input-field"
              placeholder="مثال: كبدة"
              autoFocus
            />
          </div>

          <div>
            <label className="label">
              وحدة الشراء *
              <span className="text-[11px] font-normal text-slate-400 mr-1">— الوحدة اللي تشتري فيها وتسعّر بها</span>
            </label>
            <UnitPicker
              units={units}
              value={unitId}
              onChange={setUnitId}
              canCreate={canCreateUnits}
              onUnitCreated={onUnitCreated}
            />
            {unit && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                في الوصفات تقدر تدخل الكمية بأي وحدة من مجموعة «{familyLabel(unit.family, units)}» والنظام يحوّل تلقائياً.
              </p>
            )}
          </div>

          {familyChanged && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              <b>تنبيه:</b> تغيّرت مجموعة الوحدة من «{familyLabel(originalUnit!.family, units)}» إلى «{familyLabel(unit!.family, units)}».
              {usageCount > 0 && <> الوصفات المستخدمة لهذه المادة ({usageCount}) راح تصير كمياتها غير متوافقة وتحتاج تعديل يدوي.</>}
            </div>
          )}
          {unitChanged && !familyChanged && usageCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-sm">
              تغيّرت وحدة الشراء — النظام يحوّل تلقائياً، لكن تأكد أن السعر الجديد يخص وحدة <b>{unit?.name}</b>.
            </div>
          )}

          <div>
            <label className="label">سعر الشراء *</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={costText}
                onChange={e => setCostText(e.target.value)}
                className="input-field"
                placeholder="مثال: 25"
                dir="ltr"
              />
              <span className="text-sm font-bold text-slate-600 whitespace-nowrap">
                ريال / {unit?.name ?? '—'}
              </span>
            </div>
            {costText.trim() !== '' && parsedCost === null && (
              <p className="text-[11px] text-red-600 mt-1.5">رقم غير صالح</p>
            )}
            {parsedCost !== null && parsedCost > 0 && unit && (
              <p className="text-[11px] text-slate-500 mt-1.5">
                = <b>{formatMoney(parsedCost)}</b> ريال لكل {unit.name}
              </p>
            )}
            {parsedCost === 0 && (
              <p className="text-[11px] text-amber-600 mt-1.5">
                السعر صفر — المادة راح تظهر كـ &quot;بدون سعر&quot; في الوصفات.
              </p>
            )}
          </div>

          <div>
            <label className="label">ملاحظات</label>
            <input
              type="text"
              value={notes ?? ''}
              onChange={e => setNotes(e.target.value)}
              className="input-field"
              placeholder="اختياري — مثال: المورّد، تاريخ آخر تسعيرة"
            />
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? 'جاري الحفظ...' : material ? 'حفظ التعديلات' : 'إضافة المادة'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
