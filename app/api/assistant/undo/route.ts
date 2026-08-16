import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { clientIdFromRequest, rateLimit } from '@/lib/rate-limit';
import { executeUndo } from '@/lib/assistant/execute';
import { decodeUndo } from '@/lib/assistant/undo';
import { checkAssistantAccess, checkWriteAccess } from '@/lib/assistant/access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = createClient();

  const access = await checkAssistantAccess(supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const limit = rateLimit({
    key: `assistant-undo:${access.user.id}:${clientIdFromRequest(request)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: 'محاولات كثيرة، حاول بعد قليل' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  // الرمز موقَّع بمفتاح السيرفر — المتصفح يحمله ولا يقدر يصنعه.
  const payload = decodeUndo((body as { token?: unknown })?.token);
  if (!payload) {
    return NextResponse.json(
      { error: 'رمز التراجع غير صالح أو انتهت صلاحيته (ساعة واحدة).' },
      { status: 400 },
    );
  }

  const write = checkWriteAccess(access.user, payload.permission);
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: 403 });

  try {
    const outcome = await executeUndo(supabase, payload.ops, payload.label, {
      userId: access.user.id,
      page: '/assistant',
    });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, applied: outcome.applied }, { status: 500 });
    }
    return NextResponse.json({ ok: true, applied: outcome.applied });
  } catch (err) {
    console.error('[assistant/undo] failed:', err);
    return NextResponse.json({ error: 'تعذّر التراجع' }, { status: 500 });
  }
}
