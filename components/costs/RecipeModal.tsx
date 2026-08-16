'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import UnitPicker from './UnitPicker';
import {
  LINE_ISSUE_LABELS,
  baseUnitOf,
  convertQuantity,
  costRecipe,
  formatMoney,
  formatQty,
  parsePositiveNumber,
  round,
  type CostUnitDef,
  type RawMaterial,
  type RecipeItem,
} from '@/lib/costs';
import type { Meal } from '@/lib/types';

const IngredientPicker = dynamic(() => import('./IngredientPicker'), { ssr: false });

/** سطر قيد التحرير — الكمية نص عشان يقبل إدخالاً جزئياً أثناء الكتابة */
interface DraftLine {
  key: string;
  raw_material_id: string;
  qtyText: string;
  unit_id: string;
}

interface Props {
  meal: Meal;
  existing: RecipeItem[];
  materials: RawMaterial[];
  units: CostUnitDef[];
  canEdit: boolean;
  /** إعادة تحميل المواد/الوحدات بعد إنشاء واحدة جديدة من داخل هذه النافذة */
  onDataChanged: () => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}

let keySeq = 0;
const nextKey = () => `line-${++keySeq}`;

export default function RecipeModal({
  meal, existing, materials, units, canEdit, onDataChanged, onClose, onSaved,
}: Props) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    existing.map(r => ({
      key: nextKey(),
      raw_material_id: r.raw_material_id,
      qtyText: String(r.quantity),
      unit_id: r.unit_id,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** null = مغلق | {mode:'add'} = إضافة مواد | {mode:'replace', key} = تبديل سطر */
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'replace'; key: string } | null>(null);

  const materialsById = useMemo(() => {
    const map: Record<string, RawMaterial> = {};
    for (const m of materials) map[m.id] = m;
    return map;
  }, [materials]);

  const unitsById = useMemo(() => {
    const map: Record<string, CostUnitDef> = {};
    for (const u of units) map[u.id] = u;
    return map;
  }, [units]);

  // التسعير الحيّ — نفس دالة الخادم بالضبط، فالرقم هنا هو الرقم هناك
  const costed = useMemo(() => {
    const parsed = lines
      .map(l => ({
        raw_material_id: l.raw_material_id,
        quantity: parsePositiveNumber(l.qtyText) ?? 0,
        unit_id: l.unit_id,
      }))
      .filter(l => l.raw_material_id && l.quantity > 0);
    return costRecipe(parsed, materialsById, unitsById);
  }, [lines, materialsById, unitsById]);

  const lineCost = (line: DraftLine): number | null => {
    const qty = parsePositiveNumber(line.qtyText);
    if (!line.raw_material_id || qty === null || qty <= 0) return null;
    const single = costRecipe(
      [{ raw_material_id: line.raw_material_id, quantity: qty, unit_id: line.unit_id }],
      materialsById,
      unitsById,
    );
    const issue = single.lines[0]?.issue;
    return issue === 'unit_mismatch' || issue === 'missing_unit' || issue === 'missing_material'
      ? null
      : single.total;
  };

  const usedIds = useMemo(
    () => new Set(lines.map(l => l.raw_material_id).filter(Boolean)),
    [lines],
  );

  /**
   * وحدة السطر الافتراضية = أصغر وحدة في مجموعة وحدة شراء المادة.
   * الزيت يُشترى باللتر لكن يدخل الصحن بالمل، والكبدة تُشترى بالكجم وتدخل
   * بالجرام — فنبدأ من الوحدة اللي راح يكتب بها فعلاً بدل ما يبدّلها كل مرة.
   */
  const defaultUnitFor = (m: RawMaterial | undefined): string => {
    if (!m) return '';
    return baseUnitOf(unitsById[m.unit_id], units)?.id ?? m.unit_id;
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => setLines(prev => prev.filter(l => l.key !== key));

  /** نتيجة المنتقي: إضافة أسطر جديدة أو تبديل مادة سطر قائم */
  const handlePicked = (ids: string[]) => {
    if (ids.length === 0) { setPicker(null); return; }

    if (picker?.mode === 'replace') {
      const m = materialsById[ids[0]];
      updateLine(picker.key, { raw_material_id: ids[0], unit_id: defaultUnitFor(m) });
    } else {
      setLines(prev => [
        ...prev,
        ...ids
          .filter(id => !prev.some(l => l.raw_material_id === id))
          .map(id => ({
            key: nextKey(),
            raw_material_id: id,
            qtyText: '',
            unit_id: defaultUnitFor(materialsById[id]),
          })),
      ]);
    }
    setPicker(null);
  };

  const handleSave = async () => {
    setError('');

    const seen = new Set<string>();
    for (const l of lines) {
      const mName = materialsById[l.raw_material_id]?.name ?? '';
      if (!l.raw_material_id) { setError('في سطر بدون مادة أولية — احذفه أو اختر له مادة'); return; }
      if (seen.has(l.raw_material_id)) { setError(`المادة "${mName}" مكرّرة — ادمجها في سطر واحد`); return; }
      seen.add(l.raw_material_id);
      if (!l.unit_id) { setError(`اختر وحدة للمادة "${mName}"`); return; }
      const qty = parsePositiveNumber(l.qtyText);
      if (qty === null || qty <= 0) {
        setError(`كمية غير صالحة للمادة "${mName}" — أدخل رقماً أكبر من صفر`);
        return;
      }
    }
    if (costed.issues.some(i => i.issue === 'unit_mismatch')) {
      setError('في سطر وحدته من مجموعة غير مجموعة وحدة شراء المادة — صحّحه قبل الحفظ');
      return;
    }

    setSaving(true);

    // نعامل الوصفة كمجموعة استبدال كاملة مفتاحها (الصنف، المادة):
    // أي مادة اختفت من الشاشة تُحذف، والباقي يُدرج أو يُحدَّث عبر onConflict.
    // ما نرسل id أبداً — لو تغيّرت مادة سطر قائم، إرسال الـid القديم مع
    // onConflict على (meal_id, raw_material_id) يصطدم بالمفتاح الأساسي.
    const finalMaterialIds = new Set(lines.map(l => l.raw_material_id));
    const toDelete = existing.filter(r => !finalMaterialIds.has(r.raw_material_id)).map(r => r.id);

    if (toDelete.length > 0) {
      const { error: delErr } = await supabase.from('meal_recipe_items').delete().in('id', toDelete);
      if (delErr) { setError(delErr.message); setSaving(false); return; }
    }

    const rows = lines.map(l => ({
      meal_id: meal.id,
      raw_material_id: l.raw_material_id,
      quantity: parsePositiveNumber(l.qtyText)!,
      unit_id: l.unit_id,
    }));

    if (rows.length > 0) {
      const { error: upErr } = await supabase
        .from('meal_recipe_items')
        .upsert(rows, { onConflict: 'meal_id,raw_material_id' });
      if (upErr) { setError(upErr.message); setSaving(false); return; }
    }

    void logActivity({
      action: existing.length === 0 ? 'create' : 'update',
      entity_type: 'recipe_item',
      entity_id: meal.id,
      entity_name: meal.name,
      details: {
        ingredients: rows.length,
        portion_cost: round(costed.total, 4),
        removed: toDelete.length || undefined,
      },
    });

    setSaving(false);
    onSaved();
  };

  const hasBlockingIssue = costed.issues.some(
    i => i.issue === 'unit_mismatch' || i.issue === 'missing_material' || i.issue === 'missing_unit',
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl max-h-[92vh] flex flex-col">
        {/* الرأس */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">وصفة: {meal.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              المواد الأولية الداخلة في <b>حصة واحدة</b> من هذا الصنف
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        {/* المكوّنات */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {lines.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="text-3xl">🧾</div>
              <p className="text-slate-500 text-sm">ما فيه مواد أولية في هذا الصنف بعد</p>
              {canEdit && (
                <button onClick={() => setPicker({ mode: 'add' })} className="btn-primary mx-auto text-sm">
                  + اختر المواد الأولية
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="hidden sm:grid grid-cols-[1fr_100px_120px_120px_36px] gap-2 px-1 text-[11px] font-bold text-slate-400">
                <span>المادة الأولية</span>
                <span className="text-center">الكمية</span>
                <span>الوحدة</span>
                <span className="text-left">التكلفة</span>
                <span></span>
              </div>

              {lines.map(line => {
                const material = materialsById[line.raw_material_id];
                const materialUnit = material ? unitsById[material.unit_id] : undefined;
                const cost = lineCost(line);
                const qtyInvalid = line.qtyText.trim() !== '' && (parsePositiveNumber(line.qtyText) ?? 0) <= 0;
                // نسبة السطر من تكلفة الصنف — تبيّن أي مادة تقود التكلفة
                const share = cost !== null && costed.total > 0 ? (cost / costed.total) * 100 : null;
                // كم يمثّل هذا السطر من وحدة شراء المادة — يُعرض فقط لما تختلف الوحدتان
                const lineUnit = unitsById[line.unit_id];
                const qtyNum = parsePositiveNumber(line.qtyText);
                const portionOfPurchase =
                  materialUnit && lineUnit && qtyNum !== null && qtyNum > 0 && lineUnit.id !== materialUnit.id
                    ? convertQuantity(qtyNum, lineUnit, materialUnit)
                    : null;

                return (
                  <div key={line.key} className="grid grid-cols-2 sm:grid-cols-[1fr_100px_120px_120px_36px] gap-2 items-center">
                    {/* المادة — اسم لا قائمة. الضغط عليه يفتح المنتقي للتبديل */}
                    <button
                      type="button"
                      onClick={() => canEdit && setPicker({ mode: 'replace', key: line.key })}
                      disabled={!canEdit}
                      title={canEdit ? 'اضغط لتبديل المادة' : undefined}
                      className={`col-span-2 sm:col-span-1 text-right px-3 py-2 rounded-lg border border-slate-200 min-w-0 ${
                        canEdit ? 'hover:border-emerald-300 hover:bg-slate-50 transition-colors' : ''
                      }`}
                    >
                      <span className="block font-semibold text-slate-800 text-sm truncate">
                        {material?.name ?? <span className="text-red-500">مادة محذوفة</span>}
                      </span>
                      {material && (
                        <span className="block text-[11px] text-slate-400" dir="ltr">
                          {material.unit_cost > 0
                            ? `${formatMoney(material.unit_cost)} ر / ${materialUnit?.name ?? '؟'}`
                            : '—'}
                        </span>
                      )}
                    </button>

                    <div>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={line.qtyText}
                        onChange={e => updateLine(line.key, { qtyText: e.target.value })}
                        disabled={!canEdit}
                        dir="ltr"
                        placeholder="0"
                        className={`input-field py-2 text-sm text-center w-full ${qtyInvalid ? 'border-red-300' : ''}`}
                      />
                      {/* الجزء المأخوذ من وحدة الشراء — يوضّح إن 2 مل = 0.002 لتر */}
                      {portionOfPurchase !== null && (
                        <div className="text-[10px] text-slate-400 text-center mt-0.5" dir="ltr">
                          = {formatQty(portionOfPurchase)} {materialUnit?.name}
                        </div>
                      )}
                    </div>

                    <UnitPicker
                      units={units}
                      value={line.unit_id}
                      onChange={id => updateLine(line.key, { unit_id: id })}
                      restrictToFamilyOf={materialUnit}
                      disabled={!canEdit || !material}
                      canCreate={canEdit && !!materialUnit}
                      onUnitCreated={onDataChanged}
                      className="input-field py-2 text-sm"
                    />

                    <div className="text-left tabular-nums" dir="ltr">
                      {cost === null ? (
                        <span className="text-slate-300 text-sm">—</span>
                      ) : cost > 0 ? (
                        <>
                          <span className="block text-sm font-bold text-slate-700">{formatMoney(cost)}</span>
                          {share !== null && (
                            <span className="block text-[10px] text-slate-400">{Math.round(share)}%</span>
                          )}
                        </>
                      ) : (
                        <span className="text-amber-600 text-xs">بلا سعر</span>
                      )}
                    </div>

                    {canEdit && (
                      <button
                        onClick={() => removeLine(line.key)}
                        title="حذف المكوّن"
                        className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors justify-self-end"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}

              {canEdit && (
                <button
                  onClick={() => setPicker({ mode: 'add' })}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 text-sm font-semibold hover:border-emerald-300 hover:text-emerald-600 transition-colors"
                >
                  + إضافة مواد أولية
                </button>
              )}
            </>
          )}

          {/* التحذيرات */}
          {costed.issues.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 space-y-1">
              <b>أسطر تحتاج انتباه:</b>
              {costed.issues.map((i, idx) => (
                <div key={idx} className="text-xs">
                  • {i.name}: {LINE_ISSUE_LABELS[i.issue!]}
                  {i.issue === 'unit_mismatch' && i.material_unit_name && (
                    <> — المادة تُشترى بـ«{i.material_unit_name}»</>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* الإجمالي + الحفظ */}
        <div className="border-t border-slate-100 px-6 py-4 space-y-3">
          <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <div>
              <div className="text-xs text-emerald-700 font-semibold">تكلفة الحصة الواحدة</div>
              <div className="text-[11px] text-emerald-600/70">
                {lines.length} مادة أولية
                {costed.issues.length > 0 && ` — ${costed.issues.length} منها غير محتسب`}
              </div>
            </div>
            <div className="text-2xl font-extrabold text-emerald-700 tabular-nums" dir="ltr">
              {formatMoney(costed.total)} <span className="text-sm font-bold">ريال</span>
            </div>
          </div>

          {costed.total > 0 && (
            <div className="text-[11px] text-slate-500 text-center">
              يعني 100 حصة = <b dir="ltr">{formatMoney(costed.total * 100)}</b> ريال
              {' · '}
              1000 حصة = <b dir="ltr">{formatMoney(costed.total * 1000)}</b> ريال
            </div>
          )}

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div className="flex gap-3">
            {canEdit && (
              <button
                onClick={() => void handleSave()}
                disabled={saving || hasBlockingIssue}
                className="btn-primary flex-1 justify-center"
                title={hasBlockingIssue ? 'صحّح الأسطر المعطوبة أولاً' : undefined}
              >
                {saving ? 'جاري الحفظ...' : 'حفظ الوصفة'}
              </button>
            )}
            <button onClick={onClose} className="btn-secondary">{canEdit ? 'إلغاء' : 'إغلاق'}</button>
          </div>
        </div>
      </div>

      {picker && (
        <IngredientPicker
          materials={materials}
          unitsById={unitsById}
          units={units}
          // في وضع التبديل نسمح بالمادة الحالية عشان ما تظهر "مضافة" على نفسها
          usedIds={
            picker.mode === 'replace'
              ? new Set(lines.filter(l => l.key !== picker.key).map(l => l.raw_material_id))
              : usedIds
          }
          mode={picker.mode}
          mealName={meal.name}
          canCreate={canEdit}
          onConfirm={handlePicked}
          onCancel={() => setPicker(null)}
          onDataChanged={onDataChanged}
        />
      )}
    </div>
  );
}
