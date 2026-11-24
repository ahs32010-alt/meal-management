'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Meal } from '@/lib/types';
import { saveMealTexture, textureMealName } from '@/lib/meal-textures';

/**
 * «الحالات الغذائية» للصنف — مهروس / خلاط / مقطع …
 *
 * كل حالة = صف في meals مربوط بالأصل (texture_of) ونظام غذائي (texture_diet_id).
 * الاسم والخصائص والربط بالنظام كلها تتم بالـtriggers في
 * supabase/meal-textures-migration.sql — هنا نكتب ثلاث خانات فقط.
 */

const SUGGESTIONS = ['مهروس', 'خلاط', 'مقطع', 'مفروم', 'سائل'];

const MIGRATION_HINT =
  'الحالات الغذائية تحتاج تشغيل ملف الترقية: supabase/meal-textures-migration.sql';

interface TextureRow {
  id: string;
  name: string;
  texture_name: string;
  texture_diet_id: string | null;
}

interface Props {
  meal: Meal;
  disabled?: boolean;
}

export default function MealTexturesEditor({ meal, disabled }: Props) {
  const [rows, setRows] = useState<TextureRow[]>([]);
  const [diets, setDiets] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [newDiet, setNewDiet] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [tRes, dRes] = await Promise.all([
      supabase.from('meals').select('id, name, texture_name, texture_diet_id')
        .eq('texture_of', meal.id).order('created_at'),
      supabase.from('diet_systems').select('id, name').order('name'),
    ]);
    if (tRes.error) {
      setError(/texture|column/i.test(tRes.error.message) ? MIGRATION_HINT : tRes.error.message);
    } else {
      setRows((tRes.data ?? []) as TextureRow[]);
    }
    setDiets((dRes.data ?? []) as { id: string; name: string }[]);
    setLoading(false);
  }, [meal.id]);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const tex = newName.trim();
    if (!tex) { setError('اكتب اسم الحالة (مثال: مهروس)'); return; }
    if (!newDiet) { setError('اختر النظام الغذائي المربوط بالحالة'); return; }
    if (rows.some(r => r.texture_name.trim() === tex)) { setError(`الحالة «${tex}» موجودة أصلاً`); return; }
    setBusy(true);
    setError('');

    const r = await saveMealTexture(supabase, meal, tex, newDiet);
    const variantName = textureMealName(meal.name, tex);
    const variantId = r.id;
    if (r.error) {
      setError(/texture|column/i.test(r.error) ? MIGRATION_HINT
        : /duplicate|unique/i.test(r.error) ? `الحالة «${tex}» موجودة أصلاً لهذا الصنف`
        : r.error);
      setBusy(false);
      return;
    }
    void logActivity({
      action: 'create',
      entity_type: 'meal',
      entity_id: variantId,
      entity_name: variantName,
      details: {
        texture_of: meal.name,
        texture_name: tex,
        diet: diets.find(d => d.id === newDiet)?.name ?? null,
      },
    });
    setNewName('');
    setNewDiet('');
    setBusy(false);
    void load();
  };

  const changeDiet = async (row: TextureRow, dietId: string) => {
    setBusy(true);
    setError('');
    const { error: e } = await supabase.from('meals')
      .update({ texture_diet_id: dietId || null }).eq('id', row.id);
    if (e) setError(e.message);
    setBusy(false);
    void load();
  };

  const remove = async (row: TextureRow) => {
    if (!confirm(`حذف الحالة «${row.texture_name}»؟\nالمستفيدين اللي نظامهم مربوط فيها يرجعون ياخذون «${meal.name}» العادي.`)) return;
    setBusy(true);
    setError('');
    const { error: e } = await supabase.from('meals').delete().eq('id', row.id);
    if (e) setError(e.message);
    else {
      void logActivity({
        action: 'delete',
        entity_type: 'meal',
        entity_id: row.id,
        entity_name: row.name,
        details: { texture_of: meal.name, texture_name: row.texture_name },
      });
    }
    setBusy(false);
    void load();
  };

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 space-y-2">
      <div>
        <div className="text-sm font-bold text-violet-800">🥣 الحالات الغذائية</div>
        <p className="text-[11px] text-slate-500 mt-0.5">
          كل حالة تُربط بنظام غذائي: من عنده النظام ياخذ «{meal.name} (الحالة)» بدل «{meal.name}» في أمر التشغيل تلقائياً.
        </p>
      </div>

      {loading ? (
        <div className="text-xs text-slate-400">جاري التحميل…</div>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="space-y-1.5">
              {rows.map(r => (
                <li key={r.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 px-2 py-1.5">
                  <span className="text-sm font-semibold text-slate-700 flex-1 min-w-0 truncate" title={r.name}>
                    {r.texture_name}
                  </span>
                  <select
                    value={r.texture_diet_id ?? ''}
                    onChange={e => changeDiet(r, e.target.value)}
                    disabled={busy || disabled}
                    className="input-field !py-1 !text-xs max-w-[55%]"
                  >
                    <option value="">— بدون نظام —</option>
                    {diets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => remove(r)}
                    disabled={busy || disabled}
                    className="w-7 h-7 flex items-center justify-center text-red-500 hover:bg-red-50 rounded-lg shrink-0"
                    title="حذف الحالة"
                  >✕</button>
                </li>
              ))}
            </ul>
          )}

          {!disabled && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                list="meal-texture-suggestions"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="الحالة: مهروس"
                className="input-field !py-1.5 !text-sm flex-1 min-w-0"
              />
              <datalist id="meal-texture-suggestions">
                {SUGGESTIONS.map(s => <option key={s} value={s} />)}
              </datalist>
              <select
                value={newDiet}
                onChange={e => setNewDiet(e.target.value)}
                className="input-field !py-1.5 !text-sm flex-1 min-w-0"
              >
                <option value="">النظام الغذائي…</option>
                {diets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <button type="button" onClick={add} disabled={busy}
                className="btn-primary !py-1.5 !px-3 text-sm shrink-0">
                {busy ? '…' : '+ إضافة'}
              </button>
            </div>
          )}
        </>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  );
}
