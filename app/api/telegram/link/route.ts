/**
 * ربط حساب المستخدم بمحادثة تليقرام — من جهة الموقع.
 *
 * GET    حالة الربط لهذا المستخدم (وللأدمن: كل الروابط).
 * POST   كود ربط جديد، صالح ١٥ دقيقة، يُستهلك مرة واحدة.
 * DELETE فكّ ربط محادثة.
 *
 * الهوية هنا من الكوكيز كأي مسار آخر؛ ومفتاح الخدمة يُستعمل للكتابة فقط لأن
 * جداول تليقرام مغلقة أمام العميل المتصفّح بالكامل.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { clientIdFromRequest, rateLimit } from '@/lib/rate-limit';
import { issueLinkCode, listLinksForUser } from '@/lib/telegram/store';
import { botToken, getMe } from '@/lib/telegram/api';
import type { AppUser } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function currentUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('app_users')
    .select('id, email, full_name, is_admin, permissions, approval_required, avatar_url, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  return (data as AppUser | null) ?? null;
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const links = await listLinksForUser(admin, user.id);

  // اسم البوت يوفّر على المستخدم البحث عنه — ونتجاوزه بصمت لو تعذّر.
  let bot: string | null = null;
  if (botToken()) {
    bot = await getMe()
      .then((me) => me.username ?? null)
      .catch(() => null);
  }

  return NextResponse.json({
    configured: Boolean(botToken()),
    botUsername: bot,
    links: links.map((l) => ({
      chatId: String(l.chat_id),
      username: l.telegram_username,
      name: l.telegram_name,
      linkedAt: l.linked_at,
      lastSeenAt: l.last_seen_at,
    })),
  });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!botToken()) {
    return NextResponse.json(
      { error: 'بوت تليقرام غير مفعّل — ينقص TELEGRAM_BOT_TOKEN على الخادم.' },
      { status: 503 },
    );
  }

  // الكود مفتاح حساب: نحدّ توليده حتى لا يُستنزف بالتخمين أو بالخطأ.
  const limit = rateLimit({
    key: `tg-link:${user.id}:${clientIdFromRequest(request)}`,
    limit: 5,
    windowMs: 10 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'أكواد كثيرة في وقت قصير. انتظر قليلاً.' },
      { status: 429 },
    );
  }

  try {
    const { code, expiresAt } = await issueLinkCode(createAdminClient(), user.id);
    return NextResponse.json({ code, expiresAt });
  } catch (err) {
    console.error('[telegram/link] issue failed:', err);
    return NextResponse.json({ error: 'تعذّر إنشاء الكود' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  const chatId = Number((body as { chatId?: unknown })?.chatId);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: 'معرّف المحادثة مفقود' }, { status: 400 });
  }

  const admin = createAdminClient();

  // الأدمن يفكّ أي ربط؛ وغيره لا يفكّ إلا ربط نفسه.
  let query = admin.from('telegram_links').delete().eq('chat_id', chatId);
  if (!user.is_admin) query = query.eq('user_id', user.id);
  const { error } = await query;

  if (error) return NextResponse.json({ error: 'تعذّر فكّ الربط' }, { status: 500 });

  await admin.from('telegram_sessions').delete().eq('chat_id', chatId);
  await admin.from('telegram_pending').delete().eq('chat_id', chatId);

  return NextResponse.json({ ok: true });
}
