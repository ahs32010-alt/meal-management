'use client';

import { useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Meal, MealType, EntityType, ItemCategory } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL, ENTITY_BADGE_STYLES, CATEGORY_LABELS } from '@/lib/types';

const CATEGORY_THEME: Record<ItemCategory, { icon: string; bg: string; textOn: string }> = {
  hot:   { icon: '🔥', bg: 'bg-red-500',   textOn: 'text-white' },
  cold:  { icon: '❄️', bg: 'bg-sky-500',   textOn: 'text-white' },
  snack: { icon: '🍿', bg: 'bg-amber-500', textOn: 'text-white' },
};

interface Props {
  meal: Meal | null;
  defaultType?: MealType;
  defaultIsSnack?: boolean;
  // الفئة التي ينتمي لها هذا الصنف. عند التعديل نحترم نوع الصنف الأصلي،
  // وعند الإنشاء الجديد ناخذ القيمة من الـtab الحالي في صفحة الأصناف.
  entityType?: EntityType;
  onClose: () => void;
  onSaved: () => void;
}

export default function MealModal({ meal, defaultType = 'lunch', defaultIsSnack = false, entityType: entityTypeProp = 'beneficiary', onClose, onSaved }: Props) {
  const entityType: EntityType = (meal?.entity_type as EntityType | undefined) ?? entityTypeProp;
  const [name, setName] = useState(meal?.name ?? '');
  const [englishName, setEnglishName] = useState(meal?.english_name ?? '');
  const [type, setType] = useState<MealType>(meal?.type ?? defaultType);
  const [isSnack, setIsSnack] = useState(meal?.is_snack ?? defaultIsSnack);
  // التصنيف الافتراضي: لو سناك → snack، وإلا hot. المستخدم يقدر يبدّل لـ cold.
  const [category, setCategory] = useState<ItemCategory>(
    meal?.category ?? (meal?.is_snack ?? defaultIsSnack ? 'snack' : 'hot')
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const supabase = useMemo(() => createClient(), []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('يرجى إدخال اسم الصنف'); return; }
    setSaving(true);
    setError('');

    const payload: Record<string, unknown> = {
      name: name.trim(),
      english_name: englishName.trim() || null,
      type,
      is_snack: isSnack,
      category,
    };
    // فقط نضيف entity_type عند الإنشاء — التعديل ما يغيّر النوع
    if (!meal) payload.entity_type = entityType;

    if (meal) {
      let r = await supabase.from('meals').update(payload).eq('id', meal.id);
      if (r.error && /category|column/i.test(r.error.message)) {
        delete payload.category;
        r = await supabase.from('meals').update(payload).eq('id', meal.id);
      }
      const { error } = r;
      if (error) { setError(error.message); setSaving(false); return; }
      // إذا تغير الاسم → حدّث الكلمة في الترجمة
      if (meal.name !== payload.name) {
        await supabase
          .from('custom_transliterations')
          .update({ word: payload.name })
          .eq('word', meal.name);
      }
      void logActivity({
        action: 'update',
        entity_type: 'meal',
        entity_id: meal.id,
        entity_name: payload.name as string,
        details: {
          previous_name: meal.name !== payload.name ? meal.name : undefined,
          type: payload.type,
          is_snack: payload.is_snack,
          for_entity: entityType,
        },
      });
    } else {
      let r = await supabase.from('meals').insert(payload).select('id').single();
      if (r.error && /category|column/i.test(r.error.message)) {
        delete payload.category;
        r = await supabase.from('meals').insert(payload).select('id').single();
      }
      const { data, error } = r;
      if (error) { setError(error.message); setSaving(false); return; }
      void logActivity({
        action: 'create',
        entity_type: 'meal',
        entity_id: data?.id ?? null,
        entity_name: payload.name as string,
        details: { type: payload.type, is_snack: payload.is_snack, for_entity: entityType },
      });
    }

    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-slate-800">
              {meal ? 'تعديل صنف' : 'إضافة صنف جديد'}
            </h2>
            <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>
              {ENTITY_TYPE_LABELS_PLURAL[entityType]}
            </span>
          </div>
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
            <label className="label">نوع الصنف *</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => {
                setIsSnack(false);
                if (category === 'snack') setCategory('hot');
              }}
                className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${!isSnack ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                صنف وجبة
              </button>
              <button type="button" onClick={() => {
                setIsSnack(true);
                setCategory('snack');
              }}
                className={`py-3 rounded-xl border-2 font-semibold text-sm transition-all ${isSnack ? 'border-amber-500 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                سناك
              </button>
            </div>
          </div>

          {/* الفئة (حار/بارد/سناك) — تنعكس على الستيكرات والتقارير في كل مكان */}
          <div>
            <label className="label flex items-center gap-2">
              الفئة <span className="text-red-500">*</span>
              <span className="text-[11px] font-normal text-slate-400">— يحدّد الكيس في الستيكرات</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['hot', 'cold', 'snack'] as ItemCategory[]).map(c => {
                const t = CATEGORY_THEME[c];
                const active = category === c;
                // لو الصنف "سناك"، نقفل اختيار حار/بارد ونثبّته على snack
                const disabled = isSnack && c !== 'snack';
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => !disabled && setCategory(c)}
                    disabled={disabled}
                    className={`flex items-center justify-center gap-2 py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                      active
                        ? `${t.bg} ${t.textOn} border-transparent shadow-md`
                        : disabled
                          ? 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-lg leading-none">{t.icon}</span>
                    <span>{CATEGORY_LABELS[c]}</span>
                  </button>
                );
              })}
            </div>
            {!isSnack && (
              <p className="text-[11px] text-slate-400 mt-1.5">
                اختر &quot;حار&quot; أو &quot;بارد&quot; — راح ينعكس تلقائياً في كل أوامر التشغيل والمنيو والستيكرات.
              </p>
            )}
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
