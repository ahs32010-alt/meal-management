import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * طبقة مزوّدي النطق.
 *
 * وُجدت بعد درس عملي: حصة Gemini المجانية **عشرة مقاطع في اليوم**، وأمر تشغيل
 * واحد يحتاج أربعين. فما يحرسه هذا الملف هو ألّا يُربط النظام بمزوّد واحد مرة
 * أخرى، وألّا يسقط لغيره بصمت.
 */

const ORIGINAL = { ...process.env };

async function fresh() {
  vi.resetModules();
  return import('@/lib/kitchen/tts');
}

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_TTS_CREDENTIALS;
  delete process.env.KITCHEN_TTS_PROVIDER;
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

/** شهادة حساب خدمة صالحة الشكل — لا تُستعمل في أي نداء هنا. */
const FAKE_CREDS = JSON.stringify({
  client_email: 'tts@example.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  project_id: 'demo',
});

describe('التعرّف على المزوّدين', () => {
  it('يميّز المعرّفات الصالحة', async () => {
    const { isTtsProviderId } = await fresh();
    expect(isTtsProviderId('google')).toBe(true);
    expect(isTtsProviderId('gemini')).toBe(true);
    expect(isTtsProviderId('azure')).toBe(false);
    expect(isTtsProviderId(undefined)).toBe(false);
  });

  it('بلا بيانات اعتماد لا مزوّد مهيّأ', async () => {
    const { configuredProviders, resolveTtsProvider } = await fresh();
    expect(configuredProviders()).toEqual([]);
    expect(resolveTtsProvider().provider).toBeNull();
  });
});

describe('تهيئة Google Cloud', () => {
  it('يقبل شهادة JSON خاماً', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = FAKE_CREDS;
    const { getProvider } = await fresh();
    expect(getProvider('google').isConfigured()).toBe(true);
  });

  it('يقبلها مرمّزة base64 — منصّات النشر تختنق بالأسطر المتعددة', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = Buffer.from(FAKE_CREDS).toString('base64');
    const { getProvider } = await fresh();
    expect(getProvider('google').isConfigured()).toBe(true);
  });

  it('يرفض شهادة ناقصة الحقول بدل الفشل لاحقاً عند أول نداء', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = JSON.stringify({ client_email: 'x@y.z' });
    const { getProvider } = await fresh();
    expect(getProvider('google').isConfigured()).toBe(false);
  });

  it('يرفض نصّاً ليس JSON', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = 'ليست شهادة';
    const { getProvider } = await fresh();
    expect(getProvider('google').isConfigured()).toBe(false);
  });
});

describe('اختيار المزوّد', () => {
  it('يفضّل Google Cloud حين يتوفّر الاثنان — حصته تكفي بمئات الأضعاف', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = FAKE_CREDS;
    process.env.GEMINI_API_KEY = 'g';
    const { resolveTtsProvider } = await fresh();
    expect(resolveTtsProvider().provider?.id).toBe('google');
  });

  it('يحترم طلب المستخدم حين يكون مهيّأً', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = FAKE_CREDS;
    process.env.GEMINI_API_KEY = 'g';
    const { resolveTtsProvider } = await fresh();
    const r = resolveTtsProvider('gemini');
    expect(r.provider?.id).toBe('gemini');
    expect(r.fellBack).toBe(false);
  });

  it('يسقط للبديل ويعلن السقوط — المستخدم يستحق يعرف بمن يستمع', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const { resolveTtsProvider } = await fresh();
    const r = resolveTtsProvider('google');
    expect(r.provider?.id).toBe('gemini');
    expect(r.fellBack).toBe(true);
    expect(r.requested).toBe('google');
  });

  it('يتبع تفضيل البيئة حين لا يطلب المستخدم شيئاً', async () => {
    process.env.GOOGLE_TTS_CREDENTIALS = FAKE_CREDS;
    process.env.GEMINI_API_KEY = 'g';
    process.env.KITCHEN_TTS_PROVIDER = 'gemini';
    const { resolveTtsProvider } = await fresh();
    expect(resolveTtsProvider().provider?.id).toBe('gemini');
  });

  it('طلبٌ بقيمة مخترعة يُتجاهَل ولا يُفشل الطلب', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const { resolveTtsProvider } = await fresh();
    const r = resolveTtsProvider('azure');
    expect(r.provider?.id).toBe('gemini');
    expect(r.requested).toBeNull();
    expect(r.fellBack).toBe(false);
  });
});

describe('أصوات Gemini', () => {
  it('الافتراضي ذكوري وموجود في القائمة', async () => {
    process.env.GEMINI_API_KEY = 'g';
    const { getProvider } = await fresh();
    const provider = getProvider('gemini');
    const voices = await provider.listVoices();
    const def = voices.find((v) => v.id === provider.defaultVoice());
    expect(def?.gender).toBe('male');
  });

  it('الذكورية مرتّبة قبل الأنثوية', async () => {
    const { getProvider } = await fresh();
    const voices = await getProvider('gemini').listVoices();
    const ranks = voices.map((v) => v.rank ?? 0);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    const firstFemale = voices.findIndex((v) => v.gender === 'female');
    expect(voices.slice(0, firstFemale).every((v) => v.gender === 'male')).toBe(true);
  });

  it('يرفض اسم صوت من مزوّد آخر', async () => {
    const { getProvider } = await fresh();
    const gemini = getProvider('gemini');
    expect(await gemini.isValidVoice('Iapetus')).toBe(true);
    // اسم Google Cloud لا يُقبل عند Gemini — تمريره يرجع خطأً غامضاً.
    expect(await gemini.isValidVoice('ar-XA-Wavenet-B')).toBe(false);
  });
});

describe('خطأ المزوّد', () => {
  it('يميّز نفاد الحصة عن غيره — إعادة المحاولة اليوم لا تفيد', async () => {
    const { TtsProviderError } = await fresh();
    const quota = new TtsProviderError('انتهت الحصة', 429, true);
    const busy = new TtsProviderError('مشغول', 503);
    expect(quota.quota).toBe(true);
    expect(busy.quota).toBe(false);
    expect(quota.status).toBe(429);
  });
});
