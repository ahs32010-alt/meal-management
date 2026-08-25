import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { assertAdmin } from '@/lib/auth';
import { parseJson, updateUserSchema, uuidSchema } from '@/lib/validation';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { sanitizeOptional } from '@/lib/sanitize';
import { logActivityServer } from '@/lib/activity-log-server';
import { updateDetails, valueDetails } from '@/lib/activity-diff';
import { ACTION_LABELS, PAGES, type PageKey, type PermissionAction } from '@/lib/permissions';

const PAGE_LABEL_BY_KEY: Record<string, string> = Object.fromEntries(PAGES.map(p => [p.key, p.label]));

/**
 * فرق مصفوفة صلاحيات مُتداخلة (صفحة → إجراء → boolean) كسطور مقروءة:
 * «المستفيدون: حذف». المقارنة على مستوى (صفحة، إجراء) لأن تخزين الكائن كاملاً
 * في السجل يعطي كتلة JSON ما أحد يقراها.
 */
function diffPermissionMaps(
  before: unknown,
  after: unknown
): { granted: string[]; revoked: string[] } {
  const asMap = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, Record<string, unknown>>) : {});
  const b = asMap(before);
  const a = asMap(after);
  const granted: string[] = [];
  const revoked: string[] = [];
  const pageKeys = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const page of pageKeys) {
    const actions = new Set([...Object.keys(b[page] ?? {}), ...Object.keys(a[page] ?? {})]);
    for (const action of actions) {
      const was = Boolean(b[page]?.[action]);
      const now = Boolean(a[page]?.[action]);
      if (was === now) continue;
      const label = `${PAGE_LABEL_BY_KEY[page as PageKey] ?? page}: ${ACTION_LABELS[action as PermissionAction] ?? action}`;
      (now ? granted : revoked).push(label);
    }
  }
  return { granted, revoked };
}

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

  const { email, password, full_name, is_admin, permissions, approval_required } = parsed.data;

  const admin = createAdminClient();

  if (email || password) {
    const authUpdate: { email?: string; password?: string } = {};
    if (email) authUpdate.email = email;
    if (password) authUpdate.password = password;
    const { error: authErr } = await admin.auth.admin.updateUserById(params.id, authUpdate);
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 400 });
  }

  // اللقطة قبل الكتابة — بدونها ما نقدر نقول في السجل «من إيش إلى إيش»
  const { data: beforeRow } = await admin.from('app_users').select('*').eq('id', params.id).maybeSingle();

  const profileUpdate: Record<string, unknown> = {};
  if (email !== undefined) profileUpdate.email = email;
  if (full_name !== undefined) profileUpdate.full_name = sanitizeOptional(full_name, 120);
  if (is_admin !== undefined) profileUpdate.is_admin = Boolean(is_admin);
  if (permissions !== undefined) profileUpdate.permissions = permissions;
  if (approval_required !== undefined) profileUpdate.approval_required = approval_required;

  if (Object.keys(profileUpdate).length > 0) {
    const { error: updErr } = await admin.from('app_users').update(profileUpdate).eq('id', params.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  const { data: row } = await admin.from('app_users').select('*').eq('id', params.id).maybeSingle();

  const permsDiff = permissions !== undefined
    ? diffPermissionMaps(beforeRow?.permissions, row?.permissions)
    : { granted: [], revoked: [] };
  const approvalDiff = approval_required !== undefined
    ? diffPermissionMaps(beforeRow?.approval_required, row?.approval_required)
    : { granted: [], revoked: [] };

  await logActivityServer({
    user_id: check.currentUserId,
    action: 'update',
    entity_type: 'user',
    entity_id: params.id,
    entity_name: row?.full_name ?? row?.email ?? null,
    details: updateDetails(
      beforeRow,
      row,
      ['email', 'full_name', 'is_admin'],
      {
        // كلمة المرور لا تُسجَّل قيمتها أبداً — فقط أنها بُدِّلت
        ...(password ? { password: 'بُدِّلت (القيمة غير مسجّلة)' } : {}),
        ...(permsDiff.granted.length > 0 ? { granted_permissions: permsDiff.granted } : {}),
        ...(permsDiff.revoked.length > 0 ? { revoked_permissions: permsDiff.revoked } : {}),
        ...(approvalDiff.granted.length > 0 ? { approval_enabled: approvalDiff.granted } : {}),
        ...(approvalDiff.revoked.length > 0 ? { approval_disabled: approvalDiff.revoked } : {}),
      },
    ),
    page: '/settings',
  });

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

  // Capture user info before deletion so we can log a meaningful entry.
  const { data: target } = await admin
    .from('app_users')
    .select('email, full_name, is_admin')
    .eq('id', params.id)
    .maybeSingle();

  const { error } = await admin.auth.admin.deleteUser(params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivityServer({
    user_id: check.currentUserId,
    action: 'delete',
    entity_type: 'user',
    entity_id: params.id,
    entity_name: target?.full_name ?? target?.email ?? null,
    details: target ? valueDetails(target, ['email', 'full_name', 'is_admin']) : null,
    page: '/settings',
  });

  return NextResponse.json({ ok: true });
}
