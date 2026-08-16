import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { clientIdFromRequest, rateLimit } from '@/lib/rate-limit';
import { ask } from '@/lib/assistant/answer';
import { runTurn } from '@/lib/assistant/plan';
import type { DialogContext, Pending } from '@/lib/assistant/interpret';
import { checkAssistantAccess, checkWriteAccess } from '@/lib/assistant/access';
import { can, type PageKey } from '@/lib/permissions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_QUESTION_LENGTH = 300;

export async function POST(request: Request) {
  const supabase = createClient();

  const access = await checkAssistantAccess(supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const limit = rateLimit({
    key: `assistant:${access.user.id}:${clientIdFromRequest(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول بعد قليل' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  const { question: raw, context, pending } = (body ?? {}) as {
    question?: unknown;
    context?: DialogContext;
    pending?: Pending;
  };

  if (typeof raw !== 'string' || !raw.trim()) {
    return NextResponse.json({ error: 'اكتب سؤالاً أو أمراً' }, { status: 400 });
  }
  if (raw.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json(
      { error: `النص طويل جداً (الحد ${MAX_QUESTION_LENGTH} حرف)` },
      { status: 400 },
    );
  }

  const question = raw.trim();

  try {
    const turn = await runTurn(supabase, { text: question, context, pending });

    if (turn.kind === 'ask') {
      return NextResponse.json({
        kind: 'ask',
        question: turn.question,
        field: turn.field,
        options: turn.options,
        pending: turn.pending,
        context: turn.context,
      });
    }

    if (turn.kind === 'navigate') {
      // لا نوجّه المستخدم لصفحة ما يقدر يفتحها أصلاً
      const allowed =
        turn.permission === null ||
        can(access.user, turn.permission as PageKey, 'view');
      if (!allowed) {
        return NextResponse.json({
          kind: 'problem',
          type: 'problem',
          title: 'غير مسموح',
          summary: `ما عندك صلاحية عرض صفحة ${turn.label}.`,
          context: turn.context,
        });
      }
      return NextResponse.json({
        kind: 'navigate',
        href: turn.href,
        label: turn.label,
        context: turn.context,
      });
    }

    if (turn.kind === 'problem') {
      return NextResponse.json({ kind: 'problem', ...turn.problem, context: turn.context });
    }

    if (turn.kind === 'plan') {
      // نتحقق من صلاحية الكتابة الآن حتى لا نعرض معاينة لعملية ممنوعة أصلاً.
      const write = checkWriteAccess(access.user, turn.plan.permission);
      if (!write.ok) {
        return NextResponse.json({
          kind: 'problem',
          type: 'problem',
          title: 'غير مسموح',
          summary: write.error,
          context: turn.context,
        });
      }
      // ops و activity تفاصيل داخلية — تُعاد بناؤها عند التنفيذ ولا تُرسل.
      const { ops: _ops, activity: _activity, ...safe } = turn.plan;
      void _ops;
      void _activity;
      return NextResponse.json({
        kind: 'plan',
        ...safe,
        question,
        context: turn.context,
        usedContext: turn.usedContext,
        // نعيد المدخلات كما هي حتى يرسلها المتصفح عند التأكيد فيُعاد الاشتقاق.
        replay: { context: context ?? null, pending: pending ?? null },
      });
    }

    const answer = await ask(supabase, question);
    return NextResponse.json({ kind: 'answer', ...answer, context: context ?? null });
  } catch (err) {
    console.error('[assistant] failed:', err);
    return NextResponse.json({ error: 'تعذّر تنفيذ الطلب' }, { status: 500 });
  }
}
