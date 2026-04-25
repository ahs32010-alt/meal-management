'use client';

import { createClient } from '@/lib/supabase-client';

export type ActivityAction = 'create' | 'update' | 'delete';

export type ActivityEntityType =
  | 'beneficiary'
  | 'meal'
  | 'order'
  | 'user'
  | 'transliteration'
  | 'fixed_meal'
  | 'exclusion';

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
    const supabase = createClient();

    let info = readCachedAppUser();
    if (!info) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      info = { id: auth.user.id, email: auth.user.email ?? null, full_name: null };
    }

    await supabase.from('activity_log').insert({
      user_id: info.id,
      user_email: info.email,
      user_name: info.full_name ?? info.email,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      entity_name: input.entity_name ?? null,
      details: input.details ?? null,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('activity log failed:', err);
    }
  }
}

export const ENTITY_LABELS: Record<ActivityEntityType, string> = {
  beneficiary: 'مستفيد',
  meal: 'صنف',
  order: 'أمر تشغيل',
  user: 'مستخدم',
  transliteration: 'ترجمة حرفية',
  fixed_meal: 'صنف ثابت',
  exclusion: 'محظور',
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
  meal: 'bg-amber-50 text-amber-700 border-amber-200',
  order: 'bg-blue-50 text-blue-700 border-blue-200',
  user: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  transliteration: 'bg-slate-50 text-slate-700 border-slate-200',
  fixed_meal: 'bg-teal-50 text-teal-700 border-teal-200',
  exclusion: 'bg-rose-50 text-rose-700 border-rose-200',
};
