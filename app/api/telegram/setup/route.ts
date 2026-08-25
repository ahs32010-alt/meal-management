/**
 * إدارة الويب‑هوك من داخل النظام — للأدمن وحده.
 *
 * تسجيل الويب‑هوك عند تليقرام يحتاج نداءً واحداً بالرمز السرّي، ويُنسى بعد كل
 * تغيير نطاق. فبدل أن يُشرح للمستخدم أمر curl يحمل مفتاح البوت، نجعله زراً
 * في صفحة الإعدادات: الخادم وحده يلمس المفتاح، والأدمن يرى الحالة والأخطاء.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  botToken,
  deleteWebhook,
  getMe,
  getWebhookInfo,
  setMyCommands,
  setWebhook,
  TelegramError,
} from '@/lib/telegram/api';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function requireAdmin(): Promise<{ ok: true } | { ok: false; status: 401 | 403 }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data } = await supabase
    .from('app_users')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (!(data as { is_admin?: boolean } | null)?.is_admin) return { ok: false, status: 403 };
  return { ok: true };
}

/** عنوان الويب‑هوك: من متغيّر البيئة إن وُجد، وإلا من نطاق الطلب نفسه. */
function webhookUrl(request: Request): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    new URL(request.url).origin;
  return `${base.replace(/\/$/, '')}/api/telegram/webhook`;
}

const COMMANDS = [
  { command: 'help', description: 'أمثلة وأوامر البوت' },
  { command: 'new', description: 'ابدأ حواراً جديداً' },
  { command: 'whoami', description: 'بأي حساب أتكلم' },
  { command: 'unlink', description: 'فكّ ربط هذه المحادثة' },
];

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: admin.status });

  const hasToken = Boolean(botToken());
  const hasSecret = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim());

  if (!hasToken) {
    return NextResponse.json({
      hasToken: false,
      hasSecret,
      expectedUrl: webhookUrl(request),
    });
  }

  try {
    const [me, info] = await Promise.all([getMe(), getWebhookInfo()]);
    const expected = webhookUrl(request);
    return NextResponse.json({
      hasToken: true,
      hasSecret,
      botUsername: me.username ?? null,
      expectedUrl: expected,
      webhookUrl: info.url || null,
      matches: info.url === expected,
      pending: info.pending_update_count,
      lastError: info.last_error_message ?? null,
      lastErrorAt: info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : null,
    });
  } catch (err) {
    const message = err instanceof TelegramError ? err.message : 'تعذّر الاتصال بتليقرام';
    return NextResponse.json({ hasToken: true, hasSecret, error: message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: admin.status });

  if (!botToken()) {
    return NextResponse.json({ error: 'ينقص TELEGRAM_BOT_TOKEN على الخادم.' }, { status: 503 });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json(
      {
        error:
          'ينقص TELEGRAM_WEBHOOK_SECRET على الخادم. بدونه يبقى مسار الويب‑هوك مفتوحاً لأي أحد، فنرفض تفعيله.',
      },
      { status: 503 },
    );
  }

  const url = webhookUrl(request);
  if (!url.startsWith('https://')) {
    return NextResponse.json(
      { error: 'تليقرام يقبل عناوين HTTPS فقط — لا يصلح localhost. استعمل نطاق النشر.' },
      { status: 400 },
    );
  }

  try {
    await setWebhook(url, secret);
    // القائمة تجميلية؛ فشلها لا يبطل التفعيل.
    await setMyCommands(COMMANDS).catch(() => undefined);
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    console.error('[telegram/setup] setWebhook failed:', err);
    const message = err instanceof TelegramError ? err.message : 'تعذّر تفعيل الويب‑هوك';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function DELETE() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: 'Forbidden' }, { status: admin.status });

  if (!botToken()) {
    return NextResponse.json({ error: 'ينقص TELEGRAM_BOT_TOKEN على الخادم.' }, { status: 503 });
  }

  try {
    await deleteWebhook();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[telegram/setup] deleteWebhook failed:', err);
    return NextResponse.json({ error: 'تعذّر إيقاف الويب‑هوك' }, { status: 502 });
  }
}
