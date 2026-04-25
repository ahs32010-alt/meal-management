import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { assertAdmin } from '@/lib/auth';
import { parseJson, updateUserSchema, uuidSchema } from '@/lib/validation';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { sanitizeOptional } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

function validateId(id: string): { ok: true } | { ok: false; res: NextResponse } {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return { ok: false, res: NextResponse.json({ error: 'معرّف مستخدم غير صالح' }, { status: 400 }) };
  }
  return { ok: true };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const idCheck = validateId(params.id);
  if (!idCheck.ok) return idCheck.res;

  const check = await assertAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const limit = rateLimit({
    key: `users:update:${check.currentUserId}:${clientIdFromRequest(req)}`,
    limit: 60,
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

  const parsed = parseJson(updateUserSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { email, password, full_name, is_admin, permissions } = parsed.data;

  const admin = createAdminClient();

  if (email || password) {
    const authUpdate: { email?: string; password?: string } = {};
    if (email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    const { error: authErr } = await admin.auth.admin.updateUserById(params.id, authUpdate);
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
  }

  const profileUpdate: Record<string, unknown> = {};
  if (email !== undefined) profileUpdate.email = email;
  if (full_name !== undefined) profileUpdate.full_name = sanitizeOptional(full_name, 120);
  if (is_admin !== undefined) profileUpdate.is_admin = Boolean(is_admin);
  if (permissions !== undefined) profileUpdate.permissions = permissions;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: updErr } = await admin.from('app_users').update(profileUpdate).eq('id', params.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const { data: row } = await admin.from('app_users').select('*').eq('id', params.id).maybeSingle();
  return NextResponse.json({ user: row });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const idCheck = validateId(params.id);
  if (!idCheck.ok) return idCheck.res;

  const check = await assertAdmin();
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const limit = rateLimit({
    key: `users:delete:${check.currentUserId}:${clientIdFromRequest(req)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    );
  }

  if (check.currentUserId === params.id) {
    return NextResponse.json({ error: 'لا يمكنك حذف حسابك الخاص' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
