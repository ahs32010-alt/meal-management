'use client';

// قاعدة طلبات الموافقة: المستخدم غير الأدمن لما يضيف/يحذف ينحفظ طلبه هنا،
// والأدمن يقبله أو يرفضه من جرس الإشعارات. الإضافة/الحذف الفعليان يتمّان
// عند الموافقة فقط.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from './permissions';
import type { EntityType } from './types';

export interface PendingAction {
  id: string;
  user_id: string | null;
  user_name: string | null;
  action: 'create' | 'delete';
  entity_type: EntityType;
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
  }>;
}

// نوع موحّد لنتيجة enqueue: ok=true عند النجاح، ok=false مع سبب الفشل،
// و duplicate=true لما يكون عند المستخدم طلب pending سابق لنفس العملية.
export type EnqueueResult =
  | { ok: true }
  | { ok: false; error: string; duplicate?: boolean };

// نفحص لو في طلب pending سابق بنفس المستخدم لنفس الكيان — يمنع تكرار العملية.
async function findDuplicatePending(
  supabase: SupabaseClient,
  user: AppUser,
  match: {
    action: 'create' | 'delete';
    entityType: EntityType;
    entityId?: string;
    entityName?: string;
  },
): Promise<boolean> {
  let q = supabase
    .from('pending_actions')
    .select('id')
    .eq('status', 'pending')
    .eq('user_id', user.id)
    .eq('action', match.action)
    .eq('entity_type', match.entityType);
  if (match.entityId) q = q.eq('entity_id', match.entityId);
  if (match.entityName) q = q.eq('entity_name', match.entityName);
  const { data, error } = await q.limit(1);
  if (error) return false; // عند الخطأ نسمح بالمحاولة بدل ما نحجز المستخدم
  return (data?.length ?? 0) > 0;
}

// طلب إضافة
export async function enqueueCreate(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: EntityType,
  entityName: string,
  payload: CreatePayload,
): Promise<EnqueueResult> {
  const dup = await findDuplicatePending(supabase, user, {
    action: 'create',
    entityType,
    entityName,
  });
  if (dup) {
    return {
      ok: false,
      duplicate: true,
      error: `عندك طلب إضافة لـ "${entityName}" بانتظار الموافقة بالفعل.`,
    };
  }
  const { error } = await supabase.from('pending_actions').insert({
    user_id: user.id,
    user_name: user.full_name ?? user.email ?? '',
    action: 'create',
    entity_type: entityType,
    entity_name: entityName,
    payload: payload as unknown as Record<string, unknown>,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

// طلب حذف
export async function enqueueDelete(
  supabase: SupabaseClient,
  user: AppUser,
  entityType: EntityType,
  entityId: string,
  entityName: string | null,
): Promise<EnqueueResult> {
  const dup = await findDuplicatePending(supabase, user, {
    action: 'delete',
    entityType,
    entityId,
  });
  if (dup) {
    return {
      ok: false,
      duplicate: true,
      error: `عندك طلب حذف لهذا ${entityType === 'companion' ? 'المرافق' : 'المستفيد'} بانتظار الموافقة بالفعل.`,
    };
  }
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

// قبول الطلب: ننفّذ العملية الفعلية ثم نضع الحالة approved
export async function approveAction(
  supabase: SupabaseClient,
  admin: AppUser,
  pa: PendingAction,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (pa.action === 'delete') {
      if (!pa.entity_id) return { ok: false, error: 'entity_id مفقود' };
      const { error } = await supabase.from('beneficiaries').delete().eq('id', pa.entity_id);
      if (error) return { ok: false, error: error.message };
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
          const fallback = rows.map(({ category: _c, ...rest }) => rest);
          ({ error: fmErr } = await supabase.from('beneficiary_fixed_meals').insert(fallback));
        }
        if (fmErr) return { ok: false, error: `تم إنشاء المستفيد لكن الأصناف الثابتة فشلت: ${fmErr.message}` };
      }
    }

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
