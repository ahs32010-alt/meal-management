import { createClient as createServerClient } from '@/lib/supabase-server';
import type { PageKey, PermissionAction, PermissionsMap } from '@/lib/permissions';
import { cachedByToken } from '@/lib/auth-cache';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * المستخدم الحالي + صفّه في `app_users`.
 *
 * كان كل مسار API يدفع رحلتَي شبكة متسلسلتين قبل أن يبدأ شغله: `getUser()`
 * للتحقّق من الرمز (٣٣٥–٤٨٠ms)، ثم قراءة صفّ الصلاحيات (~٤٥٠ms). والنتيجة
 * واحدة لنفس الرمز، فنحسبها مرّة كل ١٥ ثانية بدل كل طلب.
 *
 * التحقّق لم يضعف: الرمز يُتحقَّق منه عند Supabase كالمعتاد، والذاكرة تمنع
 * تكرار السؤال عن **نفس** الرمز فقط. راجع lib/auth-cache.ts.
 */
export async function getCachedUser(supabase: SupabaseClient): Promise<User | null> {
  return currentUser(supabase);
}

async function currentUser(supabase: SupabaseClient): Promise<User | null> {
  // قراءة محلية من الكوكيز بلا شبكة — منها نأخذ مفتاح الذاكرة
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return (await supabase.auth.getUser()).data.user ?? null;
  return cachedByToken(`user:${token}`, async () =>
    (await supabase.auth.getUser()).data.user ?? null);
}

type AppUserRow = { is_admin?: boolean; full_name?: string | null; permissions?: PermissionsMap | null };

async function currentUserRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<AppUserRow | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const key = `row:${session?.access_token ?? userId}`;
  return cachedByToken(key, async () => {
    const { data } = await supabase
      .from('app_users')
      .select('is_admin, full_name, permissions')
      .eq('id', userId)
      .maybeSingle();
    return (data as AppUserRow | null) ?? null;
  });
}

export type AdminCheckResult =
  | { ok: true; currentUserId: string }
  | { ok: false; error: string; status: 401 | 403; currentUserId: string | null };

export async function assertAdmin(): Promise<AdminCheckResult> {
  const supabase = createServerClient();
  const user = await currentUser(supabase);
  if (!user) {
    return { ok: false, error: 'Unauthorized', status: 401, currentUserId: null };
  }
  const row = await currentUserRow(supabase, user.id);
  if (!row?.is_admin) {
    return { ok: false, error: 'Forbidden', status: 403, currentUserId: user.id };
  }
  return { ok: true, currentUserId: user.id };
}

export async function assertAuthenticated(): Promise<
  | { ok: true; userId: string }
  | { ok: false; error: string; status: 401 }
> {
  const supabase = createServerClient();
  const user = await currentUser(supabase);
  if (!user) return { ok: false, error: 'Unauthorized', status: 401 };
  return { ok: true, userId: user.id };
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
  const user = await currentUser(supabase);
  if (!user) return { ok: false, error: 'Unauthorized', status: 401 };

  const row = await currentUserRow(supabase, user.id);

  const isAdmin = !!row?.is_admin;
  const allowed = isAdmin || !!(row?.permissions as PermissionsMap | null)?.[page]?.[action];
  if (!allowed) return { ok: false, error: 'Forbidden', status: 403 };

  return {
    ok: true,
    userId: user.id,
    userName: (row?.full_name as string | null) ?? user.email ?? null,
    isAdmin,
  };
}
