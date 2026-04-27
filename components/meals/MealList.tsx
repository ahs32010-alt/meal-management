'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { Meal, MealType, EntityType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL, ENTITY_BADGE_STYLES } from '@/lib/types';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { exportXLSX } from '@/lib/xlsx-utils';

const MealModal = dynamic(() => import('./MealModal'), { ssr: false });
const ImportModal = dynamic(() => import('@/components/shared/ImportModal'), { ssr: false });

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];

const TYPE_COLORS: Record<MealType, { bg: string; text: string; border: string }> = {
  breakfast: { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200' },
  lunch: { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200' },
  dinner: { bg: 'bg-purple-50', text: 'text-purple-800', border: 'border-purple-200' },
};

interface MealSectionProps {
  title: string;
  meals: Meal[];
  isSnack: boolean;
  mealType: MealType;
  colors: { bg: string; text: string; border: string };
  onAdd: (type: MealType, isSnack: boolean) => void;
  onBulkAdd: (type: MealType, isSnack: boolean) => void;
  onEdit: (meal: Meal) => void;
  onDuplicate: (meal: Meal) => void;
  onDelete: (id: string) => void;
  onDeleteAll: (type: MealType, isSnack: boolean) => void;
  deleting: string | null;
  duplicating: string | null;
  deletingAll: boolean;
}

function MealSection({ title, meals, isSnack, mealType, colors, onAdd, onBulkAdd, onEdit, onDuplicate, onDelete, onDeleteAll, deleting, duplicating, deletingAll }: MealSectionProps) {
  return (
    <div className={`rounded-xl border ${colors.border} overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-3 ${colors.bg}`}>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-sm ${colors.text}`}>{title}</span>
          <span className={`badge text-xs ${colors.bg} ${colors.text} border ${colors.border}`}>{meals.length} صنف</span>
        </div>
        <div className="flex items-center gap-1">
          {meals.length > 0 && (
            <button
              onClick={() => onDeleteAll(mealType, isSnack)}
              disabled={deletingAll}
              title="حذف الكل"
              className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-40"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              حذف الكل
            </button>
          )}
          <button
            onClick={() => onBulkAdd(mealType, isSnack)}
            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${colors.border} ${colors.text} hover:opacity-80 transition-opacity`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h8" />
            </svg>
            إضافة جماعية
          </button>
          <button
            onClick={() => onAdd(mealType, isSnack)}
            className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border ${colors.border} ${colors.text} hover:opacity-80 transition-opacity`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة
          </button>
        </div>
      </div>
      {meals.length === 0 ? (
        <div className="py-6 text-center text-slate-400 text-sm bg-white">لا توجد أصناف</div>
      ) : (
        <div className="bg-white divide-y divide-slate-100">
          {meals.map((meal) => (
            <div key={meal.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50">
              <div>
                <span className="font-medium text-slate-800 text-sm">{meal.name}</span>
                {meal.english_name && (
                  <span className="text-slate-400 text-xs mr-2 font-mono">({meal.english_name})</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => onEdit(meal)} title="تعديل" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => onDuplicate(meal)}
                  disabled={duplicating === meal.id}
                  title="نسخ هذا الصنف مع كل تخصيصاته"
                  className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors disabled:opacity-40"
                >
                  {duplicating === meal.id ? (
                    <div className="w-3.5 h-3.5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => onDelete(meal.id)}
                  disabled={deleting === meal.id}
                  title="حذف"
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk Add Modal ──────────────────────────────────────────────────────────
interface BulkAddModalProps {
  title: string;
  mealType: MealType;
  isSnack: boolean;
  onSave: (names: string[], type: MealType, isSnack: boolean) => Promise<{ added: number; errors: string[] }>;
  onClose: () => void;
}

function BulkAddModal({ title, mealType, isSnack, onSave, onClose }: BulkAddModalProps) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ added: number; errors: string[] } | null>(null);

  const names = text.split('\n').map(l => l.trim()).filter(Boolean);

  const handleSave = async () => {
    if (names.length === 0) return;
    setSaving(true);
    const res = await onSave(names, mealType, isSnack);
    setResult(res);
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">إضافة جماعية — {title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="p-6 space-y-4">
          {!result ? (
            <>
              <p className="text-sm text-slate-500">اكتب كل صنف في سطر منفصل:</p>
              <textarea
                autoFocus
                value={text}
                onChange={e => setText(e.target.value)}
                rows={10}
                placeholder={'أرز بالدجاج\nمعكرونة\nشوربة عدس\n...'}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-400 font-medium leading-relaxed"
              />
              {names.length > 0 && (
                <p className="text-xs text-emerald-700 font-semibold">{names.length} صنف جاهز للإضافة</p>
              )}
            </>
          ) : (
            <div className={`border rounded-xl p-4 ${result.errors.length === 0 ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
              <p className={`font-bold text-sm ${result.errors.length === 0 ? 'text-green-800' : 'text-orange-800'}`}>
                ✓ تمت إضافة {result.added} صنف بنجاح
              </p>
              {result.errors.length > 0 && (
                <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
                  {result.errors.map((e, i) => <p key={i} className="text-xs text-orange-700">{e}</p>)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6">
          {!result ? (
            <>
              <button
                onClick={handleSave}
                disabled={saving || names.length === 0}
                className="btn-primary flex-1 justify-center"
              >
                {saving ? 'جاري الحفظ...' : `إضافة ${names.length > 0 ? names.length + ' أصناف' : ''}`}
              </button>
              <button onClick={onClose} className="btn-secondary flex-1 justify-center">إلغاء</button>
            </>
          ) : (
            <button onClick={onClose} className="btn-primary flex-1 justify-center">إغلاق</button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MealList() {
  // الـtab بين أصناف المستفيدين وأصناف المرافقين — يُحفظ في localStorage
  // عشان يبقى محدد بين الجلسات (راحة للمستخدم).
  const [entityType, setEntityType] = useState<EntityType>(() => {
    if (typeof window === 'undefined') return 'beneficiary';
    return (window.localStorage.getItem('mealsEntityType') as EntityType | null) ?? 'beneficiary';
  });
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkAddTarget, setBulkAddTarget] = useState<{ mealType: MealType; isSnack: boolean } | null>(null);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [modalDefaults, setModalDefaults] = useState<{ type: MealType; isSnack: boolean }>({ type: 'lunch', isSnack: false });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<{ name: string; excl: number; fixed: number; menu: number } | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const [search, setSearch] = useState('');
  const supabase = useMemo(() => createClient(), []);

  // كل ما تغيّر الـtab نخزن الاختيار ونعيد التحميل.
  const switchEntity = useCallback((next: EntityType) => {
    setEntityType(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mealsEntityType', next);
    }
  }, []);

  const fetchMeals = useCallback(async () => {
    setLoading(true);
    try {
      // نحاول الفلترة بـentity_type أولاً، ولو العمود ما موجود (الـmigration ما اتشغّل)
      // نرجع لجميع الصفوف (و للمرافقين نظهر تنبيه).
      const tryFetch = async (withEntity: boolean) => {
        const q = supabase
          .from('meals')
          .select(`id, name, english_name, type, is_snack${withEntity ? ', entity_type' : ''}, created_at`)
          .order('type').order('is_snack').order('name');
        return withEntity ? q.eq('entity_type', entityType) : q;
      };
      let res = await tryFetch(true);
      if (res.error && /entity_type|column/i.test(res.error.message)) {
        if (entityType === 'companion') {
          alert(
            'صفحة أصناف المرافقين تحتاج تشغيل ملف الترقية:\n' +
            'supabase/companions-meals-migration.sql'
          );
          setMeals([]);
          setLoading(false);
          return;
        }
        res = await tryFetch(false);
      }
      if (res.error) throw res.error;
      if (res.data) setMeals(res.data as unknown as Meal[]);
    } catch (err) {
      console.error('Fetch meals error:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase, entityType]);

  useEffect(() => { fetchMeals(); }, [fetchMeals]);

  const handleDelete = (id: string) => {
    const meal = meals.find(m => m.id === id);
    setDialog({
      title: 'حذف صنف',
      message: `هل أنت متأكد من حذف "${meal?.name ?? 'هذا الصنف'}"؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeleting(id);
        await supabase.from('meals').delete().eq('id', id);
        if (meal) await supabase.from('custom_transliterations').delete().eq('word', meal.name);
        void logActivity({
          action: 'delete',
          entity_type: 'meal',
          entity_id: id,
          entity_name: meal?.name ?? null,
          details: meal ? { type: meal.type, is_snack: meal.is_snack } : null,
        });
        await fetchMeals();
        setDeleting(null);
      },
    });
  };

  const handleDeleteAll = (type: MealType, isSnack: boolean) => {
    const section = meals.filter(m => m.type === type && m.is_snack === isSnack);
    if (section.length === 0) return;
    const label = isSnack ? 'سناكات' : 'أصناف';
    setDialog({
      title: `حذف جميع ${label} القائمة`,
      message: `هل أنت متأكد من حذف ${section.length} ${label} من هذه القائمة؟ لا يمكن التراجع عن هذه العملية.`,
      onConfirm: async () => {
        setDialog(null);
        setDeletingAll(true);
        const ids = section.map(m => m.id);
        const names = section.map(m => m.name);
        const count = ids.length;
        await supabase.from('meals').delete().in('id', ids);
        await supabase.from('custom_transliterations').delete().in('word', names);
        void logActivity({
          action: 'delete',
          entity_type: 'meal',
          entity_name: `حذف جماعي — ${label} ${MEAL_TYPE_LABELS[type]} (${count})`,
          details: { count, type, is_snack: isSnack, scope: 'section' },
        });
        await fetchMeals();
        setDeletingAll(false);
      },
    });
  };

  const handleAdd = (type: MealType, isSnack: boolean) => {
    setEditingMeal(null);
    setModalDefaults({ type, isSnack });
    setModalOpen(true);
  };

  const handleEdit = (meal: Meal) => {
    setEditingMeal(meal);
    setModalDefaults({ type: meal.type, isSnack: meal.is_snack });
    setModalOpen(true);
  };

  const handleDuplicate = (meal: Meal) => {
    setDialog({
      title: 'نسخ صنف',
      message:
        `سيتم إنشاء نسخة من "${meal.name}" باسم "نسخة من ${meal.name}".\n\n` +
        `كل التخصيصات تُنقَل تلقائياً للنسخة:\n` +
        `• المحظورات (مع نفس البديل لكل شخص)\n` +
        `• الأصناف الثابتة (نفس الأيام والكمية والتصنيف)\n` +
        `• بنود قائمة الطعام (نفس الأسبوع/اليوم/التصنيف)\n\n` +
        `الأصلي يبقى كما هو دون تغيير. متابعة؟`,
      confirmLabel: 'نسخ',
      onConfirm: async () => {
        setDialog(null);
        await runDuplicate(meal);
      },
    });
  };

  // ينفّذ النسخ الفعلي: إنشاء صنف جديد + تكرار العلاقات (المحظورات + الثابتة + المنيو).
  // ⚠️ ما نلمس بيانات الصنف الأصلي ولا أوامر التشغيل القديمة.
  const runDuplicate = async (meal: Meal) => {
    setDuplicating(meal.id);
    setDuplicateResult(null);
    try {
      // 1) إنشاء النسخة — مع تجنّب تعارض الاسم لو نُسخت سابقاً
      const baseName = `نسخة من ${meal.name}`;
      let newId: string | null = null;
      let finalName = baseName;
      for (let attempt = 1; attempt <= 50 && !newId; attempt++) {
        const candidate = attempt === 1 ? baseName : `${baseName} (${attempt})`;
        const payload: Record<string, unknown> = {
          name: candidate,
          english_name: meal.english_name ? `Copy of ${meal.english_name}` : null,
          type: meal.type,
          is_snack: meal.is_snack,
          entity_type: entityType,
        };
        const { data, error } = await supabase
          .from('meals')
          .insert(payload)
          .select('id')
          .single();
        if (!error && data) {
          newId = data.id;
          finalName = candidate;
          break;
        }
        if (error && /unique|duplicate|meals_entity/i.test(error.message)) {
          continue; // try next candidate
        }
        if (error && /entity_type|column/i.test(error.message)) {
          // العمود ما موجود (companions-meals-migration.sql ما اتشغّل) — نحاول بدون
          delete payload.entity_type;
          const retry = await supabase.from('meals').insert(payload).select('id').single();
          if (retry.error) {
            if (/unique|duplicate/i.test(retry.error.message)) continue;
            throw retry.error;
          }
          newId = retry.data.id;
          finalName = candidate;
          break;
        }
        if (error) throw error;
      }
      if (!newId) throw new Error('تعذّر إيجاد اسم فريد للنسخة بعد 50 محاولة');

      // 2) نسخ المحظورات — كل صف يستهدف الأصلي ندرج صفّاً جديداً للنسخة
      const { data: excls, error: exErr } = await supabase
        .from('exclusions')
        .select('beneficiary_id, alternative_meal_id')
        .eq('meal_id', meal.id);
      if (exErr) throw exErr;

      let exclCount = 0;
      if (excls && excls.length > 0) {
        const rows = excls.map((e: { beneficiary_id: string; alternative_meal_id: string | null }) => ({
          beneficiary_id: e.beneficiary_id,
          meal_id: newId,
          alternative_meal_id: e.alternative_meal_id ?? null,
        }));
        const { error: insErr } = await supabase.from('exclusions').insert(rows);
        if (insErr) throw insErr;
        exclCount = rows.length;
      }

      // 3) نسخ الأصناف الثابتة — مع التعامل مع غياب عمود category
      const fetchFM = async (withCategory: boolean) =>
        supabase
          .from('beneficiary_fixed_meals')
          .select(`beneficiary_id, day_of_week, meal_type, quantity${withCategory ? ', category' : ''}`)
          .eq('meal_id', meal.id);
      let fmRes = await fetchFM(true);
      let fmHasCategory = true;
      if (fmRes.error && /category|column/i.test(fmRes.error.message)) {
        fmRes = await fetchFM(false);
        fmHasCategory = false;
      }
      if (fmRes.error) throw fmRes.error;

      let fmCount = 0;
      if (fmRes.data && fmRes.data.length > 0) {
        const fmRows = (fmRes.data as unknown as Array<{
          beneficiary_id: string; day_of_week: number; meal_type: string;
          quantity: number; category?: string;
        }>).map(r => {
          const out: Record<string, unknown> = {
            beneficiary_id: r.beneficiary_id,
            day_of_week: r.day_of_week,
            meal_type: r.meal_type,
            meal_id: newId,
            quantity: r.quantity ?? 1,
          };
          if (fmHasCategory && r.category) out.category = r.category;
          return out;
        });
        const { error: fmInsErr } = await supabase.from('beneficiary_fixed_meals').insert(fmRows);
        if (fmInsErr) {
          // fallback: لو فشل بسبب category
          if (/category|column/i.test(fmInsErr.message)) {
            const fallback = fmRows.map(({ category: _omit, ...rest }) => rest);
            const { error: fmInsErr2 } = await supabase.from('beneficiary_fixed_meals').insert(fallback);
            if (fmInsErr2) throw fmInsErr2;
          } else {
            throw fmInsErr;
          }
        }
        fmCount = fmRows.length;
      }

      // 4) نسخ بنود قائمة الطعام
      const fetchMI = async (withEntity: boolean) =>
        supabase
          .from('menu_items')
          .select(`week_number, day_of_week, meal_type, category, position, multiplier${withEntity ? ', entity_type' : ''}`)
          .eq('meal_id', meal.id);
      let miRes = await fetchMI(true);
      let miHasEntity = true;
      if (miRes.error && /entity_type|column/i.test(miRes.error.message)) {
        miRes = await fetchMI(false);
        miHasEntity = false;
      }
      if (miRes.error) throw miRes.error;

      let miCount = 0;
      if (miRes.data && miRes.data.length > 0) {
        const miRows = (miRes.data as unknown as Array<{
          week_number: number; day_of_week: number; meal_type: string;
          category: string; position: number; multiplier?: number; entity_type?: string;
        }>).map(r => {
          const out: Record<string, unknown> = {
            week_number: r.week_number,
            day_of_week: r.day_of_week,
            meal_type: r.meal_type,
            meal_id: newId,
            category: r.category,
            position: r.position,
            multiplier: r.multiplier ?? 1,
          };
          if (miHasEntity) out.entity_type = r.entity_type ?? entityType;
          return out;
        });
        const { error: miInsErr } = await supabase.from('menu_items').insert(miRows);
        if (miInsErr) {
          if (/entity_type|column/i.test(miInsErr.message)) {
            const fallback = miRows.map(({ entity_type: _omit, ...rest }) => rest);
            const { error: miInsErr2 } = await supabase.from('menu_items').insert(fallback);
            if (miInsErr2) throw miInsErr2;
          } else {
            throw miInsErr;
          }
        }
        miCount = miRows.length;
      }

      void logActivity({
        action: 'create',
        entity_type: 'meal',
        entity_id: newId,
        entity_name: finalName,
        details: {
          source: 'duplicate',
          original_meal_id: meal.id,
          original_meal_name: meal.name,
          for_entity: entityType,
          copied_exclusions: exclCount,
          copied_fixed_meals: fmCount,
          copied_menu_items: miCount,
        },
      });

      setDuplicateResult({ name: finalName, excl: exclCount, fixed: fmCount, menu: miCount });
      await fetchMeals();
    } catch (err) {
      alert(`تعذّر النسخ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDuplicating(null);
    }
  };

  const handleBulkAdd = (type: MealType, isSnack: boolean) => {
    setBulkAddTarget({ mealType: type, isSnack });
  };

  const handleBulkSave = async (names: string[], type: MealType, isSnack: boolean) => {
    let added = 0;
    const errors: string[] = [];
    for (const name of names) {
      const { error } = await supabase.from('meals').insert({ name, type, is_snack: isSnack, entity_type: entityType });
      if (error) {
        errors.push(`"${name}": ${error.message}`);
      } else {
        added++;
      }
    }
    if (added > 0) {
      void logActivity({
        action: 'create',
        entity_type: 'meal',
        entity_name: `إضافة جماعية — ${isSnack ? 'سناكات' : 'أصناف'} ${MEAL_TYPE_LABELS[type]} (${added}) — ${ENTITY_TYPE_LABELS_PLURAL[entityType]}`,
        details: { added, type, is_snack: isSnack, for_entity: entityType, source: 'bulk_add' },
      });
    }
    await fetchMeals();
    return { added, errors };
  };

  const getMeals = (type: MealType, isSnack: boolean) => {
    const q = search.trim().toLowerCase();
    return meals.filter(m => {
      if (m.type !== type || m.is_snack !== isSnack) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.english_name ?? '').toLowerCase().includes(q)
      );
    });
  };

  // ── Export ──────────────────────────────────────────────────────────────
  const handleExport = () => {
    const typeMap: Record<string, string> = { breakfast: 'فطور', lunch: 'غداء', dinner: 'عشاء' };
    const rows = meals.map(m => ({
      'الاسم': m.name,
      'الاسم الإنجليزي': m.english_name ?? '',
      'نوع الوجبة': typeMap[m.type] ?? m.type,
      'سناك': m.is_snack ? 'نعم' : 'لا',
    }));
    const tag = entityType === 'companion' ? 'مرافقون' : 'مستفيدون';
    exportXLSX(rows, `أصناف_${tag}_${new Date().toISOString().slice(0, 10)}.xlsx`, `أصناف ${ENTITY_TYPE_LABELS_PLURAL[entityType]}`);
  };

  // ── Import ──────────────────────────────────────────────────────────────
  const handleImport = async (rows: Record<string, string>[]) => {
    let imported = 0;
    const errors: string[] = [];
    const typeRevMap: Record<string, string> = { 'فطور': 'breakfast', 'غداء': 'lunch', 'عشاء': 'dinner', breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = row['الاسم']?.trim();
      if (!name) { errors.push(`صف ${i + 2}: الاسم مطلوب`); continue; }
      const typeRaw = row['نوع الوجبة']?.trim();
      const type = typeRevMap[typeRaw];
      if (!type) { errors.push(`صف ${i + 2} (${name}): نوع الوجبة غير صحيح — القيم المقبولة: فطور، غداء، عشاء`); continue; }
      const snackRaw = row['سناك']?.trim().toLowerCase();
      const is_snack = snackRaw === 'نعم' || snackRaw === 'yes' || snackRaw === 'true' || snackRaw === '1';

      const payload = { name, english_name: row['الاسم الإنجليزي']?.trim() || null, type, is_snack, entity_type: entityType };
      // الـconflict على (entity_type, type, is_snack, name) عشان الاستيراد يستبدل المكرر
      // داخل نفس الفئة + الوجبة + التصنيف فقط (وما يخلط بين فواكه فطور وفواكه عشاء مثلاً).
      const { error } = await supabase
        .from('meals')
        .upsert(payload, { onConflict: 'entity_type,type,is_snack,name' });
      if (error) { errors.push(`صف ${i + 2} (${name}): ${error.message}`); continue; }
      imported++;
    }
    if (imported > 0) {
      void logActivity({
        action: 'create',
        entity_type: 'meal',
        entity_name: `استيراد أصناف (${imported}) — ${ENTITY_TYPE_LABELS_PLURAL[entityType]}`,
        details: { imported, errors_count: errors.length, for_entity: entityType, source: 'excel_import' },
      });
    }
    return { imported, errors };
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-slate-200 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* رسالة نتيجة النسخ */}
      {duplicateResult && (
        <div className="bg-violet-50 border border-violet-200 text-violet-800 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm">
            ✓ تم إنشاء <span className="font-bold">&quot;{duplicateResult.name}&quot;</span> ونُسخ معها{' '}
            <span className="font-bold">{duplicateResult.excl}</span> محظور،{' '}
            <span className="font-bold">{duplicateResult.fixed}</span> صنف ثابت،{' '}
            <span className="font-bold">{duplicateResult.menu}</span> بند منيو.
          </div>
          <button
            onClick={() => setDuplicateResult(null)}
            className="text-violet-500 hover:text-violet-700 text-lg leading-none"
            title="إغلاق"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-800">الأصناف</h1>
          <span className={`badge ${ENTITY_BADGE_STYLES[entityType]}`}>
            {ENTITY_TYPE_LABELS_PLURAL[entityType]}
          </span>
          <p className="text-slate-500 text-sm">
            {meals.filter(m => !m.is_snack).length} وجبة، {meals.filter(m => m.is_snack).length} سناك
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setImportOpen(true)} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            استيراد
          </button>
          <button onClick={handleExport} disabled={meals.length === 0} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            تصدير
          </button>
        </div>
      </div>

      {/* Tabs: مستفيدين / مرافقين — كل tab يعرض أصناف فئته فقط */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        {(['beneficiary', 'companion'] as EntityType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => switchEntity(t)}
            className={`px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              entityType === t
                ? (t === 'beneficiary' ? 'border-emerald-500 text-emerald-700' : 'border-indigo-500 text-indigo-700')
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            أصناف {ENTITY_TYPE_LABELS_PLURAL[t]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="card p-3">
        <div className="relative">
          <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن صنف بالاسم العربي أو الإنجليزي…"
            className="input-field pr-9"
            dir="rtl"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
              title="مسح"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {MEAL_TYPES.map(mealType => {
        const colors = TYPE_COLORS[mealType];
        return (
          <div key={mealType} className="space-y-3">
            <h2 className={`text-base font-bold px-3 py-1.5 rounded-lg inline-block ${colors.bg} ${colors.text}`}>
              وجبة {MEAL_TYPE_LABELS[mealType]}
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MealSection
                title={`أصناف ${MEAL_TYPE_LABELS[mealType]}`}
                meals={getMeals(mealType, false)}
                isSnack={false}
                mealType={mealType}
                colors={colors}
                onAdd={handleAdd}
                onBulkAdd={handleBulkAdd}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onDeleteAll={handleDeleteAll}
                deleting={deleting}
                duplicating={duplicating}
                deletingAll={deletingAll}
              />
              <MealSection
                title={`سناكات ${MEAL_TYPE_LABELS[mealType]}`}
                meals={getMeals(mealType, true)}
                isSnack={true}
                mealType={mealType}
                colors={colors}
                onAdd={handleAdd}
                onBulkAdd={handleBulkAdd}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                onDeleteAll={handleDeleteAll}
                deleting={deleting}
                duplicating={duplicating}
                deletingAll={deletingAll}
              />
            </div>
          </div>
        );
      })}

      {importOpen && (
        <ImportModal
          title="الأصناف"
          templateHeaders={['الاسم', 'الاسم الإنجليزي', 'نوع الوجبة', 'سناك']}
          templateRow={['أرز بالدجاج', 'Rice with Chicken', 'غداء', 'لا']}
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); fetchMeals(); }}
        />
      )}

      {modalOpen && (
        <MealModal
          meal={editingMeal}
          defaultType={modalDefaults.type}
          defaultIsSnack={modalDefaults.isSnack}
          entityType={entityType}
          onClose={() => setModalOpen(false)}
          onSaved={() => { setModalOpen(false); fetchMeals(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        confirmLabel={dialog?.confirmLabel}
        onConfirm={() => dialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      />

      {bulkAddTarget && (
        <BulkAddModal
          title={`${bulkAddTarget.isSnack ? 'سناكات' : 'أصناف'} ${MEAL_TYPE_LABELS[bulkAddTarget.mealType]}`}
          mealType={bulkAddTarget.mealType}
          isSnack={bulkAddTarget.isSnack}
          onSave={handleBulkSave}
          onClose={() => { setBulkAddTarget(null); }}
        />
      )}
    </div>
  );
}
