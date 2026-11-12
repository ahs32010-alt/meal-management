import { createClient } from '@/lib/supabase-server';
import { assertPagePermission } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { buildKitchenSectionsReport } from '@/lib/kitchen-sections-report';
import type { MealType } from '@/lib/types';

export const dynamic = 'force-dynamic';

/** حصر أقسام المطبخ — نفس مدخلات /api/reports/menu-period */
export async function POST(request: Request) {
  // صلاحية «حصر الأقسام» (kitchen_report) — الأدمن يمرّ دائماً
  const perm = await assertPagePermission('kitchen_report', 'view');
  if (!perm.ok) {
    return NextResponse.json(
      { error: perm.status === 403 ? 'ما عندك صلاحية «حصر الأقسام»' : perm.error },
      { status: perm.status },
    );
  }
  const supabase = createClient();

  const limit = rateLimit({
    key: `kitchen-sections:${perm.userId}:${clientIdFromRequest(request)}`,
    limit: 20,
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

  const validated: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(selections as Record<string, unknown>)) {
    const week = Number(k);
    if (!Number.isInteger(week) || week < 1 || week > 4) continue;
    if (!Array.isArray(v)) continue;
    const days = [...new Set((v as unknown[]).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
    if (days.length > 0) validated[String(week)] = days;
  }
  if (Object.keys(validated).length === 0) {
    return NextResponse.json({ error: 'اختر يوماً واحداً على الأقل' }, { status: 400 });
  }

  const report = await buildKitchenSectionsReport(supabase, {
    selections: validated,
    meal_type: meal_type && ['breakfast', 'lunch', 'dinner'].includes(meal_type) ? (meal_type as MealType) : undefined,
    entity_type: entity_type === 'companion' ? 'companion' : entity_type === 'beneficiary' ? 'beneficiary' : undefined,
  });

  if ('error' in report) return NextResponse.json({ error: report.error }, { status: 400 });
  if (report.grandTotal === 0) {
    return NextResponse.json({ error: 'لا توجد أصناف في قائمة الطعام للأيام المحددة' }, { status: 404 });
  }
  return NextResponse.json(report);
}
