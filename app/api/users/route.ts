import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

async function assertAdmin() {
  const supabase = createServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Unauthorized', status: 401 as const };
  const { data: row } = await supabase
    .from('app_users')
    .select('is_admin')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (!row?.is_admin) return { error: 'Forbidden', status: 403 as const };
  return { ok: true as const };
}

export async function GET() {
  const check = await assertAdmin();
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_users')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ users: data ?? [] });
}

export async function POST(req: NextRequest) {
  const check = await assertAdmin();
  if ('error' in check) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await req.json();
  const { email, password, full_name, is_admin, permissions } = body ?? {};

  if (!email || !password) {
    return NextResponse.json({ error: 'الإيميل وكلمة السر مطلوبان' }, { status: 400 });
  }
  if (String(password).length < 6) {
    return NextResponse.json({ error: 'كلمة السر يجب أن تكون 6 أحرف على الأقل' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name ?? null },
  });
  if (authErr || !created.user) {
    return NextResponse.json({ error: authErr?.message ?? 'فشل إنشاء المستخدم' }, { status: 400 });
  }

  const { data: row, error: insertErr } = await admin
    .from('app_users')
    .insert({
      id: created.user.id,
      email,
      full_name: full_name ?? null,
      is_admin: Boolean(is_admin),
      permissions: permissions ?? {},
    })
    .select()
    .single();

  if (insertErr) {
    // Rollback the auth user if profile insert fails
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ user: row });
}
