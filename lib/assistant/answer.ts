/**
 * تنفيذ النيّة على قاعدة البيانات وبناء الإجابة.
 *
 * قاعدة أساسية: **أي رقم كمّيات يمر عبر buildMenuPeriodReport** — نفس الدالة
 * اللي تبني تقرير الفترة في صفحة التقارير. هذا يضمن أن رقم المساعد يطابق
 * رقم التقرير دائماً، لأنه حرفياً نفس الحساب (الاستثناءات، البدائل، الأصناف
 * الثابتة، المضاعفات، والمعطّلين مؤقتاً).
 *
 * ما نخمّن أبداً: لو ما لقينا الصنف، أو ما قدرنا نحدّد الأسبوع، نقول ذلك
 * بوضوح ونقترح بدائل بدل ما نطلع رقماً غير موثوق.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, ItemCategory, MealType } from '@/lib/types';
import {
  CATEGORY_LABELS,
  DAY_LABELS,
  ENTITY_TYPE_LABELS,
  MEAL_TYPE_LABELS,
} from '@/lib/types';
import { MENU_DAYS } from '@/lib/menu-utils';
import { fetchAllRows } from '@/lib/fetch-all';
import { buildMenuPeriodReport } from '@/lib/menu-period-report';
import { resolveOne, type RankedMatch } from './normalize';
import { parseQuestion } from './parse';
import {
  cycleWeekFor,
  parseIsoDate,
  resolveCycleAnchor,
  resolveWeeks,
  type CycleAnchor,
} from './week';
import type { Answer, AnswerBlock, Intent, StatItem } from './types';

// ── أشكال الصفوف (فضفاضة عمداً: نقرأ بـ select('*') حتى ما تنكسر الاستعلامات
//    لو أحد الـmigrations الاختيارية ما اتشغّل بعد) ─────────────────────────

interface MealRow {
  id: string;
  name: string;
  english_name?: string | null;
  type: MealType;
  is_snack?: boolean | null;
  category?: ItemCategory | null;
  entity_type?: string | null;
}

interface PersonRow {
  id: string;
  name: string;
  english_name?: string | null;
  code: string;
  category?: string | null;
  villa?: string | null;
  diet_type?: string | null;
  notes?: string | null;
  fixed_items?: string | null;
  is_active?: boolean | null;
  entity_type?: string | null;
}

interface MenuItemRow {
  id: string;
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  meal_id: string;
  category?: ItemCategory | null;
  position?: number | null;
  multiplier?: number | null;
  extra_quantity?: number | null;
  entity_type?: string | null;
  meals?: MealRow | null;
}

interface ExclusionRow {
  id: string;
  beneficiary_id: string;
  meal_id: string;
  alternative_meal_id?: string | null;
}

interface FixedMealRow {
  id: string;
  beneficiary_id: string;
  day_of_week: number;
  meal_type: MealType;
  meal_id: string;
  quantity?: number | null;
}

const isActive = (p: PersonRow) => p.is_active !== false;
const entityOf = (v?: string | null): EntityType => (v === 'companion' ? 'companion' : 'beneficiary');
const dayLabel = (d: number) => DAY_LABELS[d] ?? String(d);
const num = (n: number) => n.toLocaleString('en-US');

/** ترتيب أيام العرض: السبت أولاً كما في صفحة القائمة. */
const DAY_ORDER = MENU_DAYS.map((d) => d.value);
const dayRank = (d: number) => {
  const i = DAY_ORDER.indexOf(d);
  return i === -1 ? 99 : i;
};

// ── سياق مُخزَّن مؤقتاً لكل طلب ────────────────────────────────────────────

class Ctx {
  private meals?: Promise<MealRow[]>;
  private people?: Promise<PersonRow[]>;
  private menu?: Promise<MenuItemRow[]>;
  private anchorP?: Promise<CycleAnchor | null>;

  constructor(
    readonly supabase: SupabaseClient,
    readonly today: Date,
  ) {}

  getMeals(): Promise<MealRow[]> {
    return (this.meals ??= (async () => {
      const { data } = await this.supabase.from('meals').select('*').order('name');
      return (data as unknown as MealRow[]) ?? [];
    })());
  }

  getPeople(): Promise<PersonRow[]> {
    return (this.people ??= (async () => {
      const { data } = await this.supabase.from('beneficiaries').select('*').order('name');
      return (data as unknown as PersonRow[]) ?? [];
    })());
  }

  getMenu(): Promise<MenuItemRow[]> {
    return (this.menu ??= (async () => {
      // قراءة على دفعات — menu_items يتجاوز سقف الـ١٠٠٠ صف مع تراكم الأسابيع
      const { data } = await fetchAllRows((from, to) =>
        this.supabase.from('menu_items').select('*, meals(*)').order('id').range(from, to));
      return (data as unknown as MenuItemRow[]) ?? [];
    })());
  }

  getAnchor(): Promise<CycleAnchor | null> {
    return (this.anchorP ??= resolveCycleAnchor(this.supabase, this.today));
  }
}

// ── مساعدات بناء الإجابة ───────────────────────────────────────────────────

function fail(intent: Intent['kind'], title: string, summary: string, blocks: AnswerBlock[] = [], suggestions?: string[]): Answer {
  return { ok: false, intent, title, summary, blocks, suggestions };
}

function notFoundMeal(intent: Intent['kind'], query: string, near: RankedMatch<MealRow>[]): Answer {
  const blocks: AnswerBlock[] = [];
  if (near.length > 0) {
    blocks.push({
      type: 'list',
      caption: 'أقرب الأصناف الموجودة',
      items: near.map((n) => n.item.name),
    });
  }
  return fail(
    intent,
    'الصنف غير موجود',
    `ما لقيت صنفاً باسم «${query}» في الأصناف المسجّلة.`,
    blocks,
    near.map((n) => n.item.name),
  );
}

function ambiguous(intent: Intent['kind'], query: string, cands: RankedMatch<{ name: string }>[]): Answer {
  return fail(
    intent,
    'الاسم غير محدّد',
    `«${query}» يطابق أكثر من نتيجة. اختر واحداً منها:`,
    [{ type: 'list', caption: 'النتائج المحتملة', items: cands.map((c) => c.item.name) }],
    cands.map((c) => c.item.name),
  );
}

/** يبني اختيارات الفترة بالشكل اللي يفهمه buildMenuPeriodReport. */
function selectionsFrom(pairs: Array<{ week: number; day: number }>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const { week, day } of pairs) {
    const key = String(week);
    if (!out[key]) out[key] = [];
    if (!out[key].includes(day)) out[key].push(day);
  }
  return out;
}

// ── منفّذو النوايا ─────────────────────────────────────────────────────────

async function answerMealSchedule(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'meal_schedule' }>,
): Promise<Answer> {
  const meals = await ctx.getMeals();
  const res = resolveOne(intent.subject, meals, (m) => [m.name, m.english_name]);
  if (res.status === 'none') return notFoundMeal('meal_schedule', intent.subject, res.near);
  if (res.status === 'ambiguous') return ambiguous('meal_schedule', intent.subject, res.candidates);

  const meal = res.item;
  const menu = await ctx.getMenu();
  const slots = menu
    .filter((m) => m.meal_id === meal.id)
    .filter((m) => !intent.mealType || m.meal_type === intent.mealType)
    .filter((m) => !intent.entityType || entityOf(m.entity_type) === intent.entityType)
    .sort((a, b) => a.week_number - b.week_number || dayRank(a.day_of_week) - dayRank(b.day_of_week));

  const anchor = await ctx.getAnchor();

  if (slots.length === 0) {
    // ممكن يكون الصنف مستخدم كبديل أو كصنف ثابت فقط
    const [{ data: exRaw }, { data: fxRaw }] = await Promise.all([
      ctx.supabase.from('exclusions').select('*').eq('alternative_meal_id', meal.id),
      ctx.supabase.from('beneficiary_fixed_meals').select('*').eq('meal_id', meal.id),
    ]);
    const asAlt = ((exRaw as unknown as ExclusionRow[]) ?? []).length;
    const asFixed = ((fxRaw as unknown as FixedMealRow[]) ?? []).length;

    const notes: AnswerBlock[] = [];
    if (asAlt > 0 || asFixed > 0) {
      notes.push({
        type: 'note',
        tone: 'info',
        text: `لكنه مستخدم خارج القائمة: ${asAlt > 0 ? `بديل لـ ${num(asAlt)} حالة استثناء` : ''}${asAlt > 0 && asFixed > 0 ? '، و' : ''}${asFixed > 0 ? `صنف ثابت لـ ${num(asFixed)} تخصيص` : ''}.`,
      });
    }
    return {
      ok: true,
      intent: 'meal_schedule',
      title: meal.name,
      summary: `صنف «${meal.name}» غير مُدرَج في قائمة الطعام حالياً.`,
      blocks: notes,
      source: 'قائمة الطعام (menu_items)',
    };
  }

  const rows = slots.map((s) => [
    `الأسبوع ${s.week_number}`,
    dayLabel(s.day_of_week),
    MEAL_TYPE_LABELS[s.meal_type],
    CATEGORY_LABELS[(s.category ?? meal.category ?? (meal.is_snack ? 'snack' : 'hot')) as ItemCategory],
    `×${Math.max(1, s.multiplier ?? 1)}`,
    ENTITY_TYPE_LABELS[entityOf(s.entity_type)],
  ]);

  const weeksSet = Array.from(new Set(slots.map((s) => s.week_number))).sort();
  const currentNote =
    anchor && weeksSet.includes(anchor.currentWeek)
      ? `الأسبوع الحالي (${anchor.currentWeek}) من ضمن أسابيع تقديم هذا الصنف.`
      : anchor
        ? `الأسبوع الحالي هو ${anchor.currentWeek}، وهذا الصنف يُقدَّم في ${weeksSet.map((w) => `الأسبوع ${w}`).join('، ')}.`
        : undefined;

  const blocks: AnswerBlock[] = [
    {
      type: 'stats',
      items: [
        { label: 'مرات التقديم في الدورة', value: num(slots.length), tone: 'primary' },
        { label: 'عدد الأسابيع', value: num(weeksSet.length) },
      ],
    },
    {
      type: 'table',
      columns: ['الأسبوع', 'اليوم', 'الوجبة', 'التصنيف', 'المضاعف', 'الفئة'],
      rows,
    },
  ];
  if (currentNote) blocks.push({ type: 'note', tone: 'info', text: currentNote });

  return {
    ok: true,
    intent: 'meal_schedule',
    title: `مواعيد تقديم: ${meal.name}`,
    summary: `يُقدَّم «${meal.name}» ${num(slots.length)} ${slots.length === 1 ? 'مرة' : 'مرات'} خلال دورة الأربعة أسابيع.`,
    blocks,
    source: 'قائمة الطعام (menu_items)',
    suggestions: [`كم عدد المستفيدين اللي ياكلون ${meal.name} هذا الأسبوع؟`, `مين ممنوع عليه ${meal.name}؟`],
  };
}

async function answerMealConsumption(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'meal_consumption' }>,
): Promise<Answer> {
  const meals = await ctx.getMeals();
  const res = resolveOne(intent.subject, meals, (m) => [m.name, m.english_name]);
  if (res.status === 'none') return notFoundMeal('meal_consumption', intent.subject, res.near);
  if (res.status === 'ambiguous') return ambiguous('meal_consumption', intent.subject, res.candidates);

  const meal = res.item;
  const anchor = await ctx.getAnchor();
  const weeksRes = resolveWeeks(intent.weeks, anchor);

  if (weeksRes.needsAnchor) {
    return fail(
      'meal_consumption',
      'حدّد الأسبوع',
      weeksRes.note ?? 'لا يمكن تحديد الأسبوع الحالي.',
      [],
      [1, 2, 3, 4].map((w) => `كم عدد المستفيدين اللي ياكلون ${meal.name} الأسبوع ${w === 1 ? 'الأول' : w === 2 ? 'الثاني' : w === 3 ? 'الثالث' : 'الرابع'}؟`),
    );
  }

  const menu = await ctx.getMenu();
  const slots = menu
    .filter((m) => m.meal_id === meal.id)
    .filter((m) => weeksRes.weeks.includes(m.week_number))
    .filter((m) => !intent.days || intent.days.includes(m.day_of_week))
    .filter((m) => !intent.mealType || m.meal_type === intent.mealType)
    .filter((m) => !intent.entityType || entityOf(m.entity_type) === intent.entityType);

  const weeksLabel = weeksRes.weeks.map((w) => `الأسبوع ${w}`).join('، ');

  if (slots.length === 0) {
    return {
      ok: true,
      intent: 'meal_consumption',
      title: `${meal.name} — ${weeksLabel}`,
      summary: `صنف «${meal.name}» غير مُجدوَل في ${weeksLabel}، فالكمية = 0.`,
      blocks: weeksRes.note ? [{ type: 'note', tone: 'info', text: weeksRes.note }] : [],
      source: 'قائمة الطعام (menu_items)',
      suggestions: [`متى يُقدَّم ${meal.name}؟`],
    };
  }

  // أزواج (أسبوع، يوم) الفريدة اللي يظهر فيها الصنف
  const pairKey = (w: number, d: number) => `${w}|${d}`;
  const pairMap = new Map<string, { week: number; day: number }>();
  for (const s of slots) pairMap.set(pairKey(s.week_number, s.day_of_week), { week: s.week_number, day: s.day_of_week });
  const pairs = Array.from(pairMap.values()).sort((a, b) => a.week - b.week || dayRank(a.day) - dayRank(b.day));

  const reportArgs = {
    meal_type: intent.mealType,
    entity_type: intent.entityType,
  };

  let total = 0;
  let mainTotal = 0;
  let altTotal = 0;
  let fixedTotal = 0;
  const perPair: Array<{ week: number; day: number; qty: number }> = [];

  // تجميع الأمر التشغيلي تراكمي عبر الخانات، فمجموع النداءات لكل خانة =
  // نداء واحد على كل الخانات. نفصّل حسب اليوم لما الخانات قليلة.
  const detailed = pairs.length <= 4;

  const collect = (report: Awaited<ReturnType<typeof buildMenuPeriodReport>>) => {
    if (!report) return 0;
    const agg = report.aggregated;
    const qty = agg.itemsSummary.find((x) => x.meal.id === meal.id)?.quantity ?? 0;
    mainTotal +=
      (agg.mainMealsSummary.find((x) => x.meal.id === meal.id)?.gets ?? 0) +
      (agg.snackMealsSummary.find((x) => x.meal.id === meal.id)?.gets ?? 0);
    altTotal +=
      (agg.altSummary.find((x) => x.meal.id === meal.id)?.qty ?? 0) +
      (agg.snackAltSummary.find((x) => x.meal.id === meal.id)?.qty ?? 0);
    fixedTotal += agg.fixedSummary.find((x) => x.meal.id === meal.id)?.qty ?? 0;
    return qty;
  };

  if (detailed) {
    for (const p of pairs) {
      const report = await buildMenuPeriodReport(ctx.supabase, {
        selections: selectionsFrom([p]),
        ...reportArgs,
      });
      const qty = collect(report);
      total += qty;
      perPair.push({ ...p, qty });
    }
  } else {
    const report = await buildMenuPeriodReport(ctx.supabase, {
      selections: selectionsFrom(pairs),
      ...reportArgs,
    });
    total = collect(report);
  }

  // كم شخصاً مستثنى من هذا الصنف — يفسّر الفرق عن العدد الكلي
  const { data: exRaw } = await ctx.supabase.from('exclusions').select('*').eq('meal_id', meal.id);
  const exclusions = (exRaw as unknown as ExclusionRow[]) ?? [];
  const people = await ctx.getPeople();
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const activeExcluded = exclusions.filter((e) => {
    const p = peopleById.get(e.beneficiary_id);
    if (!p || !isActive(p)) return false;
    return !intent.entityType || entityOf(p.entity_type) === intent.entityType;
  });

  const stats: StatItem[] = [
    { label: 'إجمالي الحصص', value: num(total), tone: 'primary', hint: weeksLabel },
    { label: 'من القائمة الأساسية', value: num(mainTotal) },
  ];
  if (altTotal > 0) stats.push({ label: 'كصنف بديل', value: num(altTotal), tone: 'success' });
  if (fixedTotal > 0) stats.push({ label: 'كصنف ثابت', value: num(fixedTotal), tone: 'success' });
  if (activeExcluded.length > 0) {
    stats.push({ label: 'مستثنون من الصنف', value: num(activeExcluded.length), tone: 'warn' });
  }

  const blocks: AnswerBlock[] = [{ type: 'stats', items: stats }];

  if (detailed && perPair.length > 0) {
    blocks.push({
      type: 'table',
      caption: 'التفصيل حسب اليوم',
      columns: ['الأسبوع', 'اليوم', 'الحصص'],
      rows: perPair.map((p) => [`الأسبوع ${p.week}`, dayLabel(p.day), num(p.qty)]),
      numericColumns: [2],
    });
  } else if (!detailed) {
    blocks.push({
      type: 'note',
      tone: 'info',
      text: `الصنف يظهر في ${num(pairs.length)} أيام ضمن الفترة — عُرض الإجمالي فقط بدون تفصيل يومي.`,
    });
  }

  if (weeksRes.note) blocks.push({ type: 'note', tone: 'info', text: weeksRes.note });

  return {
    ok: true,
    intent: 'meal_consumption',
    title: `${meal.name} — ${weeksLabel}`,
    summary: `إجمالي ${num(total)} حصة من «${meal.name}» خلال ${weeksLabel}${intent.mealType ? ` (${MEAL_TYPE_LABELS[intent.mealType]})` : ''}${intent.entityType ? ` — ${ENTITY_TYPE_LABELS[intent.entityType]}` : ''}.`,
    blocks,
    source: 'نفس حساب تقرير الفترة: القائمة + الاستثناءات + البدائل + الأصناف الثابتة + المضاعفات، مع استبعاد المعطّلين.',
    suggestions: [`متى يُقدَّم ${meal.name}؟`, `مين ممنوع عليه ${meal.name}؟`],
  };
}

async function answerMealExclusions(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'meal_exclusions' }>,
): Promise<Answer> {
  const meals = await ctx.getMeals();
  const res = resolveOne(intent.subject, meals, (m) => [m.name, m.english_name]);
  if (res.status === 'none') return notFoundMeal('meal_exclusions', intent.subject, res.near);
  if (res.status === 'ambiguous') return ambiguous('meal_exclusions', intent.subject, res.candidates);

  const meal = res.item;
  const { data: exRaw } = await ctx.supabase.from('exclusions').select('*').eq('meal_id', meal.id);
  const exclusions = (exRaw as unknown as ExclusionRow[]) ?? [];

  const people = await ctx.getPeople();
  const peopleById = new Map(people.map((p) => [p.id, p]));
  const mealsById = new Map(meals.map((m) => [m.id, m]));

  const rows = exclusions
    .map((e) => {
      const p = peopleById.get(e.beneficiary_id);
      if (!p) return null;
      const alt = e.alternative_meal_id ? mealsById.get(e.alternative_meal_id) : null;
      return {
        person: p,
        altName: alt?.name ?? '— بدون بديل —',
      };
    })
    .filter((x): x is { person: PersonRow; altName: string } => x !== null)
    .sort((a, b) => a.person.name.localeCompare(b.person.name, 'ar'));

  const active = rows.filter((r) => isActive(r.person));

  if (rows.length === 0) {
    return {
      ok: true,
      intent: 'meal_exclusions',
      title: `ممنوعات: ${meal.name}`,
      summary: `ما فيه أحد ممنوع عليه «${meal.name}».`,
      blocks: [],
      source: 'جدول الاستثناءات (exclusions)',
    };
  }

  return {
    ok: true,
    intent: 'meal_exclusions',
    title: `ممنوعات: ${meal.name}`,
    summary: `${num(active.length)} ${active.length === 1 ? 'شخص' : 'أشخاص'} ممنوع عليهم «${meal.name}»${rows.length !== active.length ? ` (بالإضافة إلى ${num(rows.length - active.length)} معطّل مؤقتاً)` : ''}.`,
    blocks: [
      {
        type: 'table',
        columns: ['الاسم', 'الكود', 'الفئة', 'الفيلا', 'البديل', 'الحالة'],
        rows: rows.map((r) => [
          r.person.name,
          r.person.code ?? '—',
          ENTITY_TYPE_LABELS[entityOf(r.person.entity_type)],
          r.person.villa ?? '—',
          r.altName,
          isActive(r.person) ? 'نشط' : 'معطّل',
        ]),
      },
    ],
    source: 'جدول الاستثناءات (exclusions) + بيانات المستفيدين',
    suggestions: [`كم عدد المستفيدين اللي ياكلون ${meal.name} هذا الأسبوع؟`, `متى يُقدَّم ${meal.name}؟`],
  };
}

async function answerMenuDay(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'menu_day' }>,
): Promise<Answer> {
  const anchor = await ctx.getAnchor();
  let weeks: number[];
  let days: number[];
  let note: string | undefined;

  if (intent.date) {
    const target = resolveDate(intent.date, ctx.today);
    if (!target) return fail('menu_day', 'تاريخ غير مفهوم', `ما قدرت أفهم التاريخ «${intent.date}».`);
    days = [target.getUTCDay()];
    if (!anchor) {
      return fail(
        'menu_day',
        'حدّد الأسبوع',
        'ما قدرت أحدّد رقم الأسبوع في الدورة لهذا التاريخ — ما فيه أوامر تشغيل مسجّلة برقم أسبوع. أضف الأسبوع للسؤال (مثلاً: «الأسبوع الثاني»).',
      );
    }
    const w = cycleWeekFor(parseIsoDate(anchor.anchorDate)!, anchor.anchorWeek, target);
    weeks = [w];
    note = `${formatUtcDate(target)} → ${dayLabel(days[0])}، الأسبوع ${w} في الدورة.`;
  } else {
    const wr = resolveWeeks(intent.weeks, anchor);
    if (wr.needsAnchor) return fail('menu_day', 'حدّد الأسبوع', wr.note ?? '');
    weeks = wr.weeks;
    days = intent.days ?? DAY_ORDER;
    note = wr.note;
  }

  const menu = await ctx.getMenu();
  const items = menu
    .filter((m) => weeks.includes(m.week_number) && days.includes(m.day_of_week))
    .filter((m) => !intent.mealType || m.meal_type === intent.mealType)
    .filter((m) => !intent.entityType || entityOf(m.entity_type) === intent.entityType)
    .sort(
      (a, b) =>
        a.week_number - b.week_number ||
        dayRank(a.day_of_week) - dayRank(b.day_of_week) ||
        (a.position ?? 0) - (b.position ?? 0),
    );

  const scope = `${weeks.map((w) => `الأسبوع ${w}`).join('، ')}${days.length < 7 ? ` — ${days.map(dayLabel).join('، ')}` : ''}`;

  if (items.length === 0) {
    return {
      ok: true,
      intent: 'menu_day',
      title: `القائمة — ${scope}`,
      summary: `ما فيه أصناف مسجّلة في القائمة لـ${scope}.`,
      blocks: note ? [{ type: 'note', tone: 'info', text: note }] : [],
      source: 'قائمة الطعام (menu_items)',
    };
  }

  const blocks: AnswerBlock[] = [
    {
      type: 'table',
      columns: ['الأسبوع', 'اليوم', 'الوجبة', 'الصنف', 'التصنيف', 'المضاعف'],
      rows: items.map((it) => [
        `الأسبوع ${it.week_number}`,
        dayLabel(it.day_of_week),
        MEAL_TYPE_LABELS[it.meal_type],
        it.meals?.name ?? '—',
        CATEGORY_LABELS[(it.category ?? it.meals?.category ?? 'hot') as ItemCategory],
        `×${Math.max(1, it.multiplier ?? 1)}`,
      ]),
    },
  ];
  if (note) blocks.push({ type: 'note', tone: 'info', text: note });

  return {
    ok: true,
    intent: 'menu_day',
    title: `القائمة — ${scope}`,
    summary: `${num(items.length)} صنف في ${scope}${intent.mealType ? ` (${MEAL_TYPE_LABELS[intent.mealType]})` : ''}.`,
    blocks,
    source: 'قائمة الطعام (menu_items)',
  };
}

async function answerEntityCount(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'entity_count' }>,
): Promise<Answer> {
  const people = await ctx.getPeople();
  let filtered = people;
  const filters: string[] = [];

  if (intent.entityType) {
    filtered = filtered.filter((p) => entityOf(p.entity_type) === intent.entityType);
    filters.push(ENTITY_TYPE_LABELS[intent.entityType]);
  }
  if (intent.villa) {
    const v = intent.villa.trim();
    filtered = filtered.filter((p) => (p.villa ?? '').trim() === v);
    filters.push(`فيلا ${v}`);
  }
  if (intent.activeOnly === true) {
    filtered = filtered.filter(isActive);
    filters.push('النشطون فقط');
  } else if (intent.activeOnly === false) {
    filtered = filtered.filter((p) => !isActive(p));
    filters.push('المعطّلون فقط');
  }

  const active = filtered.filter(isActive).length;
  const inactive = filtered.length - active;

  const stats: StatItem[] = [
    { label: 'الإجمالي', value: num(filtered.length), tone: 'primary' },
    { label: 'نشط', value: num(active), tone: 'success' },
  ];
  if (inactive > 0) stats.push({ label: 'معطّل مؤقتاً', value: num(inactive), tone: 'warn' });

  if (!intent.entityType) {
    stats.push({
      label: 'مستفيدون',
      value: num(filtered.filter((p) => entityOf(p.entity_type) === 'beneficiary').length),
    });
    stats.push({
      label: 'مرافقون',
      value: num(filtered.filter((p) => entityOf(p.entity_type) === 'companion').length),
    });
  }

  const scope = filters.length ? ` (${filters.join('، ')})` : '';

  return {
    ok: true,
    intent: 'entity_count',
    title: `العدد${scope}`,
    summary: `${num(filtered.length)} سجل${scope}. منهم ${num(active)} نشط${inactive > 0 ? ` و${num(inactive)} معطّل مؤقتاً` : ''}.`,
    blocks: [{ type: 'stats', items: stats }],
    source: 'جدول المستفيدين/المرافقين (beneficiaries)',
    suggestions: ['توزيع المستفيدين حسب الفيلا', 'توزيع المستفيدين حسب الحمية'],
  };
}

async function answerEntityBreakdown(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'entity_breakdown' }>,
): Promise<Answer> {
  const people = await ctx.getPeople();
  const scoped = intent.entityType
    ? people.filter((p) => entityOf(p.entity_type) === intent.entityType)
    : people;
  const activeOnly = scoped.filter(isActive);

  const keyOf = (p: PersonRow) =>
    (intent.by === 'villa' ? p.villa : intent.by === 'diet' ? p.diet_type : p.category) || 'غير محدّد';

  const counts = new Map<string, number>();
  for (const p of activeOnly) counts.set(keyOf(p), (counts.get(keyOf(p)) ?? 0) + 1);

  const label = intent.by === 'villa' ? 'الفيلا' : intent.by === 'diet' ? 'نوع الحمية' : 'الفئة';
  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ar'))
    .map(([k, v]) => [k, num(v), `${Math.round((v / Math.max(1, activeOnly.length)) * 100)}%`]);

  return {
    ok: true,
    intent: 'entity_breakdown',
    title: `التوزيع حسب ${label}`,
    summary: `${num(activeOnly.length)} سجل نشط موزّعين على ${num(counts.size)} ${intent.by === 'villa' ? 'فيلا' : 'مجموعة'}.`,
    blocks: [
      {
        type: 'table',
        columns: [label, 'العدد', 'النسبة'],
        rows,
        numericColumns: [1, 2],
      },
    ],
    source: 'جدول المستفيدين/المرافقين (النشطون فقط)',
  };
}

async function answerEntityProfile(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'entity_profile' }>,
): Promise<Answer> {
  const people = await ctx.getPeople();
  const res = resolveOne(intent.subject, people, (p) => [p.name, p.english_name, p.code]);

  if (res.status === 'none') {
    return fail(
      'entity_profile',
      'غير موجود',
      `ما لقيت مستفيداً أو مرافقاً باسم «${intent.subject}».`,
      res.near.length ? [{ type: 'list', caption: 'أقرب الأسماء', items: res.near.map((n) => n.item.name) }] : [],
      res.near.map((n) => `معلومات ${n.item.name}`),
    );
  }
  if (res.status === 'ambiguous') return ambiguous('entity_profile', intent.subject, res.candidates);

  const person = res.item;
  const meals = await ctx.getMeals();
  const mealsById = new Map(meals.map((m) => [m.id, m]));

  const [{ data: exRaw }, { data: fxRaw }] = await Promise.all([
    ctx.supabase.from('exclusions').select('*').eq('beneficiary_id', person.id),
    ctx.supabase.from('beneficiary_fixed_meals').select('*').eq('beneficiary_id', person.id),
  ]);
  const exclusions = (exRaw as unknown as ExclusionRow[]) ?? [];
  const fixed = (fxRaw as unknown as FixedMealRow[]) ?? [];

  const blocks: AnswerBlock[] = [
    {
      type: 'stats',
      items: [
        { label: 'الكود', value: person.code ?? '—' },
        { label: 'الفئة', value: ENTITY_TYPE_LABELS[entityOf(person.entity_type)], tone: 'primary' },
        { label: 'الفيلا', value: person.villa || '—' },
        { label: 'الحمية', value: person.diet_type || '—' },
        {
          label: 'الحالة',
          value: isActive(person) ? 'نشط' : 'معطّل مؤقتاً',
          tone: isActive(person) ? 'success' : 'warn',
        },
      ],
    },
  ];

  if (exclusions.length > 0) {
    blocks.push({
      type: 'table',
      caption: 'الممنوعات والبدائل',
      columns: ['الصنف الممنوع', 'البديل'],
      rows: exclusions.map((e) => [
        mealsById.get(e.meal_id)?.name ?? '—',
        e.alternative_meal_id ? (mealsById.get(e.alternative_meal_id)?.name ?? '—') : '— بدون بديل —',
      ]),
    });
  }

  if (fixed.length > 0) {
    blocks.push({
      type: 'table',
      caption: 'الأصناف الثابتة',
      columns: ['اليوم', 'الوجبة', 'الصنف', 'الكمية'],
      rows: fixed
        .slice()
        .sort((a, b) => dayRank(a.day_of_week) - dayRank(b.day_of_week))
        .map((f) => [
          dayLabel(f.day_of_week),
          MEAL_TYPE_LABELS[f.meal_type] ?? f.meal_type,
          mealsById.get(f.meal_id)?.name ?? '—',
          num(f.quantity ?? 1),
        ]),
    });
  }

  if (person.notes) blocks.push({ type: 'note', tone: 'info', text: `ملاحظات: ${person.notes}` });

  return {
    ok: true,
    intent: 'entity_profile',
    title: person.name,
    summary: `${ENTITY_TYPE_LABELS[entityOf(person.entity_type)]} — ${num(exclusions.length)} ممنوع و${num(fixed.length)} صنف ثابت.`,
    blocks,
    source: 'بيانات المستفيد + الاستثناءات + الأصناف الثابتة',
  };
}

async function answerTopMeals(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'top_meals' }>,
): Promise<Answer> {
  const anchor = await ctx.getAnchor();
  const weeksRes = resolveWeeks(intent.weeks, anchor);
  if (weeksRes.needsAnchor) return fail('top_meals', 'حدّد الأسبوع', weeksRes.note ?? '');

  const selections: Record<string, number[]> = {};
  for (const w of weeksRes.weeks) selections[String(w)] = [...DAY_ORDER];

  const report = await buildMenuPeriodReport(ctx.supabase, {
    selections,
    meal_type: intent.mealType,
    entity_type: intent.entityType,
  });

  const weeksLabel = weeksRes.weeks.map((w) => `الأسبوع ${w}`).join('، ');

  if (!report) {
    return fail(
      'top_meals',
      'لا توجد بيانات',
      `ما فيه أصناف في القائمة لـ${weeksLabel}، أو ما فيه مستفيدون مسجّلون.`,
    );
  }

  const top = report.aggregated.itemsSummary.slice(0, Math.max(1, Math.min(50, intent.limit)));
  const grand = report.aggregated.itemsSummary.reduce((s, x) => s + x.quantity, 0);

  const blocks: AnswerBlock[] = [
    {
      type: 'stats',
      items: [
        { label: 'إجمالي الحصص', value: num(grand), tone: 'primary', hint: weeksLabel },
        { label: 'عدد الأصناف', value: num(report.aggregated.itemsSummary.length) },
      ],
    },
    {
      type: 'table',
      caption: `أعلى ${num(top.length)} صنف`,
      columns: ['#', 'الصنف', 'الحصص', 'النسبة'],
      rows: top.map((x, i) => [
        i + 1,
        x.meal.name,
        num(x.quantity),
        `${Math.round((x.quantity / Math.max(1, grand)) * 100)}%`,
      ]),
      numericColumns: [0, 2, 3],
    },
  ];
  if (weeksRes.note) blocks.push({ type: 'note', tone: 'info', text: weeksRes.note });

  return {
    ok: true,
    intent: 'top_meals',
    title: `أكثر الأصناف استهلاكاً — ${weeksLabel}`,
    summary: `أعلى صنف هو «${top[0]?.meal.name ?? '—'}» بـ ${num(top[0]?.quantity ?? 0)} حصة من إجمالي ${num(grand)}.`,
    blocks,
    source: 'نفس حساب تقرير الفترة (القائمة + الاستثناءات + البدائل + الثوابت + المضاعفات)',
  };
}

async function answerLookup(
  ctx: Ctx,
  intent: Extract<Intent, { kind: 'lookup' }>,
): Promise<Answer> {
  const [meals, people] = await Promise.all([ctx.getMeals(), ctx.getPeople()]);

  const mealRes = resolveOne(intent.subject, meals, (m) => [m.name, m.english_name], { confident: 0.7 });
  const personRes = resolveOne(intent.subject, people, (p) => [p.name, p.english_name, p.code], { confident: 0.7 });

  const mealScore = mealRes.status === 'found' ? mealRes.score : 0;
  const personScore = personRes.status === 'found' ? personRes.score : 0;

  if (mealScore >= personScore && mealScore > 0) {
    return answerMealSchedule(ctx, { kind: 'meal_schedule', subject: intent.subject });
  }
  if (personScore > 0) {
    return answerEntityProfile(ctx, { kind: 'entity_profile', subject: intent.subject });
  }

  const near = [
    ...(mealRes.status === 'none' ? mealRes.near.map((n) => `صنف: ${n.item.name}`) : []),
    ...(personRes.status === 'none' ? personRes.near.map((n) => `شخص: ${n.item.name}`) : []),
  ].slice(0, 6);

  return fail(
    'lookup',
    'ما لقيت نتيجة',
    `ما لقيت صنفاً ولا شخصاً باسم «${intent.subject}».`,
    near.length ? [{ type: 'list', caption: 'أقرب النتائج', items: near }] : [],
  );
}

function helpAnswer(reason: 'empty' | 'unknown'): Answer {
  return {
    ok: false,
    intent: 'help',
    title: reason === 'empty' ? 'اكتب سؤالك' : 'ما فهمت السؤال',
    summary:
      reason === 'empty'
        ? 'اكتب سؤالاً عن الأصناف أو المستفيدين أو القائمة.'
        : 'ما قدرت أفهم السؤال. جرّب صيغة أقرب للأمثلة التالية:',
    blocks: [
      {
        type: 'list',
        caption: 'أسئلة مفهومة',
        items: [
          'متى يُقدَّم البرتقال؟',
          'كم عدد المستفيدين اللي ياكلون برتقال الأسبوع الجاي؟',
          'مين ممنوع عليه السمك؟',
          'وش القائمة يوم الثلاثاء الأسبوع الثاني؟',
          'أكثر الأصناف استهلاكاً هذا الأسبوع',
          'كم عدد المرافقين النشطين؟',
          'توزيع المستفيدين حسب الفيلا',
          'معلومات أحمد',
        ],
      },
      {
        type: 'list',
        caption: 'أوامر تنفيذية (تُعرض للتأكيد قبل التنفيذ)',
        items: [
          'خلّي أحمد العلي ياكل بيض بدل الفول',
          'امنع السمك عن أحمد العلي',
          'احذف منع الفول عن أحمد العلي',
          'حط لأحمد العلي صنف ثابت بيض يوم السبت والثلاثاء فطور',
          'احذف الصنف الثابت بيض عن أحمد العلي',
          'أضف بيض لفطور السبت الأسبوع الثاني',
          'احذف بيض من فطور السبت الأسبوع الثاني',
          'أضف صنف جديد اسمه شوربة عدس غداء',
          'غيّر فيلا أحمد العلي إلى 3',
          'عطّل أحمد العلي / فعّل أحمد العلي',
        ],
      },
    ],
  };
}

// ── مساعدات التاريخ ────────────────────────────────────────────────────────

function todayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function resolveDate(token: string, now: Date): Date | null {
  const base = todayUtc(now);
  if (token === 'today') return base;
  if (token === 'tomorrow') return new Date(base.getTime() + 86400000);
  if (token === 'yesterday') return new Date(base.getTime() - 86400000);
  return parseIsoDate(token);
}

function formatUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── نقطة الدخول ────────────────────────────────────────────────────────────

export async function answerIntent(
  supabase: SupabaseClient,
  intent: Intent,
  now: Date = new Date(),
): Promise<Answer> {
  const ctx = new Ctx(supabase, now);
  switch (intent.kind) {
    case 'meal_schedule':
      return answerMealSchedule(ctx, intent);
    case 'meal_consumption':
      return answerMealConsumption(ctx, intent);
    case 'meal_exclusions':
      return answerMealExclusions(ctx, intent);
    case 'menu_day':
      return answerMenuDay(ctx, intent);
    case 'entity_count':
      return answerEntityCount(ctx, intent);
    case 'entity_breakdown':
      return answerEntityBreakdown(ctx, intent);
    case 'entity_profile':
      return answerEntityProfile(ctx, intent);
    case 'top_meals':
      return answerTopMeals(ctx, intent);
    case 'lookup':
      return answerLookup(ctx, intent);
    case 'help':
      return helpAnswer(intent.reason);
  }
}

/** يحلّل السؤال ثم ينفّذه — الواجهة الوحيدة اللي يحتاجها مسار الـAPI. */
export async function ask(
  supabase: SupabaseClient,
  question: string,
  now: Date = new Date(),
): Promise<Answer> {
  return answerIntent(supabase, parseQuestion(question), now);
}
