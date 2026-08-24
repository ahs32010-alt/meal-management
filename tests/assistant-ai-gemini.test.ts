import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolOutcome } from '@/lib/assistant/ai/tools';

/**
 * حلقة Gemini، على SDK وهمي — بلا شبكة ولا مفتاح.
 *
 * ما يهمّنا إثباته هنا ليس أن النموذج ذكي، بل أن الحلقة **تحفظ عقود النظام**:
 * لا كتابة بلا تأكيد، لا تسرّب استثناءات خام، ولا حلقة بلا سقف.
 */

const generateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  // قيم الـenum الحقيقية — الاختبارات تؤكّد عليها نصّاً.
  ThinkingLevel: {
    THINKING_LEVEL_UNSPECIFIED: 'THINKING_LEVEL_UNSPECIFIED',
    MINIMAL: 'MINIMAL',
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
  },
}));

type RunTool = (supabase: unknown, name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;
const runTool = vi.fn<RunTool>();

vi.mock('@/lib/assistant/ai/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assistant/ai/tools')>();
  return { ...actual, runTool: (...args: Parameters<RunTool>) => runTool(...args) };
});

const ORIGINAL = { ...process.env };

async function loadProvider() {
  vi.resetModules();
  return (await import('@/lib/assistant/ai/gemini')).geminiProvider;
}

/** رد نصّي بسيط. */
const textReply = (text: string) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] } }],
  functionCalls: [],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
});

/** رد يطلب أدوات. */
const callReply = (calls: Array<{ name: string; args?: Record<string, unknown>; id?: string }>) => ({
  candidates: {
    0: { content: { role: 'model', parts: calls.map((c) => ({ functionCall: c })) } },
    length: 1,
    [Symbol.iterator]: Array.prototype[Symbol.iterator],
  } as unknown as Array<{ content: unknown }>,
  functionCalls: calls,
  usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, thoughtsTokenCount: 3 },
});

const input = () => ({
  supabase: {} as never,
  history: [],
  question: 'كم عدد المستفيدين؟',
  userName: 'أحمد',
  today: '2026-08-20',
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.GEMINI_MODEL;
  generateContent.mockReset();
  runTool.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('Gemini — تعريفات الأدوات', () => {
  it('تُشتقّ من نفس مصدر Claude — لا قائمة موازية تنحرف عنه', async () => {
    vi.resetModules();
    const { __toolDeclarations } = await import('@/lib/assistant/ai/gemini');
    const { TOOL_DEFS } = await import('@/lib/assistant/ai/tools');

    const declarations = __toolDeclarations();
    expect(declarations.map((d) => d.name)).toEqual(TOOL_DEFS.map((t) => t.name));
    for (const d of declarations) expect(d.description?.length).toBeGreaterThan(0);
  });

  it('تحذف `required` الفارغة — المصفوفة الفارغة قد يرفضها المدقّق', async () => {
    vi.resetModules();
    const { __toolDeclarations } = await import('@/lib/assistant/ai/gemini');
    const search = __toolDeclarations().find((d) => d.name === 'search_people');
    const schema = search?.parametersJsonSchema as Record<string, unknown>;

    expect(schema.properties).toBeDefined();
    expect('required' in schema).toBe(false);
  });

  it('تبقي `required` غير الفارغة', async () => {
    vi.resetModules();
    const { __toolDeclarations } = await import('@/lib/assistant/ai/gemini');
    const get = __toolDeclarations().find((d) => d.name === 'get_person');
    expect((get?.parametersJsonSchema as Record<string, unknown>).required).toEqual(['id']);
  });

  it('الأداة بلا معاملات تُرسَل بلا مخطط أصلاً', async () => {
    vi.resetModules();
    const { __toolDeclarations } = await import('@/lib/assistant/ai/gemini');
    const pages = __toolDeclarations().find((d) => d.name === 'list_pages');
    // `properties: {}` مخططٌ فارغ — والتوثيق يقول تُترك بلا مخطط.
    expect(pages?.parametersJsonSchema).toBeUndefined();
  });

  it('كل أداة قرائية معلَنة، وأداة التعديل الوحيدة هي propose_change', async () => {
    vi.resetModules();
    const { __toolDeclarations } = await import('@/lib/assistant/ai/gemini');
    const names = __toolDeclarations().map((d) => d.name);

    expect(names).toContain('list_fixed_meals');
    expect(names).toContain('order_summary');
    // لا أداة كتابة مباشرة: لا SQL ولا insert ولا update تصل النموذج.
    expect(names.filter((n) => /insert|update|delete|write|sql|execute/i.test(n ?? ''))).toEqual([]);
    expect(names).toContain('propose_change');
  });
});

describe('Gemini — الحلقة الأساسية', () => {
  it('يرجّع نصاً حين لا يطلب أدوات', async () => {
    generateContent.mockResolvedValue(textReply('عندك ٤٨٢ مستفيداً.'));
    const provider = await loadProvider();

    const result = await provider.run(input());

    expect(result.text).toBe('عندك ٤٨٢ مستفيداً.');
    expect(result.toolsUsed).toEqual([]);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('ينفّذ الأداة ثم يصوغ الجواب من نتيجتها', async () => {
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'count_people', args: {}, id: 'c1' }]))
      .mockResolvedValueOnce(textReply('عددهم ٤٨٢.'));
    runTool.mockResolvedValue({ kind: 'data', data: { count: 482 } });

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(runTool).toHaveBeenCalledWith({}, 'count_people', {});
    expect(result.toolsUsed).toEqual(['count_people']);
    expect(result.text).toBe('عددهم ٤٨٢.');

    // نتيجة الأداة تُمرَّر للنموذج تحت مفتاح output كما يتوقّعه Gemini
    const second = generateContent.mock.calls[1][0];
    const toolTurn = second.contents[second.contents.length - 1];
    expect(toolTurn.parts[0].functionResponse.response).toEqual({ output: { count: 482 } });
  });

  it('ينفّذ الأدوات المستقلة بالتوازي', async () => {
    let active = 0;
    let peak = 0;
    runTool.mockImplementation(async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { kind: 'data', data: {} };
    });
    generateContent
      .mockResolvedValueOnce(
        callReply([
          { name: 'count_people', id: 'a' },
          { name: 'search_meals', id: 'b' },
        ]),
      )
      .mockResolvedValueOnce(textReply('تمام.'));

    const provider = await loadProvider();
    await provider.run(input());

    // التسلسل هنا انتظار بلا سبب — الأدوات قراءة فقط ومستقلة.
    expect(peak).toBe(2);
  });

  it('يحصي استهلاك التوكنات شاملاً التفكير', async () => {
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'count_people', id: 'c1' }]))
      .mockResolvedValueOnce(textReply('تمام.'));
    runTool.mockResolvedValue({ kind: 'data', data: {} });

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(result.usage.input).toBe(30); // 20 + 10
    // إهمال thoughtsTokenCount يُظهر التكلفة أقل مما هي فعلاً
    expect(result.usage.output).toBe(16); // (8 + 3) + 5
  });
});

describe('Gemini — عقد عدم الكتابة', () => {
  it('الخطة تُرجَّع للمعاينة ولا تُنفَّذ، وتوقف الحلقة', async () => {
    const plan = { summary: 'منع الفول عن أحمد', permission: { page: 'beneficiaries', action: 'edit' } };
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'propose_change', args: { command: 'امنع أحمد من الفول' }, id: 'p1' }]))
      .mockResolvedValueOnce(textReply('راح أمنع الفول عن أحمد — أكّد لو صحيح.'));
    runTool.mockResolvedValue({
      kind: 'plan',
      plan: plan as never,
      commandText: 'امنع أحمد من الفول',
    });

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(result.plan?.commandText).toBe('امنع أحمد من الفول');
    // نص الأمر هو ما يُعاد اشتقاق الخطة منه عند التأكيد — لو ضاع، بطل التوقيع.
    expect(result.plan?.plan).toBe(plan);
    // جولة الأدوات + جولة الصياغة فقط: الخطة توقف الحلقة فوراً.
    expect(generateContent).toHaveBeenCalledTimes(2);

    // جولة الصياغة بلا أدوات — حتى لا يقترح النموذج تعديلاً ثانياً بعد الأول.
    expect(generateContent.mock.calls[1][0].config.tools).toBeUndefined();
  });

  it('تبقى الخطة سليمة حتى لو فشلت جولة الصياغة', async () => {
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'propose_change', args: { command: 'امنع أحمد من الفول' }, id: 'p1' }]))
      .mockRejectedValueOnce(new Error('network down'));
    runTool.mockResolvedValue({
      kind: 'plan',
      plan: { summary: 'x' } as never,
      commandText: 'امنع أحمد من الفول',
    });

    const provider = await loadProvider();
    const result = await provider.run(input());

    // إسقاط خطة جاهزة لأن جملة الشرح تعذّرت خسارةٌ بلا سبب.
    expect(result.plan).toBeDefined();
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('التنقّل يوقف الحلقة كالخطة', async () => {
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'open_page', args: { href: '/reports' }, id: 'n1' }]))
      .mockResolvedValueOnce(textReply('فتحت التقارير.'));
    runTool.mockResolvedValue({
      kind: 'navigate',
      href: '/reports',
      label: 'التقارير',
      permission: 'reports',
    });

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(result.navigate?.href).toBe('/reports');
    expect(generateContent).toHaveBeenCalledTimes(2);
  });
});

describe('Gemini — الصمود', () => {
  it('فشل أداة يُبلَّغ للنموذج ولا يُسقط الطلب', async () => {
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'get_person', args: { id: 'x' }, id: 'g1' }]))
      .mockResolvedValueOnce(textReply('ما قدرت أقرأ بياناته.'));
    runTool.mockRejectedValue(new Error('boom'));

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(result.text).toBe('ما قدرت أقرأ بياناته.');
    const second = generateContent.mock.calls[1][0];
    const toolTurn = second.contents[second.contents.length - 1];
    expect(toolTurn.parts[0].functionResponse.response.error).toContain('تعذّر تنفيذ الأداة');
  });

  it('يتوقف عند سقف الدورات بدل الدوران بلا نهاية', async () => {
    generateContent.mockResolvedValue(callReply([{ name: 'count_people', id: 'loop' }]));
    runTool.mockResolvedValue({ kind: 'data', data: {} });

    const provider = await loadProvider();
    const result = await provider.run(input());

    // الحصة المجانية تُحسب بالطلبات — حلقة بلا سقف تحرقها في ثوانٍ.
    expect(generateContent.mock.calls.length).toBeLessThanOrEqual(8);
    expect(result.text).toContain('توقفت بعد محاولات كثيرة');
  });

  it('يتجاهل تاريخاً مشوّهاً بدل تمريره للـSDK', async () => {
    generateContent.mockResolvedValue(textReply('أهلاً.'));
    const provider = await loadProvider();

    await provider.run({ ...input(), history: ['نص', null, { role: 'user' }, 42] as unknown[] });

    // التاريخ يصل من المتصفح — أي شكل غريب يُسقَط لا يُمرَّر.
    const contents = generateContent.mock.calls[0][0].contents;
    expect(contents).toHaveLength(1);
    expect(contents[0].parts[0].text).toBe('كم عدد المستفيدين؟');
  });

  it('لا يرجّع نصاً فارغاً للمستخدم', async () => {
    generateContent.mockResolvedValue({ candidates: [], functionCalls: [], usageMetadata: {} });
    const provider = await loadProvider();
    const result = await provider.run(input());
    expect(result.text.trim().length).toBeGreaterThan(0);
  });
});

describe('Gemini — السقوط بين النماذج عند نفاد الحصة', () => {
  const quota = () => Object.assign(new Error('RESOURCE_EXHAUSTED: quota'), { status: 429 });

  it('ينتقل للنموذج التالي بدل أن يفشل — الحصة اليومية لكل نموذج على حدة', async () => {
    generateContent
      .mockRejectedValueOnce(quota())
      .mockResolvedValueOnce(textReply('تمام.'));

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(result.text).toBe('تمام.');
    // النموذج الذي ردّ فعلاً — لا الافتراضي — حتى يعرف المستخدم بمن يتحدّث.
    expect(result.model).toBe('gemini-3.6-flash');
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.7-flash');
    expect(generateContent.mock.calls[1][0].model).toBe('gemini-3.6-flash');
  });

  it('يستمر على النموذج البديل في بقية جولات الطلب نفسه', async () => {
    generateContent
      .mockRejectedValueOnce(quota())
      .mockResolvedValueOnce(callReply([{ name: 'count_people', id: 'c1' }]))
      .mockResolvedValueOnce(textReply('٤٨٢.'));
    runTool.mockResolvedValue({ kind: 'data', data: { count: 482 } });

    const provider = await loadProvider();
    await provider.run(input());

    // الارتداد للنموذج المستنفَد في كل جولة يعني فشلاً متكرراً بلا داعٍ.
    expect(generateContent.mock.calls[2][0].model).toBe('gemini-3.6-flash');
  });

  it('يفشل برسالة الحصة حين تنفد السلسلة كلها', async () => {
    generateContent.mockRejectedValue(quota());
    const provider = await loadProvider();

    await expect(provider.run(input())).rejects.toMatchObject({ status: 429 });
    // ثلاثة نماذج في السلسلة — جُرّبت كلها قبل الاستسلام.
    expect(new Set(generateContent.mock.calls.map((c) => c[0].model)).size).toBe(3);
  });

  it('GEMINI_MODEL الصريح يُحترم بلا سقوط', async () => {
    process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
    generateContent.mockRejectedValue(quota());
    const provider = await loadProvider();

    await expect(provider.run(input())).rejects.toMatchObject({ status: 429 });
    // من اختار نموذجاً بعينه، التبديل تحته يخفي عنه أنه لا يعمل.
    const used = new Set(generateContent.mock.calls.map((c) => c[0].model));
    expect([...used]).toEqual(['gemini-3.1-flash-lite']);
  });

  it('الضغط اللحظي (503) يُعاد على نفس النموذج لا على غيره', async () => {
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('high demand'), { status: 503 }))
      .mockResolvedValueOnce(textReply('تمام.'));

    const provider = await loadProvider();
    const result = await provider.run(input());

    expect(result.model).toBe('gemini-3.7-flash');
    // 503 يختفي خلال ثوانٍ — تبديل النموذج بسببه ينزل بالجودة بلا سبب.
    expect(generateContent.mock.calls[1][0].model).toBe('gemini-3.7-flash');
  }, 15_000);
});

describe('Gemini — ميزانية التفكير', () => {
  it('يحدّ التفكير في الجولة الرئيسية — وإلا ابتلع ميزانية الجواب', async () => {
    generateContent.mockResolvedValue(textReply('تمام.'));
    const provider = await loadProvider();
    await provider.run(input());

    const config = generateContent.mock.calls[0][0].config;
    expect(config.thinkingConfig?.thinkingLevel).toBe('LOW');
    expect(config.maxOutputTokens).toBeGreaterThanOrEqual(8000);
  });

  it('جولة الصياغة بأدنى تفكير وبميزانية تكفي جملة', async () => {
    generateContent
      .mockResolvedValueOnce(callReply([{ name: 'propose_change', args: { command: 'x' }, id: 'p' }]))
      .mockResolvedValueOnce(textReply('أكّد لو صحيح.'));
    runTool.mockResolvedValue({ kind: 'plan', plan: { summary: 's' } as never, commandText: 'x' });

    const provider = await loadProvider();
    await provider.run(input());

    const closing = generateContent.mock.calls[1][0].config;
    expect(closing.thinkingConfig?.thinkingLevel).toBe('MINIMAL');
    expect(closing.maxOutputTokens).toBeGreaterThan(1000);
  });

  it('انقطاع بسبب MAX_TOKENS يُشخَّص بدل لوم صياغة المستخدم', async () => {
    generateContent.mockResolvedValue({
      candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS' }],
      functionCalls: [],
      usageMetadata: { thoughtsTokenCount: 900 },
    });
    const provider = await loadProvider();
    const result = await provider.run(input());
    expect(result.text).toContain('انقطع');
  });
});

describe('Gemini — ترجمة الأخطاء', () => {
  const cases: Array<[string, unknown, number, string]> = [
    ['حد الطلبات المجاني', Object.assign(new Error('RESOURCE_EXHAUSTED'), { status: 429 }), 429, 'حد الطلبات المجاني'],
    ['مفتاح غير صالح', Object.assign(new Error('API key not valid'), { status: 403 }), 502, 'مفتاح Gemini'],
    ['الخدمة مشغولة', Object.assign(new Error('model is overloaded'), { status: 503 }), 503, 'مشغولة'],
    ['نموذج غير متاح', Object.assign(new Error('model not found'), { status: 404 }), 502, 'غير متاح'],
    ['خطأ غير معروف', new Error('something odd'), 500, 'تعذّر الوصول'],
  ];

  it.each(cases)('%s → رسالة عربية وحالة مناسبة', async (_label, thrown, status, fragment) => {
    generateContent.mockRejectedValue(thrown);
    const provider = await loadProvider();

    // نداء واحد ونفحص كل شيء عليه: حالة 503 تمر بإعادات محاولة، فتكرار النداء
    // يضاعف الانتظار بلا فائدة.
    // وثلاث مشاكل بثلاثة حلول عند المستخدم — دمجها في «فشل» واحد يضيّعه.
    const error = await provider.run(input()).then(
      () => null,
      (e: unknown) => e as { name?: string; status?: number; message?: string },
    );

    expect(error?.name).toBe('GeminiError');
    expect(error?.status).toBe(status);
    expect(error?.message).toContain(fragment);
    // 503 وحده يُعاد؛ الباقي يفشل من أول نداء لأن الإعادة لن تغيّر شيئاً.
  }, 20_000);

  it('حجب المحتوى يُبلَّغ صراحةً', async () => {
    generateContent.mockResolvedValue({
      candidates: [],
      functionCalls: [],
      promptFeedback: { blockReason: 'SAFETY' },
      usageMetadata: {},
    });
    const provider = await loadProvider();
    await expect(provider.run(input())).rejects.toThrow('رفض Gemini');
  });
});
