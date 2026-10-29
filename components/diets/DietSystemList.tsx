'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { supabase } from '@/lib/supabase-client';
import { logActivity } from '@/lib/activity-log';
import { listDiffDetails } from '@/lib/activity-diff';
import { useCurrentUser } from '@/lib/use-current-user';
import { can, needsApproval, type AppUser } from '@/lib/permissions';
import {
  enqueueGenericCreate, enqueueGenericUpdate, enqueueGenericDelete,
  isEntityTypeConstraintError, DIET_APPROVAL_MIGRATION_HINT, type DietPayload, type EnqueueResult,
} from '@/lib/pending-actions';
import { useMyPending } from '@/lib/use-my-pending';
import { fetchAllRows } from '@/lib/fetch-all';
import type { DietSystem, Meal } from '@/lib/types';
import { MEAL_TYPE_LABELS, DAY_LABELS, DAYS_ORDER } from '@/lib/types';
import ExclusionSectionsEditor, { type ExclusionEntry } from '@/components/shared/ExclusionSectionsEditor';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import DietFixedMealsEditor, { draftsFromRows, rowsFromDrafts, fixedRowKey, type DietFixedDraft } from '@/components/diets/DietFixedMealsEditor';
import type { ImportMode } from '@/components/shared/ImportModeDialog';
import { exportXLSX } from '@/lib/xlsx-utils';
import { DIET_HEADERS, DIET_REQUIRED_HEADERS, DIET_TEMPLATE_ROW, buildDietRows, dietNameKey, parseDietRows } from '@/lib/diet-sheet';

const ImportModal = dynamic(() => import('@/components/shared/ImportModal'), { ssr: false });

const MIGRATION_HINT =
  'جداول «النظام الغذائي» غير موجودة بعد — شغّل الملف supabase/diet-systems-migration.sql في Supabase SQL Editor ثم حدّث الصفحة.';

const FIXED_MIGRATION_HINT =
  'الأصناف الثابتة للأنظمة غير مفعّلة بعد — شغّل الملف supabase/diet-fixed-meals-migration.sql في Supabase SQL Editor ثم حدّث الصفحة.';

type Ben = { id: string; name: string; code: string; entity_type?: string };

/** وصف مختصر لصنف ثابت في النظام: «فول · فطور · كل الأيام ×2» */
function describeFixedDraft(d: DietFixedDraft, mealName: (id: string) => string) {
  const days = d.days.length === 7 ? 'كل الأيام' : DAYS_ORDER.filter(x => d.days.includes(x)).map(x => DAY_LABELS[x]).join('، ');
  return `${mealName(d.meal_id)} · ${MEAL_TYPE_LABELS[d.meal_type]} · ${days}${d.quantity > 1 ? ` ×${d.quantity}` : ''}${d.is_alternative ? ' (بديل)' : ''}`;
}

/**
 * صفحة «النظام الغذائي»: كل نظام = اسم + أصناف مستبعدة (ولكل صنف بديل
 * اختياري). يُسند النظام للمستفيد من صفحته، فتنطبق استبعاداته على منيوه —
 * المزامنة مع جدول exclusions تجري داخل القاعدة (diet-systems-migration.sql).
 */
export default function DietSystemList() {
  const { user: currentUser } = useCurrentUser();
  const canView = can(currentUser, 'diets', 'view');
  const canAdd = can(currentUser, 'diets', 'add');
  const canEdit = can(currentUser, 'diets', 'edit');
  const canDelete = can(currentUser, 'diets', 'delete');
  const isAdmin = currentUser?.is_admin === true;
  // المستخدم المقيَّد بالموافقة: الحفظ/الحذف يصير طلباً في صفحة الموافقات
  const addNeedsApproval = needsApproval(currentUser, 'diets', 'add');
  const editNeedsApproval = needsApproval(currentUser, 'diets', 'edit');
  const deleteNeedsApproval = needsApproval(currentUser, 'diets', 'delete');
  const myPending = useMyPending('diet');

  const [diets, setDiets] = useState<DietSystem[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [bens, setBens] = useState<Ben[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<DietSystem | 'new' | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DietSystem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // false = جدول الأصناف الثابتة للأنظمة غير موجود (الترقية ما اتشغّلت)
  const [fixedReady, setFixedReady] = useState(true);

  const load = useCallback(async () => {
    setError('');
    const [dRes, mRes, bRes] = await Promise.all([
      // الأصناف الثابتة (diet-fixed-meals-migration) — نرجع بدونها لو الجدول غير موجود
      (async () => {
        const read = (withFixed: boolean) => supabase
          .from('diet_systems')
          .select(`id, name, description, created_at, exclusions:diet_system_exclusions(id, meal_id, alternative_meal_id)${withFixed
            ? ', fixed_meals:diet_system_fixed_meals(id, day_of_week, meal_type, meal_id, quantity, is_alternative)' : ''}, beneficiary_diets(beneficiary_id)`)
          .order('name');
        const r = await read(true);
        if (r.error && /diet_system_fixed_meals/i.test(r.error.message)) {
          setFixedReady(false);
          return read(false);
        }
        setFixedReady(true);
        return r;
      })(),
      // entity_type يميّز صنف المستفيدين عن صنف المرافقين بنفس الاسم في ملف
      // التصدير/الاستيراد — ونرجع بدونه لو ترقية المرافقين ما اتشغّلت.
      (async () => {
        const read = (cols: string) => fetchAllRows((from, to) =>
          supabase.from('meals').select(cols)
            .order('type').order('is_snack').order('name').order('id').range(from, to));
        const r = await read('id, name, english_name, type, is_snack, entity_type, created_at');
        return r.error && /entity_type|column/i.test(r.error.message)
          ? read('id, name, english_name, type, is_snack, created_at')
          : r;
      })(),
      fetchAllRows((from, to) =>
        supabase.from('beneficiaries').select('id, name, code, entity_type').order('name').order('id').range(from, to)),
    ]);
    if (dRes.error) {
      setError(/does not exist|relation|schema cache/i.test(dRes.error.message) ? MIGRATION_HINT : dRes.error.message);
      setLoading(false);
      return;
    }
    setDiets((dRes.data ?? []) as unknown as DietSystem[]);
    setMeals((mRes.data ?? []) as unknown as Meal[]);
    setBens((bRes.data ?? []) as unknown as Ben[]);
    setLoading(false);
  }, []);

  useEffect(() => { if (canView) void load(); }, [canView, load]);

  const mealById = useMemo(() => new Map(meals.map(m => [m.id, m])), [meals]);
  const benById = useMemo(() => new Map(bens.map(b => [b.id, b])), [bens]);

  const handleDelete = async (d: DietSystem) => {
    setConfirmDelete(null);
    if (deleteNeedsApproval && currentUser) {
      const r = await enqueueGenericDelete(supabase, currentUser, 'diet', d.id, d.name);
      if (!r.ok) { alert(approvalError(r)); return; }
      alert(`✓ تم إرسال طلب حذف النظام «${d.name}» للأدمن. يُحذف بعد الموافقة.`);
      myPending.refresh();
      return;
    }
    const { error: e } = await supabase.from('diet_systems').delete().eq('id', d.id);
    if (e) { alert(e.message); return; }
    void logActivity({ action: 'delete', entity_type: 'diet_system', entity_id: d.id, entity_name: d.name });
    void load();
  };

  // ── التصدير ───────────────────────────────────────────────────────────────
  // صيغة الملف في lib/diet-sheet.ts — نفسها يقرأها الاستيراد ويبني منها القالب.
  const handleExport = () => {
    void exportXLSX(buildDietRows(diets, meals), `الأنظمة_الغذائية_${new Date().toISOString().slice(0, 10)}.xlsx`, 'الأنظمة الغذائية');
  };

  // ── الاستيراد ─────────────────────────────────────────────────────────────
  //   • إضافة  — أنظمة جديدة + استبعادات جديدة فقط، الموجود لا يُلمس.
  //   • تحديث  — كالإضافة + تحديث الوصف والبدائل للأنظمة الموجودة بالاسم.
  //   • استبدال — استبعادات كل نظام في الملف تصير مطابقة للملف تماماً، والأنظمة
  //     الغائبة عن الملف تُحذف. الأنظمة الموجودة تُحدَّث في مكانها (لا تُحذف
  //     وتُعاد) فيبقى إسنادها للمستفيدين.
  const handleImport = async (rows: Record<string, string>[], mode: ImportMode) => {
    const { diets: parsed, errors } = parseDietRows(rows, meals);
    if (errors.length > 0) return { imported: 0, errors: ['لم يُحفظ أي شيء — صحّح الأخطاء التالية ثم أعد الاستيراد:', ...errors] };
    if (parsed.length === 0) return { imported: 0, errors: ['لم يُعثر على أنظمة في الملف'] };

    const existingByKey = new Map(diets.map(d => [dietNameKey(d.name), d]));
    const out: string[] = [];
    let imported = 0;

    for (const pd of parsed) {
      const existing = existingByKey.get(dietNameKey(pd.name));
      let dietId = existing?.id;
      if (!existing) {
        const { data, error: e } = await supabase.from('diet_systems')
          .insert({ name: pd.name, description: pd.description ?? null }).select('id').single();
        if (e || !data) { out.push(`${pd.name}: ${e?.message ?? 'تعذّر إنشاء النظام'}`); continue; }
        dietId = (data as { id: string }).id;
      } else if (mode !== 'append' && pd.description !== undefined && (existing.description ?? null) !== pd.description) {
        const { error: e } = await supabase.from('diet_systems').update({ description: pd.description }).eq('id', existing.id);
        if (e) { out.push(`${pd.name}: ${e.message}`); continue; }
      }

      if (existing && mode === 'replace') {
        const keep = new Set(pd.exclusions.map(x => x.meal_id));
        const removed = (existing.exclusions ?? []).map(x => x.meal_id).filter(id => !keep.has(id));
        if (removed.length > 0) {
          const { error: e } = await supabase.from('diet_system_exclusions').delete().eq('diet_id', existing.id).in('meal_id', removed);
          if (e) { out.push(`${pd.name}: ${e.message}`); continue; }
        }
      }
      if (pd.exclusions.length > 0) {
        const { error: e } = await supabase.from('diet_system_exclusions').upsert(
          pd.exclusions.map(x => ({ diet_id: dietId, meal_id: x.meal_id, alternative_meal_id: x.alternative_meal_id })),
          { onConflict: 'diet_id,meal_id', ignoreDuplicates: mode === 'append' },
        );
        if (e) { out.push(`${pd.name}: ${e.message}`); continue; }
      }
      imported++;
    }

    if (mode === 'replace' && out.length === 0) {
      const keep = new Set(parsed.map(p => dietNameKey(p.name)));
      for (const d of diets.filter(x => !keep.has(dietNameKey(x.name)))) {
        const { error: e } = await supabase.from('diet_systems').delete().eq('id', d.id);
        if (e) out.push(`تعذّر حذف النظام «${d.name}»: ${e.message}`);
      }
    }

    if (imported > 0) {
      void logActivity({
        action: 'create',
        entity_type: 'diet_system',
        entity_name: `استيراد أنظمة غذائية (${imported})`,
        details: { imported, errors_count: out.length, mode, source: 'excel_import' },
      });
    }
    return { imported, errors: out };
  };

  if (currentUser && !canView) {
    return <div className="p-6"><div className="card p-8 text-center text-slate-500">لا تملك صلاحية عرض هذه الصفحة</div></div>;
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">النظام الغذائي</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            أنشئ النظام وحدّد أصنافه المستبعدة وأصنافه الثابتة، ثم اختره للمستفيد من خانة «النظام الغذائي الأساسي» في صفحته — تنطبق على منيوه تلقائياً.
          </p>
        </div>
        <div className="flex items-center gap-2">
        {/* الاستيراد للأدمن فقط — نفس صفحة الأصناف؛ التصدير لكل من يرى الصفحة */}
        {isAdmin && !error && (
          <button onClick={() => setImportOpen(true)} disabled={loading} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            استيراد
          </button>
        )}
        {!error && (
          <button onClick={handleExport} disabled={loading || diets.length === 0} className="btn-secondary text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            تصدير
          </button>
        )}
        {canAdd && !error && (
          <button className="btn-primary" onClick={() => setEditing('new')}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            نظام جديد
          </button>
        )}
        </div>
      </div>

      {error && <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-4 rounded-xl text-sm">{error}</div>}

      {loading && !error && (
        <div className="card p-10 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
        </div>
      )}

      {myPending.getCreates().length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2.5 rounded-xl text-sm">
          ⏳ بانتظار موافقة الأدمن على إنشاء: {myPending.getCreates().map(p => `«${p.entity_name}»`).join('، ')}
        </div>
      )}

      {!loading && !error && diets.length === 0 && (
        <div className="card p-10 text-center text-slate-500">
          <p className="font-semibold text-slate-700 mb-1">لا توجد أنظمة غذائية بعد</p>
          <p className="text-sm">مثال: «سكري» يستبعد الحلى ببديل فاكهة، «قليل ملح» يستبعد المخللات…</p>
        </div>
      )}

      {!loading && !error && diets.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {diets.map(d => {
            const assigned = (d.beneficiary_diets ?? []).map(x => benById.get(x.beneficiary_id)).filter(Boolean) as Ben[];
            const open = expanded === d.id;
            return (
              <div key={d.id} className="card overflow-hidden">
                <div className="px-4 py-3 flex items-start justify-between gap-3 border-b border-slate-100">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-800 text-lg">
                      {d.name}
                      {myPending.hasDelete(d.id) && <span className="pending-badge pending-badge-delete mr-2">⏳ حذف</span>}
                      {!myPending.hasDelete(d.id) && myPending.hasUpdate(d.id) && <span className="pending-badge pending-badge-update mr-2">⏳ تعديل</span>}
                    </h3>
                    {d.description && <p className="text-xs text-slate-500 mt-0.5">{d.description}</p>}
                    <div className="flex gap-2 mt-2 text-xs">
                      <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
                        {d.exclusions?.length ?? 0} صنف مستبعد
                      </span>
                      {fixedReady && (
                        <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                          {draftsFromRows(d.fixed_meals ?? []).length} صنف ثابت
                        </span>
                      )}
                      <button type="button" onClick={() => setExpanded(open ? null : d.id)}
                        className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100">
                        مسند لـ {assigned.length} {open ? '▲' : '▼'}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {canEdit && (
                      <button onClick={() => setEditing(d)} className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                        تعديل
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => setConfirmDelete(d)} className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                        حذف
                      </button>
                    )}
                  </div>
                </div>
                <div className="px-4 py-3 flex flex-wrap gap-1.5">
                  {(d.exclusions ?? []).length === 0 && <span className="text-xs text-slate-400">لا توجد أصناف مستبعدة</span>}
                  {(d.exclusions ?? []).map(x => {
                    const m = mealById.get(x.meal_id);
                    const alt = x.alternative_meal_id ? mealById.get(x.alternative_meal_id) : undefined;
                    if (!m) return null;
                    return (
                      <span key={x.meal_id} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                        <span className="line-through text-slate-400">{m.name}</span>
                        {alt && <> <span className="text-slate-300">→</span> <span className="text-slate-700">{alt.name}</span></>}
                      </span>
                    );
                  })}
                </div>
                {(d.fixed_meals ?? []).length > 0 && (
                  <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                    {draftsFromRows(d.fixed_meals ?? []).map(fd => (
                      <span key={`${fd.meal_id}_${fd.meal_type}`} className="text-xs bg-teal-50/60 border border-teal-200 text-slate-700 rounded-lg px-2 py-1">
                        {describeFixedDraft(fd, id => mealById.get(id)?.name ?? 'صنف محذوف')}
                      </span>
                    ))}
                  </div>
                )}
                {open && (
                  <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50">
                    {assigned.length === 0 ? (
                      <p className="text-xs text-slate-400">غير مسند لأحد — اختره من صفحة المستفيد (تبويب البيانات ← النظام الغذائي الأساسي).</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {assigned.map(b => (
                          <span key={b.id} className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1">
                            {b.name} <span className="text-slate-400 font-mono">{b.code}</span>
                            {b.entity_type === 'companion' && <span className="text-indigo-500"> · مرافق</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title={`حذف نظام «${confirmDelete?.name ?? ''}»؟`}
        message={(() => {
          const n = confirmDelete?.beneficiary_diets?.length ?? 0;
          return n > 0
            ? `هذا النظام مسند لـ ${n} شخص، وستُزال استبعاداته وأصنافه الثابتة من منيوهم فوراً (محظوراتهم الشخصية لا تتأثر). لا يمكن التراجع عن الحذف.`
            : 'سيُحذف النظام وأصنافه المستبعدة. لا يمكن التراجع عن الحذف.';
        })()}
        confirmLabel="نعم، احذف"
        onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />

      {importOpen && (
        <ImportModal
          title="الأنظمة الغذائية"
          templateHeaders={DIET_HEADERS}
          requiredHeaders={DIET_REQUIRED_HEADERS}
          templateRow={DIET_TEMPLATE_ROW}
          modes={['append', 'update', 'replace']}
          updateHint="تحديث وصف الأنظمة الموجودة (بالاسم) وبدائل أصنافها، وإضافة الجديد — بلا حذف"
          replaceWarning="استبعادات كل نظام في الملف ستصير مطابقة للملف تماماً، وكل نظام غير موجود في الملف سيُحذف — ومعه إسناده للمستفيدين واستبعاداته من منيوهم (المحظورات الشخصية لا تتأثر). لا يُحفظ شيء لو في الملف أي خطأ."
          onImport={handleImport}
          onClose={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); void load(); }}
        />
      )}

      {editing && (
        <DietModal
          diet={editing === 'new' ? null : editing}
          meals={meals}
          fixedReady={fixedReady}
          existingNames={diets.filter(d => editing === 'new' || d.id !== editing.id).map(d => d.name)}
          onClose={() => setEditing(null)}
          approvalUser={
            currentUser && (editing === 'new' ? addNeedsApproval : editNeedsApproval) ? currentUser : null
          }
          onSaved={() => { setEditing(null); myPending.refresh(); void load(); }}
        />
      )}
    </div>
  );
}

/** رسالة فشل إرسال الطلب — قيد القاعدة يعني أن ترقية الأنظمة في الموافقات ما اتشغّلت */
function approvalError(r: Extract<EnqueueResult, { ok: false }>) {
  return isEntityTypeConstraintError(r.error) ? DIET_APPROVAL_MIGRATION_HINT : r.error;
}

function DietModal({ diet, meals, fixedReady, existingNames, approvalUser, onClose, onSaved }: {
  diet: DietSystem | null;
  meals: Meal[];
  fixedReady: boolean;
  existingNames: string[];
  /** موجود = الحفظ يحتاج موافقة → يُرسل طلباً بدل الكتابة المباشرة */
  approvalUser: AppUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(diet?.name ?? '');
  const [description, setDescription] = useState(diet?.description ?? '');
  const [items, setItems] = useState<ExclusionEntry[]>(
    (diet?.exclusions ?? []).map(x => ({ meal_id: x.meal_id, alternative_meal_id: x.alternative_meal_id ?? '' })),
  );
  const [fixedDrafts, setFixedDrafts] = useState<DietFixedDraft[]>(() => draftsFromRows(diet?.fixed_meals ?? []));
  const [tab, setTab] = useState<'exclusions' | 'fixed'>('exclusions');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const assignedCount = diet?.beneficiary_diets?.length ?? 0;

  const mealName = (id: string | null | undefined) => (id ? meals.find(m => m.id === id)?.name ?? 'صنف محذوف' : '');
  const describe = (x: { meal_id: string; alternative_meal_id?: string | null }) =>
    `${mealName(x.meal_id)}${x.alternative_meal_id ? ` ← ${mealName(x.alternative_meal_id)}` : ''}`;

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('اكتب اسم النظام'); return; }
    if (existingNames.some(n => n.trim().toLowerCase() === trimmed.toLowerCase())) {
      setError('يوجد نظام بنفس الاسم'); return;
    }
    setSaving(true); setError('');

    if (approvalUser) {
      const payload: DietPayload = {
        diet: { name: trimmed, description: description.trim() || null },
        exclusions: items.map(x => ({ meal_id: x.meal_id, alternative_meal_id: x.alternative_meal_id || null })),
        ...(fixedReady ? {
          fixed_meals: rowsFromDrafts(fixedDrafts).map(r => ({
            day_of_week: r.day_of_week, meal_type: r.meal_type, meal_id: r.meal_id,
            quantity: r.quantity, is_alternative: r.is_alternative === true,
          })),
        } : {}),
      };
      const raw = payload as unknown as Record<string, unknown>;
      const r = diet
        ? await enqueueGenericUpdate(supabase, approvalUser, 'diet', diet.id, trimmed, raw)
        : await enqueueGenericCreate(supabase, approvalUser, 'diet', trimmed, raw);
      if (!r.ok) { setError(approvalError(r)); setSaving(false); return; }
      alert(diet
        ? `✓ تم إرسال طلب تعديل النظام «${trimmed}» للأدمن. ينطبق بعد الموافقة.`
        : `✓ تم إرسال طلب إنشاء النظام «${trimmed}» للأدمن. يُنشأ بعد الموافقة.`);
      onSaved();
      return;
    }

    try {
      let dietId = diet?.id;
      if (diet) {
        const { error: e } = await supabase.from('diet_systems')
          .update({ name: trimmed, description: description.trim() || null }).eq('id', diet.id);
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.from('diet_systems')
          .insert({ name: trimmed, description: description.trim() || null }).select('id').single();
        if (e) throw e;
        dietId = (data as { id: string }).id;
      }

      // الاستبعادات بالفرق — كل تغيير يعيد مزامنة من عنده النظام (في القاعدة)
      const before = new Map((diet?.exclusions ?? []).map(x => [x.meal_id, x.alternative_meal_id ?? '']));
      const now = new Map(items.map(x => [x.meal_id, x.alternative_meal_id]));
      const removed = [...before.keys()].filter(id => !now.has(id));
      const upserts = items.filter(x => !before.has(x.meal_id) || before.get(x.meal_id) !== x.alternative_meal_id);

      if (removed.length > 0) {
        const { error: e } = await supabase.from('diet_system_exclusions').delete()
          .eq('diet_id', dietId).in('meal_id', removed);
        if (e) throw e;
      }
      if (upserts.length > 0) {
        const { error: e } = await supabase.from('diet_system_exclusions').upsert(
          upserts.map(x => ({ diet_id: dietId, meal_id: x.meal_id, alternative_meal_id: x.alternative_meal_id || null })),
          { onConflict: 'diet_id,meal_id' },
        );
        if (e) throw e;
      }

      // الأصناف الثابتة بالفرق — المزامنة للمستفيدين تجري في القاعدة
      // (diet-fixed-meals-migration.sql) فتنعكس على كل من عنده النظام فوراً.
      if (fixedReady) {
        const beforeRows = new Map((diet?.fixed_meals ?? []).map(r => [fixedRowKey(r), r]));
        const nowRows = rowsFromDrafts(fixedDrafts);
        const nowKeys = new Set(nowRows.map(fixedRowKey));
        const removedIds = [...beforeRows.values()].filter(r => !nowKeys.has(fixedRowKey(r))).map(r => r.id).filter(Boolean) as string[];
        const changed = nowRows.filter(r => {
          const b = beforeRows.get(fixedRowKey(r));
          return !b || b.quantity !== r.quantity || (b.is_alternative === true) !== r.is_alternative;
        });
        if (removedIds.length > 0) {
          const { error: e } = await supabase.from('diet_system_fixed_meals').delete().in('id', removedIds);
          if (e) throw e;
        }
        if (changed.length > 0) {
          const { error: e } = await supabase.from('diet_system_fixed_meals').upsert(
            changed.map(r => ({ ...r, diet_id: dietId })),
            { onConflict: 'diet_id,day_of_week,meal_type,meal_id' },
          );
          if (e) throw e;
        }
      }

      const fixedName = (id: string) => mealName(id);
      void logActivity({
        action: diet ? 'update' : 'create',
        entity_type: 'diet_system',
        entity_id: dietId,
        entity_name: trimmed,
        details: {
          ...(diet && diet.name !== trimmed ? { name: { from: diet.name, to: trimmed } } : {}),
          ...listDiffDetails('diet_exclusions', (diet?.exclusions ?? []).map(describe), items.map(describe)),
          ...(fixedReady ? listDiffDetails(
            'diet_fixed_meals',
            draftsFromRows(diet?.fixed_meals ?? []).map(d => describeFixedDraft(d, fixedName)),
            fixedDrafts.filter(d => d.days.length > 0).map(d => describeFixedDraft(d, fixedName)),
          ) : {}),
          ...(assignedCount > 0 ? { beneficiaries_count: assignedCount } : {}),
        },
      });
      onSaved();
    } catch (e) {
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
      setError(/duplicate|unique/i.test(msg) ? 'يوجد نظام بنفس الاسم' : msg);
      setSaving(false);
    }
  };

  return (
    // ملء الشاشة — نفس نافذة منيو المستفيد: أقسام الوجبات الست وقوائم أصنافها
    // تحتاج المساحة كاملة بدل صندوق ضيق يتطلب تمريراً مستمراً.
    <div className="fixed inset-0 bg-black/50 z-50 flex">
      <div className="bg-white shadow-xl w-full h-full flex flex-col">
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{diet ? `تعديل نظام «${diet.name}»` : 'نظام غذائي جديد'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">اسم النظام</label>
              <input value={name} onChange={e => setName(e.target.value)} className="input-field" placeholder="مثال: سكري" autoFocus />
            </div>
            <div>
              <label className="label">وصف (اختياري)</label>
              <input value={description} onChange={e => setDescription(e.target.value)} className="input-field" placeholder="ملاحظة قصيرة عن النظام" />
            </div>
          </div>

          {assignedCount > 0 && (
            <div className="bg-green-50 border border-green-200 text-green-800 text-xs rounded-lg px-3 py-2">
              هذا النظام مسند لـ {assignedCount} شخص — أي تعديل هنا ينعكس على منيوهم فور الحفظ.
            </div>
          )}

          <div className="flex gap-1 border-b border-slate-200">
            {([
              ['exclusions', `الأصناف المستبعدة (${items.length})`],
              ['fixed', `الأصناف الثابتة (${fixedDrafts.length})`],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${tab === key
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'exclusions' && (
            <div>
              <h3 className="label mb-2">الأصناف المستبعدة وبدائلها</h3>
              <div className="space-y-3">
                <ExclusionSectionsEditor
                  meals={meals}
                  items={items}
                  onAdd={m => setItems(prev => prev.some(x => x.meal_id === m.id) ? prev : [...prev, { meal_id: m.id, alternative_meal_id: '' }])}
                  onRemove={id => setItems(prev => prev.filter(x => x.meal_id !== id))}
                  onSetAlt={(id, alt) => setItems(prev => prev.map(x => x.meal_id === id ? { ...x, alternative_meal_id: alt } : x))}
                />
              </div>
            </div>
          )}

          {tab === 'fixed' && (
            fixedReady ? (
              <div>
                <p className="text-xs text-slate-500 mb-3">
                  أصناف تُضاف تلقائياً لكل من عنده هذا النظام في الأيام المختارة — تظهر في تبويب «الثابتة الأسبوعية» عنده وفي أمر التشغيل.
                  لو عند الشخص نفس الصنف بنفس اليوم والوجبة كصنف شخصي يبقى صفاً واحداً.
                </p>
                <DietFixedMealsEditor meals={meals} drafts={fixedDrafts} onChange={setFixedDrafts} />
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 px-5 py-4 rounded-xl text-sm">{FIXED_MIGRATION_HINT}</div>
            )
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3">
          <span className="text-sm text-red-600">{error}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">إلغاء</button>
            <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-50">
              {saving ? 'جاري الحفظ…' : approvalUser ? 'إرسال للموافقة' : 'حفظ'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
