/**
 * فحص الوصول للمساعد على السيرفر.
 *
 * إخفاء الرابط من القائمة ليس حماية — كل طلب يمر من هنا.
 * وأي أمر تنفيذي يحتاج، إضافةً لصلاحية فتح المساعد، **صلاحية الصفحة المعنية
 * نفسها**: مين ما يقدر يعدّل المستفيدين من صفحتهم، ما يقدر يعدّلهم عبر المساعد.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { can, needsApproval, type AppUser, type PageKey, type PermissionAction } from '@/lib/permissions';

export type Access =
  | { ok: true; user: AppUser }
  | { ok: false; status: 401 | 403; error: string };

type MinimalUser = Pick<AppUser, 'id' | 'is_admin' | 'permissions' | 'approval_required'>;

export async function checkAssistantAccess(supabase: SupabaseClient): Promise<Access> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data } = await supabase
    .from('app_users')
    .select('id, email, full_name, is_admin, permissions, approval_required, avatar_url, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  const appUser = data as AppUser | null;
  if (!appUser) return { ok: false, status: 403, error: 'Forbidden' };
  if (!can(appUser, 'assistant', 'view')) {
    return { ok: false, status: 403, error: 'ليس لديك صلاحية استخدام المساعد الذكي' };
  }
  return { ok: true, user: appUser };
}

const PAGE_LABEL: Partial<Record<PageKey, string>> = {
  beneficiaries: 'المستفيدين',
  companions: 'المرافقين',
  menu: 'قائمة الطعام',
  meals: 'الأصناف',
};

const ACTION_LABEL: Record<PermissionAction, string> = {
  view: 'عرض',
  add: 'إضافة',
  edit: 'تعديل',
  delete: 'حذف',
};

/**
 * هل يجوز لهذا المستخدم تنفيذ خطة تلمس هذه الصفحة؟
 * ملاحظة: من كانت أفعاله تحتاج موافقة الأدمن يُمنع من التنفيذ المباشر عبر
 * المساعد ويُوجَّه للصفحة الأصلية، حتى لا يلتفّ المساعد حول نظام الموافقات.
 */
export function checkWriteAccess(
  user: MinimalUser,
  permission: { page: PageKey; action: PermissionAction },
): { ok: true } | { ok: false; error: string } {
  const asUser = user as AppUser;
  if (!can(asUser, permission.page, permission.action)) {
    const label = PAGE_LABEL[permission.page] ?? permission.page;
    return { ok: false, error: `ما عندك صلاحية ${ACTION_LABEL[permission.action]} على ${label}.` };
  }
  if (permission.action !== 'view' && needsApproval(asUser, permission.page, permission.action)) {
    const label = PAGE_LABEL[permission.page] ?? permission.page;
    return {
      ok: false,
      error: `تعديلاتك على ${label} تحتاج موافقة الأدمن — نفّذ العملية من صفحة ${label} حتى تمر على مسار الموافقات.`,
    };
  }
  return { ok: true };
}
