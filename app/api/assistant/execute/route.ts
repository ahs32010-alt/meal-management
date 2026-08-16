import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { clientIdFromRequest, rateLimit } from '@/lib/rate-limit';
import { runTurn } from '@/lib/assistant/plan';
import type { DialogContext, Pending } from '@/lib/assistant/interpret';
import { executePlan } from '@/lib/assistant/execute';
import { checkAssistantAccess, checkWriteAccess } from '@/lib/assistant/access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = createClient();

  const access = await checkAssistantAccess(supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const limit = rateLimit({
    key: `assistant-exec:${access.user.id}:${clientIdFromRequest(request)}`,
    limit: 20,
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

  const { question, signature, replay } = (body ?? {}) as {
    question?: unknown;
    signature?: unknown;
    replay?: { context?: DialogContext | null; pending?: Pending | null };
  };
  if (typeof question !== 'string' || !question.trim()) {
    return NextResponse.json({ error: 'الأمر مفقود' }, { status: 400 });
  }
  if (typeof signature !== 'string' || !signature) {
    return NextResponse.json({ error: 'توقيع الخطة مفقود' }, { status: 400 });
  }

  try {
    // نعيد اشتقاق الخطة من نفس المدخلات — لا نثق بأي عمليات قادمة من المتصفح.
    const turn = await runTurn(supabase, {
      text: question.trim(),
      context: replay?.context ?? undefined,
      pending: replay?.pending ?? undefined,
    });

    if (turn.kind !== 'plan') {
      return NextResponse.json(
        {
          error:
            turn.kind === 'problem' ? turn.problem.summary : 'هذا النص ليس أمراً قابلاً للتنفيذ',
        },
        { status: 400 },
      );
    }
    const plan = turn.plan;

    // لو تغيّرت البيانات بين المعاينة والتأكيد، التوقيع يختلف — نرفض ونطلب معاينة جديدة.
    if (plan.signature !== signature) {
      return NextResponse.json(
        { error: 'تغيّرت البيانات منذ المعاينة. أعد إرسال الأمر لمراجعة الخطة من جديد.', stale: true },
        { status: 409 },
      );
    }

    const write = checkWriteAccess(access.user, plan.permission);
    if (!write.ok) return NextResponse.json({ error: write.error }, { status: 403 });

    const outcome = await executePlan(supabase, plan, { userId: access.user.id, page: '/assistant' });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error, applied: outcome.applied }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      applied: outcome.applied,
      title: plan.title,
      summary: plan.summary,
      undoToken: outcome.undoToken ?? null,
    });
  } catch (err) {
    console.error('[assistant/execute] failed:', err);
    return NextResponse.json({ error: 'تعذّر تنفيذ الأمر' }, { status: 500 });
  }
}
