import { createClient as createServerClient } from '@/lib/supabase-server';
import type { PageKey, PermissionAction, PermissionsMap } from '@/lib/permissions';

export type AdminCheckResult =
  | { ok: true; currentUserId: string }
  | { ok: false; error: string; status: 401 | 403; currentUserId: string | null };

export async function assertAdmin(): Promise<AdminCheckResult> {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return { ok: false, error: 'Unauthorized', status: 401, currentUserId: null };
  }
  const { data: row } = await supabase
    .from('app_users')
    .select('is_admin')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!row?.is_admin) {
    return { ok: false, error: 'Forbidden', status: 403, currentUserId: auth.user.id };
  }
  return { ok: true, currentUserId: auth.user.id };
}

export async function assertAuthenticated(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string; status: 401 }
> {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'Unauthorized', status: 401 };
  return { ok: true, userId: auth.user.id };
}

/**
 * يتحقق أن المستخدم يملك إجراءً معيّناً على صفحة معيّنة.
 * الأدمن يمرّ دائماً. نفس منطق `can()` في الواجهة، لكن على الخادم — الواجهة
 * تخفي الأزرار فقط، والمنع الحقيقي لازم يكون هنا.
 */
export async function assertPagePermission(
  page: PageKey,
  action: PermissionAction,
): Promise<
  | { ok: true; userId: string; userName: string | null; isAdmin: boolean }
  | { ok: false; error: string; status: 401 | 403 }
> {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, error: 'Unauthorized', status: 401 };

  const { data: row } = await supabase
    .from('app_users')
    .select('is_admin, full_name, permissions')
    .eq('id', auth.user.id)
    .maybeSingle();

  const isAdmin = !!row?.is_admin;
  const allowed = isAdmin || !!(row?.permissions as PermissionsMap | null)?.[page]?.[action];
  if (!allowed) return { ok: false, error: 'Forbidden', status: 403 };

  return {
    ok: true,
    userId: auth.user.id,
    userName: (row?.full_name as string | null) ?? auth.user.email ?? null,
    isAdmin,
  };
}
