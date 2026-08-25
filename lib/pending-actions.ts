'use client';

// قاعدة طلبات الموافقة: المستخدم غير الأدمن لما يضيف/يحذف ينحفظ طلبه هنا،
// والأدمن يقبله أو يرفضه من جرس الإشعارات. الإضافة/الحذف الفعليان يتمّان
// عند الموافقة فقط.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from './permissions';
import type { EntityType, MealType } from './types';
import { DAY_LABELS, MEAL_TYPE_LABELS } from './types';
import { logActivity, type ActivityEntityType } from './activity-log';
import { updateDetails, valueDetails, listDiffDetails } from './activity-diff';

// نوع الكيان في طلبات الموافقة — أوسع من EntityType الأصلي عشان نغطي
// المستفيدين والمرافقين والأصناف وبنود قائمة الطعام
export type PendingEntityType = EntityType | 'meal' | 'menu_item';

export interface PendingAction {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: 'create' | 'update' | 'delete';
  entity_type: PendingEntityType;
  entity_id: string | null;
  entity_name: string | null;
  payload: Record<string, unknown> | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface CreatePayload {
  // البيانات الأساسية للمستفيد/المرافق
  beneficiary: Record<string, unknown>;
  // قائمة المحظورات
  exclusions: Array<{ meal_id: string; alternative_meal_id: string | null }>;
  // قائمة الأصناف الثابتة
  fixed_meals: Array<{
    day_of_week: number;
    meal_type: string;
    meal_id: string;
    quantity: number;
    category?: string;
    suppress_if_meal_ids?: string[];
    // معلَّم كـ«بديل» → يُحتسب ضمن الأصناف البديلة في أمر التشغيل
    is_alternative?: boolean;
  }>;
  /**
   * قرارات المنيو على خانة محددة (أسبوع + يوم + وجبة) — من تبويب «المنيو
   * المخصّص». اختيارية: الطلبات القديمة (وقبل تشغيل ترقية القرارات) ما تحملها.
   */
  menu_overrides?: Array<{
    week_number: number;
    day_of_week: number;
    meal_type: string;
    action: 'replace' | 'remove' | 'add';
    base_meal_id?: string | null;
    target_meal_id?: string | null;
    quantity?: number;
    is_alternative?: boolean;
  }>;
}

/**
 * كتابة قرارات المنيو لمستفيد واحد: مسح ثم إدراج — نفس دلالة المحظورات
 * والأصناف الثابتة في BeneficiaryModal.
 *
 * لو الجدول غير موجود (ترقية القرارات ما اتشغّلت) نتجاهل بصمت بدل ما نفشّل
 * الموافقة كلها — بقية بيانات المستفيد تُطبَّق كما هي.
 */
async function replaceMenuOverrides(
  supabase: SupabaseClient,
  beneficiaryId: string,
  overrides: CreatePayload['menu_overrides'],
): Promise<{ ok: true } | { ok: false; error: string }> {
  // ⚠️ الطلب الذي لا يحمل المفتاح أصلاً (طلب قديم، أو نافذة ما قرأت القرارات)
  // لا يعني «امسح كل القرارات» — يعني «لا رأي لي فيها». المسح هنا كان يضيّع
  // قرارات المستفيد بالكامل عند الموافقة على أي تعديل آخر.
  if (overrides === undefined) return { ok: true };

  const missingTable = (msg: string) =>
    /beneficiary_menu_overrides|relation .* does not exist|schema cache|could not find the table/i.test(msg);

  const { error: delErr } = await supabase
    .from('beneficiary_menu_overrides')
    .delete()
    .eq('beneficiary_id', beneficiaryId);
  if (delErr) {
    if (missingTable(delErr.message)) return { ok: true };
    return { ok: false, error: delErr.message };
  }

  if (!overrides?.length) return { ok: true };
  const rows = overrides.map(ov => ({ ...ov, beneficiary_id: beneficiaryId }));
  const { error: insErr } = await supabase.from('beneficiary_menu_overrides').insert(rows);
  if (insErr) {
    if (missingTable(insErr.message)) return { ok: true };
    return { ok: false, error: insErr.message };
  }
  return { ok: true };
}

// نوع موحّد لنتيجة enqueue: ok=true عند النجاح، ok=false مع سبب الفشل،
// و duplicate=true لما يكون عند المستخدم طلب pending سابق لنفس العملية.
export type EnqueueResult =
  | { ok: true }
  | { ok: false; error: string; duplicate?: boolean };

// نبحث عن طلب pending سابق بنفس المستخدم لنفس الكيان — لو وُجد نرجع id
// عشان نقدر نحدّثه (replace) بدل ما نضيف صف جديد. هذا يسمح للمستخدم يعدّل
// عدة مرات متتالية ويبقى آخر تعديل هو المعتمد.
async function findExistingPendingId(
  supabase: SupabaseClient,
  user: AppUser,
  match: {
    action: 'create' | 'update' | 'delete';
    entityType: PendingEntityType;
    entityId?: string;
    entityName?: string;
  },
): Promise<string | null> {
  let q = supabase
    .from('pending_actions')
    .select('id')
    .eq('status', 'pending')
    .eq('user_id', user.id)
    .eq('action', match.action)
    .eq('entity_type', match.entityType);
  if (match.entityId) q = q.eq('entity_id', match.entityId);
  if (match.entityName) q = q.eq('entity_name', match.entityName);
  const { data, error } = await q.limit(1).maybeSingle();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

// طلب إضافة (مستفيد/مرافق) — يستبدل أي طلب pending سابق بنفس الاسم
export async function enqueueCreate(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: EntityType,
  entityName: string,
  payload: CreatePayload,
): Promise<EnqueueResult> {
  return enqueueGenericCreate(supabase, user, entityType, entityName, payload as unknown as Record<string, unknown>);
}

// طلب تعديل (مستفيد/مرافق) — يستبدل/يدمج أي طلب pending سابق لنفس الـid
export async function enqueueUpdate(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: EntityType,
  entityId: string,
  entityName: string,
  payload: CreatePayload,
): Promise<EnqueueResult> {
  return enqueueGenericUpdate(supabase, user, entityType, entityId, entityName, payload as unknown as Record<string, unknown>);
}

// ── helpers عامّة لأي نوع كيان (أصناف، بنود منيو، إلخ) ────────────────────
// السلوك: لو فيه طلب pending سابق نفس النوع للمستخدم، نحدّث الـpayload (آخر
// تعديل يُعتمد). عدا الحذف — لو موجود يبقى كما هو (idempotent).

export async function enqueueGenericCreate(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: PendingEntityType,
  entityName: string,
  payload: Record<string, unknown>,
): Promise<EnqueueResult> {
  const existingId = await findExistingPendingId(supabase, user, { action: 'create', entityType, entityName });
  if (existingId) {
    const { error } = await supabase
      .from('pending_actions')
      .update({ payload, created_at: new Date().toISOString() })
      .eq('id', existingId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await supabase.from('pending_actions').insert({
    user_id: user.id,
    user_name: user.full_name ?? user.email ?? '',
    action: 'create',
    entity_type: entityType,
    entity_name: entityName,
    payload,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function enqueueGenericUpdate(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: PendingEntityType,
  entityId: string,
  entityName: string,
  payload: Record<string, unknown>,
): Promise<EnqueueResult> {
  const existingId = await findExistingPendingId(supabase, user, { action: 'update', entityType, entityId });
  if (existingId) {
    // نسمح بتعديلات متتالية — ندمج الـpayload القديم مع الجديد (الجديد يفوز عند التعارض)
    const { data: oldRow } = await supabase
      .from('pending_actions')
      .select('payload')
      .eq('id', existingId)
      .maybeSingle();
    const merged = { ...((oldRow?.payload as Record<string, unknown>) ?? {}), ...payload };
    const { error } = await supabase
      .from('pending_actions')
      .update({ payload: merged, entity_name: entityName, created_at: new Date().toISOString() })
      .eq('id', existingId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await supabase.from('pending_actions').insert({
    user_id: user.id,
    user_name: user.full_name ?? user.email ?? '',
    action: 'update',
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName,
    payload,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function enqueueGenericDelete(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: PendingEntityType,
  entityId: string,
  entityName: string | null,
): Promise<EnqueueResult> {
  const existingId = await findExistingPendingId(supabase, user, { action: 'delete', entityType, entityId });
  if (existingId) return { ok: true }; // idempotent — موجود مسبقاً
  const { error } = await supabase.from('pending_actions').insert({
    user_id: user.id,
    user_name: user.full_name ?? user.email ?? '',
    action: 'delete',
    entity_type: entityType,
    entity_id: entityId,
    entity_name: entityName,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// طلب حذف (مستفيد/مرافق) — idempotent عبر enqueueGenericDelete
export async function enqueueDelete(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: EntityType,
  entityId: string,
  entityName: string | null,
): Promise<EnqueueResult> {
  return enqueueGenericDelete(supabase, user, entityType, entityId, entityName);
}

// خريطة من entity_type → جدول DB
function tableFor(entityType: PendingEntityType): string {
  switch (entityType) {
    case 'beneficiary':
    case 'companion': return 'beneficiaries';
    case 'meal':      return 'meals';
    case 'menu_item': return 'menu_items';
  }
}

// قبول الطلب: ننفّذ العملية الفعلية ثم نضع الحالة approved
// ── تسجيل الموافقات في سجل النشاط ───────────────────────────────────────────
// الطلب الذي يمرّ بالموافقة كان يُطبَّق بصمت: التعديل يصير في القاعدة ولا يظهر
// في «آخر التحديثات» إطلاقاً. النتيجة أن كل تعديلات المستخدمين المقيَّدين
// بالموافقة كانت غائبة عن السجل — وهي بالضبط التعديلات التي تستحق المتابعة.

/** حقول المستفيد التي تدخل مقارنة قبل/بعد — بلا الأعمدة التقنية */
const APPROVAL_BENEFICIARY_FIELDS = [
  'name', 'english_name', 'code', 'category', 'villa', 'diet_type', 'notes',
  'no_fish', 'no_pasta_sandwich', 'low_carb', 'is_active',
];

/** أسماء الأصناف لمجموعة معرّفات — استعلام واحد بدل معرّفات صمّاء في السجل */
async function mealNameMap(supabase: SupabaseClient, ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.from('meals').select('id, name').in('id', unique);
  return new Map(((data ?? []) as { id: string; name: string }[]).map(m => [m.id, m.name]));
}

type ExclusionRow = { meal_id: string; alternative_meal_id?: string | null };
type FixedRow = {
  meal_id: string; meal_type: string; day_of_week: number;
  quantity?: number; is_alternative?: boolean;
};

function exclusionLabels(rows: ExclusionRow[], name: (id?: string | null) => string) {
  return rows.map(e => `${name(e.meal_id)}${e.alternative_meal_id ? ` (البديل: ${name(e.alternative_meal_id)})` : ''}`);
}

function fixedLabels(rows: FixedRow[], name: (id?: string | null) => string) {
  return rows.map(f =>
    `${name(f.meal_id)} · ${MEAL_TYPE_LABELS[f.meal_type as MealType] ?? f.meal_type}` +
    ` · ${DAY_LABELS[f.day_of_week] ?? f.day_of_week} · كمية ${f.quantity ?? 1}` +
    `${f.is_alternative ? ' · بديل' : ''}`
  );
}

/** نوع الكيان في سجل النشاط — بنود المنيو تُسجَّل تحت «صنف» كما في شاشة المنيو */
function activityEntityOf(t: PendingEntityType): ActivityEntityType {
  return (t === 'menu_item' ? 'meal' : t) as ActivityEntityType;
}

export async function approveAction(
  supabase: SupabaseClient,
  admin: AppUser,
  pa: PendingAction,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // مسار الأصناف وبنود المنيو — payload عادي على الجدول مباشرة
    if (pa.entity_type === 'meal' || pa.entity_type === 'menu_item') {
      const table = tableFor(pa.entity_type);
      // اللقطة تُقرأ قبل الكتابة — بعدها ضاعت القيمة السابقة للأبد
      const beforeRow = pa.entity_id
        ? (await supabase.from(table).select('*').eq('id', pa.entity_id).maybeSingle()).data as Record<string, unknown> | null
        : null;
      let logDetails: Record<string, unknown> = {};

      if (pa.action === 'create') {
        if (!pa.payload) return { ok: false, error: 'payload مفقود' };
        const { error } = await supabase.from(table).insert(pa.payload);
        if (error) return { ok: false, error: error.message };
        logDetails = valueDetails(pa.payload);
      } else if (pa.action === 'update') {
        if (!pa.entity_id || !pa.payload) return { ok: false, error: 'payload أو entity_id مفقود' };
        const { error } = await supabase.from(table).update(pa.payload).eq('id', pa.entity_id);
        if (error) return { ok: false, error: error.message };
        // المقارنة محصورة بمفاتيح الـpayload: الطلب ما يمسّ غيرها
        logDetails = updateDetails(beforeRow, pa.payload, Object.keys(pa.payload));
      } else if (pa.action === 'delete') {
        if (!pa.entity_id) return { ok: false, error: 'entity_id مفقود' };
        const { error } = await supabase.from(table).delete().eq('id', pa.entity_id);
        if (error) return { ok: false, error: error.message };
        logDetails = beforeRow
          ? valueDetails(beforeRow, Object.keys(beforeRow).filter(k => !['id', 'created_at', 'updated_at'].includes(k)))
          : {};
      }

      void logActivity({
        action: pa.action,
        entity_type: activityEntityOf(pa.entity_type),
        entity_id: pa.entity_id,
        entity_name: pa.entity_name,
        details: { ...logDetails, requested_by: pa.user_name, source: 'approval' },
      });
      // علم الطلب كـapproved
      const { error: upErr } = await supabase
        .from('pending_actions')
        .update({ status: 'approved', reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
        .eq('id', pa.id);
      if (upErr) return { ok: false, error: upErr.message };
      return { ok: true };
    }

    // مسار المستفيدين/المرافقين (الموجود سابقاً)
    let benLogDetails: Record<string, unknown> = {};

    if (pa.action === 'delete') {
      if (!pa.entity_id) return { ok: false, error: 'entity_id مفقود' };
      const { data: beforeRow } = await supabase
        .from('beneficiaries').select('*').eq('id', pa.entity_id).maybeSingle();
      const { error } = await supabase.from('beneficiaries').delete().eq('id', pa.entity_id);
      if (error) return { ok: false, error: error.message };
      benLogDetails = beforeRow
        ? valueDetails(beforeRow as Record<string, unknown>, APPROVAL_BENEFICIARY_FIELDS)
        : {};
    } else if (pa.action === 'create') {
      const cp = pa.payload as unknown as CreatePayload | null;
      if (!cp?.beneficiary) return { ok: false, error: 'payload مفقود' };
      const { data, error } = await supabase.from('beneficiaries').insert(cp.beneficiary).select('id').single();
      if (error) return { ok: false, error: error.message };
      const newId = (data as { id: string }).id;

      if (cp.exclusions?.length) {
        const rows = cp.exclusions.map(ex => ({ ...ex, beneficiary_id: newId }));
        const { error: exErr } = await supabase.from('exclusions').insert(rows);
        if (exErr) return { ok: false, error: `تم إنشاء المستفيد لكن المحظورات فشلت: ${exErr.message}` };
      }

      if (cp.fixed_meals?.length) {
        const rows = cp.fixed_meals.map(fm => ({ ...fm, beneficiary_id: newId }));
        let { error: fmErr } = await supabase.from('beneficiary_fixed_meals').insert(rows);
        if (fmErr && /category|column/i.test(fmErr.message)) {
          const fallback = rows.map(({ category: _c, suppress_if_meal_ids: _s, is_alternative: _a, ...rest }) => rest);
          ({ error: fmErr } = await supabase.from('beneficiary_fixed_meals').insert(fallback));
        }
        if (fmErr) return { ok: false, error: `تم إنشاء المستفيد لكن الأصناف الثابتة فشلت: ${fmErr.message}` };
      }

      const ovRes = await replaceMenuOverrides(supabase, newId, cp.menu_overrides);
      if (!ovRes.ok) return { ok: false, error: `تم إنشاء المستفيد لكن قرارات المنيو فشلت: ${ovRes.error}` };

      const names = await mealNameMap(supabase, [
        ...(cp.exclusions ?? []).flatMap(e => [e.meal_id, e.alternative_meal_id]),
        ...(cp.fixed_meals ?? []).map(f => f.meal_id),
      ]);
      const nm = (id?: string | null) => (id ? (names.get(id) ?? 'صنف محذوف') : '—');
      benLogDetails = {
        ...valueDetails(cp.beneficiary, APPROVAL_BENEFICIARY_FIELDS),
        ...(cp.exclusions?.length ? { exclusions: exclusionLabels(cp.exclusions, nm) } : {}),
        ...(cp.fixed_meals?.length ? { fixed_meals: fixedLabels(cp.fixed_meals, nm) } : {}),
        ...(cp.menu_overrides?.length ? { menu_overrides_count: cp.menu_overrides.length } : {}),
      };
    } else if (pa.action === 'update') {
      const cp = pa.payload as unknown as CreatePayload | null;
      if (!pa.entity_id || !cp?.beneficiary) return { ok: false, error: 'payload أو entity_id مفقود' };
      const id = pa.entity_id;

      // كل اللقطات تُقرأ قبل أي كتابة — الاستبدال يمسح الصفوف القديمة، فلو
      // قرأناها بعده سجّلنا «ما تغيّر شيء» بينما التغيير حصل فعلاً.
      const { data: beforeRow } = await supabase
        .from('beneficiaries').select('*').eq('id', id).maybeSingle();
      const { data: beforeExRows } = await supabase
        .from('exclusions').select('meal_id, alternative_meal_id').eq('beneficiary_id', id);
      const { data: beforeFmRows } = await supabase
        .from('beneficiary_fixed_meals')
        .select('meal_id, meal_type, day_of_week, quantity, is_alternative')
        .eq('beneficiary_id', id);

      // تحديث البيانات الأساسية للمستفيد
      const { error: updErr } = await supabase.from('beneficiaries').update(cp.beneficiary).eq('id', id);
      if (updErr) return { ok: false, error: updErr.message };

      // استبدال المحظورات (نحذف ثم نضيف لتطابق الـbehavior في BeneficiaryModal)
      const { error: delExErr } = await supabase.from('exclusions').delete().eq('beneficiary_id', id);
      if (delExErr) return { ok: false, error: `تم تحديث الأساس لكن مسح المحظورات فشل: ${delExErr.message}` };
      if (cp.exclusions?.length) {
        const rows = cp.exclusions.map(ex => ({ ...ex, beneficiary_id: id }));
        const { error: exErr } = await supabase.from('exclusions').insert(rows);
        if (exErr) return { ok: false, error: `إضافة المحظورات الجديدة فشلت: ${exErr.message}` };
      }

      // استبدال الأصناف الثابتة
      const { error: delFmErr } = await supabase.from('beneficiary_fixed_meals').delete().eq('beneficiary_id', id);
      if (delFmErr) return { ok: false, error: `تم تحديث الأساس لكن مسح الأصناف الثابتة فشل: ${delFmErr.message}` };
      if (cp.fixed_meals?.length) {
        const rows = cp.fixed_meals.map(fm => ({ ...fm, beneficiary_id: id }));
        let { error: fmErr } = await supabase.from('beneficiary_fixed_meals').insert(rows);
        if (fmErr && /category|column/i.test(fmErr.message)) {
          const fallback = rows.map(({ category: _c, suppress_if_meal_ids: _s, is_alternative: _a, ...rest }) => rest);
          ({ error: fmErr } = await supabase.from('beneficiary_fixed_meals').insert(fallback));
        }
        if (fmErr) return { ok: false, error: `إضافة الأصناف الثابتة فشلت: ${fmErr.message}` };
      }

      // استبدال قرارات المنيو
      const ovRes = await replaceMenuOverrides(supabase, id, cp.menu_overrides);
      if (!ovRes.ok) return { ok: false, error: `تحديث قرارات المنيو فشل: ${ovRes.error}` };

      const beforeEx = (beforeExRows ?? []) as ExclusionRow[];
      const beforeFm = (beforeFmRows ?? []) as FixedRow[];
      const names = await mealNameMap(supabase, [
        ...beforeEx.flatMap(e => [e.meal_id, e.alternative_meal_id]),
        ...beforeFm.map(f => f.meal_id),
        ...(cp.exclusions ?? []).flatMap(e => [e.meal_id, e.alternative_meal_id]),
        ...(cp.fixed_meals ?? []).map(f => f.meal_id),
      ]);
      const nm = (id2?: string | null) => (id2 ? (names.get(id2) ?? 'صنف محذوف') : '—');

      benLogDetails = updateDetails(
        beforeRow as Record<string, unknown> | null,
        cp.beneficiary,
        APPROVAL_BENEFICIARY_FIELDS,
        {
          ...listDiffDetails(
            'exclusions',
            exclusionLabels(beforeEx, nm),
            exclusionLabels(cp.exclusions ?? [], nm),
          ),
          ...listDiffDetails(
            'fixed_meals',
            fixedLabels(beforeFm, nm),
            fixedLabels(cp.fixed_meals ?? [], nm),
          ),
        },
      );
    }

    void logActivity({
      action: pa.action,
      entity_type: activityEntityOf(pa.entity_type),
      entity_id: pa.entity_id,
      entity_name: pa.entity_name,
      details: { ...benLogDetails, requested_by: pa.user_name, source: 'approval' },
    });

    const { error: upErr } = await supabase
      .from('pending_actions')
      .update({ status: 'approved', reviewed_by: admin.id, reviewed_at: new Date().toISOString() })
      .eq('id', pa.id);
    if (upErr) return { ok: false, error: upErr.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// رفض الطلب: نضع status = rejected ولا نمس بيانات المستفيدين
export async function rejectAction(
  supabase: SupabaseClient,
  admin: AppUser,
  pa: PendingAction,
  reason?: string,
) {
  return supabase.from('pending_actions').update({
    status: 'rejected',
    reviewed_by: admin.id,
    reviewed_at: new Date().toISOString(),
    reject_reason: reason ?? null,
  }).eq('id', pa.id);
}
