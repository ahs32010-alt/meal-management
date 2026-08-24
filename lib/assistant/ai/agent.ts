/**
 * حلقة Claude: يفهم الطلب بالعربية الطبيعية، يستدعي الأدوات، ويرد.
 *
 * الحلقة تتوقف في ثلاث حالات: انتهى الرد، أو اقترح تعديلاً ينتظر تأكيد
 * المستخدم، أو طلب تنقّلاً. وفوق ذلك سقف جولات صلب — نموذج عالق في حلقة
 * أدوات يكلّف مالاً حقيقياً، فنقطعه بدل أن ننتظره.
 *
 * الحدّ الأدنى من الحقائق يُبنى مرة واحدة في `SYSTEM` الثابت حتى يُخزَّن
 * مؤقتاً (prompt caching): النص الثابت أول، والمتغيّر (اسم المستخدم، التاريخ)
 * بعده في رسالة نظام منفصلة، وإلا بطل التخزين وتضاعفت التكلفة.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Plan } from '@/lib/assistant/plan';
import { TOOL_DEFS, runTool } from './tools';
import { SYSTEM } from './prompt';

// نعيد تصديرها حفاظاً على أي مستورد يعتمد المسار القديم.
export { SYSTEM };

export const AI_MODEL = 'claude-opus-5';

/** سقف جولات الأدوات في الطلب الواحد — حارس تكلفة، لا حارس أداء. */
const MAX_TURNS = 12;

export type AgentEvent =
  | { type: 'tool'; name: string }
  | { type: 'text'; text: string }
  | { type: 'plan'; plan: Plan; commandText: string }
  | { type: 'navigate'; href: string; label: string; permission: string | null }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens: number };

export interface AgentInput {
  supabase: SupabaseClient;
  /** الحوار السابق كما رجّعناه للمتصفح — الخادم بلا حالة. */
  history: Anthropic.MessageParam[];
  question: string;
  userName: string;
  /** بأي حساب يُفحص التنقّل — نمرّره للنداء بدل أن نفحص هنا. */
  today: string;
}

export interface AgentResult {
  /** الرسائل الجديدة لتُضاف للحوار في الجولة القادمة. */
  messages: Anthropic.MessageParam[];
  text: string;
  plan?: { plan: Plan; commandText: string };
  navigate?: { href: string; label: string; permission: string | null };
  toolsUsed: string[];
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...input.history,
    { role: 'user', content: input.question },
  ];

  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const toolsUsed: string[] = [];
  const produced: Anthropic.MessageParam[] = [{ role: 'user', content: input.question }];
  let text = '';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [
        // النص الثابت أولاً ومعه نقطة التخزين — كل ما بعدها متغيّر ولا يُخزَّن
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `المستخدم: ${input.userName}\nتاريخ اليوم: ${input.today}` },
      ],
      tools: TOOL_DEFS as unknown as Anthropic.Tool[],
      messages,
    });

    usage.input += response.usage.input_tokens;
    usage.output += response.usage.output_tokens;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;

    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    if (response.stop_reason !== 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });
      produced.push({ role: 'assistant', content: response.content });
      return { messages: produced, text: text.trim(), toolsUsed, usage };
    }

    messages.push({ role: 'assistant', content: response.content });
    produced.push({ role: 'assistant', content: response.content });

    const calls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const results: Anthropic.ToolResultBlockParam[] = [];
    let sideEffect: Pick<AgentResult, 'plan' | 'navigate'> | null = null;

    for (const call of calls) {
      toolsUsed.push(call.name);
      let outcome;
      try {
        outcome = await runTool(input.supabase, call.name, (call.input ?? {}) as Record<string, unknown>);
      } catch (err) {
        console.error(`[assistant/ai] tool ${call.name} failed:`, err);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: 'تعذّر تنفيذ الأداة. جرّب أداة أخرى أو أبلغ المستخدم.',
          is_error: true,
        });
        continue;
      }

      if (outcome.kind === 'plan') {
        sideEffect = { plan: { plan: outcome.plan, commandText: outcome.commandText } };
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `تم بناء المعاينة وعُرضت على المستخدم: ${outcome.plan.summary}. ` +
            `لم يُنفَّذ شيء بعد — بجملة واحدة اشرح له ما سيحدث لو أكّد.`,
        });
      } else if (outcome.kind === 'navigate') {
        sideEffect = { navigate: outcome };
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `فُتحت صفحة ${outcome.label}. أخبر المستخدم بجملة قصيرة.`,
        });
      } else {
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(outcome.data),
        });
      }
    }

    messages.push({ role: 'user', content: results });
    produced.push({ role: 'user', content: results });

    // خطة أو تنقّل ⇐ نأخذ جولة أخيرة واحدة ليصوغ الجملة، ثم نتوقف
    if (sideEffect) {
      const closing = await client.messages.create({
        model: AI_MODEL,
        max_tokens: 1000,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `المستخدم: ${input.userName}\nتاريخ اليوم: ${input.today}` },
        ],
        tools: TOOL_DEFS as unknown as Anthropic.Tool[],
        tool_choice: { type: 'none' },
        messages,
      });
      usage.input += closing.usage.input_tokens;
      usage.output += closing.usage.output_tokens;
      usage.cacheRead += closing.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += closing.usage.cache_creation_input_tokens ?? 0;
      for (const block of closing.content) if (block.type === 'text') text += block.text;
      produced.push({ role: 'assistant', content: closing.content });

      return { messages: produced, text: text.trim(), ...sideEffect, toolsUsed, usage };
    }
  }

  return {
    messages: produced,
    text: (text + '\n\nتوقفت بعد محاولات كثيرة بلا نتيجة. صِغ طلبك بشكل أوضح أو جزّئه.').trim(),
    toolsUsed,
    usage,
  };
}
