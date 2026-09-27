import { createClient } from '@/lib/supabase-server';
import { getCachedUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { buildFixedExtrasReport, datesInRange, MAX_RANGE_DAYS } from '@/lib/fixed-extras-period';
import type { MealType } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const supabase = createClient();

  const user = await getCachedUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `fixed-extras:${user.id}:${clientIdFromRequest(request)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: { from?: unknown; to?: unknown; meal_types?: unknown; entity_type?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }

  const from = typeof body.from === 'string' && ISO_DATE.test(body.from) ? body.from : null;
  const to = typeof body.to === 'string' && ISO_DATE.test(body.to) ? body.to : null;
  if (!from || !to) return NextResponse.json({ error: 'حدّد تاريخ البداية والنهاية' }, { status: 400 });

  const days = datesInRange(from, to).length;
  if (days === 0) return NextResponse.json({ error: 'تاريخ النهاية قبل تاريخ البداية' }, { status: 400 });
  if (days > MAX_RANGE_DAYS) return NextResponse.json({ error: `أقصى فترة ${MAX_RANGE_DAYS} يوماً` }, { status: 400 });

  const mealTypes = Array.isArray(body.meal_types)
    ? MEAL_TYPES.filter(t => (body.meal_types as unknown[]).includes(t))
    : MEAL_TYPES;
  if (mealTypes.length === 0) return NextResponse.json({ error: 'اختر وجبة واحدة على الأقل' }, { status: 400 });

  const entityType =
    body.entity_type === 'companion' ? 'companion' as const
    : body.entity_type === 'beneficiary' ? 'beneficiary' as const
    : undefined;

  try {
    const report = await buildFixedExtrasReport(supabase, { from, to, mealTypes, entityType });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'حدث خطأ' }, { status: 500 });
  }
}
