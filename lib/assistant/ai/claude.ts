/**
 * مزوّد Claude — غلاف رقيق حول `agent.ts` الموجود.
 *
 * لا منطق هنا: الحلقة كما هي منذ كُتبت، بلا تغيير في سلوكها. الغرض الوحيد أن
 * تلبس واجهة `AiProvider` فيصير التبديل بينها وبين Gemini سطراً واحداً.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { AI_MODEL, hasApiKey, runAgent } from './agent';
import type { AgentInput, AiProvider } from './provider';

export const claudeProvider: AiProvider = {
  id: 'claude',
  label: 'Claude',

  isConfigured: () => hasApiKey(),

  modelName: () => AI_MODEL,

  async run(input: AgentInput) {
    // التاريخ معتم في الواجهة؛ هنا فقط نعرف شكله الحقيقي. وما نثق بأنه مصفوفة
    // لمجرد وصوله — المتصفح يرسله، فنفحص قبل التمرير لـSDK.
    const history = Array.isArray(input.history) ? (input.history as Anthropic.MessageParam[]) : [];

    const result = await runAgent({
      supabase: input.supabase,
      history,
      question: input.question,
      userName: input.userName,
      today: input.today,
    });

    return {
      messages: result.messages,
      text: result.text,
      plan: result.plan,
      navigate: result.navigate,
      toolsUsed: result.toolsUsed,
      usage: result.usage,
    };
  },
};
