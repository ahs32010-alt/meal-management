import { createClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';
import { uuidSchema } from '@/lib/validation';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { buildOrderReport, saveOrderSnapshot } from '@/lib/order-report';

export const dynamic = 'force-dynamic';

/**
 * POST — recompute snapshot from current DB state and save it.
 * Called by OrderModal after save (and can be called manually for "refresh stats").
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
  }

  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `snapshot:${user.id}:${clientIdFromRequest(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  const report = await buildOrderReport(supabase, params.id);
  if (!report) return NextResponse.json({ error: 'Order not found or empty' }, { status: 404 });

  const snapshotAt = await saveOrderSnapshot(supabase, params.id, report);
  if (snapshotAt === null) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'migration_required',
        error: 'عمود snapshot غير موجود — شغّل migration order-snapshot-migration.sql في Supabase SQL Editor',
      },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, snapshot_at: snapshotAt });
}
