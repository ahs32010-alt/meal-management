import { createClient } from '@/lib/supabase-server';
import { NextResponse } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { buildMenuPeriodReport } from '@/lib/menu-period-report';
import type { MealType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `menu-period:${user.id}:${clientIdFromRequest(request)}`,
    limit: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 }); }

  const { selections, meal_type, entity_type } =
    body as { selections?: unknown; meal_type?: string; entity_type?: string };

  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
    return NextResponse.json({ error: 'selections مطلوب' }, { status: 400 });
  }

  // Validate selections: { "1": [0, 1, 6], ... }
  const validated: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(selections as Record<string, unknown>)) {
    const week = Number(k);
    if (!Number.isInteger(week) || week < 1 || week > 4) continue;
    if (!Array.isArray(v)) continue;
    const days = (v as unknown[])
      .map(Number)
      .filter(d => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length > 0) validated[String(week)] = days;
  }

  if (Object.keys(validated).length === 0) {
    return NextResponse.json({ error: 'اختر أسبوعاً واحداً على الأقل' }, { status: 400 });
  }

  const report = await buildMenuPeriodReport(supabase, {
    selections: validated,
    meal_type:
      meal_type && ['breakfast', 'lunch', 'dinner'].includes(meal_type)
        ? (meal_type as MealType)
        : undefined,
    entity_type:
      entity_type === 'companion'
        ? 'companion'
        : entity_type === 'beneficiary'
        ? 'beneficiary'
        : undefined,
  });

  if (!report) {
    return NextResponse.json(
      { error: 'لا توجد أصناف في قائمة الطعام لهذه الأسابيع/الأيام المحددة' },
      { status: 404 },
    );
  }

  return NextResponse.json(report);
}
