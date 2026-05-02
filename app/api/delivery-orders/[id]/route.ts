import { createClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { uuidSchema, deliveryOrderSchema, parseJson } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const SELECT_FULL = `
  id, order_number, source_order_id, date, meal_type,
  delivery_location_id, creator_id, created_by_name, created_by_phone,
  delivery_date, delivery_time, notes,
  creator_signature_url, receiver_signature_url,
  created_at, updated_at,
  delivery_locations(id, name, city_id, created_at, cities(id, name, created_at)),
  delivery_creators(id, name, phone, created_at),
  delivery_order_items(id, delivery_order_id, display_name, meal_type, quantity, receiver_signature_url, position, created_at)
`;

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('delivery_orders')
    .select(SELECT_FULL)
    .eq('id', params.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'أمر التسليم غير موجود' }, { status: 404 });
  }

  const items = (data.delivery_order_items ?? []).slice().sort(
    (a: { position: number }, b: { position: number }) => a.position - b.position
  );
  return NextResponse.json({ ...data, delivery_order_items: items });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
  }

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

  const { error: updateError } = await supabase
    .from('delivery_orders')
    .update({
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
    .eq('id', params.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // استبدال البنود كاملة (أبسط من الـdiff)
  const { error: deleteError } = await supabase
    .from('delivery_order_items')
    .delete()
    .eq('delivery_order_id', params.id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  const itemsRows = items.map((it, idx) => ({
    delivery_order_id: params.id,
    display_name: it.display_name,
    meal_type: it.meal_type,
    quantity: it.quantity,
    receiver_signature_url: it.receiver_signature_url ?? null,
    position: idx,
  }));
  const { error: insertError } = await supabase.from('delivery_order_items').insert(itemsRows);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const { data: full } = await supabase
    .from('delivery_orders')
    .select(SELECT_FULL)
    .eq('id', params.id)
    .single();

  return NextResponse.json(full);
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabase.from('delivery_orders').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
