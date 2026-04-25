'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Meal, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';

interface Props {
  meal: Meal | null;
  defaultType?: MealType;
  defaultIsSnack?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function MealModal({ meal, defaultType = 'lunch', defaultIsSnack = false, onClose, onSaved }: Props) {
  const [name, setName] = useState(meal?.name ?? '');
  const [englishName, setEnglishName] = useState(meal?.english_name ?? '');
  const [type, setType] = useState<MealType>(meal?.type ?? defaultType);
  const [isSnack, setIsSnack] = useState(meal?.is_snack ?? defaultIsSnack);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const supabase = useMemo(() => createClient(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('يرجى إدخال اسم الصنف'); return; }
    setSaving(true);
    setError('');

    const payload = {
      name: name.trim(),
      english_name: englishName.trim() || null,
      type,
      is_snack: isSnack,
    };

    if (meal) {
      const { error } = await supabase.from('meals').update(payload).eq('id', meal.id);
      if (error) { setError(error.message); setSaving(false); return; }
      // إذا تغير الاسم → حدّث الكلمة في الترجمة
      if (meal.name !== payload.name) {
        await supabase
          .from('custom_transliterations')
          .update({ word: payload.name })
          .eq('word', meal.name);
      }
      await logActivity({
        action: 'update',
        entity_type: 'meal',
        entity_id: meal.id,
        entity_name: payload.name,
        details: {
          previous_name: meal.name !== payload.name ? meal.name : undefined,
          type: payload.type,
          is_snack: payload.is_snack,
        },
      });
    } else {
      const { data, error } = await supabase.from('meals').insert(payload).select('id').single();
      if (error) { setError(error.message); setSaving(false); return; }
      await logActivity({
        action: 'create',
        entity_type: 'meal',
        entity_id: data?.id ?? null,
        entity_name: payload.name,
        details: { type: payload.type, is_snack: payload.is_snack },
      });
    }

    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">
            {meal ? 'تعديل صنف' : 'إضافة صنف جديد'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">اسم الصنف (عربي) *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="input-field" placeholder="مثال: أرز بالدجاج" autoFocus />
          </div>

          <div>
            <label className="label">الاسم بالإنجليزي (للستيكر)</label>
            <input type="text" value={englishName} onChange={e => setEnglishName(e.target.value)} className="input-field" placeholder="مثال: Arz bil Djaj" dir="ltr" />
          </div>

          <div>
            <label className="label">نوع الوجبة *</label>
            <select value={type} onChange={e => setType(e.target.value as MealType)} className="input-field">
              {Object.entries(MEAL_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">التصنيف *</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setIsSnack(false)}
                className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${!isSnack ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                صنف وجبة
              </button>
              <button type="button" onClick={() => setIsSnack(true)}
                className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${isSnack ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                سناك
              </button>
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? 'جاري الحفظ...' : meal ? 'حفظ التعديلات' : 'إضافة الصنف'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      </div>
    </div>
  );
}
