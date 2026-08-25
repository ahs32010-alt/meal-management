/**
 * سجلّ مزوّدي النطق.
 *
 * الترتيب مقصود: Google Cloud أولاً لأن حصته تكفي الاستخدام بمئات الأضعاف،
 * وGemini بعده لأنه يعمل بلا إعداد لكن حصته المجانية عشرة مقاطع يومياً.
 */

import { googleCloudTts } from './google-cloud';
import { geminiTts } from './gemini';
import type { TtsProvider, TtsProviderId } from './types';

export * from './types';

export const TTS_PROVIDERS: TtsProvider[] = [googleCloudTts, geminiTts];

export function isTtsProviderId(value: unknown): value is TtsProviderId {
  return value === 'google' || value === 'gemini';
}

export function getProvider(id: TtsProviderId): TtsProvider {
  return TTS_PROVIDERS.find((p) => p.id === id) ?? geminiTts;
}

/**
 * يختار المزوّد: ما طلبه المستخدم إن كان مهيّأً، وإلا أول مهيّأ.
 *
 * والسقوط صامتٌ عمداً هنا لا يليق — المستخدم يستحق يعرف بأي مزوّد يستمع،
 * فنرجّع ما طُلب وما استُعمل ويقرّر المستدعي كيف يخبره.
 */
export interface ProviderChoice {
  provider: TtsProvider | null;
  requested: TtsProviderId | null;
  fellBack: boolean;
}

export function resolveTtsProvider(requested?: unknown): ProviderChoice {
  const wanted = isTtsProviderId(requested) ? requested : null;

  if (wanted) {
    const exact = getProvider(wanted);
    if (exact.isConfigured()) return { provider: exact, requested: wanted, fellBack: false };
  }

  const preferred = process.env.KITCHEN_TTS_PROVIDER;
  const order = [
    ...(isTtsProviderId(preferred) ? [getProvider(preferred)] : []),
    ...TTS_PROVIDERS,
  ];

  const available = order.find((p) => p.isConfigured()) ?? null;
  return { provider: available, requested: wanted, fellBack: Boolean(wanted && available?.id !== wanted) };
}

export function configuredProviders(): TtsProvider[] {
  return TTS_PROVIDERS.filter((p) => p.isConfigured());
}
