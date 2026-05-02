import { createClient } from '@/lib/supabase-server';
import { NextResponse, type NextRequest } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { deliveryPrintHeaderSchema, parseJson } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('delivery_print_header')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Always return an object — fallback if migration hasn't seeded the row yet
  return NextResponse.json(data ?? { id: 1 });
}

export async function PUT(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `print-header:${user.id}:${clientIdFromRequest(request)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: 'محاولات كثيرة، حاول لاحقاً' }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const parsed = parseJson(deliveryPrintHeaderSchema, body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });

  const payload = {
    id: 1,
    company_name_en: parsed.data.company_name_en ?? null,
    company_name_ar: parsed.data.company_name_ar ?? null,
    address_line1: parsed.data.address_line1 ?? null,
    address_line2: parsed.data.address_line2 ?? null,
    cr_number: parsed.data.cr_number ?? null,
    vat_number: parsed.data.vat_number ?? null,
    logo_url: parsed.data.logo_url ?? null,
    title_ar: parsed.data.title_ar ?? null,
    title_en: parsed.data.title_en ?? null,
    default_creator_signature_url: parsed.data.default_creator_signature_url ?? null,
  };

  const { data, error } = await supabase
    .from('delivery_print_header')
    .upsert(payload, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
