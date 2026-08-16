import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { assertPagePermission } from '@/lib/auth';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { uuidSchema } from '@/lib/validation';
import { round } from '@/lib/costs';
import {
  buildFreezeBreakdown,
  computeOrderCosts,
  loadPricingContext,
  type OrderRow,
} from '@/lib/costs-server';

export const dynamic = 'force-dynamic';

async function guard(request: Request, action: 'edit' | 'delete') {
  const perm = await assertPagePermission('costs', action);
  if (!perm.ok) {
    return { res: NextResponse.json({ error: perm.error }, { status: perm.status }) };
  }
  const limit = rateLimit({
    key: `costs-freeze:${perm.userId}:${clientIdFromRequest(request)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return {
      res: NextResponse.json(
        { error: 'محاولات كثيرة، حاول لاحقاً' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
      ),
    };
  }
  return { perm };
}

async function readBody(
  request: Request,
): Promise<{ id: string; refreeze: boolean } | { error: string }> {
  let body: unknown;
  try { body = await request.json(); }
  catch { return { error: 'بيانات غير صالحة' }; }
  const parsed = uuidSchema.safeParse((body as { order_id?: unknown })?.order_id);
  if (!parsed.success) return { error: 'معرّف أمر غير صالح' };
  return { id: parsed.data, refreeze: (body as { refreeze?: unknown })?.refreeze === true };
}

/**
 * POST /api/costs/orders/freeze — اعتماد (تجميد) تكلفة أمر تشغيل.
 * يحسب التكلفة بالأسعار الحالية ويحفظها مع تفصيل كامل، فتبقى ثابتة بعدها.
 * الأمر المجمّد لا يُعاد تجميده إلا بـ refreeze صريحة.
 */
export async function POST(request: Request) {
  const g = await guard(request, 'edit');
  if ('res' in g) return g.res;

  const parsed = await readBody(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createClient();

  const fetchOrder = async (withExtras: boolean) =>
    supabase
      .from('daily_orders')
      .select(`id, date, meal_type${withExtras ? ', entity_type, snapshot' : ''}`)
      .eq('id', parsed.id)
      .single();

  let orderRes = await fetchOrder(true);
  if (orderRes.error && /entity_type|snapshot|column/i.test(orderRes.error.message)) {
    orderRes = await fetchOrder(false);
  }
  if (orderRes.error || !orderRes.data) {
    return NextResponse.json({ error: 'أمر التشغيل غير موجود' }, { status: 404 });
  }

  const existing = await supabase
    .from('order_cost_snapshots')
    .select('order_id, frozen_at')
    .eq('order_id', parsed.id)
    .maybeSingle();

  if (existing.data && !parsed.refreeze) {
    return NextResponse.json(
      { error: 'التكلفة معتمدة مسبقاً. لإعادة الاعتماد بالأسعار الحالية أرسل refreeze.' },
      { status: 409 },
    );
  }

  // computeOrderCosts يرجّع اللقطة المحفوظة لو وُجدت. عند إعادة الاعتماد نبي
  // الحساب الحيّ بالأسعار الحالية، فنحذف اللقطة القديمة قبل الحساب.
  if (existing.data && parsed.refreeze) {
    await supabase.from('order_cost_snapshots').delete().eq('order_id', parsed.id);
  }

  const order = orderRes.data as unknown as OrderRow;
  const ctx = await loadPricingContext(supabase);
  const [result] = await computeOrderCosts(supabase, [order]);

  if (!result || result.noData) {
    return NextResponse.json(
      { error: 'لا توجد كميات محسوبة لهذا الأمر — افتح الأمر واحفظه أولاً' },
      { status: 400 },
    );
  }

  const breakdown = buildFreezeBreakdown(result, ctx);

  const { error } = await supabase.from('order_cost_snapshots').upsert(
    {
      order_id: parsed.id,
      total_cost: round(result.total, 4),
      breakdown,
      frozen_at: new Date().toISOString(),
      frozen_by: g.perm.userId,
      frozen_by_name: g.perm.userName,
    },
    { onConflict: 'order_id' },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    order_id: parsed.id,
    total: round(result.total, 2),
    coverage: round(result.coverage, 2),
    unpricedNames: result.unpricedNames,
  });
}

/** DELETE — فكّ الاعتماد فيرجع الأمر للحساب المباشر بالأسعار الحالية */
export async function DELETE(request: Request) {
  const g = await guard(request, 'delete');
  if ('res' in g) return g.res;

  const parsed = await readBody(request);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createClient();
  const { error } = await supabase.from('order_cost_snapshots').delete().eq('order_id', parsed.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, order_id: parsed.id });
}
