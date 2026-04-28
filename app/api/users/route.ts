import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { assertAdmin } from '@/lib/auth';
import { createUserSchema, parseJson } from '@/lib/validation';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { sanitizeOptional } from '@/lib/sanitize';
import { logActivityServer } from '@/lib/activity-log-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const check = await assertAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

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
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const limit = rateLimit({
    key: `users:create:${check.currentUserId}:${clientIdFromRequest(req)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'صيغة JSON غير صالحة' }, { status: 400 });
  }

  const parsed = parseJson(createUserSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { email, password, full_name, is_admin, permissions, approval_required } = parsed.data;
  const cleanFullName = sanitizeOptional(full_name, 120);

  const admin = createAdminClient();

  const { data: created, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: cleanFullName },
  });
  if (authErr || !created.user) {
    return NextResponse.json({ error: authErr?.message ?? 'فشل إنشاء المستخدم' }, { status: 400 });
  }

  const { data: row, error: insertErr } = await admin
    .from('app_users')
    .insert({
      id: created.user.id,
      email,
      full_name: cleanFullName,
      is_admin: Boolean(is_admin),
      permissions: permissions ?? {},
      approval_required: approval_required ?? {},
    })
    .select()
    .single();

  if (insertErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await logActivityServer({
    user_id: check.currentUserId,
    action: 'create',
    entity_type: 'user',
    entity_id: created.user.id,
    entity_name: cleanFullName ?? email,
    details: { email, is_admin: Boolean(is_admin) },
  });

  return NextResponse.json({ user: row });
}
