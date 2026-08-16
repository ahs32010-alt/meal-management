'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { exportXLSX } from '@/lib/xlsx-utils';
import { formatMoney, type CostUnitDef, type RawMaterial } from '@/lib/costs';

const RawMaterialModal = dynamic(() => import('./RawMaterialModal'), { ssr: false });
const UnitsModal = dynamic(() => import('./UnitsModal'), { ssr: false });

interface Props {
  materials: RawMaterial[];
  units: CostUnitDef[];
  /** raw_material_id → عدد الوصفات المستخدِمة */
  usageByMaterial: Record<string, number>;
  /** unit_id → عدد المواد وأسطر الوصفات المستخدِمة */
  usageByUnit: Record<string, number>;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onChanged: () => Promise<void>;
}

export default function RawMaterialsTab({
  materials, units, usageByMaterial, usageByUnit, canAdd, canEdit, canDelete, onChanged,
}: Props) {
  const [search, setSearch] = useState('');
  const [modalFor, setModalFor] = useState<RawMaterial | null | undefined>(undefined);
  const [unitsOpen, setUnitsOpen] = useState(false);

  const unitsById = useMemo(() => {
    const map: Record<string, CostUnitDef> = {};
    for (const u of units) map[u.id] = u;
    return map;
  }, [units]);
  const [deleteTarget, setDeleteTarget] = useState<RawMaterial | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? materials.filter(m => m.name.toLowerCase().includes(q))
      : materials;
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [materials, search]);

  const unpriced = materials.filter(m => !(m.unit_cost > 0)).length;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setError('');
    const { error: err } = await supabase.from('raw_materials').delete().eq('id', deleteTarget.id);
    setDeleting(false);

    if (err) {
      // القيد on delete restrict — المادة مستخدَمة في وصفة
      setError(
        /foreign key|violates/i.test(err.message)
          ? `لا يمكن حذف "${deleteTarget.name}" لأنها مستخدَمة في ${usageByMaterial[deleteTarget.id] ?? 0} وصفة. احذفها من الوصفات أولاً.`
          : err.message,
      );
      setDeleteTarget(null);
      return;
    }

    void logActivity({
      action: 'delete',
      entity_type: 'raw_material',
      entity_id: deleteTarget.id,
      entity_name: deleteTarget.name,
    });
    setDeleteTarget(null);
    void onChanged();
  };

  const handleExport = () => {
    if (filtered.length === 0) return;
    void exportXLSX(
      filtered.map(m => ({
        'المادة': m.name,
        'وحدة الشراء': unitsById[m.unit_id]?.name ?? '—',
        'السعر (ريال/وحدة)': m.unit_cost,
        'مستخدَمة في (وصفات)': usageByMaterial[m.id] ?? 0,
        'ملاحظات': m.notes ?? '',
      })),
      `raw-materials-${new Date().toISOString().slice(0, 10)}.xlsx`,
      'المواد الأولية',
    );
  };

  return (
    <div className="space-y-4">
      {/* شريط الأدوات */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input-field pr-10"
            placeholder="ابحث عن مادة أولية..."
          />
          <svg className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <button onClick={() => setUnitsOpen(true)} className="btn-secondary text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
          الوحدات
        </button>
        {materials.length > 0 && (
          <button onClick={handleExport} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            تصدير
          </button>
        )}
        {canAdd && (
          <button onClick={() => setModalFor(null)} className="btn-primary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة مادة
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      {unpriced > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-lg text-sm">
          ⚠️ {unpriced} مادة بدون سعر — أي صنف يستخدمها راح تطلع تكلفته ناقصة.
        </div>
      )}

      {/* الجدول */}
      <div className="card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">
            {materials.length === 0
              ? 'ما فيه مواد أولية بعد — ابدأ بإضافة المواد اللي تشتريها (كبدة، بصل، أرز...)'
              : 'ما فيه نتائج للبحث'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">المادة</th>
                  <th className="table-header">وحدة الشراء</th>
                  <th className="table-header">السعر</th>
                  <th className="table-header">مستخدَمة في</th>
                  <th className="table-header">ملاحظات</th>
                  {(canEdit || canDelete) && <th className="table-header w-24"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const usage = usageByMaterial[m.id] ?? 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="table-cell font-semibold text-slate-800">{m.name}</td>
                      <td className="table-cell">
                        <span className="badge bg-slate-100 text-slate-700">{unitsById[m.unit_id]?.name ?? '—'}</span>
                      </td>
                      <td className="table-cell">
                        {m.unit_cost > 0 ? (
                          <span className="font-bold text-slate-800" dir="ltr">
                            {formatMoney(m.unit_cost)} <span className="text-[11px] font-normal text-slate-400">/{unitsById[m.unit_id]?.name ?? '؟'}</span>
                          </span>
                        ) : (
                          <span className="badge bg-amber-100 text-amber-700">بدون سعر</span>
                        )}
                      </td>
                      <td className="table-cell">
                        {usage > 0 ? (
                          <span className="badge bg-emerald-50 text-emerald-700">{usage} وصفة</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="table-cell text-slate-500 text-xs max-w-[220px] truncate" title={m.notes ?? ''}>
                        {m.notes || '—'}
                      </td>
                      {(canEdit || canDelete) && (
                        <td className="table-cell">
                          <div className="flex items-center gap-1">
                            {canEdit && (
                              <button
                                onClick={() => setModalFor(m)}
                                title="تعديل"
                                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => {
                                  // المادة المستخدَمة محميّة بقيد في القاعدة — نمنعها هنا
                                  // برسالة واضحة بدل ما نفتح حوار تأكيد ينتهي بخطأ SQL
                                  if (usage > 0) {
                                    setError(`لا يمكن حذف "${m.name}" لأنها مستخدَمة في ${usage} وصفة. أزلها من الوصفات أولاً — الحذف المباشر يخفّض تكلفة الأصناف بصمت.`);
                                    return;
                                  }
                                  setDeleteTarget(m);
                                }}
                                title={usage > 0 ? `مستخدَمة في ${usage} وصفة — لا يمكن حذفها` : 'حذف'}
                                className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalFor !== undefined && (
        <RawMaterialModal
          material={modalFor}
          units={units}
          usageCount={modalFor ? (usageByMaterial[modalFor.id] ?? 0) : 0}
          canCreateUnits={canEdit || canAdd}
          onUnitCreated={onChanged}
          onClose={() => setModalFor(undefined)}
          onSaved={() => { setModalFor(undefined); void onChanged(); }}
        />
      )}

      {unitsOpen && (
        <UnitsModal
          units={units}
          usageByUnit={usageByUnit}
          canEdit={canEdit || canAdd}
          canDelete={canDelete}
          onChanged={onChanged}
          onClose={() => setUnitsOpen(false)}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="حذف مادة أولية"
        message={`هل تريد حذف "${deleteTarget?.name}"؟`}
        confirmLabel={deleting ? 'جاري الحذف...' : 'حذف'}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
