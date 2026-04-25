import { createClient as createServerClient } from '@/lib/supabase-server';

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
