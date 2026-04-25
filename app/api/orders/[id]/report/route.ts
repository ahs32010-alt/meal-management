import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/validation';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { buildOrderReport, saveOrderSnapshot } from '@/lib/order-report';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
  }

  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `report:${user.id}:${clientIdFromRequest(request)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  // 1) If a snapshot exists for this order, return it (frozen view).
  //    If the snapshot column doesn't exist yet (migration not run), skip
  //    silently and fall through to live computation.
  const snapshotQuery = await supabase
    .from('daily_orders')
    .select('snapshot')
    .eq('id', params.id)
    .single();

  const snapshotColumnMissing =
    snapshotQuery.error && /snapshot|column/i.test(snapshotQuery.error.message);

  if (snapshotQuery.error && !snapshotColumnMissing) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }
  if (snapshotQuery.data?.snapshot) {
    return NextResponse.json(snapshotQuery.data.snapshot);
  }

  // 2) No snapshot yet (legacy order or migration not run) — compute live.
  const report = await buildOrderReport(supabase, params.id);
  if (!report) {
    return NextResponse.json({ error: 'Order has no items or no beneficiaries' }, { status: 400 });
  }

  // Best-effort save — never fail the request because snapshot save fails
  // (e.g. when the migration hasn't been applied yet).
  if (!snapshotColumnMissing) {
    void saveOrderSnapshot(supabase, params.id, report).catch(() => {});
  }

  return NextResponse.json(report);
}
