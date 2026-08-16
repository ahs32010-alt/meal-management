/**
 * تحديد "الأسبوع الحالي" داخل دورة القائمة (٤ أسابيع).
 *
 * النظام ما يخزّن الأسبوع الحالي في أي مكان — الأسبوع يُختار يدوياً عند إنشاء
 * أمر التشغيل. فالمصدر الوحيد الموثوق هو **آخر أمر تشغيل مُسجَّل**: نأخذ
 * تاريخه ورقم أسبوعه كنقطة ارتساء (anchor)، ثم نعدّ كم أسبوع تقويمي مرّ
 * من وقتها.
 *
 * لو ما فيه ولا أمر تشغيل، ما نخمّن — نرجّع null وتطلب الواجهة من المستخدم
 * تحديد الأسبوع صراحةً. تخمين رقم أسبوع خطأ أسوأ من الاعتراف بعدم المعرفة.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeekSpec } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** يحوّل 'YYYY-MM-DD' إلى تاريخ UTC منتصف الليل — بلا مفاجآت منطقة زمنية. */
export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** بداية أسبوع القائمة (السبت) للتاريخ المعطى، بتوقيت UTC. */
export function startOfMenuWeek(date: Date): Date {
  // getUTCDay: الأحد=0 … السبت=6. الأيام منذ آخر سبت = (day + 1) % 7
  const since = (date.getUTCDay() + 1) % 7;
  return new Date(date.getTime() - since * DAY_MS);
}

/** يلفّ الرقم داخل نطاق 1..4. */
export function wrapWeek(n: number): number {
  return ((((n - 1) % 4) + 4) % 4) + 1;
}

/**
 * رقم أسبوع الدورة لتاريخ معيّن، انطلاقاً من نقطة ارتساء معروفة.
 * دالة نقية — مُختبَرة بشكل مستقل.
 */
export function cycleWeekFor(anchorDate: Date, anchorWeek: number, target: Date): number {
  const a = startOfMenuWeek(anchorDate).getTime();
  const t = startOfMenuWeek(target).getTime();
  const elapsed = Math.round((t - a) / (7 * DAY_MS));
  return wrapWeek(anchorWeek + elapsed);
}

export interface CycleAnchor {
  /** رقم أسبوع الدورة اليوم. */
  currentWeek: number;
  /** تاريخ أمر التشغيل المرجعي. */
  anchorDate: string;
  /** رقم الأسبوع المسجَّل على ذلك الأمر. */
  anchorWeek: number;
}

type OrderRow = { date: string; week_number?: number | null; week_of_month?: number | null };

/** يجلب نقطة الارتساء من آخر أمر تشغيل يحمل رقم أسبوع. */
export async function resolveCycleAnchor(
  supabase: SupabaseClient,
  today: Date = new Date(),
): Promise<CycleAnchor | null> {
  const { data, error } = await supabase
    .from('daily_orders')
    .select('*')
    .order('date', { ascending: false })
    .limit(60);

  if (error || !data) return null;

  const rows = data as unknown as OrderRow[];
  for (const row of rows) {
    const week = row.week_number ?? row.week_of_month;
    if (typeof week !== 'number' || week < 1 || week > 4) continue;
    const anchorDate = parseIsoDate(row.date);
    if (!anchorDate) continue;
    return {
      currentWeek: cycleWeekFor(anchorDate, week, today),
      anchorDate: row.date,
      anchorWeek: week,
    };
  }
  return null;
}

export interface ResolvedWeeks {
  weeks: number[];
  /** شرح نصّي يظهر للمستخدم — من وين جبنا رقم الأسبوع. */
  note?: string;
  /** true لما نحتاج الأسبوع الحالي وما قدرنا نحدّده. */
  needsAnchor?: boolean;
}

/** يحوّل WeekSpec إلى أرقام أسابيع فعلية، مع شرح شفّاف للمصدر. */
export function resolveWeeks(spec: WeekSpec, anchor: CycleAnchor | null): ResolvedWeeks {
  if (spec.mode === 'explicit') return { weeks: spec.weeks };
  if (spec.mode === 'all') return { weeks: [1, 2, 3, 4] };

  if (!anchor) {
    return {
      weeks: [],
      needsAnchor: true,
      note: 'ما قدرت أحدّد الأسبوع الحالي — ما فيه أوامر تشغيل مسجّلة برقم أسبوع. حدّد الأسبوع صراحةً (مثلاً: «الأسبوع الثالث»).',
    };
  }

  const offset = spec.mode === 'next' ? 1 : spec.mode === 'prev' ? -1 : 0;
  const week = wrapWeek(anchor.currentWeek + offset);
  const label =
    spec.mode === 'next' ? 'الأسبوع القادم' : spec.mode === 'prev' ? 'الأسبوع الماضي' : 'الأسبوع الحالي';

  return {
    weeks: [week],
    note: `${label} = الأسبوع ${week} في الدورة (مُشتق من أمر التشغيل بتاريخ ${anchor.anchorDate} المسجَّل على الأسبوع ${anchor.anchorWeek}).`,
  };
}
