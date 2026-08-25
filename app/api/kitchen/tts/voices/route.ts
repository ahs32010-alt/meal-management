import { NextResponse } from 'next/server';
import { assertPagePermission } from '@/lib/auth';
import { configuredProviders, resolveTtsProvider } from '@/lib/kitchen/tts';

/**
 * المزوّدون المهيّأون وأصواتهم.
 *
 * القائمة تُقرأ من كل مزوّد لا من ثابت في الواجهة: Google تضيف أصواتاً وتتقاعد
 * أخرى، وقائمة مكتوبة في العميل تعني صوتاً مفقوداً يوماً ما بلا إنذار.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const access = await assertPagePermission('orders', 'view');
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const active = resolveTtsProvider().provider;

  const providers = await Promise.all(
    configuredProviders().map(async (p) => {
      // مزوّد تعذّرت قراءة أصواته لا يُسقط البقية — يظهر بلا أصوات مع سببه.
      const voices = await p.listVoices().catch(() => []);
      return {
        id: p.id,
        label: p.label,
        defaultVoice: p.defaultVoice(),
        voices,
        available: voices.length > 0,
      };
    }),
  );

  return NextResponse.json({
    providers,
    active: active?.id ?? null,
    anyConfigured: providers.length > 0,
  });
}
