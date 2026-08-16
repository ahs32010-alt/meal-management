'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import UnitPicker from './UnitPicker';
import { familyLabel, formatQty, type CostUnitDef } from '@/lib/costs';

interface Props {
  units: CostUnitDef[];
  /** unit_id → كم مرة مستخدمة (مواد + أسطر وصفات) */
  usageByUnit: Record<string, number>;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
  onClose: () => void;
}

export default function UnitsModal({ units, usageByUnit, canEdit, canDelete, onChanged, onClose }: Props) {
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  // منتقي الوحدات هو نفسه نموذج الإضافة — نعرضه بقيمة فارغة
  const [adderKey, setAdderKey] = useState(0);

  /** مجمّعة حسب المجموعة عشان يبان أي وحدات تتحوّل مع بعض */
  const families = useMemo(() => {
    const map = new Map<string, CostUnitDef[]>();
    for (const u of units) {
      const list = map.get(u.family) ?? [];
      list.push(u);
      map.set(u.family, list);
    }
    return Array.from(map.entries())
      .map(([family, list]) => ({
        family,
        label: familyLabel(family, units),
        units: list.slice().sort((a, b) => a.factor - b.factor),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [units]);

  const handleDelete = async (unit: CostUnitDef) => {
    const usage = usageByUnit[unit.id] ?? 0;
    if (unit.is_builtin) {
      setError(`"${unit.name}" وحدة مدمجة ولا يمكن حذفها.`);
      return;
    }
    if (usage > 0) {
      setError(`لا يمكن حذف "${unit.name}" لأنها مستخدَمة في ${usage} موضع (مواد أو وصفات). غيّرها هناك أولاً.`);
      return;
    }

    setDeleting(unit.id);
    setError('');
    const { error: err } = await supabase.from('cost_units').delete().eq('id', unit.id);
    setDeleting(null);

    if (err) {
      setError(/foreign key|violates/i.test(err.message)
        ? `"${unit.name}" مستخدَمة ولا يمكن حذفها.`
        : err.message);
      return;
    }

    void logActivity({
      action: 'delete',
      entity_type: 'cost_unit',
      entity_id: unit.id,
      entity_name: unit.name,
    });
    await onChanged();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">وحدات القياس</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              الوحدات داخل نفس المجموعة تتحوّل تلقائياً بينها
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3">
              <span>{error}</span>
              <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
            </div>
          )}

          {families.map(f => {
            const base = f.units[0];
            return (
              <div key={f.family} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">{f.label}</span>
                  <span className="text-[11px] text-slate-400">
                    الأساس: {base?.name}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {f.units.map(u => {
                    const usage = usageByUnit[u.id] ?? 0;
                    return (
                      <div key={u.id} className="flex items-center gap-2 px-4 py-2.5">
                        <span className="font-semibold text-slate-800 text-sm flex-1">{u.name}</span>
                        {u.is_builtin && (
                          <span className="badge bg-slate-100 text-slate-500 text-[10px]">مدمجة</span>
                        )}
                        {usage > 0 && (
                          <span className="badge bg-emerald-50 text-emerald-700 text-[10px]">{usage} استخدام</span>
                        )}
                        <span className="text-[11px] text-slate-400 tabular-nums" dir="ltr">
                          {u.id === base?.id ? '—' : `= ${formatQty(u.factor / (base?.factor || 1))} ${base?.name}`}
                        </span>
                        {canDelete && !u.is_builtin && (
                          <button
                            onClick={() => void handleDelete(u)}
                            disabled={deleting === u.id}
                            title={usage > 0 ? `مستخدَمة في ${usage} موضع` : 'حذف'}
                            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {canEdit && (
            <div>
              <label className="label">إضافة وحدة</label>
              <UnitPicker
                key={adderKey}
                units={units}
                value=""
                onChange={() => { /* الإضافة فقط — لا اختيار هنا */ }}
                canCreate
                onUnitCreated={async () => {
                  await onChanged();
                  setAdderKey(k => k + 1);
                }}
              />
              <p className="text-[11px] text-slate-400 mt-1.5">
                اختر &quot;+ وحدة جديدة&quot; من القائمة، ثم عرّفها بأنها تساوي كم من وحدة موجودة.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="btn-secondary w-full justify-center">إغلاق</button>
        </div>
      </div>
    </div>
  );
}
