import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

async function assertAdmin() {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Unauthorized', status: 401 as const, currentUserId: null };
  const { data: row } = await supabase
    .from('app_users')
    .select('is_admin')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!row?.is_admin) return { error: 'Forbidden', status: 403 as const, currentUserId: auth.user.id };
  return { ok: true as const, currentUserId: auth.user.id };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const check = await assertAdmin();
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await req.json();
  const { email, password, full_name, is_admin, permissions } = body ?? {};

  const admin = createAdminClient();

  if (email || password) {
    const authUpdate: { email?: string; password?: string } = {};
    if (email) authUpdate.email = email;
    if (password) {
      if (String(password).length < 6) {
        return NextResponse.json({ error: 'كلمة السر يجب أن تكون 6 أحرف على الأقل' }, { status: 400 });
      }
      authUpdate.password = password;
    }
    const { error: authErr } = await admin.auth.admin.updateUserById(params.id, authUpdate);
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
  }

  const profileUpdate: Record<string, unknown> = {};
  if (email !== undefined) profileUpdate.email = email;
  if (full_name !== undefined) profileUpdate.full_name = full_name;
  if (is_admin !== undefined) profileUpdate.is_admin = Boolean(is_admin);
  if (permissions !== undefined) profileUpdate.permissions = permissions;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: updErr } = await admin.from('app_users').update(profileUpdate).eq('id', params.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const { data: row } = await admin.from('app_users').select('*').eq('id', params.id).maybeSingle();
  return NextResponse.json({ user: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const check = await assertAdmin();
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  if (check.currentUserId === params.id) {
    return NextResponse.json({ error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // app_users row cascades via FK
  return NextResponse.json({ ok: true });
}
