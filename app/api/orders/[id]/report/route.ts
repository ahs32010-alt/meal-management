import { createClient } from '@/lib/supabase-server';
import { getCachedUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { uuidSchema } from '@/lib/validation';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';
import { buildOrderReport, saveOrderSnapshot } from '@/lib/order-report';
import { todayISO } from '@/lib/date-utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!uuidSchema.safeParse(params.id).success) {
    return NextResponse.json({ error: 'معرّف غير صالح' }, { status: 400 });
  }

  const supabase = createClient();

  const user = await getCachedUser(supabase);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const limit = rateLimit({
    key: `report:${user.id}:${clientIdFromRequest(request)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'محاولات كثيرة، حاول لاحقاً' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  // 1) نقرأ اللقطة المحفوظة + تاريخ الأمر.
  //    لو عمود snapshot ما زال غير موجود (الـmigration ما اتشغّل) نتجاهل
  //    بصمت ونكمل للحساب الحيّ.
  const snapshotQuery = await supabase
    .from('daily_orders')
    .select('snapshot, date')
    .eq('id', params.id)
    .single();

  const snapshotColumnMissing =
    snapshotQuery.error && /snapshot|column/i.test(snapshotQuery.error.message);

  if (snapshotQuery.error && !snapshotColumnMissing) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  // الأوامر القادمة (تاريخها اليوم أو بعده) تُحسب من الوضع الحالي في كل مرة:
  // هي اللي بتُطبخ وتُطبع، فلازم تعكس آخر تعديلات المستفيدين (محظور جديد،
  // صنف ثابت معلَّم كـ«صنف بديل»…). أما الأوامر الماضية فتبقى مجمّدة كسجلّ
  // تاريخي لا يتغيّر — وتُحدَّث يدوياً فقط بزر «تحديث الأرقام».
  const orderDate = (snapshotQuery.data as { date?: string } | null)?.date;
  const isUpcoming = !!orderDate && orderDate >= todayISO();

  if (!isUpcoming && snapshotQuery.data?.snapshot) {
    return NextResponse.json(snapshotQuery.data.snapshot);
  }

  // 2) حساب حيّ — إما أمر قادم، أو أمر قديم بلا لقطة.
  const report = await buildOrderReport(supabase, params.id);
  if (!report) {
    // لو تعذّر الحساب الحيّ لأي سبب، ما نضيّع على المستخدم اللقطة الموجودة.
    if (snapshotQuery.data?.snapshot) {
      return NextResponse.json(snapshotQuery.data.snapshot);
    }
    return NextResponse.json({ error: 'Order has no items or no beneficiaries' }, { status: 400 });
  }

  // Best-effort save — never fail the request because snapshot save fails
  // (e.g. when the migration hasn't been applied yet).
  if (!snapshotColumnMissing) {
    void saveOrderSnapshot(supabase, params.id, report).catch(() => {});
  }

  return NextResponse.json(report);
}
