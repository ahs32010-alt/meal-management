import { createClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { deliveryOrderSchema, parseJson } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const SELECT_LIST = `
  id, order_number, source_order_id, date, meal_type,
  delivery_location_id, creator_id, created_by_name, created_by_phone,
  delivery_date, delivery_time, notes,
  creator_signature_url, receiver_signature_url,
  created_at, updated_at,
  delivery_locations(id, name, city_id, created_at, cities(id, name, created_at)),
  delivery_creators(id, name, phone, created_at),
  delivery_order_items(id, delivery_order_id, display_name, meal_type, quantity, receiver_signature_url, position, created_at)
`;

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('delivery_orders')
    .select(SELECT_LIST)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sorted = (data ?? []).map(o => {
    const items = (o.delivery_order_items ?? []).slice().sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    );
    return { ...o, delivery_order_items: items };
  });
  return NextResponse.json(sorted);
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
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

  const { data: created, error: insertError } = await supabase
    .from('delivery_orders')
    .insert({
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
    })
    .select('id')
    .single();

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

  const { data: full } = await supabase
    .from('delivery_orders')
    .select(SELECT_LIST)
    .eq('id', created.id)
    .single();

  return NextResponse.json(full, { status: 201 });
}
