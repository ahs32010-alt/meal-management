'use client';

/**
 * عرض «أقسام المطبخ» داخل صفحة الأصناف.
 *
 * تجميع تنظيمي فقط: ينشئ المستخدم أقساماً (طبخ / أرز / سلطات / حلى …) ويضع
 * الأصناف تحتها. يقرأ ويكتب في جدولين مستقلين فقط (kitchen_sections و
 * meal_kitchen_sections) — لا يمسّ جدول meals ولا التصنيف (حار/بارد/سناك)
 * ولا أي آلية أخرى (أوامر التشغيل، الستيكرات، التقارير).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import type { KitchenSection, Meal, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

const PALETTE = [
  '#EF4444', '#F97316', '#F59E0B', '#EAB308', '#84CC16', '#22C55E',
  '#14B8A6', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
  '#78716C', '#64748B',
];
const DEFAULT_COLOR = '#64748B';
const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];
const TYPE_BADGE: Record<MealType, string> = {
  breakfast: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  lunch: 'bg-blue-50 text-blue-800 border-blue-200',
  dinner: 'bg-purple-50 text-purple-800 border-purple-200',
};

const isMissingTable = (msg: string) =>
  /kitchen_sections|meal_kitchen_sections|relation|does not exist|schema cache/i.test(msg);

interface Props {
  /** أصناف التبويب الحالي (مستفيدين أو مرافقين) — كما حمّلتها صفحة الأصناف */
  meals: Meal[];
  search: string;
  /** إنشاء/تعديل الأقسام وتوزيع الأصناف عليها */
  canManage: boolean;
}

function MealTypeBadge({ meal }: { meal: Meal }) {
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TYPE_BADGE[meal.type]}`}>
      {MEAL_TYPE_LABELS[meal.type]}{meal.is_snack ? ' · سناك' : ''}
    </span>
  );
}

// ── نافذة إنشاء/تعديل قسم ────────────────────────────────────────────────────
function SectionFormModal({
  initial, onSave, onClose,
}: {
  initial: KitchenSection | null;
  onSave: (name: string, color: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color || PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) { setError('اكتب اسم القسم'); return; }
    setSaving(true);
    const err = await onSave(name.trim(), color);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800">{initial ? 'تعديل القسم' : 'قسم جديد'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">اسم القسم</label>
            <input
              autoFocus
              value={name}
              onChange={e => { setName(e.target.value); setError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder="مثال: سلطات"
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">اللون</label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  title={c}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'border-slate-800 scale-110' : 'border-white shadow'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button onClick={submit} disabled={saving} className="btn-primary flex-1 justify-center">
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ── نافذة اختيار أصناف للقسم ─────────────────────────────────────────────────
function AssignMealsModal({
  section, meals, sectionByMeal, sectionsById, onSave, onClose,
}: {
  section: KitchenSection;
  meals: Meal[];
  sectionByMeal: Record<string, string>;
  sectionsById: Record<string, KitchenSection>;
  onSave: (selectedIds: string[]) => Promise<string | null>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(meals.filter(m => sectionByMeal[m.id] === section.id).map(m => m.id)),
  );
  const [q, setQ] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = q.trim().toLowerCase();
  const visible = meals.filter(m => {
    if (query && !m.name.toLowerCase().includes(query) && !(m.english_name ?? '').toLowerCase().includes(query)) return false;
    if (onlyUnassigned && sectionByMeal[m.id] && sectionByMeal[m.id] !== section.id) return false;
    return true;
  });

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const movedCount = [...selected].filter(id => sectionByMeal[id] && sectionByMeal[id] !== section.id).length;

  const submit = async () => {
    setSaving(true);
    const err = await onSave([...selected]);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <span className="w-3 h-3 rounded-full" style={{ background: section.color || DEFAULT_COLOR }} />
            أصناف قسم «{section.name}»
          </h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:bg-slate-100 rounded-lg">✕</button>
        </div>

        <div className="px-6 pt-4 space-y-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="ابحث عن صنف…"
            className="input-field"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} />
            إخفاء الأصناف الموجودة في أقسام أخرى
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-4">
          {MEAL_TYPES.map(type => {
            const list = visible.filter(m => m.type === type);
            if (list.length === 0) return null;
            return (
              <div key={type}>
                <p className="text-xs font-bold text-slate-500 mb-1">وجبة {MEAL_TYPE_LABELS[type]}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {list.map(m => {
                    const other = sectionByMeal[m.id] && sectionByMeal[m.id] !== section.id
                      ? sectionsById[sectionByMeal[m.id]] : null;
                    return (
                      <label
                        key={m.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-sm hover:bg-slate-50 ${selected.has(m.id) ? 'bg-emerald-50' : ''}`}
                      >
                        <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                        <span className="font-medium text-slate-800">{m.name}</span>
                        {m.is_snack && <span className="text-[10px] text-amber-700">سناك</span>}
                        {other && (
                          <span
                            className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                            style={{ background: other.color || DEFAULT_COLOR }}
                            title="موجود حالياً في هذا القسم — اختياره ينقله"
                          >
                            {other.name}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {visible.length === 0 && <p className="text-center text-slate-400 text-sm py-6">لا توجد أصناف</p>}
        </div>

        <div className="px-6 pb-6 pt-3 border-t border-slate-100 space-y-2">
          {movedCount > 0 && (
            <p className="text-xs text-amber-700">⚠ {movedCount} صنف بينتقل من قسمه الحالي لهذا القسم</p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button onClick={submit} disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? 'جاري الحفظ...' : `حفظ (${selected.size} صنف)`}
            </button>
            <button onClick={onClose} className="btn-secondary flex-1 justify-center">إلغاء</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── العرض الرئيسي ────────────────────────────────────────────────────────────
export default function KitchenSectionsView({ meals, search, canManage }: Props) {
  const [sections, setSections] = useState<KitchenSection[]>([]);
  const [sectionByMeal, setSectionByMeal] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formFor, setFormFor] = useState<KitchenSection | 'new' | null>(null);
  const [assignFor, setAssignFor] = useState<KitchenSection | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const load = useCallback(async () => {
    const [secRes, mapRes] = await Promise.all([
      supabase.from('kitchen_sections').select('id, name, color, sort_order, created_at')
        .order('sort_order').order('created_at'),
      supabase.from('meal_kitchen_sections').select('meal_id, section_id'),
    ]);
    const err = secRes.error ?? mapRes.error;
    if (err) {
      if (isMissingTable(err.message)) setMissing(true);
      else console.error('Fetch kitchen sections error:', err);
      setLoading(false);
      return;
    }
    setMissing(false);
    setSections((secRes.data ?? []) as KitchenSection[]);
    const map: Record<string, string> = {};
    ((mapRes.data ?? []) as { meal_id: string; section_id: string }[]).forEach(r => { map[r.meal_id] = r.section_id; });
    setSectionByMeal(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const sectionsById = useMemo(
    () => Object.fromEntries(sections.map(s => [s.id, s])) as Record<string, KitchenSection>,
    [sections],
  );

  const q = search.trim().toLowerCase();
  const matches = (m: Meal) =>
    !q || m.name.toLowerCase().includes(q) || (m.english_name ?? '').toLowerCase().includes(q);
  const sortMeals = (list: Meal[]) =>
    [...list].sort((a, b) =>
      MEAL_TYPES.indexOf(a.type) - MEAL_TYPES.indexOf(b.type)
      || Number(a.is_snack) - Number(b.is_snack)
      || a.name.localeCompare(b.name, 'ar'));

  const mealsOf = (sectionId: string) => sortMeals(meals.filter(m => sectionByMeal[m.id] === sectionId && matches(m)));
  const unassigned = sortMeals(meals.filter(m => !sectionsById[sectionByMeal[m.id] ?? ''] && matches(m)));

  // ── عمليات الأقسام ──
  const saveSection = async (name: string, color: string): Promise<string | null> => {
    const editing = formFor && formFor !== 'new' ? formFor : null;
    const res = editing
      ? await supabase.from('kitchen_sections').update({ name, color }).eq('id', editing.id)
      : await supabase.from('kitchen_sections').insert({
          name, color, sort_order: (sections.reduce((mx, s) => Math.max(mx, s.sort_order), 0) + 1),
        });
    if (res.error) {
      return /duplicate|unique/i.test(res.error.message) ? 'يوجد قسم بنفس الاسم' : res.error.message;
    }
    void logActivity({
      action: editing ? 'update' : 'create',
      entity_type: 'meal',
      entity_id: editing?.id ?? null,
      entity_name: `قسم مطبخ — ${name}`,
      details: { source: 'kitchen_section', name, color, previous_name: editing?.name ?? null },
    });
    setFormFor(null);
    await load();
    return null;
  };

  const deleteSection = (s: KitchenSection) => {
    const count = meals.filter(m => sectionByMeal[m.id] === s.id).length;
    setDialog({
      title: 'حذف قسم',
      message: `حذف قسم «${s.name}»؟\n\nالأصناف ما تنحذف — ترجع «بدون قسم» فقط${count ? ` (${count} صنف في هذا التبويب)` : ''}.`,
      onConfirm: async () => {
        setDialog(null);
        setBusy(s.id);
        const { error } = await supabase.from('kitchen_sections').delete().eq('id', s.id);
        if (error) alert(`تعذّر الحذف: ${error.message}`);
        else void logActivity({ action: 'delete', entity_type: 'meal', entity_id: s.id, entity_name: `قسم مطبخ — ${s.name}`, details: { source: 'kitchen_section' } });
        await load();
        setBusy(null);
      },
    });
  };

  const moveSection = async (s: KitchenSection, dir: -1 | 1) => {
    const idx = sections.findIndex(x => x.id === s.id);
    const other = sections[idx + dir];
    if (!other) return;
    setBusy(s.id);
    // نعيد ترقيم الكل بالترتيب الجديد عشان ما تتعارض قيم sort_order المتساوية
    const reordered = [...sections];
    [reordered[idx], reordered[idx + dir]] = [reordered[idx + dir], reordered[idx]];
    setSections(reordered.map((x, i) => ({ ...x, sort_order: i + 1 })));
    const results = await Promise.all(
      reordered.map((x, i) => supabase.from('kitchen_sections').update({ sort_order: i + 1 }).eq('id', x.id)),
    );
    const err = results.find(r => r.error)?.error;
    if (err) { alert(`تعذّر الترتيب: ${err.message}`); await load(); }
    setBusy(null);
  };

  // ── ربط الأصناف ──
  const setMealSection = async (meal: Meal, sectionId: string | null) => {
    const prev = sectionByMeal[meal.id] ?? null;
    if (prev === sectionId) return;
    setBusy(meal.id);
    setSectionByMeal(curr => {
      const next = { ...curr };
      if (sectionId) next[meal.id] = sectionId; else delete next[meal.id];
      return next;
    });
    const { error } = sectionId
      ? await supabase.from('meal_kitchen_sections').upsert({ meal_id: meal.id, section_id: sectionId }, { onConflict: 'meal_id' })
      : await supabase.from('meal_kitchen_sections').delete().eq('meal_id', meal.id);
    if (error) {
      alert(`تعذّر الحفظ: ${error.message}`);
      await load();
    } else {
      void logActivity({
        action: 'update', entity_type: 'meal', entity_id: meal.id, entity_name: meal.name,
        details: {
          source: 'kitchen_section',
          previous_section: prev ? sectionsById[prev]?.name ?? null : null,
          new_section: sectionId ? sectionsById[sectionId]?.name ?? null : null,
        },
      });
    }
    setBusy(null);
  };

  const saveAssignment = async (section: KitchenSection, selectedIds: string[]): Promise<string | null> => {
    const selected = new Set(selectedIds);
    const toRemove = meals.filter(m => sectionByMeal[m.id] === section.id && !selected.has(m.id)).map(m => m.id);
    const toUpsert = selectedIds.filter(id => sectionByMeal[id] !== section.id);
    if (toUpsert.length > 0) {
      const { error } = await supabase.from('meal_kitchen_sections').upsert(
        toUpsert.map(id => ({ meal_id: id, section_id: section.id })), { onConflict: 'meal_id' },
      );
      if (error) return error.message;
    }
    if (toRemove.length > 0) {
      const { error } = await supabase.from('meal_kitchen_sections').delete().in('meal_id', toRemove);
      if (error) return error.message;
    }
    if (toUpsert.length || toRemove.length) {
      void logActivity({
        action: 'update', entity_type: 'meal', entity_id: section.id,
        entity_name: `قسم مطبخ — ${section.name}`,
        details: { source: 'kitchen_section', added: toUpsert.length, removed: toRemove.length },
      });
    }
    setAssignFor(null);
    await load();
    return null;
  };

  // ── الرسم ──
  if (loading) {
    return <div className="animate-pulse grid grid-cols-1 md:grid-cols-2 gap-4">{[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-slate-200 rounded-xl" />)}</div>;
  }

  if (missing) {
    return (
      <div className="card p-6 text-center space-y-2">
        <p className="font-bold text-slate-800">أقسام المطبخ تحتاج تفعيل في قاعدة البيانات</p>
        <p className="text-sm text-slate-500">
          شغّل الملف <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">supabase/kitchen-sections-migration.sql</code> مرة وحدة في Supabase SQL Editor ثم حدّث الصفحة.
        </p>
      </div>
    );
  }

  const assignedCount = meals.filter(m => sectionsById[sectionByMeal[m.id] ?? '']).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-slate-500">
          {sections.length} قسم · {assignedCount} صنف موزّع · {meals.length - assignedCount} بدون قسم
        </p>
        {canManage && (
          <button onClick={() => setFormFor('new')} className="btn-primary text-sm">+ قسم جديد</button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {sections.map((s, idx) => {
          const color = s.color || DEFAULT_COLOR;
          const list = mealsOf(s.id);
          const total = meals.filter(m => sectionByMeal[m.id] === s.id).length;
          return (
            <div key={s.id} className="rounded-xl border border-slate-200 overflow-hidden bg-white" style={{ borderTop: `4px solid ${color}` }}>
              <div className="flex items-center justify-between px-4 py-3 bg-slate-50 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                  <span className="font-bold text-sm text-slate-800 truncate">{s.name}</span>
                  <span className="badge text-xs bg-white border border-slate-200 text-slate-600">{total} صنف</span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => moveSection(s, -1)} disabled={idx === 0 || busy === s.id} title="تقديم" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg disabled:opacity-30">▲</button>
                    <button onClick={() => moveSection(s, 1)} disabled={idx === sections.length - 1 || busy === s.id} title="تأخير" className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg disabled:opacity-30">▼</button>
                    <button onClick={() => setFormFor(s)} title="تعديل القسم" className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg">✎</button>
                    <button onClick={() => deleteSection(s)} disabled={busy === s.id} title="حذف القسم" className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30">🗑</button>
                    <button
                      onClick={() => setAssignFor(s)}
                      className="mr-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border text-white hover:opacity-90"
                      style={{ background: color, borderColor: color }}
                    >
                      + أصناف
                    </button>
                  </div>
                )}
              </div>
              {list.length === 0 ? (
                <div className="py-6 text-center text-slate-400 text-sm">{q ? 'لا نتائج' : 'لا توجد أصناف'}</div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {list.map(m => (
                    <div key={m.id} className="flex items-center justify-between px-4 py-2 hover:bg-slate-50">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-800">{m.name}</span>
                        <MealTypeBadge meal={m} />
                      </div>
                      {canManage && (
                        <button
                          onClick={() => setMealSection(m, null)}
                          disabled={busy === m.id}
                          title="إخراج من القسم"
                          className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded text-xs disabled:opacity-30"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* بدون قسم */}
        <div className="rounded-xl border border-dashed border-slate-300 overflow-hidden bg-white md:col-span-2">
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50">
            <span className="font-bold text-sm text-slate-600">بدون قسم</span>
            <span className="badge text-xs bg-white border border-slate-200 text-slate-500">{unassigned.length} صنف</span>
          </div>
          {unassigned.length === 0 ? (
            <div className="py-6 text-center text-slate-400 text-sm">
              {q ? 'لا نتائج' : '✓ كل الأصناف موزّعة على أقسام'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y divide-slate-100 max-h-[28rem] overflow-y-auto">
              {unassigned.map(m => (
                <div key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-slate-50">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="font-medium text-sm text-slate-800">{m.name}</span>
                    <MealTypeBadge meal={m} />
                  </div>
                  {canManage && sections.length > 0 && (
                    <select
                      value=""
                      disabled={busy === m.id}
                      onChange={e => { if (e.target.value) setMealSection(m, e.target.value); }}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600 shrink-0"
                    >
                      <option value="">نقل إلى…</option>
                      {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {formFor && (
        <SectionFormModal
          initial={formFor === 'new' ? null : formFor}
          onSave={saveSection}
          onClose={() => setFormFor(null)}
        />
      )}

      {assignFor && (
        <AssignMealsModal
          section={assignFor}
          meals={meals}
          sectionByMeal={sectionByMeal}
          sectionsById={sectionsById}
          onSave={ids => saveAssignment(assignFor, ids)}
          onClose={() => setAssignFor(null)}
        />
      )}

      <ConfirmDialog
        isOpen={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        onConfirm={() => dialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
