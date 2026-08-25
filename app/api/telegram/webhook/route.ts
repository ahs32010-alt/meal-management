/**
 * مدخل تليقرام إلى النظام.
 *
 * ── لماذا لا كوكيز هنا؟ ────────────────────────────────────────────────────
 * الطلب قادم من خوادم تليقرام لا من متصفح، فلا جلسة ولا هوية في الطلب نفسه.
 * ما يحمي هذا المسار شيئان: سرٌّ في ترويسة يعرفه تليقرام وحده (`secret_token`
 * الذي ضبطناه مع الويب‑هوك)، ثم أن كل ما بعده مربوط بحساب عبر `chat_id` —
 * ومحادثة غير مربوطة لا ترى من النظام حرفاً.
 *
 * ── لماذا نردّ ٢٠٠ دائماً؟ ──────────────────────────────────────────────────
 * أي ردّ غير ناجح يجعل تليقرام يعيد التحديث مراراً. وخطأٌ في رسالة واحدة لا
 * يستحق طابوراً معاداً بلا نهاية — فنبتلع الخطأ هنا، ونخبر المستخدم بالخطأ
 * رسالةً في محادثته، ونحمي أنفسنا من التكرار بحجز `update_id` في القاعدة.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { isConfigured, type TgUpdate } from '@/lib/telegram/api';
import { safeHandleUpdate } from '@/lib/telegram/handle';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** جولة أدوات كاملة قد تطول — نمنحها ما نمنحه مسار المساعد في الويب. */
export const maxDuration = 120;

function secretMatches(header: string | null): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  // بلا سرّ مضبوط لا نستقبل شيئاً: مسار مفتوح للعالم يتكلم بصوت النظام.
  if (!expected) return false;
  if (!header) return false;

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!isConfigured()) {
    console.error('[telegram] webhook hit but TELEGRAM_BOT_TOKEN is missing');
    return NextResponse.json({ ok: true });
  }

  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (typeof update?.update_id !== 'number') return NextResponse.json({ ok: true });

  await safeHandleUpdate(update);
  return NextResponse.json({ ok: true });
}
