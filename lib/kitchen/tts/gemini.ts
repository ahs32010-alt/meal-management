/**
 * مزوّد Gemini للنطق.
 *
 * ⚠️ حصته المجانية **عشرة طلبات في اليوم** لكل نموذج
 * (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`) — وأمر تشغيل واحد
 * يحتاج أربعين مقطعاً. فهو لا يصلح مصدراً أساسياً على الحصة المجانية، ويبقى
 * هنا لأنه يعمل بلا إعداد ولمن فعّل الفوترة.
 */

import { GoogleGenAI } from '@google/genai';
import { parseSampleRate, pcmToWav } from '@/lib/kitchen/wav';
import { TtsProviderError, type SynthesisResult, type TtsProvider, type TtsVoiceInfo } from './types';

const MODEL = process.env.GEMINI_TTS_MODEL?.trim() || 'gemini-3.1-flash-tts-preview';

/**
 * الأصوات المنشورة. التوثيق يذكر الطابع فقط — والجنس مستنتَج من أصول
 * الأسماء الأسطورية، فالحكم النهائي للأذن عبر عيّنة في الشاشة.
 */
const VOICES: TtsVoiceInfo[] = [
  { id: 'Iapetus', label: 'واضح', gender: 'male', rank: 100 },
  { id: 'Orus', label: 'حازم', gender: 'male', rank: 99 },
  { id: 'Charon', label: 'إخباري', gender: 'male', rank: 98 },
  { id: 'Alnilam', label: 'حازم وقوي', gender: 'male', rank: 97 },
  { id: 'Rasalgethi', label: 'إخباري هادئ', gender: 'male', rank: 96 },
  { id: 'Gacrux', label: 'ناضج', gender: 'male', rank: 95 },
  { id: 'Achird', label: 'ودود', gender: 'male', rank: 94 },
  { id: 'Algieba', label: 'ناعم', gender: 'male', rank: 93 },
  { id: 'Zubenelgenubi', label: 'عفوي', gender: 'male', rank: 92 },
  { id: 'Sadaltager', label: 'واثق', gender: 'male', rank: 91 },
  { id: 'Puck', label: 'نشيط', gender: 'male', rank: 90 },
  { id: 'Umbriel', label: 'مرتاح', gender: 'male', rank: 89 },
  { id: 'Kore', label: 'حازمة', gender: 'female', rank: 50 },
  { id: 'Erinome', label: 'واضحة', gender: 'female', rank: 49 },
  { id: 'Schedar', label: 'متزنة', gender: 'female', rank: 48 },
  { id: 'Autonoe', label: 'مشرقة', gender: 'female', rank: 47 },
  { id: 'Sulafat', label: 'دافئة', gender: 'female', rank: 46 },
  { id: 'Vindemiatrix', label: 'لطيفة', gender: 'female', rank: 45 },
];

const ALLOWED = new Set(VOICES.map((v) => v.id));

export const geminiTts: TtsProvider = {
  id: 'gemini',
  label: 'Gemini',

  isConfigured: () => Boolean(process.env.GEMINI_API_KEY?.trim()),

  listVoices: async () => VOICES,

  defaultVoice: () => 'Iapetus',

  isValidVoice: async (voice) => ALLOWED.has(voice),

  async synthesize(text, voice): Promise<SynthesisResult> {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const result = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      });

      const part = result.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      const base64 = part?.inlineData?.data;
      if (!base64) throw new TtsProviderError('ما رجّع النموذج صوتاً.', 502);

      // Gemini يرجّع PCM عارياً — بلا ترويسة RIFF لا يشغّله متصفح.
      return {
        audio: pcmToWav(new Uint8Array(Buffer.from(base64, 'base64')), {
          sampleRate: parseSampleRate(part?.inlineData?.mimeType),
        }),
        contentType: 'audio/wav',
        ext: 'wav',
      };
    } catch (err) {
      if (err instanceof TtsProviderError) throw err;
      const status = (err as { status?: number })?.status;
      const raw = err instanceof Error ? err.message : '';
      if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(raw)) {
        throw new TtsProviderError(
          'انتهت حصة Gemini المجانية لليوم (١٠ مقاطع). المقاطع المولَّدة سابقاً تعمل كالمعتاد.',
          429,
          true,
        );
      }
      if (status === 503) throw new TtsProviderError('خدمة Gemini مشغولة — أعد المحاولة بعد قليل.', 503);
      throw new TtsProviderError('تعذّر توليد الصوت من Gemini.', 502);
    }
  },
};
