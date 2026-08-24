import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * اختيار المزوّد.
 *
 * القاعدة: مفتاح ناقص عند مزوّد لا يعطّل المساعد ما دام الآخر جاهزاً — لكن
 * السقوط للبديل يجب أن **يُعلَن**، فالمستخدم يستحق يعرف بأي عقل يتحدّث.
 */

const ORIGINAL = { ...process.env };

async function fresh() {
  vi.resetModules();
  return import('@/lib/assistant/ai/provider');
}

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ASSISTANT_AI_PROVIDER;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('التعرّف على المزوّدين', () => {
  it('يميّز المعرّفات الصالحة', async () => {
    const { isProviderId } = await fresh();
    expect(isProviderId('gemini')).toBe(true);
    expect(isProviderId('claude')).toBe(true);
    expect(isProviderId('gpt')).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });

  it('يبلّغ عن التهيئة بلا كشف أي مفتاح', async () => {
    process.env.GEMINI_API_KEY = 'sk-test-secret-value';
    const { providerStatuses } = await fresh();
    const statuses = await providerStatuses();

    const gemini = statuses.find((s) => s.id === 'gemini');
    expect(gemini?.configured).toBe(true);
    expect(statuses.find((s) => s.id === 'claude')?.configured).toBe(false);

    // ما يخرج من هنا يصل المتصفح — فلا يحمل قيمة المفتاح بأي شكل.
    expect(JSON.stringify(statuses)).not.toContain('sk-test-secret-value');
  });

  it('المفتاح الفارغ أو الفراغات ليس تهيئة', async () => {
    process.env.GEMINI_API_KEY = '   ';
    const { providerStatuses } = await fresh();
    const statuses = await providerStatuses();
    expect(statuses.find((s) => s.id === 'gemini')?.configured).toBe(false);
  });
});

describe('حلّ المزوّد', () => {
  it('يفشل برسالة مفهومة حين لا مفتاح إطلاقاً', async () => {
    const { resolveProvider } = await fresh();
    const r = await resolveProvider();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('GEMINI_API_KEY');
      expect(r.error).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('يحترم طلب المستخدم حين يكون مهيّأً', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.ANTHROPIC_API_KEY = 'a';
    const { resolveProvider } = await fresh();

    const claude = await resolveProvider('claude');
    expect(claude.ok && claude.provider.id).toBe('claude');
    expect(claude.ok && claude.fellBack).toBe(false);
  });

  it('يسقط للبديل حين يكون المطلوب غير مهيّأ — ويعلن السقوط', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const { resolveProvider } = await fresh();

    const r = await resolveProvider('claude');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider.id).toBe('gemini');
      // بلا هذه الراية يظن المستخدم أنه يحادث Claude وهو يحادث Gemini.
      expect(r.fellBack).toBe(true);
      expect(r.requested).toBe('claude');
    }
  });

  it('يتبع تفضيل البيئة حين لا يطلب المستخدم شيئاً', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.ANTHROPIC_API_KEY = 'a';
    process.env.ASSISTANT_AI_PROVIDER = 'claude';
    const { resolveProvider } = await fresh();

    const r = await resolveProvider();
    expect(r.ok && r.provider.id).toBe('claude');
    expect(r.ok && r.fellBack).toBe(false); // لم يطلب المستخدم شيئاً فما سقطنا
  });

  it('الافتراضي Gemini حين لا تفضيل ولا طلب', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.ANTHROPIC_API_KEY = 'a';
    const { resolveProvider } = await fresh();
    expect((await resolveProvider()).ok && (await resolveProvider()).ok).toBe(true);
    const r = await resolveProvider();
    expect(r.ok && r.provider.id).toBe('gemini');
  });

  it('طلبٌ بقيمة مخترعة يُتجاهَل ولا يُفشل الطلب', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const { resolveProvider } = await fresh();
    const r = await resolveProvider('gpt-5');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.provider.id).toBe('gemini');
      expect(r.requested).toBeNull();
      expect(r.fellBack).toBe(false);
    }
  });

  it('كل مزوّد يعلن اسم نموذجه', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const { resolveProvider } = await fresh();
    const r = await resolveProvider();
    expect(r.ok && r.provider.modelName().length).toBeGreaterThan(0);
  });

  it('GEMINI_MODEL يتجاوز الافتراضي', async () => {
    process.env.GEMINI_API_KEY = 'g';
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const { resolveProvider } = await fresh();
    const r = await resolveProvider('gemini');
    expect(r.ok && r.provider.modelName()).toBe('gemini-2.5-flash');
  });
});
