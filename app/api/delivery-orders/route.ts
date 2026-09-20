import { createClient } from '@/lib/supabase-server';
import { getCachedUser } from '@/lib/auth';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { deliveryOrderSchema, parseJson } from '@/lib/validation';
import { fetchAllRows } from '@/lib/fetch-all';
import { deliveryOrderSelect, isMissingEntityTypeColumn } from '@/lib/delivery-order-select';

export const dynamic = 'force-dynamic';

/** الحد الأدنى الذي تلمسه هذه الواجهة من صف الأمر — البنود تُرتَّب قبل الإرسال */
type OrderRowWithItems = Record<string, unknown> & {
  delivery_order_items?: { position: number }[];
};


export async function GET() {
  const supabase = createClient();
  const user = await getCachedUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // قراءة على دفعات — بدونها يقصّ PostgREST القائمة عند ١٠٠٠ أمر بصمت
  // فتختفي أوامر من الصفحة ومن التصدير بلا أي مؤشّر.
  const readAll = (select: string) => fetchAllRows((from, to) =>
    supabase
      .from('delivery_orders')
      .select(select)
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to));

  let { data, error } = await readAll(deliveryOrderSelect(true));
  if (error && isMissingEntityTypeColumn(error.message)) {
    ({ data, error } = await readAll(deliveryOrderSelect(false)));
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = ((data ?? []) as unknown as OrderRowWithItems[]).map(o => {
    const items = (o.delivery_order_items ?? []).slice().sort((a, b) => a.position - b.position);
    return { ...o, delivery_order_items: items };
  });
  return NextResponse.json(sorted);
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const user = await getCachedUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `delivery:${user.id}:${clientIdFromRequest(request)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: 'محاولات كثيرة، حاول لاحقاً' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseJson(deliveryOrderSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { items, ...orderData } = parsed.data;

  const orderRow = {
      source_order_id: orderData.source_order_id ?? null,
      date: orderData.date,
      meal_type: orderData.meal_type,
      delivery_location_id: orderData.delivery_location_id ?? null,
      creator_id: orderData.creator_id ?? null,
      created_by_name: orderData.created_by_name ?? null,
      created_by_phone: orderData.created_by_phone ?? null,
      delivery_date: orderData.delivery_date ?? null,
      delivery_time: orderData.delivery_time ?? null,
      notes: orderData.notes ?? null,
      creator_signature_url: orderData.creator_signature_url ?? null,
      receiver_signature_url: orderData.receiver_signature_url ?? null,
      entity_type: orderData.entity_type ?? 'beneficiary',
  };

  const insertOrder = (row: Record<string, unknown>) =>
    supabase.from('delivery_orders').insert(row).select('id').single();

  let { data: created, error: insertError } = await insertOrder(orderRow);
  if (insertError && isMissingEntityTypeColumn(insertError.message)) {
    const { entity_type: _dropped, ...withoutEntityType } = orderRow;
    ({ data: created, error: insertError } = await insertOrder(withoutEntityType));
  }

  if (insertError || !created) {
    return NextResponse.json({ error: insertError?.message ?? 'تعذّر إنشاء أمر التسليم' }, { status: 500 });
  }

  const itemsRows = items.map((it, idx) => ({
    delivery_order_id: created.id,
    display_name: it.display_name,
    meal_type: it.meal_type,
    quantity: it.quantity,
    receiver_signature_url: it.receiver_signature_url ?? null,
    position: idx,
  }));

  const { error: itemsError } = await supabase.from('delivery_order_items').insert(itemsRows);
  if (itemsError) {
    // تنظيف: نحذف الأمر لو فشل إدراج البنود
    await supabase.from('delivery_orders').delete().eq('id', created.id);
    return NextResponse.json({ error: itemsError.message }, { status: 500 });
  }

  const readOne = (select: string) =>
    supabase.from('delivery_orders').select(select).eq('id', created.id).single();

  let { data: full, error: readError } = await readOne(deliveryOrderSelect(true));
  if (readError && isMissingEntityTypeColumn(readError.message)) {
    ({ data: full } = await readOne(deliveryOrderSelect(false)));
  }

  return NextResponse.json(full, { status: 201 });
}
