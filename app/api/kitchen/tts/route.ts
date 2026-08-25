import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';
import { clientIdFromRequest, rateLimit } from '@/lib/rate-limit';
import { assertPagePermission } from '@/lib/auth';
import { resolveTtsProvider, TtsProviderError } from '@/lib/kitchen/tts';

/**
 * نطق عربي مولَّد على الخادم — البديل حين لا يوجد صوت عربي على الجهاز.
 *
 * ── التخزين هو جوهر التصميم ────────────────────────────────────────────────
 * نطلب من العميل **مقاطع مستقلة**: اسم الصنف وحده، والعدد وحده. فالتراكيب
 * تنهار من (١٧٢ صنف × ٤٧ رقم = ٨٠٠٠) إلى **٢١٩ مقطعاً** تُولَّد مرة واحدة في
 * عمر النظام وتُخزَّن مشتركةً بين كل الأجهزة. بعدها لا نداء واحد للخدمة.
 *
 * ── لماذا مزوّدان ───────────────────────────────────────────────────────────
 * درسٌ عملي: حصة Gemini المجانية عشرة مقاطع يومياً، وأمر واحد يحتاج أربعين.
 * فالمزوّد الأساسي صار Google Cloud (حصته المجانية تكفي مئات الأضعاف)،
 * وGemini بديلٌ يعمل بلا إعداد.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'tts-cache';
const MAX_TEXT = 120;

/**
 * حروف عربية ولاتينية وأرقام وفواصل ومسافات فقط.
 *
 * ليس تجميلاً: المسار يمرّر النص إلى خدمة توليد، وحصره في ما يُنطق فعلاً يمنع
 * استعماله قناةً لغير غرضه على حساب اشتراك المالك.
 */
const ALLOWED = /^[؀-ۿݐ-ݿA-Za-z0-9\s،,.\-()٠-٩]+$/;

function audioResponse(body: Uint8Array, contentType: string, source: string): NextResponse {
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      // المقطع ثابت لا يتغيّر — بصمته جزء من مفتاحه.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Tts-Source': source,
    },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const text = (url.searchParams.get('text') ?? '').trim().replace(/\s+/g, ' ');

  if (!text) return NextResponse.json({ error: 'النص مفقود' }, { status: 400 });
  if (text.length > MAX_TEXT) return NextResponse.json({ error: 'النص طويل جداً' }, { status: 400 });
  if (!ALLOWED.test(text)) {
    return NextResponse.json({ error: 'النص يحوي رموزاً غير مسموحة' }, { status: 400 });
  }

  // من يسمع أوامر التشغيل يحتاج صلاحية عرضها — نفس بوابة بقية النظام.
  const access = await assertPagePermission('orders', 'view');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const choice = resolveTtsProvider(url.searchParams.get('provider'));
  if (!choice.provider) {
    return NextResponse.json(
      {
        error:
          'الصوت المولَّد غير مفعّل على الخادم — ينقص GOOGLE_TTS_CREDENTIALS أو GEMINI_API_KEY.',
        missingKey: true,
      },
      { status: 503 },
    );
  }
  const provider = choice.provider;

  // صوتٌ من مزوّد آخر يرجع خطأً غامضاً من الخدمة — نردّه للافتراضي قبل ذلك.
  const requestedVoice = url.searchParams.get('voice') ?? '';
  const voice = (await provider.isValidVoice(requestedVoice))
    ? requestedVoice
    : provider.defaultVoice();

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: 'التخزين غير مهيّأ — ينقص SUPABASE_SERVICE_ROLE_KEY على الخادم.' },
      { status: 503 },
    );
  }

  // المزوّد والصوت جزء من المفتاح — فلا تختلط مقاطع مزوّد بآخر.
  const hash = createHash('sha256').update(`${provider.id}|${voice}|${text}`).digest('hex').slice(0, 40);

  // ① المخزون أولاً — لا نستهلك حصة على مقطع ولّدناه من قبل.
  for (const ext of ['mp3', 'wav'] as const) {
    const hit = await admin.storage.from(BUCKET).download(`${hash}.${ext}`);
    if (hit.data) {
      return audioResponse(
        new Uint8Array(await hit.data.arrayBuffer()),
        ext === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        'cache',
      );
    }
  }

  // ② التوليد — محدود المعدّل لأنه يستهلك حصة حقيقية.
  const limit = rateLimit({
    key: `tts:${access.userId}:${clientIdFromRequest(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'طلبات كثيرة، انتظر قليلاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  try {
    const result = await provider.synthesize(text, voice);

    // ③ التخزين — أفضل جهد. فشله يعني إعادة توليد لاحقاً، لا فشل الطلب.
    void admin.storage
      .from(BUCKET)
      .upload(`${hash}.${result.ext}`, Buffer.from(result.audio), {
        contentType: result.contentType,
        upsert: true,
      })
      .then(async ({ error }) => {
        if (!error) return;
        // أول استعمال: الحاوية غير موجودة بعد. ننشئها ونعيد المحاولة مرة.
        if (/bucket not found/i.test(error.message)) {
          await admin.storage.createBucket(BUCKET, { public: false }).catch(() => {});
          await admin.storage
            .from(BUCKET)
            .upload(`${hash}.${result.ext}`, Buffer.from(result.audio), {
              contentType: result.contentType,
              upsert: true,
            })
            .catch(() => {});
        }
      })
      .catch(() => {});

    return audioResponse(result.audio, result.contentType, `generated:${provider.id}`);
  } catch (err) {
    console.error(`[kitchen/tts:${provider.id}] failed:`, err);
    if (err instanceof TtsProviderError) {
      return NextResponse.json(
        { error: err.message, provider: provider.id, quota: err.quota },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: 'تعذّر توليد الصوت' }, { status: 502 });
  }
}
