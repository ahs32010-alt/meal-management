import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { assertPagePermission } from '@/lib/auth';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { computeOrderCosts, type OrderRow } from '@/lib/costs-server';

export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** سقف الفترة — يمنع طلباً يجرّ سنة كاملة ويحسب تقرير كل أمر فيها */
const MAX_DAYS = 62;

/**
 * GET /api/costs/orders?from=YYYY-MM-DD&to=YYYY-MM-DD
 * تكلفة كل أمر تشغيل في الفترة + الإجمالي لكل يوم.
 */
export async function GET(request: Request) {
  const perm = await assertPagePermission('costs', 'view');
  if (!perm.ok) return NextResponse.json({ error: perm.error }, { status: perm.status });

  const limit = rateLimit({
    key: `costs-orders:${perm.userId}:${clientIdFromRequest(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? from;

  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: 'تاريخ البداية بعد تاريخ النهاية' }, { status: 400 });
  }
  const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (!Number.isFinite(spanDays) || spanDays > MAX_DAYS) {
    return NextResponse.json({ error: `الفترة أطول من ${MAX_DAYS} يوم` }, { status: 400 });
  }

  const supabase = createClient();

  // entity_type و snapshot أُضيفا بترقيات لاحقة — نسقطهما لو ما اتشغّلت الترقية
  const fetchOrders = async (withExtras: boolean) =>
    supabase
      .from('daily_orders')
      .select(`id, date, meal_type${withExtras ? ', entity_type, snapshot' : ''}`)
      .gte('date', from)
      .lte('date', to)
      .order('date')
      .order('meal_type');

  let ordersRes = await fetchOrders(true);
  if (ordersRes.error && /entity_type|snapshot|column/i.test(ordersRes.error.message)) {
    ordersRes = await fetchOrders(false);
  }
  if (ordersRes.error) {
    return NextResponse.json({ error: ordersRes.error.message }, { status: 500 });
  }

  const orders = (ordersRes.data ?? []) as unknown as OrderRow[];

  let results;
  try {
    results = await computeOrderCosts(supabase, orders);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'تعذّر حساب التكاليف';
    // جداول التكاليف غير موجودة = الترقية ما اتشغّلت — رسالة صريحة بدل 500 غامض
    if (/raw_materials|meal_recipe_items|order_cost_snapshots|does not exist/i.test(msg)) {
      return NextResponse.json(
        { error: 'جداول التكاليف غير موجودة — شغّل supabase/costs-migration.sql أولاً' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  // الإجمالي لكل يوم — هذا اللي يجاوب "كم كلّفني هذا اليوم بالكامل"
  const byDate: Record<string, { total: number; portions: number; frozen: number; orders: number }> = {};
  for (const r of results) {
    const d = (byDate[r.date] ??= { total: 0, portions: 0, frozen: 0, orders: 0 });
    d.total += r.total;
    d.portions += r.totalPortions;
    d.orders += 1;
    if (r.frozen) d.frozen += 1;
  }

  return NextResponse.json({
    from,
    to,
    orders: results,
    byDate,
    grandTotal: results.reduce((s, r) => s + r.total, 0),
    totalPortions: results.reduce((s, r) => s + r.totalPortions, 0),
  });
}
