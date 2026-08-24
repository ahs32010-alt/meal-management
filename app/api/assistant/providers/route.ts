import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { checkAssistantAccess } from '@/lib/assistant/access';
import { providerStatuses } from '@/lib/assistant/ai/provider';

/**
 * أي مزوّد ذكاء اصطناعي مهيّأ على الخادم — تسأله الواجهة لتقرّر هل تعرض
 * مبدّل الأوضاع أصلاً.
 *
 * ترجّع **وجود** المفتاح لا قيمته. لا شيء هنا يكشف سرّاً، ومع ذلك يمر الطلب
 * بفحص صلاحية المساعد: خريطة ما هو مفعّل على الخادم ليست معلومة عامة.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const supabase = createClient();
  const access = await checkAssistantAccess(supabase);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const providers = await providerStatuses();
  return NextResponse.json({
    providers,
    anyConfigured: providers.some((p) => p.configured),
  });
}
