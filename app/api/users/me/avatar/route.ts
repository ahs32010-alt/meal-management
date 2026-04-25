import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { assertAuthenticated } from '@/lib/auth';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { logActivityServer } from '@/lib/activity-log-server';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export async function POST(req: NextRequest) {
  const auth = await assertAuthenticated();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = rateLimit({
    key: `avatar:upload:${auth.userId}:${clientIdFromRequest(req)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'صيغة الطلب غير صالحة' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'لم يتم إرفاق ملف' }, { status: 400 });
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: 'نوع الملف غير مدعوم — استخدم JPG أو PNG أو WEBP أو GIF' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'حجم الصورة أكبر من 2 ميجابايت' }, { status: 400 });
  }

  const ext = EXT_BY_MIME[file.type] ?? 'jpg';
  const path = `${auth.userId}.${ext}`;

  const admin = createAdminClient();

  // Remove any older avatar for this user (different extension) so we don't accumulate orphans.
  const stale = Object.values(EXT_BY_MIME)
    .filter(e => e !== ext)
    .map(e => `${auth.userId}.${e}`);
  if (stale.length > 0) {
    await admin.storage.from('avatars').remove(stale);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from('avatars')
    .upload(path, buffer, { contentType: file.type, upsert: true, cacheControl: '31536000' });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from('avatars').getPublicUrl(path);
  // Bust caches so the new image shows immediately.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { data: row, error: updErr } = await admin
    .from('app_users')
    .update({ avatar_url: url })
    .eq('id', auth.userId)
    .select('avatar_url')
    .single();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logActivityServer({
    user_id: auth.userId,
    action: 'update',
    entity_type: 'user',
    entity_id: auth.userId,
    entity_name: null,
    details: { avatar_changed: true },
  });

  return NextResponse.json({ avatar_url: row.avatar_url });
}

export async function DELETE(req: NextRequest) {
  const auth = await assertAuthenticated();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = rateLimit({
    key: `avatar:delete:${auth.userId}:${clientIdFromRequest(req)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    );
  }

  const admin = createAdminClient();
  const all = Object.values(EXT_BY_MIME).map(e => `${auth.userId}.${e}`);
  await admin.storage.from('avatars').remove(all);

  const { error: updErr } = await admin
    .from('app_users')
    .update({ avatar_url: null })
    .eq('id', auth.userId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logActivityServer({
    user_id: auth.userId,
    action: 'update',
    entity_type: 'user',
    entity_id: auth.userId,
    entity_name: null,
    details: { avatar_removed: true },
  });

  return NextResponse.json({ ok: true });
}
