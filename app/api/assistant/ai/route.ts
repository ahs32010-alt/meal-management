/**
 * مسار المساعد المدعوم بـClaude.
 *
 * الخادم بلا حالة: المتصفح يعيد إرسال الحوار مع كل طلب. وبما أن الحوار قادم
 * من المتصفح فهو **غير موثوق** — لكنه لا يفتح باباً للكتابة: الخطة تُعاد
 * اشتقاقها على الخادم من نصّها، وتُفحص الصلاحية، ولا تُنفَّذ إلا بضغطة
 * المستخدم على مسار /api/assistant/execute القديم. أقصى ما يفعله حوار مزوَّر
 * هو تشويش رد النموذج على صاحبه.
 *
 * ولذلك نحدّ حجم الحوار: طول الطلب سقفُ تكلفةٍ قبل أن يكون سقف ذاكرة.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { clientIdFromRequest, rateLimit } from '@/lib/rate-limit';
import { checkAssistantAccess, checkWriteAccess } from '@/lib/assistant/access';
import { can, type PageKey } from '@/lib/permissions';
import { isProviderId, resolveProvider, type AiProviderId } from '@/lib/assistant/ai/provider';
import { GeminiError } from '@/lib/assistant/ai/gemini';
import { todayISO } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** الجولة قد تشمل عدة استدعاءات أدوات — نمنحها وقتاً أطول من الافتراضي. */
export const maxDuration = 120;

const MAX_QUESTION_LENGTH = 2000;
/** آخر ما نحتفظ به من الحوار — يكفي للسياق ويمنع نمو التكلفة بلا حدّ. */
const MAX_HISTORY_MESSAGES = 40;
const MAX_HISTORY_BYTES = 400_000;

export async function POST(request: Request) {
  const supabase = createClient();

  const access = await checkAssistantAccess(supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const limit = rateLimit({
    key: `assistant-ai:${access.user.id}:${clientIdFromRequest(request)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول بعد قليل' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }

  const { question: raw, history: rawHistory, provider: rawProvider, historyProvider } = (body ?? {}) as {
    question?: unknown;
    history?: unknown;
    provider?: unknown;
    /** أي مزوّد أنتج التاريخ المرسَل — يحدّد هل نكمل عليه أم نبدأ من جديد. */
    historyProvider?: unknown;
  };

  const resolution = await resolveProvider(rawProvider);
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.error, missingKey: true }, { status: 503 });
  }
  const { provider } = resolution;

  if (typeof raw !== 'string' || !raw.trim()) {
    return NextResponse.json({ error: 'اكتب سؤالاً أو أمراً' }, { status: 400 });
  }
  if (raw.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: `النص طويل جداً (الحد ${MAX_QUESTION_LENGTH} حرف)` }, { status: 400 });
  }

  // شكل التاريخ خاص بكل مزوّد ولا يُترجَم بلا خسارة. فلو تبدّل المزوّد بين
  // رسالتين نبدأ حواراً جديداً بدل أن نمرّر لـGemini رسائلَ Claude فيرفضها.
  const sameProvider = isProviderId(historyProvider)
    ? (historyProvider as AiProviderId) === provider.id
    : false;

  let history: Array<{ role?: string }> =
    sameProvider && Array.isArray(rawHistory)
      ? (rawHistory.slice(-MAX_HISTORY_MESSAGES) as Array<{ role?: string }>)
      : [];
  // نقصّ من الأقدم حتى ندخل تحت السقف — القصّ من الأحدث يكسر أزواج
  // نداء الأداة/نتيجتها ويرفضه الـAPI.
  while (history.length > 0 && JSON.stringify(history).length > MAX_HISTORY_BYTES) {
    history = history.slice(2);
  }
  // الحوار لازم يبدأ بدور المستخدم، وإلا رفضه الـAPI بعد القصّ
  while (history.length > 0 && history[0]?.role !== 'user') history = history.slice(1);

  try {
    const result = await provider.run({
      supabase,
      history,
      question: raw.trim(),
      userName: access.user.full_name || access.user.email || 'مستخدم',
      today: todayISO(),
    });

    // ── التنقّل: لا نوجّه أحداً لصفحة ما يقدر يفتحها ───────────────────────
    if (result.navigate) {
      const allowed =
        result.navigate.permission === null ||
        can(access.user, result.navigate.permission as PageKey, 'view');
      if (!allowed) {
        return NextResponse.json({
          kind: 'ai',
          text: `ما عندك صلاحية عرض صفحة ${result.navigate.label}.`,
          history: result.messages,
          historyProvider: provider.id,
          provider: provider.id,
          toolsUsed: result.toolsUsed,
          usage: result.usage,
        });
      }
    }

    // ── الخطة: تُفحص صلاحيتها الآن، وتُجرَّد من عملياتها قبل الإرسال ───────
    let clientPlan = null;
    if (result.plan) {
      const write = checkWriteAccess(access.user, result.plan.plan.permission);
      if (!write.ok) {
        return NextResponse.json({
          kind: 'ai',
          text: write.error,
          history: result.messages,
          historyProvider: provider.id,
          provider: provider.id,
          toolsUsed: result.toolsUsed,
          usage: result.usage,
        });
      }
      const { ops: _ops, activity: _activity, ...safe } = result.plan.plan;
      void _ops;
      void _activity;
      clientPlan = {
        ...safe,
        // نصّ الأمر القياسي — منه يُعاد اشتقاق الخطة عند التأكيد، فلازم يطابق
        question: result.plan.commandText,
        replay: { context: null, pending: null },
      };
    }

    return NextResponse.json({
      kind: 'ai',
      text: result.text,
      plan: clientPlan,
      navigate: result.navigate ?? null,
      history: result.messages,
      historyProvider: provider.id,
      provider: provider.id,
      model: result.model ?? provider.modelName(),
      // لو طلب المستخدم مزوّداً وسقطنا لغيره، نقولها بدل أن يظن أنه يحادثه.
      fellBack: resolution.fellBack,
      toolsUsed: result.toolsUsed,
      usage: result.usage,
    });
  } catch (err) {
    console.error(`[assistant/ai:${provider.id}] failed:`, err);

    // Gemini يترجم أخطاءه بنفسه إلى رسالة عربية وحالة HTTP مناسبة.
    if (err instanceof GeminiError) {
      return NextResponse.json(
        { error: err.message, provider: provider.id },
        {
          status: err.status,
          // 429 من الحصة المجانية: نلمّح بمدة انتظار بدل «حاول لاحقاً» المبهمة.
          headers: err.status === 429 ? { 'Retry-After': '60' } : undefined,
        },
      );
    }

    const message = err instanceof Error ? err.message : '';
    if (/authentication|api key|401/i.test(message)) {
      return NextResponse.json({ error: 'مفتاح Anthropic غير صالح.' }, { status: 502 });
    }
    if (/rate_limit|429/i.test(message)) {
      return NextResponse.json({ error: 'ضغط على خدمة Claude — أعد المحاولة بعد قليل.' }, { status: 429 });
    }
    if (/credit|billing|quota/i.test(message)) {
      return NextResponse.json({ error: 'رصيد حساب Anthropic نفد.' }, { status: 402 });
    }
    return NextResponse.json({ error: 'تعذّر تنفيذ الطلب' }, { status: 500 });
  }
}
