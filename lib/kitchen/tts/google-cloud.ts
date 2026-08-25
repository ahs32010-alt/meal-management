/**
 * مزوّد Google Cloud Text-to-Speech.
 *
 * ── لماذا هو الخيار الأمتن ─────────────────────────────────────────────────
 * حصته المجانية **مليون حرف شهرياً** للأصوات القياسية (ومئة ألف للـWaveNet).
 * واحتياج المطبخ كله — ١٧٢ اسم صنف و٤٧ رقماً — لا يتجاوز ٢٦٠٠ حرف **مرة
 * واحدة في عمر النظام**. أي أننا داخل الحصة بمئات الأضعاف، لا على حافتها.
 *
 * ── لماذا حساب خدمة لا مفتاح API ───────────────────────────────────────────
 * جرّبنا مفتاح AI Studio على هذه الواجهة فردّت صراحةً:
 * «API keys are not supported by this API». فهي تقبل OAuth2 وحده. والمكتبة
 * `google-auth-library` تتولّى تبادل الشهادة بالرمز وتجديده تلقائياً.
 *
 * ── الأصوات تُقرأ من الواجهة لا من قائمة مكتوبة ─────────────────────────────
 * Google تضيف أصواتاً وتتقاعد أخرى. قائمة ثابتة في الكود تعني صوتاً مفقوداً
 * يوماً ما بلا إنذار — فنسأل الواجهة ونخزّن الجواب في الذاكرة.
 */

import { GoogleAuth } from 'google-auth-library';
import { TtsProviderError, type SynthesisResult, type TtsProvider, type TtsVoiceInfo } from './types';

const ENDPOINT = 'https://texttospeech.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** العربية متعدّدة اللهجات عند Google — وهي ما يفهمه أهل الخليج. */
const LANGUAGE = 'ar-XA';

/** الافتراضي: صوت ذكوري عالي الجودة. B هو الذكوري الأول في كل عائلات ar-XA. */
const PREFERRED_DEFAULTS = ['ar-XA-Wavenet-B', 'ar-XA-Standard-B', 'ar-XA-Wavenet-C', 'ar-XA-Standard-C'];

function credentials(): Record<string, unknown> | null {
  const raw = process.env.GOOGLE_TTS_CREDENTIALS?.trim();
  if (!raw) return null;
  try {
    // نقبل JSON خاماً أو مرمّزاً بـbase64 — منصّات النشر تختلف في احتمالها
    // للأسطر المتعددة داخل متغيّر بيئة.
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return typeof parsed.client_email === 'string' && typeof parsed.private_key === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

let auth: GoogleAuth | null = null;

function client(): GoogleAuth {
  if (auth) return auth;
  const creds = credentials();
  if (!creds) throw new TtsProviderError('بيانات اعتماد Google Cloud غير صالحة.', 503);
  auth = new GoogleAuth({ credentials: creds, scopes: [SCOPE] });
  return auth;
}

async function authorizedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await client().getAccessToken();
  if (!token) throw new TtsProviderError('تعذّر الحصول على رمز وصول Google Cloud.', 502);
  return fetch(`${ENDPOINT}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${typeof token === 'string' ? token : token}`,
      'Content-Type': 'application/json',
    },
  });
}

/** ترجمة وصف الصوت إلى عربي مفهوم — «Wavenet» لا تعني شيئاً للمستخدم. */
function describe(name: string): string {
  if (/chirp3-hd/i.test(name)) return 'طبيعي جداً';
  if (/chirp/i.test(name)) return 'طبيعي';
  if (/neural2/i.test(name)) return 'عصبي';
  if (/wavenet/i.test(name)) return 'عالي الجودة';
  if (/standard/i.test(name)) return 'قياسي';
  return 'عربي';
}

/** الأجود أولاً، والذكوري قبل الأنثوي داخل كل مستوى. */
function rankOf(name: string, gender: string): number {
  let n = 0;
  if (/chirp3-hd/i.test(name)) n += 40;
  else if (/chirp/i.test(name)) n += 30;
  else if (/neural2/i.test(name)) n += 25;
  else if (/wavenet/i.test(name)) n += 20;
  else n += 10;
  if (gender === 'MALE') n += 5;
  return n;
}

interface ApiVoice {
  name?: string;
  ssmlGender?: string;
  languageCodes?: string[];
}

let voiceCache: TtsVoiceInfo[] | null = null;

async function fetchVoices(): Promise<TtsVoiceInfo[]> {
  if (voiceCache) return voiceCache;

  const res = await authorizedFetch(`/voices?languageCode=${LANGUAGE}`);
  if (!res.ok) {
    throw translate(res.status, await res.text().catch(() => ''));
  }
  const body = (await res.json()) as { voices?: ApiVoice[] };

  const voices = (body.voices ?? [])
    .filter((v) => v.name && v.languageCodes?.some((c) => c.startsWith('ar')))
    .map<TtsVoiceInfo>((v) => {
      const gender = v.ssmlGender ?? 'SSML_VOICE_GENDER_UNSPECIFIED';
      return {
        id: v.name!,
        label: describe(v.name!),
        gender: gender === 'MALE' ? 'male' : gender === 'FEMALE' ? 'female' : 'unknown',
        rank: rankOf(v.name!, gender),
      };
    })
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));

  voiceCache = voices;
  return voices;
}

function translate(status: number, body: string): TtsProviderError {
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(body)) {
    return new TtsProviderError('تجاوزت حصة Google Cloud للنطق. راجع حدود مشروعك.', 429, true);
  }
  if (status === 401 || status === 403) {
    return new TtsProviderError(
      'بيانات اعتماد Google Cloud مرفوضة — تأكد أن واجهة Text-to-Speech مفعّلة وأن لحساب الخدمة صلاحية عليها.',
      502,
    );
  }
  if (status === 503 || status === 504) {
    return new TtsProviderError('خدمة Google Cloud مشغولة — أعد المحاولة بعد قليل.', 503);
  }
  return new TtsProviderError('تعذّر توليد الصوت من Google Cloud.', 502);
}

export const googleCloudTts: TtsProvider = {
  id: 'google',
  label: 'Google Cloud',

  isConfigured: () => credentials() !== null,

  listVoices: fetchVoices,

  defaultVoice() {
    const available = voiceCache;
    if (available?.length) {
      const preferred = PREFERRED_DEFAULTS.find((id) => available.some((v) => v.id === id));
      if (preferred) return preferred;
      const male = available.find((v) => v.gender === 'male');
      if (male) return male.id;
      return available[0].id;
    }
    return PREFERRED_DEFAULTS[0];
  },

  async isValidVoice(voice) {
    // نمنع تمرير اسم صوت من مزوّد آخر — يرجع خطأ غامضاً من الواجهة.
    const voices = await fetchVoices().catch(() => []);
    return voices.length === 0 ? /^ar-XA-/.test(voice) : voices.some((v) => v.id === voice);
  },

  async synthesize(text, voice): Promise<SynthesisResult> {
    const res = await authorizedFetch('/text:synthesize', {
      method: 'POST',
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: LANGUAGE, name: voice },
        // نولّد بسرعة طبيعية دائماً: السرعة يضبطها المتصفح وقت التشغيل، فلو
        // دخلت في التوليد لصار لكل سرعة نسخة مخزّنة على حدة.
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
      }),
    });

    if (!res.ok) throw translate(res.status, await res.text().catch(() => ''));

    const body = (await res.json()) as { audioContent?: string };
    if (!body.audioContent) {
      throw new TtsProviderError('ما رجّعت الخدمة صوتاً.', 502);
    }

    return {
      audio: new Uint8Array(Buffer.from(body.audioContent, 'base64')),
      contentType: 'audio/mpeg',
      ext: 'mp3',
    };
  },
};

/** للاختبارات — يصفّر مخزون الأصوات في الذاكرة. */
export function __resetVoiceCache() {
  voiceCache = null;
  auth = null;
}
