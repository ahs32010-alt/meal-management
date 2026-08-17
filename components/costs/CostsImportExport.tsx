'use client';

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { exportWorkbook, parseWorkbook, type WorkbookSheet } from '@/lib/xlsx-utils';
import {
  COLS,
  MATERIAL_HEADERS,
  RECIPE_HEADERS,
  SHEETS,
  UNIT_HEADERS,
  buildGuideRows,
  buildMaterialRows,
  buildRecipeRows,
  buildUnitRows,
  nameKey,
  planImport,
  summarizePlan,
  templateSamples,
  type ImportPlan,
} from '@/lib/costs-xlsx';
import type { CostUnitDef, RawMaterial, RecipeItem } from '@/lib/costs';
import type { Meal } from '@/lib/types';

interface Props {
  units: CostUnitDef[];
  materials: RawMaterial[];
  meals: Meal[];
  recipes: RecipeItem[];
  canImport: boolean;
  onChanged: () => Promise<void>;
}

const stamp = () => new Date().toISOString().slice(0, 10);

export default function CostsImportExport({
  units, materials, meals, recipes, canImport, onChanged,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState('');
  const [done, setDone] = useState('');

  // ── التصدير ───────────────────────────────────────────────────────────────

  const handleExport = () => {
    const sheets: WorkbookSheet[] = [
      { name: SHEETS.guide,     rows: buildGuideRows(), headers: ['كيف تستخدم هذا الملف'] },
      { name: SHEETS.units,     rows: buildUnitRows(units),                 headers: UNIT_HEADERS },
      { name: SHEETS.materials, rows: buildMaterialRows(materials, units),  headers: MATERIAL_HEADERS },
      { name: SHEETS.recipes,   rows: buildRecipeRows({ units, materials, meals, recipes }), headers: RECIPE_HEADERS },
    ];
    void exportWorkbook(sheets, `التكاليف-${stamp()}.xlsx`);
  };

  /** قالب فارغ برؤوس الأعمدة وأسطر مثال — الوحدات الحالية تنزل معه للمرجع */
  const handleTemplate = () => {
    const s = templateSamples();
    const sheets: WorkbookSheet[] = [
      { name: SHEETS.guide,     rows: buildGuideRows(), headers: ['كيف تستخدم هذا الملف'] },
      // الوحدات الموجودة فعلاً + أمثلة، عشان يعرف بأي وحدة يكتب
      { name: SHEETS.units,     rows: [...buildUnitRows(units), ...s.units], headers: UNIT_HEADERS },
      { name: SHEETS.materials, rows: s.materials, headers: MATERIAL_HEADERS },
      { name: SHEETS.recipes,   rows: s.recipes,   headers: RECIPE_HEADERS },
    ];
    void exportWorkbook(sheets, `قالب-التكاليف-${stamp()}.xlsx`);
  };

  // ── الاستيراد ─────────────────────────────────────────────────────────────

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';           // يسمح بإعادة اختيار نفس الملف
    if (!file) return;

    setBusy(true);
    setApplyError('');
    setDone('');
    try {
      const sheets = await parseWorkbook(file);
      setFileName(file.name);
      setPlan(planImport(sheets, { units, materials, meals }));
    } catch {
      setApplyError('تعذّرت قراءة الملف — تأكد أنه ملف Excel صالح.');
    }
    setBusy(false);
  };

  /**
   * التطبيق بالترتيب: وحدات ← مواد ← وصفات. كل مرحلة تعتمد على سابقتها،
   * فنعيد بناء خريطة الأسماء بعد كل إدراج بدل ما نفترض المعرّفات.
   */
  const handleApply = async () => {
    if (!plan || plan.errors.length > 0) return;
    setBusy(true);
    setApplyError('');

    try {
      // ١) الوحدات الجديدة
      if (plan.newUnits.length > 0) {
        const { error } = await supabase.from('cost_units').insert(
          plan.newUnits.map(u => ({ name: u.name, family: u.family, factor: u.factor, is_builtin: false })),
        );
        if (error) throw new Error(`الوحدات: ${error.message}`);
      }

      // نعيد قراءة الوحدات عشان نعرف معرّفات الجديدة
      const { data: unitRows, error: unitErr } = await supabase
        .from('cost_units').select('id, name');
      if (unitErr) throw new Error(`قراءة الوحدات: ${unitErr.message}`);
      const unitIdByName = new Map((unitRows ?? []).map(u => [nameKey(u.name), u.id as string]));

      // ٢) المواد — إدراج الجديدة وتحديث المتغيّرة فقط
      const toInsert = plan.materials.filter(m => !m.id);
      const toUpdate = plan.materials.filter(m => m.id && m.changed);

      if (toInsert.length > 0) {
        const { error } = await supabase.from('raw_materials').insert(
          toInsert.map(m => ({
            name: m.name,
            unit_id: unitIdByName.get(nameKey(m.unitName)),
            unit_cost: m.unit_cost,
            notes: m.notes,
          })),
        );
        if (error) throw new Error(`المواد الأولية: ${error.message}`);
      }

      for (const m of toUpdate) {
        const { error } = await supabase.from('raw_materials').update({
          unit_id: unitIdByName.get(nameKey(m.unitName)),
          unit_cost: m.unit_cost,
          notes: m.notes,
        }).eq('id', m.id!);
        if (error) throw new Error(`تحديث «${m.name}»: ${error.message}`);
      }

      // ٣) الوصفات — نعيد قراءة المواد لمعرفة معرّفات الجديدة
      if (plan.recipes.length > 0) {
        const { data: matRows, error: matErr } = await supabase
          .from('raw_materials').select('id, name');
        if (matErr) throw new Error(`قراءة المواد: ${matErr.message}`);
        const matIdByName = new Map((matRows ?? []).map(m => [nameKey(m.name), m.id as string]));

        const mealIds = plan.recipes.map(r => r.meal.id);
        // كل صنف في الملف تُستبدل وصفته بالكامل — نفس دلالة محرّر الوصفة
        const { error: delErr } = await supabase
          .from('meal_recipe_items').delete().in('meal_id', mealIds);
        if (delErr) throw new Error(`مسح الوصفات القديمة: ${delErr.message}`);

        const rows = plan.recipes.flatMap(r =>
          r.lines.map(l => ({
            meal_id: r.meal.id,
            raw_material_id: matIdByName.get(nameKey(l.materialName)),
            quantity: l.quantity,
            unit_id: unitIdByName.get(nameKey(l.unitName)),
          })),
        );

        const missing = rows.filter(r => !r.raw_material_id || !r.unit_id);
        if (missing.length > 0) throw new Error('تعذّر ربط بعض المواد أو الوحدات بعد الحفظ.');

        const { error: insErr } = await supabase.from('meal_recipe_items').insert(rows);
        if (insErr) throw new Error(`حفظ الوصفات: ${insErr.message}`);
      }

      void logActivity({
        action: 'update',
        entity_type: 'raw_material',
        entity_name: `استيراد Excel — ${fileName}`,
        details: {
          source: 'costs_xlsx_import',
          ...plan.stats,
        },
      });

      await onChanged();
      setDone(summarizePlan(plan).join(' · '));
      setPlan(null);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : 'تعذّر تطبيق الاستيراد');
    }
    setBusy(false);
  };

  const blocked = !!plan && plan.errors.length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={handleTemplate} className="btn-secondary text-sm" title="ملف فارغ برؤوس الأعمدة وأمثلة">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          تنزيل قالب
        </button>

        <button onClick={handleExport} className="btn-secondary text-sm" title="كل المواد والوحدات والوصفات الحالية">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          تصدير الكل
        </button>

        {canImport && (
          <>
            <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-primary text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {busy && !plan ? 'جاري القراءة...' : 'استيراد من Excel'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={e => void handleFile(e)}
              className="hidden"
            />
          </>
        )}
      </div>

      {done && (
        <div className="mt-3 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3">
          <span>✓ تم الاستيراد — {done}</span>
          <button onClick={() => setDone('')} className="text-emerald-500 hover:text-emerald-700 shrink-0">✕</button>
        </div>
      )}

      {applyError && !plan && (
        <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-start justify-between gap-3">
          <span>{applyError}</span>
          <button onClick={() => setApplyError('')} className="text-red-400 hover:text-red-600 shrink-0">✕</button>
        </div>
      )}

      {/* معاينة قبل التطبيق — لا يُكتب شيء قبل موافقة صريحة */}
      {plan && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h3 className="font-bold text-slate-800">معاينة الاستيراد</h3>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[300px]">{fileName}</p>
              </div>
              <button onClick={() => setPlan(null)} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {blocked ? (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <div className="font-bold text-red-700 text-sm mb-2">
                    {plan.errors.length} خطأ — ما راح يُحفظ أي شي حتى تُصحَّح
                  </div>
                  <ul className="space-y-1 max-h-64 overflow-y-auto">
                    {plan.errors.slice(0, 60).map((e, i) => (
                      <li key={i} className="text-xs text-red-700">• {e}</li>
                    ))}
                  </ul>
                  {plan.errors.length > 60 && (
                    <p className="text-[11px] text-red-500 mt-2">…و{plan.errors.length - 60} خطأ آخر</p>
                  )}
                </div>
              ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <div className="font-bold text-emerald-800 text-sm mb-2">الملف سليم — سيُطبَّق التالي:</div>
                  <ul className="space-y-1">
                    {summarizePlan(plan).map((line, i) => (
                      <li key={i} className="text-xs text-emerald-800">• {line}</li>
                    ))}
                  </ul>
                </div>
              )}

              {plan.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="font-bold text-amber-800 text-sm mb-2">تنبيهات ({plan.warnings.length})</div>
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {plan.warnings.slice(0, 30).map((w, i) => (
                      <li key={i} className="text-xs text-amber-800">• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!blocked && plan.recipes.length > 0 && (
                <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  ⚠️ تسعير هذي الأصناف <b>يُستبدل بالكامل</b> بما في الملف. الأصناف غير المذكورة لا تتأثر.
                </div>
              )}

              {applyError && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{applyError}</div>
              )}
            </div>

            <div className="border-t border-slate-100 px-6 py-4 flex gap-3">
              <button
                onClick={() => void handleApply()}
                disabled={busy || blocked}
                className="btn-primary flex-1 justify-center"
                title={blocked ? 'صحّح الأخطاء في الملف أولاً' : undefined}
              >
                {busy ? 'جاري الحفظ...' : 'تطبيق الاستيراد'}
              </button>
              <button onClick={() => setPlan(null)} className="btn-secondary">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
