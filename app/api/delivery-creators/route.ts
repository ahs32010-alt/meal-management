import { createClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { deliveryCreatorSchema, parseJson } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('delivery_creators')
    .select('id, name, phone, created_at')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `creator:${user.id}:${clientIdFromRequest(request)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: 'محاولات كثيرة، حاول لاحقاً' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseJson(deliveryCreatorSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const { data, error } = await supabase
    .from('delivery_creators')
    .insert({
      name: parsed.data.name,
      phone: parsed.data.phone ?? null,
    })
    .select('id, name, phone, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'هذا الشخص موجود مسبقاً بنفس الاسم والجوال' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
