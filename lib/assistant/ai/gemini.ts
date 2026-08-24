/**
 * مزوّد Gemini عبر Google AI Studio.
 *
 * نفس عقد Claude حرفياً: نفس تعليمات النظام (`SYSTEM` مستورَدة لا منسوخة)،
 * نفس الأدوات (`TOOL_DEFS`)، نفس بوّابة Zod، ونفس جسر `propose_change` الذي
 * لا يكتب شيئاً. الفرق في الـSDK وحده.
 *
 * ── لماذا `parametersJsonSchema` لا `parameters`؟ ──────────────────────────
 * لأنه يقبل JSON Schema خاماً، فنمرّر `input_schema` الموجودة كما هي. لو
 * ترجمناها إلى شكل Gemini الخاص لصار عندنا مصدران لتعريف الأداة الواحدة،
 * وأول تعديل على أحدهما يجعل النموذجين يريان أدوات مختلفة.
 *
 * ── الحصة المجانية ────────────────────────────────────────────────────────
 * مفتاح AI Studio المجاني محدود الطلبات في الدقيقة، وكل دورة أدوات = طلب.
 * فسقف الدورات هنا أقل من سقف Claude، والخطأ 429 يُترجم لرسالة عربية تقول
 * للمستخدم ينتظر — لا «تعذّر تنفيذ الطلب».
 */

import { GoogleGenAI, ThinkingLevel, type Content, type FunctionDeclaration, type Part } from '@google/genai';
import { SYSTEM } from './prompt';
import { TOOL_DEFS, runTool } from './tools';
import type { AgentInput, AgentResult, AgentUsage, AiProvider } from './provider';

/**
 * سلسلة النماذج، الأقوى أولاً.
 *
 * الحصة اليومية في AI Studio المجاني **لكل نموذج على حدة**: نفاد حصة
 * `gemini-3.7-flash` لا يمسّ `gemini-3.6-flash`. وهذا هو نمط الفشل الطبيعي
 * على الحصة المجانية — لا استثناء نادر — فالسقوط للتالي يبقي المساعد حيّاً
 * بدل أن يتعطّل حتى منتصف الليل.
 *
 * ومن يضبط `GEMINI_MODEL` صراحةً يُحترم اختياره بلا سقوط: التبديل تحته يخفي
 * عنه أن نموذجه لا يعمل.
 */
export const GEMINI_MODEL_CHAIN = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
] as const;

export const DEFAULT_GEMINI_MODEL = GEMINI_MODEL_CHAIN[0];

function modelChain(): string[] {
  const explicit = process.env.GEMINI_MODEL?.trim();
  return explicit ? [explicit] : [...GEMINI_MODEL_CHAIN];
}

/**
 * سقف دورات الأدوات. أقل من نظيره عند Claude عمداً: كل دورة طلبٌ مستقل، وحصة
 * AI Studio المجانية تُحسب بالطلبات في الدقيقة.
 */
const MAX_TURNS = 8;

/**
 * ميزانية المخرجات — **يقتطع منها التفكير**.
 *
 * هذا ليس تفصيلاً نظرياً: بسقف ٥٠ توكن استهلك التفكير ٤٦ ورجع الرد فارغاً
 * بحالة MAX_TOKENS. فالسقف هنا واسع، ومستوى التفكير مضبوط أدناه.
 */
const MAX_OUTPUT_TOKENS = 8000;

/** جولة الصياغة الأخيرة تكتب جملة واحدة — لكن التفكير يقتطع، فنترك هامشاً. */
const CLOSING_MAX_TOKENS = 2000;

/** إعادة المحاولة عند 503. النموذج المجاني يُرفض تحت الضغط كثيراً، والانتظار
 *  ثانيتين أرخص بكثير من إفشال طلب المستخدم. */
const RETRY_ON_UNAVAILABLE = 2;
const RETRY_BASE_MS = 1200;

export function hasGeminiKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function geminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/**
 * تعريفات الأدوات بشكل Gemini — من نفس مصدر Claude بلا إعادة كتابة.
 *
 * تنظيفان مقصودان قبل الإرسال:
 *  • `required: []` الفارغة تُحذف — مصفوفة فارغة في JSON Schema قد يرفضها
 *    المدقّق، ومعناها أصلاً «لا شيء مطلوب» وهو الافتراضي.
 *  • أداة بلا خصائص تُرسَل بلا مخطط أصلاً، كما ينصّ التوثيق.
 */
function functionDeclarations(): FunctionDeclaration[] {
  return TOOL_DEFS.map((tool) => {
    // `TOOL_DEFS` معلَنة `as const` فحقولها للقراءة فقط — نمرّ بـunknown.
    const schema = tool.input_schema as unknown as {
      type?: string;
      properties?: Record<string, unknown>;
      required?: readonly string[];
    };

    const declaration: FunctionDeclaration = {
      name: tool.name,
      description: tool.description,
    };

    const properties = schema.properties ?? {};
    if (Object.keys(properties).length > 0) {
      const cleaned: Record<string, unknown> = { type: schema.type ?? 'object', properties };
      if (schema.required && schema.required.length > 0) cleaned.required = [...schema.required];
      declaration.parametersJsonSchema = cleaned;
    }

    return declaration;
  });
}

/** مكشوفة للاختبار: شكل الأدوات كما يصل Gemini فعلاً. */
export const __toolDeclarations = functionDeclarations;

function addUsage(usage: AgentUsage, meta: unknown): void {
  const m = (meta ?? {}) as {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  usage.input += m.promptTokenCount ?? 0;
  // التفكير يُحاسَب مخرجات — إهماله يُظهر التكلفة أقل مما هي.
  usage.output += (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0);
  usage.cacheRead += m.cachedContentTokenCount ?? 0;
}

/** نص كل أجزاء الرد، متجاهلاً أجزاء التفكير — تلك ليست جواباً للمستخدم. */
function visibleText(content: Content | undefined): string {
  if (!content?.parts) return '';
  return content.parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

/**
 * يترجم أخطاء Gemini إلى رسائل عربية صادقة.
 *
 * يُرمى ليلتقطه المسار ويحوّله لرد HTTP مناسب. التمييز مقصود: «انتظر دقيقة»
 * و«المفتاح غلط» و«الحصة خلصت» ثلاث مشاكل بثلاثة حلول مختلفة عند المستخدم.
 */
export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 402 | 502 | 503 | 500,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

function translateError(err: unknown): GeminiError {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const status = (err as { status?: number })?.status;

  if (status === 429 || /rate.?limit|too many requests|RESOURCE_EXHAUSTED|quota/i.test(raw)) {
    return new GeminiError(
      'تجاوزت حد الطلبات المجاني في Gemini — انتظر دقيقة وأعد المحاولة، أو بدّل إلى Claude.',
      429,
    );
  }
  if (status === 401 || status === 403 || /api.?key|unauthenticated|permission denied|invalid.*credential/i.test(raw)) {
    return new GeminiError('مفتاح Gemini غير صالح أو غير مصرّح له. راجع GEMINI_API_KEY على الخادم.', 502);
  }
  if (/billing|payment|exceeded your current quota/i.test(raw)) {
    return new GeminiError('حصة حساب Gemini انتهت.', 402);
  }
  if (status === 503 || /overloaded|unavailable|deadline/i.test(raw)) {
    return new GeminiError('خدمة Gemini مشغولة الآن — أعد المحاولة بعد قليل.', 503);
  }
  if (status === 404 || /not found.*model|model.*not found/i.test(raw)) {
    return new GeminiError(`نموذج Gemini «${geminiModel()}» غير متاح لهذا المفتاح.`, 502);
  }
  return new GeminiError('تعذّر الوصول إلى Gemini.', 500);
}

/** هل الحوار الوارد من المتصفح يشبه `Content[]` فعلاً؟ لا نثق بشكله. */
function sanitizeHistory(history: unknown): Content[] {
  if (!Array.isArray(history)) return [];
  return history.filter(
    (item): item is Content =>
      Boolean(item) &&
      typeof item === 'object' &&
      Array.isArray((item as Content).parts) &&
      typeof (item as Content).role === 'string',
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** هل يستحق هذا الخطأ إعادة محاولة؟ الضغط اللحظي وحده — لا المفتاح ولا الحصة. */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(raw);
}

/** نفاد حصة — يستحق تجربة نموذج آخر لأن الحصة لكل نموذج. */
function isQuotaExhausted(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(raw);
}

/**
 * يحمل النموذج المستخدم حالياً عبر جولات الطلب الواحد — فلو سقطنا لنموذج
 * أدنى في الجولة الأولى، تكمل بقية الجولات عليه بدل أن ترتد وتفشل ثانيةً.
 */
interface ModelCursor {
  chain: string[];
  index: number;
}

/**
 * نداء واحد مع علاجين مختلفين لعطلين مختلفين:
 *   • ضغط لحظي (503) ⇒ ننتظر ونعيد على **نفس** النموذج؛ يختفي خلال ثوانٍ.
 *   • نفاد حصة (429) ⇒ الانتظار لا يفيد (الحصة يومية)، فننتقل للنموذج التالي.
 * وحين تنفد السلسلة كلها نرمي الخطأ المترجَم.
 */
async function callModel(
  client: GoogleGenAI,
  cursor: ModelCursor,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
) {
  let attempt = 0;
  for (;;) {
    try {
      return await client.models.generateContent({ ...params, model: cursor.chain[cursor.index] });
    } catch (err) {
      if (isTransient(err) && attempt < RETRY_ON_UNAVAILABLE) {
        attempt++;
        await sleep(RETRY_BASE_MS * attempt);
        continue;
      }
      if (isQuotaExhausted(err) && cursor.index < cursor.chain.length - 1) {
        console.warn(
          `[assistant/gemini] حصة ${cursor.chain[cursor.index]} نفدت — أنتقل إلى ${cursor.chain[cursor.index + 1]}`,
        );
        cursor.index++;
        attempt = 0;
        continue;
      }
      throw translateError(err);
    }
  }
}

export const geminiProvider: AiProvider = {
  id: 'gemini',
  label: 'Gemini',
  isConfigured: hasGeminiKey,
  modelName: geminiModel,

  async run(input: AgentInput): Promise<AgentResult> {
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const cursor: ModelCursor = { chain: modelChain(), index: 0 };

    const userTurn: Content = { role: 'user', parts: [{ text: input.question }] };
    const contents: Content[] = [...sanitizeHistory(input.history), userTurn];
    /** ما نضيفه لتاريخ هذه الجولة — يرجع للمتصفح ليعود إلينا في الدور القادم. */
    const produced: Content[] = [userTurn];

    const usage: AgentUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const toolsUsed: string[] = [];
    let text = '';

    const config = {
      systemInstruction: {
        role: 'system',
        parts: [
          { text: SYSTEM },
          { text: `المستخدم: ${input.userName}\nتاريخ اليوم: ${input.today}` },
        ],
      } as Content,
      tools: [{ functionDeclarations: functionDeclarations() }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // تفكير منخفض: يكفي لاختيار الأداة الصحيحة، ولا يلتهم ميزانية الجواب.
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    };

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await callModel(client, cursor, { contents, config });

      const blocked = response.promptFeedback?.blockReason;
      if (blocked) {
        throw new GeminiError('رفض Gemini معالجة هذا النص. أعد صياغته بشكل مختلف.', 502);
      }

      addUsage(usage, response.usageMetadata);

      const candidate = response.candidates?.[0]?.content;
      text += visibleText(candidate);

      const calls = response.functionCalls ?? [];

      if (calls.length === 0) {
        // انتهى: لا أدوات مطلوبة. لو ما فيه محتوى نصّي أصلاً فالنموذج قُطع.
        if (candidate) produced.push(candidate);
        if (!text.trim()) {
          // MAX_TOKENS بلا نص يعني أن التفكير استهلك الميزانية — مشكلة إعداد
          // لا مشكلة سؤال، فنفرّق في الرسالة بدل لوم صياغة المستخدم.
          const finish = response.candidates?.[0]?.finishReason;
          text =
            finish === 'MAX_TOKENS'
              ? 'الجواب طال وانقطع قبل أن يكتمل. جزّئ سؤالك إلى أجزاء أصغر.'
              : 'ما قدرت أصيغ جواباً. أعد صياغة سؤالك بشكل أوضح.';
        }
        return { messages: produced, text: text.trim(), toolsUsed, usage, model: cursor.chain[cursor.index] };
      }

      // نحفظ دور النموذج كما رجع — بما فيه توقيعات التفكير التي يحتاجها
      // الطلب التالي — قبل أن نضيف نتائج الأدوات.
      if (candidate) {
        contents.push(candidate);
        produced.push(candidate);
      }

      const responseParts: Part[] = [];
      let sideEffect: Pick<AgentResult, 'plan' | 'navigate'> | null = null;

      // بالتوازي: الأدوات قراءة فقط ومستقلة، والتسلسل هنا انتظار بلا سبب.
      const outcomes = await Promise.all(
        calls.map(async (call) => {
          const name = call.name ?? '';
          toolsUsed.push(name);
          try {
            return { call, outcome: await runTool(input.supabase, name, call.args ?? {}) };
          } catch (err) {
            console.error(`[assistant/gemini] tool ${name} failed:`, err);
            return { call, outcome: null };
          }
        }),
      );

      for (const { call, outcome } of outcomes) {
        const name = call.name ?? '';
        const respond = (payload: Record<string, unknown>) => {
          responseParts.push({
            functionResponse: { id: call.id, name, response: payload },
          });
        };

        if (!outcome) {
          respond({ error: 'تعذّر تنفيذ الأداة. جرّب أداة أخرى أو أبلغ المستخدم.' });
          continue;
        }

        if (outcome.kind === 'plan') {
          sideEffect = { plan: { plan: outcome.plan, commandText: outcome.commandText } };
          respond({
            output:
              `تم بناء المعاينة وعُرضت على المستخدم: ${outcome.plan.summary}. ` +
              'لم يُنفَّذ شيء بعد — بجملة واحدة اشرح له ما سيحدث لو أكّد.',
          });
        } else if (outcome.kind === 'navigate') {
          sideEffect = { navigate: outcome };
          respond({ output: `فُتحت صفحة ${outcome.label}. أخبر المستخدم بجملة قصيرة.` });
        } else {
          respond({ output: outcome.data });
        }
      }

      const toolTurn: Content = { role: 'user', parts: responseParts };
      contents.push(toolTurn);
      produced.push(toolTurn);

      // خطة أو تنقّل ⇒ جولة أخيرة واحدة للصياغة، بلا أدوات، ثم نتوقف.
      if (sideEffect) {
        let closing;
        try {
          closing = await callModel(client, cursor, {
            contents,
            config: {
              ...config,
              tools: undefined,
              maxOutputTokens: CLOSING_MAX_TOKENS,
              // جملة شرح واحدة لا تحتاج تفكيراً — وتركه يبتلع الميزانية فيرجع فارغاً.
              thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            },
          });
        } catch (err) {
          // الخطة جاهزة فعلاً — لا نُسقطها لأن جملة الشرح تعذّرت.
          console.error('[assistant/gemini] closing turn failed:', err);
          return {
            messages: produced,
            text: (text || 'جهّزت المعاينة — راجعها وأكّد إن كانت صحيحة.').trim(),
            ...sideEffect,
            toolsUsed,
            usage,
            model: cursor.chain[cursor.index],
          };
        }

        addUsage(usage, closing.usageMetadata);
        const closingContent = closing.candidates?.[0]?.content;
        text += visibleText(closingContent);
        if (closingContent) produced.push(closingContent);

        return {
          messages: produced,
          text: (text.trim() || 'جهّزت المعاينة — راجعها وأكّد إن كانت صحيحة.'),
          ...sideEffect,
          toolsUsed,
          usage,
          model: cursor.chain[cursor.index],
        };
      }
    }

    return {
      messages: produced,
      text: (text + '\n\nتوقفت بعد محاولات كثيرة بلا نتيجة. صِغ طلبك بشكل أوضح أو جزّئه.').trim(),
      toolsUsed,
      usage,
      model: cursor.chain[cursor.index],
    };
  },
};
