import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // ── مزوّدو الذكاء الاصطناعي للمساعد ──────────────────────────────────────
  // كلها اختيارية: النظام يشتغل كاملاً بالمحرّك الحتمي بدونها.
  // ولا واحد منها يبدأ بـNEXT_PUBLIC_ عمداً — المفاتيح لا تصل المتصفح أبداً.
  ANTHROPIC_API_KEY: z.string().trim().min(1).optional(),
  /** مفتاح Google AI Studio المجاني (aistudio.google.com/apikey). */
  GEMINI_API_KEY: z.string().trim().min(1).optional(),
  /** تجاوز النموذج الافتراضي عند الحاجة — مفيد للنزول لنموذج أرخص. */
  GEMINI_MODEL: z.string().trim().min(1).optional(),
  /** المزوّد المفضَّل. لو مفتاحه ناقص يسقط النظام تلقائياً للمتوفّر. */
  ASSISTANT_AI_PROVIDER: z.enum(['gemini', 'claude']).optional(),

  // ── بوت تليقرام (اختياري بالكامل) ────────────────────────────────────────
  /** مفتاح البوت من @BotFather. بدونه لا يوجد بوت أصلاً. */
  TELEGRAM_BOT_TOKEN: z.string().trim().min(1).optional(),
  /**
   * سرّ مشترك يرسله تليقرام في ترويسة كل تحديث.
   * مسار الويب‑هوك عام بطبيعته، وهذا السرّ هو ما يميّز تليقرام عن غيره —
   * فبدونه يرفض المسار كل طلب.
   */
  TELEGRAM_WEBHOOK_SECRET: z.string().trim().min(16).optional(),
  /** نطاق الموقع — لبناء عنوان الويب‑هوك وروابط الصفحات في ردود البوت. */
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

const publicSchema = envSchema.pick({
  NEXT_PUBLIC_SUPABASE_URL: true,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: true,
  NODE_ENV: true,
});

type ServerEnv = z.infer<typeof envSchema>;
type PublicEnv = z.infer<typeof publicSchema>;

let cachedServer: ServerEnv | null = null;
let cachedPublic: PublicEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cachedServer) return cachedServer;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server environment: ${issues}`);
  }
  cachedServer = parsed.data;
  return cachedServer;
}

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid public environment: ${issues}`);
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

export function requireServiceRoleKey(): string {
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for this operation');
  }
  return env.SUPABASE_SERVICE_ROLE_KEY;
}
