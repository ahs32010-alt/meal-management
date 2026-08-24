import { NextResponse } from 'next/server';

/**
 * نبضة فحص الاتصال. لا تلمس قاعدة البيانات ولا الجلسة — الغرض الوحيد أن نعرف
 * هل الخادم قابل للوصول، لأن `navigator.onLine` يقول «متصل» لمجرد وجود
 * واي‑فاي حتى لو كان بلا إنترنت خلفه.
 *
 * يستدعيها lib/offline/status.ts أثناء الانقطاع فقط، فما تكلّف شيئاً في
 * الحالة الطبيعية. الـservice worker يمرّرها للشبكة بلا تخزين عمداً.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } },
  );
}
