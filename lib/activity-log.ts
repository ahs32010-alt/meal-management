'use client';

import { supabase } from '@/lib/supabase-client';
import { PAGE_DETAIL_KEY } from '@/lib/activity-describe';

export type ActivityAction = 'create' | 'update' | 'delete';

export type ActivityEntityType =
  | 'beneficiary'
  | 'companion'
  | 'meal'
  | 'order'
  | 'user'
  | 'transliteration'
  | 'fixed_meal'
  | 'exclusion'
  | 'backup'
  | 'raw_material'
  | 'cost_unit'
  | 'recipe_item'
  | 'order_cost';

export interface LogActivityInput {
  action: ActivityAction;
  entity_type: ActivityEntityType;
  entity_id?: string | null;
  entity_name?: string | null;
  details?: Record<string, unknown> | null;
}

interface CachedAppUser {
  id: string;
  email: string | null;
  full_name: string | null;
}

function readCachedAppUser(): CachedAppUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem('kha:user');
    if (!raw) return null;
    const entry = JSON.parse(raw);
    const u = entry?.user;
    if (!u?.id) return null;
    return { id: u.id, email: u.email ?? null, full_name: u.full_name ?? null };
  } catch {
    return null;
  }
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    // نستخدم العميل المفرد المشترك. إنشاء عميل جديد هنا كان يخلق GoTrueClient
    // إضافياً يزاحم على نفس قفل `lock:${storageKey}` الذي يمر عليه كل طلب
    // PostgREST — فيتأخر الحفظ ثوانيَ، ويسوء كلما طالت الجلسة لأن كل عميل
    // يترك مؤقّت تحديث توكن لا يُنظَّف.
    let info = readCachedAppUser();
    if (!info) {
      // getSession يقرأ من التخزين المحلي بلا طلب شبكة — نفس السبب المشروح في
      // lib/use-current-user.ts. getUser كان يطلب الشبكة وهو ماسك القفل
      // المشترك، فيوقف الحفظ الجاري خلفه.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      info = { id: session.user.id, email: session.user.email ?? null, full_name: null };
    }

    // الصفحة تُلتقط هنا مرة وحدة بدل ما تُمرَّر يدوياً من 40+ نقطة استدعاء،
    // عشان كل عملية تعرف من أي صفحة صارت حتى لو ما مرّرت شيء.
    const page = typeof window !== 'undefined' ? window.location.pathname : null;
    const details = { ...(input.details ?? {}), [PAGE_DETAIL_KEY]: page };

    await supabase.from('activity_log').insert({
      user_id: info.id,
      user_email: info.email,
      user_name: info.full_name ?? info.email,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      entity_name: input.entity_name ?? null,
      details,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('activity log failed:', err);
    }
  }
}

export const ENTITY_LABELS: Record<ActivityEntityType, string> = {
  beneficiary: 'مستفيد',
  companion: 'مرافق',
  meal: 'صنف',
  order: 'أمر تشغيل',
  user: 'مستخدم',
  transliteration: 'ترجمة حرفية',
  fixed_meal: 'صنف ثابت',
  exclusion: 'محظور',
  backup: 'نسخة احتياطية',
  raw_material: 'مادة أولية',
  cost_unit: 'وحدة قياس',
  recipe_item: 'مكوّن وصفة',
  order_cost: 'تكلفة أمر',
};

export const ACTION_LABELS_AR: Record<ActivityAction, string> = {
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
};

export const ACTION_STYLES: Record<ActivityAction, string> = {
  create: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  update: 'bg-blue-50 text-blue-700 border-blue-200',
  delete: 'bg-red-50 text-red-700 border-red-200',
};

export const ENTITY_STYLES: Record<ActivityEntityType, string> = {
  beneficiary: 'bg-violet-50 text-violet-700 border-violet-200',
  companion: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  meal: 'bg-amber-50 text-amber-700 border-amber-200',
  order: 'bg-blue-50 text-blue-700 border-blue-200',
  user: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  transliteration: 'bg-slate-50 text-slate-700 border-slate-200',
  fixed_meal: 'bg-teal-50 text-teal-700 border-teal-200',
  exclusion: 'bg-rose-50 text-rose-700 border-rose-200',
  backup: 'bg-cyan-50 text-cyan-700 border-cyan-200',
  raw_material: 'bg-lime-50 text-lime-700 border-lime-200',
  cost_unit: 'bg-sky-50 text-sky-700 border-sky-200',
  recipe_item: 'bg-orange-50 text-orange-700 border-orange-200',
  order_cost: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
};
