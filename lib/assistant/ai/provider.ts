/**
 * طبقة المزوّد — الحدّ الفاصل بين نموذج اللغة ومنطق النظام.
 *
 * كل ما تحت هذه الواجهة قابل للاستبدال: Claude أو Gemini أو غيرهما لاحقاً.
 * وكل ما فوقها لا يعرف أيّهما يعمل — يمرّر سؤالاً ويستقبل نتيجة.
 *
 * ── ما لا يملكه المزوّد ────────────────────────────────────────────────────
 * لا يكتب في قاعدة البيانات، ولا يبني خططاً، ولا يفحص صلاحيات. كل ذلك يبقى
 * في المحرّك الحتمي (`runTurn`) خلف أداة `propose_change`. المزوّد يفهم الطلب
 * ويستدعي الأدوات ويصوغ الرد — لا أكثر.
 *
 * ── لماذا التاريخ معتم (`unknown`)؟ ────────────────────────────────────────
 * لكل مزوّد شكل رسائل خاص لا يُترجَم بلا خسارة: Claude يحتاج كتل التفكير
 * محفوظة حرفياً مع نداءات الأدوات وإلا رفض الطلب، وGemini له `Content[]` بشكل
 * مختلف. فبدل ترجمة تُفسد أحدهما، نحمل التاريخ معتماً وموسوماً باسم مزوّده،
 * والمسار يبدأ حواراً جديداً لو تبدّل المزوّد في منتصف الجلسة.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Plan } from '@/lib/assistant/plan';

export type AiProviderId = 'gemini' | 'claude';

/** الترتيب عند غياب تفضيل صريح: Gemini أولاً (مفتاح AI Studio مجاني). */
export const PROVIDER_ORDER: AiProviderId[] = ['gemini', 'claude'];

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  gemini: 'Gemini',
  claude: 'Claude',
};

export interface AgentInput {
  /** عميل المستخدم نفسه — بصلاحياته وRLS، لا مفتاح خدمة. */
  supabase: SupabaseClient;
  /** تاريخ الحوار كما رجّعه هذا المزوّد سابقاً. الخادم بلا حالة. */
  history: unknown;
  question: string;
  userName: string;
  today: string;
}

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface AgentResult {
  /** التاريخ الجديد ليُعاد إرساله في الدور القادم — معتم للمستدعي. */
  messages: unknown;
  text: string;
  /** خطة تنتظر تأكيد المستخدم — لا تُنفَّذ هنا بحال. */
  plan?: { plan: Plan; commandText: string };
  navigate?: { href: string; label: string; permission: string | null };
  toolsUsed: string[];
  usage: AgentUsage;
  /** النموذج الذي ردّ فعلاً — قد يختلف عن الافتراضي لو سقطنا لنموذج بديل. */
  model?: string;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly label: string;
  /** هل مفتاحه متوفّر على الخادم؟ */
  isConfigured(): boolean;
  /** اسم النموذج المستخدم — للعرض والتشخيص. */
  modelName(): string;
  run(input: AgentInput): Promise<AgentResult>;
}

// ── السجل ──────────────────────────────────────────────────────────────────
// الاستيراد كسول (`await import`) عمداً: تحميل SDK مزوّد لا نستخدمه يكلّف
// ذاكرة ووقت بدء في دالة serverless بلا مقابل.

async function load(id: AiProviderId): Promise<AiProvider> {
  if (id === 'gemini') return (await import('./gemini')).geminiProvider;
  return (await import('./claude')).claudeProvider;
}

export interface ProviderStatus {
  id: AiProviderId;
  label: string;
  configured: boolean;
}

/** حالة كل المزوّدين — للعرض في الواجهة بلا كشف أي مفتاح. */
export async function providerStatuses(): Promise<ProviderStatus[]> {
  return Promise.all(
    PROVIDER_ORDER.map(async (id) => {
      const provider = await load(id);
      return { id, label: provider.label, configured: provider.isConfigured() };
    }),
  );
}

export function isProviderId(value: unknown): value is AiProviderId {
  return value === 'gemini' || value === 'claude';
}

export type ProviderResolution =
  | { ok: true; provider: AiProvider; requested: AiProviderId | null; fellBack: boolean }
  | { ok: false; error: string };

/**
 * يختار المزوّد. الأولوية: ما طلبه المستخدم ← ما تفضّله البيئة ← أول مهيّأ.
 *
 * والسقوط للبديل مقصود: مفتاح ناقص أو حصة مجانية منتهية ما يعطّل المساعد ما
 * دام المزوّد الآخر جاهزاً. ونخبر المستدعي أننا سقطنا (`fellBack`) حتى يقول
 * للمستخدم بأي عقل يتحدّث الآن.
 */
export async function resolveProvider(requested?: unknown): Promise<ProviderResolution> {
  const wanted = isProviderId(requested) ? requested : null;
  const preferred = process.env.ASSISTANT_AI_PROVIDER;
  const order: AiProviderId[] = [];

  if (wanted) order.push(wanted);
  if (isProviderId(preferred)) order.push(preferred);
  order.push(...PROVIDER_ORDER);

  const seen = new Set<AiProviderId>();
  let first: AiProvider | null = null;

  for (const id of order) {
    if (seen.has(id)) continue;
    seen.add(id);
    const provider = await load(id);
    if (!first) first = provider;
    if (provider.isConfigured()) {
      return { ok: true, provider, requested: wanted, fellBack: wanted !== null && provider.id !== wanted };
    }
  }

  return {
    ok: false,
    error: wanted
      ? `مزوّد ${PROVIDER_LABELS[wanted]} غير مفعّل — ينقص مفتاحه على الخادم، وما فيه مزوّد بديل مهيّأ.`
      : 'المساعد المدعوم بالذكاء الاصطناعي غير مفعّل — ينقص مفتاح GEMINI_API_KEY أو ANTHROPIC_API_KEY على الخادم.',
  };
}
