/**
 * تحويل الأمر المُحلَّل إلى **خطة تنفيذ** (معاينة قبل التطبيق).
 *
 * الخطة تحمل شيئين:
 *   1. وصفاً بشرياً لكل ما سيحدث — يُعرض للمستخدم ليؤكّد.
 *   2. عمليات قاعدة بيانات محدّدة (ops) — تُنفَّذ حرفياً بعد التأكيد.
 *
 * لا شيء يُكتب هنا. كل الاستعلامات قراءة فقط لبناء المعاينة والتحذيرات.
 *
 * توقيع الخطة (signature) هو بصمة العمليات: عند التنفيذ يُعاد بناء الخطة من
 * نفس السؤال ويُقارن التوقيع — فلو تغيّرت البيانات بين المعاينة والتأكيد
 * (أحد عدّل الصنف مثلاً) يُرفض التنفيذ ويُطلب معاينة جديدة. الخادم لا يثق
 * أبداً بعمليات قادمة من المتصفح.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, ItemCategory, MealType } from '@/lib/types';
import { CATEGORY_LABELS, DAY_LABELS, ENTITY_TYPE_LABELS, MEAL_TYPE_LABELS } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
import type { PageKey, PermissionAction } from '@/lib/permissions';
import { rankMatches, resolveOne, type RankedMatch } from './normalize';
import { parseCommand, stripLeadingLam, type Command, type CommandGap, type GroupTarget, type PersonField } from './commands';
import {
  interpret,
  type AskOption,
  type DialogContext,
  type Pending,
} from './interpret';
import { cycleWeekFor, parseIsoDate, resolveCycleAnchor, resolveWeeks } from './week';

// ── أنواع العمليات ─────────────────────────────────────────────────────────

export type Op =
  | { table: string; action: 'insert'; values: Record<string, unknown> }
  | { table: string; action: 'update'; match: Record<string, unknown>; values: Record<string, unknown> }
  | { table: string; action: 'delete'; match: Record<string, unknown> };

export interface PlanStep {
  text: string;
  tone: 'add' | 'remove' | 'change';
}

export interface ActivityMeta {
  action: 'create' | 'update' | 'delete';
  entity_type: 'beneficiary' | 'companion' | 'meal' | 'fixed_meal' | 'exclusion';
  entity_id?: string | null;
  entity_name?: string | null;
  details?: Record<string, unknown>;
}

export interface Plan {
  type: 'plan';
  command: Command['kind'];
  title: string;
  summary: string;
  steps: PlanStep[];
  warnings: string[];
  /** الصلاحية المطلوبة لتنفيذ هذه الخطة. */
  permission: { page: PageKey; action: PermissionAction };
  signature: string;
  ops: Op[];
  activity: ActivityMeta[];
}

export interface PlanProblem {
  type: 'problem';
  title: string;
  summary: string;
  /** خيارات يقترحها المساعد لتوضيح الطلب. */
  options?: string[];
}

export type PlanResult = Plan | PlanProblem;

// ── أشكال الصفوف ───────────────────────────────────────────────────────────

interface MealRow {
  id: string;
  name: string;
  english_name?: string | null;
  type?: MealType | null;
  is_snack?: boolean | null;
  category?: ItemCategory | null;
  entity_type?: string | null;
}

interface PersonRow {
  id: string;
  name: string;
  english_name?: string | null;
  code?: string | null;
  category?: string | null;
  villa?: string | null;
  diet_type?: string | null;
  notes?: string | null;
  is_active?: boolean | null;
  entity_type?: string | null;
  no_fish?: boolean | null;
  no_pasta_sandwich?: boolean | null;
  low_carb?: boolean | null;
}

const entityOf = (v?: string | null): EntityType => (v === 'companion' ? 'companion' : 'beneficiary');
const dayLabel = (d: number) => DAY_LABELS[d] ?? String(d);
const daysLabel = (days: number[]) => days.map(dayLabel).join(' و');
const num = (n: number) => n.toLocaleString('en-US');

function problem(title: string, summary: string, options?: string[]): PlanProblem {
  return { type: 'problem', title, summary, options };
}

function signOps(ops: Op[]): string {
  const stable = JSON.stringify(ops, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
  return createHash('sha256').update(stable).digest('hex').slice(0, 32);
}

const personPermission = (p: PersonRow): { page: PageKey; action: PermissionAction } => ({
  page: entityOf(p.entity_type) === 'companion' ? 'companions' : 'beneficiaries',
  action: 'edit',
});

// ── حلّ الأسماء ────────────────────────────────────────────────────────────

async function loadMeals(supabase: SupabaseClient): Promise<MealRow[]> {
  const { data } = await supabase.from('meals').select('*').order('name');
  return (data as unknown as MealRow[]) ?? [];
}

async function loadPeople(supabase: SupabaseClient): Promise<PersonRow[]> {
  const { data } = await supabase.from('beneficiaries').select('*').order('name');
  return (data as unknown as PersonRow[]) ?? [];
}

type Resolved<T> = { ok: true; item: T } | { ok: false; problem: PlanProblem };

function resolveMeal(query: string, meals: MealRow[], label: string): Resolved<MealRow> {
  const r = resolveOne(query, meals, (m) => [m.name, m.english_name]);
  if (r.status === 'found') return { ok: true, item: r.item };
  if (r.status === 'ambiguous') {
    return {
      ok: false,
      problem: problem(
        'اسم الصنف غير محدّد',
        `«${query}» يطابق أكثر من صنف. أعد صياغة الأمر باسم دقيق:`,
        r.candidates.map((c: RankedMatch<MealRow>) => c.item.name),
      ),
    };
  }
  return {
    ok: false,
    problem: problem(
      'الصنف غير موجود',
      `ما لقيت صنفاً باسم «${query}» (${label}). تأكد من الاسم أو أضف الصنف أولاً.`,
      r.near.map((c: RankedMatch<MealRow>) => c.item.name),
    ),
  };
}

const PERSON_TEXTS = (p: PersonRow) => [p.name, p.english_name, p.code];
const MEAL_TEXTS = (m: MealRow) => [m.name, m.english_name];

/** أفضل درجة مطابقة (0..1) بلا حسم — تُستعمل لموازنة الأدوار. */
function bestScore<T>(q: string, items: readonly T[], texts: (t: T) => Array<string | null | undefined>): number {
  if (!q) return 0;
  return rankMatches(q, items, texts, { threshold: 0, limit: 1 })[0]?.score ?? 0;
}

/**
 * يصحّح انقلاب الأدوار: في العربية الحرّة قد يسبق الصنفُ الشخصَ أو العكس
 * («اسمح لأحمد بالفول» مقابل «امنع الفول عن أحمد»). بدل التكهّن نحوياً،
 * نوازن الاحتمالين مقابل قاعدة البيانات ونأخذ الأرجح بفارق واضح.
 */
export function orientPersonMeal(
  personQ: string,
  mealQ: string,
  people: PersonRow[],
  meals: MealRow[],
): { person: string; meal: string } {
  const asIs = bestScore(personQ, people, PERSON_TEXTS) + bestScore(mealQ, meals, MEAL_TEXTS);
  const swapped = bestScore(mealQ, people, PERSON_TEXTS) + bestScore(personQ, meals, MEAL_TEXTS);
  return swapped > asIs + 0.15 ? { person: mealQ, meal: personQ } : { person: personQ, meal: mealQ };
}

function resolvePerson(query: string, people: PersonRow[]): Resolved<PersonRow> {
  // «لأحمد» بلام الجر الملتصقة تُجرَّب أيضاً بلا لام
  const bare = stripLeadingLam(query);
  const effective =
    bare !== query && bestScore(bare, people, PERSON_TEXTS) > bestScore(query, people, PERSON_TEXTS)
      ? bare
      : query;
  const r = resolveOne(effective, people, (p) => [p.name, p.english_name, p.code]);
  if (r.status === 'found') return { ok: true, item: r.item };
  if (r.status === 'ambiguous') {
    return {
      ok: false,
      problem: problem(
        'الاسم غير محدّد',
        `«${query}» يطابق أكثر من شخص. حدّد الاسم كاملاً أو استخدم الكود:`,
        r.candidates.map((c: RankedMatch<PersonRow>) => `${c.item.name} (${c.item.code ?? '—'})`),
      ),
    };
  }
  return {
    ok: false,
    problem: problem(
      'الشخص غير موجود',
      `ما لقيت مستفيداً أو مرافقاً باسم «${query}».`,
      r.near.map((c: RankedMatch<PersonRow>) => c.item.name),
    ),
  };
}

// ── بناء الخطط ─────────────────────────────────────────────────────────────

async function planSetExclusion(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'set_exclusion' }>,
): Promise<PlanResult> {
  const [meals, people] = await Promise.all([loadMeals(supabase), loadPeople(supabase)]);

  const oriented = orientPersonMeal(cmd.person, cmd.meal, people, meals);
  const person = resolvePerson(oriented.person, people);
  if (!person.ok) return person.problem;
  const meal = resolveMeal(oriented.meal, meals, 'الصنف الممنوع');
  if (!meal.ok) return meal.problem;

  let alt: MealRow | null = null;
  if (cmd.alternative) {
    const a = resolveMeal(cmd.alternative, meals, 'الصنف البديل');
    if (!a.ok) return a.problem;
    alt = a.item;
  }

  if (alt && alt.id === meal.item.id) {
    return problem('أمر غير منطقي', 'الصنف البديل هو نفسه الصنف الممنوع.');
  }

  const { data: existingRaw } = await supabase
    .from('exclusions')
    .select('*')
    .eq('beneficiary_id', person.item.id)
    .eq('meal_id', meal.item.id);
  const existing = ((existingRaw as unknown as Array<{ id: string; alternative_meal_id: string | null }>) ?? [])[0];

  const warnings: string[] = [];
  if (!person.item.is_active) warnings.push('هذا الشخص معطّل مؤقتاً — التعديل يُحفظ لكن لن يظهر في الأوامر حتى تفعّله.');
  if (alt && alt.type && meal.item.type && alt.type !== meal.item.type) {
    warnings.push(`نوع البديل (${MEAL_TYPE_LABELS[alt.type]}) يختلف عن نوع الصنف الممنوع (${MEAL_TYPE_LABELS[meal.item.type]}).`);
  }

  const steps: PlanStep[] = [];
  const ops: Op[] = [];
  const activity: ActivityMeta[] = [];

  if (existing) {
    steps.push({
      tone: 'change',
      text: `تحديث منع «${meal.item.name}» عن ${person.item.name} — البديل يصير «${alt?.name ?? 'بدون بديل'}».`,
    });
    ops.push({
      table: 'exclusions',
      action: 'update',
      match: { id: existing.id },
      values: { alternative_meal_id: alt?.id ?? null },
    });
    activity.push({
      action: 'update',
      entity_type: 'exclusion',
      entity_id: existing.id,
      entity_name: `${person.item.name} — ${meal.item.name}`,
      details: { البديل: alt?.name ?? 'بدون بديل' },
    });
  } else {
    steps.push({
      tone: 'add',
      text: `منع «${meal.item.name}» عن ${person.item.name}${alt ? ` وإعطاؤه «${alt.name}» بدلاً منه` : ' بدون بديل'}.`,
    });
    ops.push({
      table: 'exclusions',
      action: 'insert',
      values: {
        beneficiary_id: person.item.id,
        meal_id: meal.item.id,
        alternative_meal_id: alt?.id ?? null,
      },
    });
    activity.push({
      action: 'create',
      entity_type: 'exclusion',
      entity_name: `${person.item.name} — ${meal.item.name}`,
      details: { البديل: alt?.name ?? 'بدون بديل' },
    });
  }

  return {
    type: 'plan',
    command: 'set_exclusion',
    title: existing ? 'تحديث ممنوع' : 'إضافة ممنوع',
    summary: `${person.item.name} (${ENTITY_TYPE_LABELS[entityOf(person.item.entity_type)]}) — ${meal.item.name}${alt ? ` → ${alt.name}` : ''}`,
    steps,
    warnings,
    permission: personPermission(person.item),
    ops,
    activity,
    signature: signOps(ops),
  };
}

async function planClearExclusion(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'clear_exclusion' }>,
): Promise<PlanResult> {
  const [meals, people] = await Promise.all([loadMeals(supabase), loadPeople(supabase)]);
  const oriented = orientPersonMeal(cmd.person, cmd.meal, people, meals);
  const person = resolvePerson(oriented.person, people);
  if (!person.ok) return person.problem;
  const meal = resolveMeal(oriented.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const { data: existingRaw } = await supabase
    .from('exclusions')
    .select('*')
    .eq('beneficiary_id', person.item.id)
    .eq('meal_id', meal.item.id);
  const existing = ((existingRaw as unknown as Array<{ id: string }>) ?? [])[0];

  if (!existing) {
    return problem(
      'لا يوجد ما يُحذف',
      `«${meal.item.name}» غير ممنوع أصلاً عن ${person.item.name}.`,
    );
  }

  const ops: Op[] = [{ table: 'exclusions', action: 'delete', match: { id: existing.id } }];

  return {
    type: 'plan',
    command: 'clear_exclusion',
    title: 'رفع المنع',
    summary: `${person.item.name} يقدر يأكل «${meal.item.name}» من جديد.`,
    steps: [{ tone: 'remove', text: `حذف منع «${meal.item.name}» عن ${person.item.name}.` }],
    warnings: [],
    permission: personPermission(person.item),
    ops,
    activity: [
      {
        action: 'delete',
        entity_type: 'exclusion',
        entity_id: existing.id,
        entity_name: `${person.item.name} — ${meal.item.name}`,
      },
    ],
    signature: signOps(ops),
  };
}

async function planAddFixed(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'add_fixed' }>,
): Promise<PlanResult> {
  const [meals, people] = await Promise.all([loadMeals(supabase), loadPeople(supabase)]);
  const oriented = orientPersonMeal(cmd.person, cmd.meal, people, meals);
  const person = resolvePerson(oriented.person, people);
  if (!person.ok) return person.problem;
  const meal = resolveMeal(oriented.meal, meals, 'الصنف الثابت');
  if (!meal.ok) return meal.problem;

  const mealType: MealType = cmd.mealType ?? (meal.item.type as MealType) ?? 'breakfast';
  const warnings: string[] = [];
  if (!cmd.mealType) {
    warnings.push(`ما ذكرت الوجبة — استُخدم نوع الصنف نفسه (${MEAL_TYPE_LABELS[mealType]}).`);
  }
  if (!person.item.is_active) warnings.push('هذا الشخص معطّل مؤقتاً — الصنف الثابت يُحفظ لكن لن يظهر حتى تفعّله.');

  const { data: existingRaw } = await supabase
    .from('beneficiary_fixed_meals')
    .select('*')
    .eq('beneficiary_id', person.item.id)
    .eq('meal_id', meal.item.id);
  const existing = (existingRaw as unknown as Array<{ id: string; day_of_week: number; meal_type: string; quantity?: number }>) ?? [];

  const steps: PlanStep[] = [];
  const ops: Op[] = [];
  const activity: ActivityMeta[] = [];
  const category: ItemCategory = meal.item.category ?? (meal.item.is_snack ? 'snack' : 'hot');

  for (const day of cmd.days) {
    const dup = existing.find((e) => e.day_of_week === day && e.meal_type === mealType);
    if (dup) {
      if ((dup.quantity ?? 1) === cmd.quantity) {
        steps.push({ tone: 'change', text: `${dayLabel(day)}: موجود مسبقاً بنفس الكمية — لا تغيير.` });
        continue;
      }
      steps.push({
        tone: 'change',
        text: `${dayLabel(day)} (${MEAL_TYPE_LABELS[mealType]}): تعديل كمية «${meal.item.name}» من ${dup.quantity ?? 1} إلى ${cmd.quantity}.`,
      });
      ops.push({
        table: 'beneficiary_fixed_meals',
        action: 'update',
        match: { id: dup.id },
        values: { quantity: cmd.quantity },
      });
      activity.push({
        action: 'update',
        entity_type: 'fixed_meal',
        entity_id: dup.id,
        entity_name: `${person.item.name} — ${meal.item.name}`,
        details: { اليوم: dayLabel(day), الكمية: cmd.quantity },
      });
      continue;
    }

    steps.push({
      tone: 'add',
      text: `${dayLabel(day)} (${MEAL_TYPE_LABELS[mealType]}): إضافة «${meal.item.name}» × ${cmd.quantity} كصنف ثابت.`,
    });
    ops.push({
      table: 'beneficiary_fixed_meals',
      action: 'insert',
      values: {
        beneficiary_id: person.item.id,
        day_of_week: day,
        meal_type: mealType,
        meal_id: meal.item.id,
        quantity: cmd.quantity,
        category,
      },
    });
    activity.push({
      action: 'create',
      entity_type: 'fixed_meal',
      entity_name: `${person.item.name} — ${meal.item.name}`,
      details: { اليوم: dayLabel(day), الوجبة: MEAL_TYPE_LABELS[mealType], الكمية: cmd.quantity },
    });
  }

  if (ops.length === 0) {
    return problem('لا جديد', `«${meal.item.name}» مضاف مسبقاً لـ${person.item.name} في ${daysLabel(cmd.days)} بنفس الكمية.`);
  }

  return {
    type: 'plan',
    command: 'add_fixed',
    title: 'صنف ثابت',
    summary: `${person.item.name} — «${meal.item.name}» يوم ${daysLabel(cmd.days)} (${MEAL_TYPE_LABELS[mealType]})`,
    steps,
    warnings,
    permission: personPermission(person.item),
    ops,
    activity,
    signature: signOps(ops),
  };
}

async function planRemoveFixed(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'remove_fixed' }>,
): Promise<PlanResult> {
  const [meals, people] = await Promise.all([loadMeals(supabase), loadPeople(supabase)]);
  const oriented = orientPersonMeal(cmd.person, cmd.meal, people, meals);
  const person = resolvePerson(oriented.person, people);
  if (!person.ok) return person.problem;
  const meal = resolveMeal(oriented.meal, meals, 'الصنف الثابت');
  if (!meal.ok) return meal.problem;

  const { data: rowsRaw } = await supabase
    .from('beneficiary_fixed_meals')
    .select('*')
    .eq('beneficiary_id', person.item.id)
    .eq('meal_id', meal.item.id);

  let rows = (rowsRaw as unknown as Array<{ id: string; day_of_week: number; meal_type: string }>) ?? [];
  if (cmd.days) rows = rows.filter((r) => cmd.days!.includes(r.day_of_week));
  if (cmd.mealType) rows = rows.filter((r) => r.meal_type === cmd.mealType);

  if (rows.length === 0) {
    return problem('لا يوجد ما يُحذف', `ما فيه صنف ثابت «${meal.item.name}» لـ${person.item.name}${cmd.days ? ` في ${daysLabel(cmd.days)}` : ''}.`);
  }

  const ops: Op[] = rows.map((r) => ({ table: 'beneficiary_fixed_meals', action: 'delete' as const, match: { id: r.id } }));

  return {
    type: 'plan',
    command: 'remove_fixed',
    title: 'حذف صنف ثابت',
    summary: `${person.item.name} — «${meal.item.name}»`,
    steps: rows.map((r) => ({
      tone: 'remove' as const,
      text: `${dayLabel(r.day_of_week)} (${MEAL_TYPE_LABELS[r.meal_type as MealType] ?? r.meal_type}): حذف «${meal.item.name}».`,
    })),
    warnings: [],
    permission: personPermission(person.item),
    ops,
    activity: rows.map((r) => ({
      action: 'delete' as const,
      entity_type: 'fixed_meal' as const,
      entity_id: r.id,
      entity_name: `${person.item.name} — ${meal.item.name}`,
      details: { اليوم: dayLabel(r.day_of_week) },
    })),
    signature: signOps(ops),
  };
}

async function planPersonStatus(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'set_person_status' }>,
): Promise<PlanResult> {
  const people = await loadPeople(supabase);
  const person = resolvePerson(cmd.person, people);
  if (!person.ok) return person.problem;

  const current = person.item.is_active !== false;
  if (current === cmd.active) {
    return problem('لا تغيير', `${person.item.name} ${cmd.active ? 'مفعّل' : 'معطّل'} أصلاً.`);
  }

  const ops: Op[] = [
    { table: 'beneficiaries', action: 'update', match: { id: person.item.id }, values: { is_active: cmd.active } },
  ];

  return {
    type: 'plan',
    command: 'set_person_status',
    title: cmd.active ? 'تفعيل' : 'تعطيل مؤقت',
    summary: `${person.item.name} (${ENTITY_TYPE_LABELS[entityOf(person.item.entity_type)]})`,
    steps: [
      {
        tone: 'change',
        text: cmd.active
          ? `تفعيل ${person.item.name} — يرجع يُحتسب في الأوامر والستيكرات والتقارير.`
          : `تعطيل ${person.item.name} مؤقتاً — يخرج من الأوامر والستيكرات والتقارير حتى تفعّله.`,
      },
    ],
    warnings: cmd.active ? [] : ['التعطيل يؤثر على كل أوامر التشغيل الجديدة والتقارير فوراً.'],
    permission: personPermission(person.item),
    ops,
    activity: [
      {
        action: 'update',
        entity_type: entityOf(person.item.entity_type),
        entity_id: person.item.id,
        entity_name: person.item.name,
        details: { الحالة: cmd.active ? 'مفعّل' : 'معطّل' },
      },
    ],
    signature: signOps(ops),
  };
}

const FIELD_LABELS: Record<PersonField, string> = {
  villa: 'الفيلا',
  diet_type: 'نوع الحمية',
  notes: 'الملاحظات',
  name: 'الاسم',
  code: 'الكود',
  english_name: 'الاسم الإنجليزي',
  category: 'الفئة',
};

async function planPersonField(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'set_person_field' }>,
): Promise<PlanResult> {
  const people = await loadPeople(supabase);
  const person = resolvePerson(cmd.person, people);
  if (!person.ok) return person.problem;

  const before = ((person.item as unknown as Record<string, unknown>)[cmd.field] ?? '') as string;
  if (before.trim() === cmd.value.trim()) {
    return problem('لا تغيير', `${FIELD_LABELS[cmd.field]} لـ${person.item.name} هي «${cmd.value}» أصلاً.`);
  }

  const ops: Op[] = [
    { table: 'beneficiaries', action: 'update', match: { id: person.item.id }, values: { [cmd.field]: cmd.value } },
  ];

  return {
    type: 'plan',
    command: 'set_person_field',
    title: `تعديل ${FIELD_LABELS[cmd.field]}`,
    summary: `${person.item.name}: «${before || '—'}» → «${cmd.value}»`,
    steps: [
      {
        tone: 'change',
        text: `تغيير ${FIELD_LABELS[cmd.field]} لـ${person.item.name} من «${before || 'فارغ'}» إلى «${cmd.value}».`,
      },
    ],
    warnings: [],
    permission: personPermission(person.item),
    ops,
    activity: [
      {
        action: 'update',
        entity_type: entityOf(person.item.entity_type),
        entity_id: person.item.id,
        entity_name: person.item.name,
        details: { [FIELD_LABELS[cmd.field]]: cmd.value },
      },
    ],
    signature: signOps(ops),
  };
}

async function resolveWeekNumber(
  supabase: SupabaseClient,
  week: number | 'current' | 'next',
  now: Date,
): Promise<{ ok: true; week: number; note?: string } | { ok: false; problem: PlanProblem }> {
  if (typeof week === 'number') return { ok: true, week };
  const anchor = await resolveCycleAnchor(supabase, now);
  const r = resolveWeeks({ mode: week }, anchor);
  if (r.needsAnchor || r.weeks.length === 0) {
    return {
      ok: false,
      problem: problem('حدّد الأسبوع', r.note ?? 'ما قدرت أحدّد الأسبوع الحالي — اذكره صراحةً (مثلاً: «الأسبوع الثالث»).'),
    };
  }
  return { ok: true, week: r.weeks[0], note: r.note };
}

async function planAddMenuItem(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'add_menu_item' }>,
  now: Date,
): Promise<PlanResult> {
  const meals = await loadMeals(supabase);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const wk = await resolveWeekNumber(supabase, cmd.week, now);
  if (!wk.ok) return wk.problem;

  const entityType = cmd.entityType ?? entityOf(meal.item.entity_type);
  const category: ItemCategory = cmd.category ?? meal.item.category ?? (meal.item.is_snack ? 'snack' : 'hot');

  const { data: slotRaw } = await supabase
    .from('menu_items')
    .select('*')
    .eq('week_number', wk.week)
    .eq('meal_type', cmd.mealType);
  const slotRows = (slotRaw as unknown as Array<{ id: string; day_of_week: number; meal_id: string; position?: number; entity_type?: string }>) ?? [];

  const steps: PlanStep[] = [];
  const ops: Op[] = [];
  const activity: ActivityMeta[] = [];
  const warnings: string[] = [];
  if (wk.note) warnings.push(wk.note);

  for (const day of cmd.days) {
    const inSlot = slotRows.filter((r) => r.day_of_week === day && entityOf(r.entity_type) === entityType);
    if (inSlot.some((r) => r.meal_id === meal.item.id)) {
      steps.push({ tone: 'change', text: `${dayLabel(day)}: «${meal.item.name}» موجود مسبقاً — لا تغيير.` });
      continue;
    }
    const position = (category === 'snack' ? 100 : 0) + inSlot.length;
    steps.push({
      tone: 'add',
      text: `الأسبوع ${wk.week} — ${dayLabel(day)} (${MEAL_TYPE_LABELS[cmd.mealType]}): إضافة «${meal.item.name}».`,
    });
    ops.push({
      table: 'menu_items',
      action: 'insert',
      values: {
        week_number: wk.week,
        day_of_week: day,
        meal_type: cmd.mealType,
        meal_id: meal.item.id,
        category,
        position,
        entity_type: entityType,
      },
    });
    activity.push({
      action: 'create',
      entity_type: 'meal',
      entity_name: `قائمة الطعام — الأسبوع ${wk.week} ${dayLabel(day)}`,
      details: { الصنف: meal.item.name, الوجبة: MEAL_TYPE_LABELS[cmd.mealType], source: 'assistant' },
    });
  }

  if (ops.length === 0) {
    return problem('لا جديد', `«${meal.item.name}» موجود مسبقاً في كل الخانات المطلوبة.`);
  }

  return {
    type: 'plan',
    command: 'add_menu_item',
    title: 'إضافة للقائمة',
    summary: `«${meal.item.name}» → الأسبوع ${wk.week}، ${daysLabel(cmd.days)}، ${MEAL_TYPE_LABELS[cmd.mealType]}`,
    steps,
    warnings,
    permission: { page: 'menu', action: 'edit' },
    ops,
    activity,
    signature: signOps(ops),
  };
}

async function planRemoveMenuItem(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'remove_menu_item' }>,
  now: Date,
): Promise<PlanResult> {
  const meals = await loadMeals(supabase);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const wk = await resolveWeekNumber(supabase, cmd.week, now);
  if (!wk.ok) return wk.problem;

  const { data: rowsRaw } = await supabase
    .from('menu_items')
    .select('*')
    .eq('week_number', wk.week)
    .eq('meal_id', meal.item.id);

  let rows = (rowsRaw as unknown as Array<{ id: string; day_of_week: number; meal_type: MealType; entity_type?: string }>) ?? [];
  rows = rows.filter((r) => cmd.days.includes(r.day_of_week));
  if (cmd.mealType) rows = rows.filter((r) => r.meal_type === cmd.mealType);
  if (cmd.entityType) rows = rows.filter((r) => entityOf(r.entity_type) === cmd.entityType);

  if (rows.length === 0) {
    return problem('لا يوجد ما يُحذف', `«${meal.item.name}» غير موجود في الأسبوع ${wk.week} — ${daysLabel(cmd.days)}.`);
  }

  const ops: Op[] = rows.map((r) => ({ table: 'menu_items', action: 'delete' as const, match: { id: r.id } }));

  return {
    type: 'plan',
    command: 'remove_menu_item',
    title: 'حذف من القائمة',
    summary: `«${meal.item.name}» من الأسبوع ${wk.week}، ${daysLabel(cmd.days)}`,
    steps: rows.map((r) => ({
      tone: 'remove' as const,
      text: `الأسبوع ${wk.week} — ${dayLabel(r.day_of_week)} (${MEAL_TYPE_LABELS[r.meal_type] ?? r.meal_type}): حذف «${meal.item.name}».`,
    })),
    warnings: wk.note ? [wk.note] : [],
    permission: { page: 'menu', action: 'edit' },
    ops,
    activity: rows.map((r) => ({
      action: 'delete' as const,
      entity_type: 'meal' as const,
      entity_name: `قائمة الطعام — الأسبوع ${wk.week} ${dayLabel(r.day_of_week)}`,
      details: { الصنف: meal.item.name, source: 'assistant' },
    })),
    signature: signOps(ops),
  };
}

async function planCreateMeal(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'create_meal' }>,
): Promise<PlanResult> {
  const meals = await loadMeals(supabase);
  const dup = resolveOne(cmd.name, meals, (m) => [m.name], { confident: 0.95 });
  if (dup.status === 'found') {
    return problem('الصنف موجود', `فيه صنف باسم «${dup.item.name}» أصلاً.`);
  }

  const category: ItemCategory = cmd.category ?? 'hot';
  const entityType = cmd.entityType ?? 'beneficiary';
  const ops: Op[] = [
    {
      table: 'meals',
      action: 'insert',
      values: {
        name: cmd.name,
        type: cmd.mealType,
        is_snack: category === 'snack',
        category,
        entity_type: entityType,
      },
    },
  ];

  return {
    type: 'plan',
    command: 'create_meal',
    title: 'صنف جديد',
    summary: `«${cmd.name}» — ${MEAL_TYPE_LABELS[cmd.mealType]}`,
    steps: [
      {
        tone: 'add',
        text: `إنشاء صنف «${cmd.name}» (${MEAL_TYPE_LABELS[cmd.mealType]}، تصنيف ${category === 'hot' ? 'حار' : category === 'cold' ? 'بارد' : 'سناك'}, ${ENTITY_TYPE_LABELS[entityType]}).`,
      },
    ],
    warnings: cmd.category ? [] : ['ما ذكرت التصنيف — استُخدم «حار» افتراضياً. تقدر تعدّله من صفحة الأصناف.'],
    permission: { page: 'meals', action: 'add' },
    ops,
    activity: [{ action: 'create', entity_type: 'meal', entity_name: cmd.name, details: { source: 'assistant' } }],
    signature: signOps(ops),
  };
}


// ── أوامر الأشخاص الإضافية ────────────────────────────────────────────────

async function planCreatePerson(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'create_person' }>,
): Promise<PlanResult> {
  const people = await loadPeople(supabase);
  const dupCode = people.find((p) => (p.code ?? '').trim() === cmd.code.trim());
  if (dupCode) {
    return problem('الكود مستخدم', `الكود «${cmd.code}» مسجّل مسبقاً لـ${dupCode.name}. اختر كوداً آخر.`);
  }
  const dupName = resolveOne(cmd.name, people, (p) => [p.name], { confident: 0.95 });
  const warnings: string[] = [];
  if (dupName.status === 'found') warnings.push(`فيه شخص باسم «${dupName.item.name}» مسجّل مسبقاً.`);

  const label = ENTITY_TYPE_LABELS[cmd.entityType];
  const ops: Op[] = [
    {
      table: 'beneficiaries',
      action: 'insert',
      values: {
        name: cmd.name,
        code: cmd.code,
        category: 'عام',
        entity_type: cmd.entityType,
        villa: cmd.villa ?? null,
        diet_type: cmd.dietType ?? null,
        is_active: true,
      },
    },
  ];

  return {
    type: 'plan',
    command: 'create_person',
    title: `${label} جديد`,
    summary: `${cmd.name} — كود ${cmd.code}`,
    steps: [{ tone: 'add', text: `إنشاء ${label} «${cmd.name}» بالكود ${cmd.code}.` }],
    warnings: [...warnings, 'الفئة الافتراضية «عام» — عدّلها من صفحة المستفيدين لو تحتاج.'],
    permission: { page: cmd.entityType === 'companion' ? 'companions' : 'beneficiaries', action: 'add' },
    ops,
    activity: [{ action: 'create', entity_type: cmd.entityType, entity_name: cmd.name, details: { الكود: cmd.code } }],
    signature: signOps(ops),
  };
}

async function planDeletePerson(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'delete_person' }>,
): Promise<PlanResult> {
  const people = await loadPeople(supabase);
  const person = resolvePerson(cmd.person, people);
  if (!person.ok) return person.problem;

  const [{ data: exRaw }, { data: fxRaw }] = await Promise.all([
    supabase.from('exclusions').select('*').eq('beneficiary_id', person.item.id),
    supabase.from('beneficiary_fixed_meals').select('*').eq('beneficiary_id', person.item.id),
  ]);
  const exCount = ((exRaw as unknown as unknown[]) ?? []).length;
  const fxCount = ((fxRaw as unknown as unknown[]) ?? []).length;

  const ops: Op[] = [{ table: 'beneficiaries', action: 'delete', match: { id: person.item.id } }];
  const warnings = [
    'الحذف نهائي ولا يمكن التراجع عنه. لو تبي إخراجه من الأوامر مؤقتاً فقط، استخدم «عطّل» بدل الحذف.',
  ];
  if (exCount + fxCount > 0) {
    warnings.push(`سيُحذف معه ${num(exCount)} استثناء و${num(fxCount)} صنف ثابت.`);
  }

  return {
    type: 'plan',
    command: 'delete_person',
    title: 'حذف نهائي',
    summary: `${person.item.name} (${ENTITY_TYPE_LABELS[entityOf(person.item.entity_type)]})`,
    steps: [{ tone: 'remove', text: `حذف ${person.item.name} نهائياً من النظام.` }],
    warnings,
    permission: {
      page: entityOf(person.item.entity_type) === 'companion' ? 'companions' : 'beneficiaries',
      action: 'delete',
    },
    ops,
    activity: [
      {
        action: 'delete',
        entity_type: entityOf(person.item.entity_type),
        entity_id: person.item.id,
        entity_name: person.item.name,
      },
    ],
    signature: signOps(ops),
  };
}

async function planStickerFlag(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'set_sticker_flag' }>,
): Promise<PlanResult> {
  const people = await loadPeople(supabase);
  const person = resolvePerson(cmd.person, people);
  if (!person.ok) return person.problem;

  const flag = STICKER_FLAGS.find((f) => f.key === cmd.flag);
  const label = flag?.label ?? cmd.flag;
  const current = Boolean((person.item as unknown as Record<string, unknown>)[cmd.flag]);
  if (current === cmd.value) {
    return problem('لا تغيير', `خيار «${label}» ${cmd.value ? 'مفعّل' : 'مطفأ'} أصلاً عند ${person.item.name}.`);
  }

  const ops: Op[] = [
    { table: 'beneficiaries', action: 'update', match: { id: person.item.id }, values: { [cmd.flag]: cmd.value } },
  ];

  return {
    type: 'plan',
    command: 'set_sticker_flag',
    title: 'خيار ستيكر',
    summary: `${person.item.name} — ${label}: ${cmd.value ? 'تفعيل' : 'إلغاء'}`,
    steps: [
      {
        tone: 'change',
        text: `${cmd.value ? 'تفعيل' : 'إلغاء'} خيار «${label}» لـ${person.item.name} — ينعكس على ستيكرات الغداء والعشاء${flag ? ` (الرمز ${flag.symbol})` : ''}.`,
      },
    ],
    warnings: [],
    permission: personPermission(person.item),
    ops,
    activity: [
      {
        action: 'update',
        entity_type: entityOf(person.item.entity_type),
        entity_id: person.item.id,
        entity_name: person.item.name,
        details: { [label]: cmd.value ? 'نعم' : 'لا' },
      },
    ],
    signature: signOps(ops),
  };
}

// ── أوامر الأصناف ─────────────────────────────────────────────────────────

async function planUpdateMeal(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'update_meal' }>,
): Promise<PlanResult> {
  const meals = await loadMeals(supabase);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const values: Record<string, unknown> = {};
  const steps: PlanStep[] = [];

  if (cmd.newName && cmd.newName !== meal.item.name) {
    values.name = cmd.newName;
    steps.push({ tone: 'change', text: `تغيير الاسم من «${meal.item.name}» إلى «${cmd.newName}».` });
  }
  if (cmd.mealType && cmd.mealType !== meal.item.type) {
    values.type = cmd.mealType;
    steps.push({ tone: 'change', text: `تغيير الوجبة إلى ${MEAL_TYPE_LABELS[cmd.mealType]}.` });
  }
  if (cmd.category && cmd.category !== meal.item.category) {
    values.category = cmd.category;
    values.is_snack = cmd.category === 'snack';
    steps.push({ tone: 'change', text: `تغيير التصنيف إلى ${CATEGORY_LABELS[cmd.category]}.` });
  }

  if (steps.length === 0) return problem('لا تغيير', `«${meal.item.name}» بالفعل على هذه القيم.`);

  const ops: Op[] = [{ table: 'meals', action: 'update', match: { id: meal.item.id }, values }];

  return {
    type: 'plan',
    command: 'update_meal',
    title: 'تعديل صنف',
    summary: meal.item.name,
    steps,
    warnings: values.name
      ? ['تغيير الاسم ينعكس على القائمة والأوامر والتقارير التي تعرض هذا الصنف.']
      : [],
    permission: { page: 'meals', action: 'edit' },
    ops,
    activity: [
      { action: 'update', entity_type: 'meal', entity_id: meal.item.id, entity_name: meal.item.name, details: values },
    ],
    signature: signOps(ops),
  };
}

async function planDeleteMeal(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'delete_meal' }>,
): Promise<PlanResult> {
  const meals = await loadMeals(supabase);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const [{ data: menuRaw }, { data: exRaw }, { data: fxRaw }] = await Promise.all([
    supabase.from('menu_items').select('*').eq('meal_id', meal.item.id),
    supabase.from('exclusions').select('*').eq('meal_id', meal.item.id),
    supabase.from('beneficiary_fixed_meals').select('*').eq('meal_id', meal.item.id),
  ]);
  const inMenu = ((menuRaw as unknown as unknown[]) ?? []).length;
  const inExcl = ((exRaw as unknown as unknown[]) ?? []).length;
  const inFixed = ((fxRaw as unknown as unknown[]) ?? []).length;

  const warnings = ['الحذف نهائي ولا يمكن التراجع عنه.'];
  if (inMenu + inExcl + inFixed > 0) {
    warnings.push(
      `الصنف مستخدم حالياً: ${num(inMenu)} خانة في القائمة، ${num(inExcl)} استثناء، ${num(inFixed)} صنف ثابت — وكلها ستُحذف معه.`,
    );
  }

  const ops: Op[] = [{ table: 'meals', action: 'delete', match: { id: meal.item.id } }];

  return {
    type: 'plan',
    command: 'delete_meal',
    title: 'حذف صنف',
    summary: meal.item.name,
    steps: [{ tone: 'remove', text: `حذف صنف «${meal.item.name}» نهائياً.` }],
    warnings,
    permission: { page: 'meals', action: 'delete' },
    ops,
    activity: [{ action: 'delete', entity_type: 'meal', entity_id: meal.item.id, entity_name: meal.item.name }],
    signature: signOps(ops),
  };
}

// ── أوامر القائمة الإضافية ────────────────────────────────────────────────

async function planMenuMultiplier(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'set_menu_multiplier' }>,
  now: Date,
): Promise<PlanResult> {
  const meals = await loadMeals(supabase);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const wk = await resolveWeekNumber(supabase, cmd.week, now);
  if (!wk.ok) return wk.problem;

  const { data: rowsRaw } = await supabase
    .from('menu_items')
    .select('*')
    .eq('week_number', wk.week)
    .eq('meal_id', meal.item.id);

  let rows = (rowsRaw as unknown as Array<{ id: string; day_of_week: number; meal_type: MealType; multiplier?: number }>) ?? [];
  rows = rows.filter((r) => cmd.days.includes(r.day_of_week));
  if (cmd.mealType) rows = rows.filter((r) => r.meal_type === cmd.mealType);

  if (rows.length === 0) {
    return problem('غير موجود في القائمة', `«${meal.item.name}» غير مُدرَج في الأسبوع ${wk.week} — ${daysLabel(cmd.days)}.`);
  }

  const changed = rows.filter((r) => Math.max(1, r.multiplier ?? 1) !== cmd.value);
  if (changed.length === 0) return problem('لا تغيير', `المضاعف بالفعل ×${cmd.value}.`);

  const ops: Op[] = changed.map((r) => ({
    table: 'menu_items',
    action: 'update' as const,
    match: { id: r.id },
    values: { multiplier: cmd.value },
  }));

  return {
    type: 'plan',
    command: 'set_menu_multiplier',
    title: 'مضاعف الصنف',
    summary: `«${meal.item.name}» → ×${cmd.value} — الأسبوع ${wk.week}، ${daysLabel(cmd.days)}`,
    steps: changed.map((r) => ({
      tone: 'change' as const,
      text: `${dayLabel(r.day_of_week)} (${MEAL_TYPE_LABELS[r.meal_type] ?? r.meal_type}): المضاعف من ×${Math.max(1, r.multiplier ?? 1)} إلى ×${cmd.value}.`,
    })),
    warnings: [
      ...(wk.note ? [wk.note] : []),
      'المضاعف يزيد كمية الطبخ فقط — لا يؤثر على ستيكرات المستفيدين.',
    ],
    permission: { page: 'menu', action: 'edit' },
    ops,
    activity: changed.map((r) => ({
      action: 'update' as const,
      entity_type: 'meal' as const,
      entity_name: `قائمة الطعام — الأسبوع ${wk.week} ${dayLabel(r.day_of_week)}`,
      details: { الصنف: meal.item.name, المضاعف: cmd.value, source: 'assistant' },
    })),
    signature: signOps(ops),
  };
}

async function planClearSlot(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'clear_menu_slot' }>,
  now: Date,
): Promise<PlanResult> {
  const wk = await resolveWeekNumber(supabase, cmd.week, now);
  if (!wk.ok) return wk.problem;

  const { data: rowsRaw } = await supabase
    .from('menu_items')
    .select('*, meals(*)')
    .eq('week_number', wk.week)
    .eq('meal_type', cmd.mealType);

  let rows = (rowsRaw as unknown as Array<{ id: string; day_of_week: number; entity_type?: string; meals?: { name?: string } }>) ?? [];
  rows = rows.filter((r) => cmd.days.includes(r.day_of_week));
  if (cmd.entityType) rows = rows.filter((r) => entityOf(r.entity_type) === cmd.entityType);

  if (rows.length === 0) {
    return problem('الخانة فارغة أصلاً', `ما فيه أصناف في ${MEAL_TYPE_LABELS[cmd.mealType]} ${daysLabel(cmd.days)} — الأسبوع ${wk.week}.`);
  }

  const ops: Op[] = rows.map((r) => ({ table: 'menu_items', action: 'delete' as const, match: { id: r.id } }));

  return {
    type: 'plan',
    command: 'clear_menu_slot',
    title: 'تفريغ خانة القائمة',
    summary: `${MEAL_TYPE_LABELS[cmd.mealType]} ${daysLabel(cmd.days)} — الأسبوع ${wk.week}`,
    steps: rows.map((r) => ({
      tone: 'remove' as const,
      text: `${dayLabel(r.day_of_week)}: حذف «${r.meals?.name ?? 'صنف'}».`,
    })),
    warnings: [...(wk.note ? [wk.note] : []), `سيُحذف ${num(rows.length)} صنف من القائمة.`],
    permission: { page: 'menu', action: 'edit' },
    ops,
    activity: [
      {
        action: 'delete',
        entity_type: 'meal',
        entity_name: `قائمة الطعام — الأسبوع ${wk.week} ${daysLabel(cmd.days)}`,
        details: { الوجبة: MEAL_TYPE_LABELS[cmd.mealType], العدد: rows.length, source: 'assistant' },
      },
    ],
    signature: signOps(ops),
  };
}


// ── أوامر التشغيل ─────────────────────────────────────────────────────────

const DAY_MS = 86400000;

/** يحوّل «اليوم/بكرة/أمس» أو ISO إلى YYYY-MM-DD بتوقيت UTC. */
function resolveDateToken(token: string, now: Date): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  const base = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const shift = token === 'tomorrow' ? 1 : token === 'yesterday' ? -1 : token === 'today' ? 0 : null;
  if (shift === null) return null;
  return new Date(base.getTime() + shift * DAY_MS).toISOString().slice(0, 10);
}

interface OrderRow {
  id: string;
  date: string;
  meal_type: MealType;
  week_number?: number | null;
  day_of_week?: number | null;
  entity_type?: string | null;
}

async function findOrder(
  supabase: SupabaseClient,
  date: string,
  mealType: MealType,
  entityType?: EntityType,
): Promise<OrderRow | undefined> {
  const { data } = await supabase.from('daily_orders').select('*').eq('date', date).eq('meal_type', mealType);
  const rows = (data as unknown as OrderRow[]) ?? [];
  return entityType ? rows.find((r) => entityOf(r.entity_type) === entityType) : rows[0];
}

async function planCreateOrder(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'create_order' }>,
  now: Date,
): Promise<PlanResult> {
  const date = resolveDateToken(cmd.date, now);
  if (!date) return problem('تاريخ غير مفهوم', `ما قدرت أفهم التاريخ «${cmd.date}».`);

  const existing = await findOrder(supabase, date, cmd.mealType, cmd.entityType);
  if (existing) {
    return problem(
      'الأمر موجود',
      `فيه أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date} مسجّل مسبقاً. تقدر تضيف أصنافاً له أو تحذفه.`,
    );
  }

  // يوم الأسبوع من التاريخ، ورقم الأسبوع من دورة القائمة
  const target = parseIsoDate(date)!;
  const dayOfWeek = target.getUTCDay();
  const anchor = await resolveCycleAnchor(supabase, now);
  const week = anchor ? cycleWeekFor(parseIsoDate(anchor.anchorDate)!, anchor.anchorWeek, target) : null;

  const warnings: string[] = [];
  if (!week) {
    warnings.push('ما قدرت أحدّد رقم الأسبوع في الدورة — سيُنشأ الأمر بلا أصناف، عبّئه من صفحة أوامر التشغيل.');
  }

  // تعبئة الأصناف من القائمة لنفس (الأسبوع، اليوم، الوجبة)
  let menuRows: Array<{ meal_id: string; category?: ItemCategory | null; multiplier?: number | null; entity_type?: string | null; meals?: { name?: string } }> = [];
  if (week) {
    const { data } = await supabase
      .from('menu_items')
      .select('*, meals(*)')
      .eq('week_number', week)
      .eq('day_of_week', dayOfWeek)
      .eq('meal_type', cmd.mealType);
    menuRows = ((data as unknown as typeof menuRows) ?? []).filter(
      (r) => entityOf(r.entity_type) === cmd.entityType,
    );
  }

  const ops: Op[] = [
    {
      table: 'daily_orders',
      action: 'insert',
      values: {
        date,
        meal_type: cmd.mealType,
        week_number: week,
        day_of_week: dayOfWeek,
        entity_type: cmd.entityType,
      },
    },
  ];

  const steps: PlanStep[] = [
    {
      tone: 'add',
      text: `إنشاء أمر ${MEAL_TYPE_LABELS[cmd.mealType]} (${ENTITY_TYPE_LABELS[cmd.entityType]}) بتاريخ ${date} — ${dayLabel(dayOfWeek)}${week ? `، الأسبوع ${week}` : ''}.`,
    },
  ];

  if (menuRows.length > 0) {
    steps.push({
      tone: 'add',
      text: `تعبئة ${num(menuRows.length)} صنف من القائمة: ${menuRows.map((r) => r.meals?.name ?? '—').join('، ')}.`,
    });
    warnings.push('الأصناف تُنسخ من قائمة الطعام لهذا اليوم — تقدر تعدّلها بعدها من صفحة أوامر التشغيل.');
  } else if (week) {
    warnings.push(`ما فيه أصناف في القائمة للأسبوع ${week} — ${dayLabel(dayOfWeek)} ${MEAL_TYPE_LABELS[cmd.mealType]}، فالأمر بينشأ فاضياً.`);
  }

  return {
    type: 'plan',
    command: 'create_order',
    title: 'أمر تشغيل جديد',
    summary: `${MEAL_TYPE_LABELS[cmd.mealType]} — ${date}`,
    steps,
    warnings,
    permission: { page: 'orders', action: 'add' },
    ops,
    // بنود الأمر تحتاج معرّف الأمر بعد إنشائه، فتُترك لصفحة الأوامر
    activity: [
      {
        action: 'create',
        entity_type: 'meal',
        entity_name: `أمر تشغيل ${MEAL_TYPE_LABELS[cmd.mealType]} — ${date}`,
        details: { التاريخ: date, الوجبة: MEAL_TYPE_LABELS[cmd.mealType], source: 'assistant' },
      },
    ],
    signature: signOps(ops),
  };
}

async function planDeleteOrder(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'delete_order' }>,
  now: Date,
): Promise<PlanResult> {
  const date = resolveDateToken(cmd.date, now);
  if (!date) return problem('تاريخ غير مفهوم', `ما قدرت أفهم التاريخ «${cmd.date}».`);

  const order = await findOrder(supabase, date, cmd.mealType, cmd.entityType);
  if (!order) {
    return problem('لا يوجد أمر', `ما فيه أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date}.`);
  }

  const { data: itemsRaw } = await supabase.from('order_items').select('*').eq('order_id', order.id);
  const itemCount = ((itemsRaw as unknown as unknown[]) ?? []).length;

  const ops: Op[] = [{ table: 'daily_orders', action: 'delete', match: { id: order.id } }];

  return {
    type: 'plan',
    command: 'delete_order',
    title: 'حذف أمر تشغيل',
    summary: `${MEAL_TYPE_LABELS[cmd.mealType]} — ${date}`,
    steps: [{ tone: 'remove', text: `حذف أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date} وكل بنوده.` }],
    warnings: [
      'الحذف نهائي — والتقارير والستيكرات المبنية على هذا الأمر ما تعود تشتغل.',
      ...(itemCount > 0 ? [`سيُحذف معه ${num(itemCount)} بند.`] : []),
    ],
    permission: { page: 'orders', action: 'delete' },
    ops,
    activity: [
      {
        action: 'delete',
        entity_type: 'meal',
        entity_id: order.id,
        entity_name: `أمر تشغيل ${MEAL_TYPE_LABELS[cmd.mealType]} — ${date}`,
        details: { source: 'assistant' },
      },
    ],
    signature: signOps(ops),
  };
}

async function planOrderItem(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'add_order_item' | 'remove_order_item' }>,
  now: Date,
): Promise<PlanResult> {
  const date = resolveDateToken(cmd.date, now);
  if (!date) return problem('تاريخ غير مفهوم', `ما قدرت أفهم التاريخ «${cmd.date}».`);

  const meals = await loadMeals(supabase);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف');
  if (!meal.ok) return meal.problem;

  const order = await findOrder(supabase, date, cmd.mealType, cmd.entityType);
  if (!order) {
    return problem(
      'لا يوجد أمر',
      `ما فيه أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date}. أنشئه أولاً: «أنشئ أمر ${MEAL_TYPE_LABELS[cmd.mealType]} ${cmd.date}».`,
    );
  }

  const { data: itemsRaw } = await supabase.from('order_items').select('*').eq('order_id', order.id);
  const items = (itemsRaw as unknown as Array<{ id: string; meal_id: string }>) ?? [];
  const existing = items.find((i) => i.meal_id === meal.item.id);

  if (cmd.kind === 'remove_order_item') {
    if (!existing) {
      return problem('غير موجود', `«${meal.item.name}» غير موجود في أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date}.`);
    }
    const ops: Op[] = [{ table: 'order_items', action: 'delete', match: { id: existing.id } }];
    return {
      type: 'plan',
      command: 'remove_order_item',
      title: 'حذف صنف من الأمر',
      summary: `«${meal.item.name}» من ${MEAL_TYPE_LABELS[cmd.mealType]} ${date}`,
      steps: [{ tone: 'remove', text: `حذف «${meal.item.name}» من أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date}.` }],
      warnings: ['التقرير والستيكرات المبنية على هذا الأمر تتغيّر فوراً.'],
      permission: { page: 'orders', action: 'edit' },
      ops,
      activity: [
        {
          action: 'update',
          entity_type: 'meal',
          entity_id: order.id,
          entity_name: `أمر تشغيل ${MEAL_TYPE_LABELS[cmd.mealType]} — ${date}`,
          details: { حُذف: meal.item.name, source: 'assistant' },
        },
      ],
      signature: signOps(ops),
    };
  }

  if (existing) {
    return problem('موجود مسبقاً', `«${meal.item.name}» موجود أصلاً في أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date}.`);
  }

  const category: ItemCategory = meal.item.category ?? (meal.item.is_snack ? 'snack' : 'hot');
  const ops: Op[] = [
    {
      table: 'order_items',
      action: 'insert',
      values: { order_id: order.id, meal_id: meal.item.id, category, multiplier: 1, extra_quantity: 0 },
    },
  ];

  return {
    type: 'plan',
    command: 'add_order_item',
    title: 'إضافة صنف للأمر',
    summary: `«${meal.item.name}» إلى ${MEAL_TYPE_LABELS[cmd.mealType]} ${date}`,
    steps: [
      {
        tone: 'add',
        text: `إضافة «${meal.item.name}» (${CATEGORY_LABELS[category]}) إلى أمر ${MEAL_TYPE_LABELS[cmd.mealType]} بتاريخ ${date}.`,
      },
    ],
    warnings: ['يُحتسب لكل مستفيد غير مستثنى من الصنف — راجع التقرير بعد الإضافة.'],
    permission: { page: 'orders', action: 'edit' },
    ops,
    activity: [
      {
        action: 'update',
        entity_type: 'meal',
        entity_id: order.id,
        entity_name: `أمر تشغيل ${MEAL_TYPE_LABELS[cmd.mealType]} — ${date}`,
        details: { أُضيف: meal.item.name, source: 'assistant' },
      },
    ],
    signature: signOps(ops),
  };
}

// ── الأوامر الجماعية ──────────────────────────────────────────────────────

function describeGroup(g: GroupTarget): string {
  const parts: string[] = [];
  if (g.entityType) parts.push(ENTITY_TYPE_LABELS[g.entityType]);
  if (g.villa) parts.push(`فيلا ${g.villa}`);
  if (g.diet) parts.push(`حمية ${g.diet}`);
  return parts.length ? parts.join(' — ') : 'كل المستفيدين والمرافقين';
}

function selectGroup(people: PersonRow[], g: GroupTarget): PersonRow[] {
  return people.filter((p) => {
    if (!p.is_active && p.is_active !== undefined && p.is_active !== null) return false;
    if (g.entityType && entityOf(p.entity_type) !== g.entityType) return false;
    if (g.villa && (p.villa ?? '').trim() !== g.villa.trim()) return false;
    if (g.diet && (p.diet_type ?? '').trim() !== g.diet.trim()) return false;
    return true;
  });
}

/** حد أعلى للعمليات الجماعية — حماية من أمر يمسّ النظام كله بالغلط. */
const BULK_LIMIT = 200;

async function planBulkExclusion(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'bulk_exclusion' }>,
): Promise<PlanResult> {
  const [meals, people] = await Promise.all([loadMeals(supabase), loadPeople(supabase)]);
  const meal = resolveMeal(cmd.meal, meals, 'الصنف الممنوع');
  if (!meal.ok) return meal.problem;

  let alt: MealRow | null = null;
  if (cmd.alternative) {
    const a = resolveMeal(cmd.alternative, meals, 'الصنف البديل');
    if (!a.ok) return a.problem;
    alt = a.item;
  }

  const targets = selectGroup(people, cmd.group);
  if (targets.length === 0) {
    return problem('المجموعة فارغة', `ما فيه أحد نشط ضمن «${describeGroup(cmd.group)}».`);
  }
  if (targets.length > BULK_LIMIT) {
    return problem('المجموعة كبيرة جداً', `الأمر يشمل ${num(targets.length)} شخصاً — الحد ${num(BULK_LIMIT)}. ضيّق الفلتر.`);
  }

  const { data: exRaw } = await supabase.from('exclusions').select('*').eq('meal_id', meal.item.id);
  const existing = (exRaw as unknown as Array<{ id: string; beneficiary_id: string; alternative_meal_id: string | null }>) ?? [];
  const byPerson = new Map(existing.map((e) => [e.beneficiary_id, e]));

  const ops: Op[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const p of targets) {
    const row = byPerson.get(p.id);
    if (!row) {
      ops.push({
        table: 'exclusions',
        action: 'insert',
        values: { beneficiary_id: p.id, meal_id: meal.item.id, alternative_meal_id: alt?.id ?? null },
      });
      added++;
    } else if ((row.alternative_meal_id ?? null) !== (alt?.id ?? null)) {
      ops.push({
        table: 'exclusions',
        action: 'update',
        match: { id: row.id },
        values: { alternative_meal_id: alt?.id ?? null },
      });
      updated++;
    } else {
      unchanged++;
    }
  }

  if (ops.length === 0) {
    return problem('لا جديد', `«${meal.item.name}» ممنوع أصلاً عن كل من في «${describeGroup(cmd.group)}» بنفس البديل.`);
  }

  const steps: PlanStep[] = [];
  if (added > 0) steps.push({ tone: 'add', text: `منع «${meal.item.name}» عن ${num(added)} شخصاً${alt ? ` وإعطاؤهم «${alt.name}»` : ''}.` });
  if (updated > 0) steps.push({ tone: 'change', text: `تحديث البديل لـ${num(updated)} شخصاً موجود عندهم المنع مسبقاً.` });
  if (unchanged > 0) steps.push({ tone: 'change', text: `${num(unchanged)} شخصاً بلا تغيير (المنع مطابق أصلاً).` });

  const names = targets.slice(0, 12).map((p) => p.name).join('، ');

  return {
    type: 'plan',
    command: 'bulk_exclusion',
    title: 'منع جماعي',
    summary: `«${meal.item.name}»${alt ? ` → ${alt.name}` : ''} عن ${describeGroup(cmd.group)} (${num(targets.length)} شخص)`,
    steps,
    warnings: [
      `المشمولون: ${names}${targets.length > 12 ? ` و${num(targets.length - 12)} آخرين` : ''}.`,
      'عملية جماعية — راجع القائمة قبل التأكيد. تقدر تتراجع بعدها بضغطة واحدة.',
    ],
    permission: {
      page: cmd.group.entityType === 'companion' ? 'companions' : 'beneficiaries',
      action: 'edit',
    },
    ops,
    activity: [
      {
        action: 'update',
        entity_type: 'exclusion',
        entity_name: `منع جماعي — ${meal.item.name}`,
        details: { المجموعة: describeGroup(cmd.group), العدد: targets.length, البديل: alt?.name ?? 'بدون', source: 'assistant' },
      },
    ],
    signature: signOps(ops),
  };
}

async function planBulkStatus(
  supabase: SupabaseClient,
  cmd: Extract<Command, { kind: 'bulk_status' }>,
): Promise<PlanResult> {
  const people = await loadPeople(supabase);

  // التفعيل يستهدف المعطّلين، والتعطيل يستهدف النشطين
  const inScope = people.filter((p) => {
    if (cmd.group.entityType && entityOf(p.entity_type) !== cmd.group.entityType) return false;
    if (cmd.group.villa && (p.villa ?? '').trim() !== cmd.group.villa.trim()) return false;
    return true;
  });
  const targets = inScope.filter((p) => (p.is_active !== false) !== cmd.active);

  if (targets.length === 0) {
    return problem('لا تغيير', `كل من في «${describeGroup(cmd.group)}» ${cmd.active ? 'مفعّل' : 'معطّل'} أصلاً.`);
  }
  if (targets.length > BULK_LIMIT) {
    return problem('المجموعة كبيرة جداً', `الأمر يشمل ${num(targets.length)} شخصاً — الحد ${num(BULK_LIMIT)}.`);
  }

  const ops: Op[] = targets.map((p) => ({
    table: 'beneficiaries',
    action: 'update' as const,
    match: { id: p.id },
    values: { is_active: cmd.active },
  }));

  const names = targets.slice(0, 12).map((p) => p.name).join('، ');

  return {
    type: 'plan',
    command: 'bulk_status',
    title: cmd.active ? 'تفعيل جماعي' : 'تعطيل جماعي',
    summary: `${describeGroup(cmd.group)} — ${num(targets.length)} شخص`,
    steps: [
      {
        tone: 'change',
        text: `${cmd.active ? 'تفعيل' : 'تعطيل'} ${num(targets.length)} شخصاً من «${describeGroup(cmd.group)}».`,
      },
    ],
    warnings: [
      `المشمولون: ${names}${targets.length > 12 ? ` و${num(targets.length - 12)} آخرين` : ''}.`,
      cmd.active
        ? 'يرجعون للاحتساب في الأوامر والستيكرات والتقارير فوراً.'
        : 'يخرجون من الأوامر والستيكرات والتقارير فوراً.',
    ],
    permission: {
      page: cmd.group.entityType === 'companion' ? 'companions' : 'beneficiaries',
      action: 'edit',
    },
    ops,
    activity: [
      {
        action: 'update',
        entity_type: cmd.group.entityType === 'companion' ? 'companion' : 'beneficiary',
        entity_name: `${cmd.active ? 'تفعيل' : 'تعطيل'} جماعي`,
        details: { المجموعة: describeGroup(cmd.group), العدد: targets.length, source: 'assistant' },
      },
    ],
    signature: signOps(ops),
  };
}

// ── نقطة الدخول ────────────────────────────────────────────────────────────

export function gapToProblem(g: CommandGap): PlanProblem {
  return problem('ينقص الأمر معلومة', g.hint);
}

export async function buildPlan(
  supabase: SupabaseClient,
  cmd: Command,
  now: Date = new Date(),
): Promise<PlanResult> {
  switch (cmd.kind) {
    case 'set_exclusion':
      return planSetExclusion(supabase, cmd);
    case 'clear_exclusion':
      return planClearExclusion(supabase, cmd);
    case 'add_fixed':
      return planAddFixed(supabase, cmd);
    case 'remove_fixed':
      return planRemoveFixed(supabase, cmd);
    case 'set_person_status':
      return planPersonStatus(supabase, cmd);
    case 'set_person_field':
      return planPersonField(supabase, cmd);
    case 'add_menu_item':
      return planAddMenuItem(supabase, cmd, now);
    case 'remove_menu_item':
      return planRemoveMenuItem(supabase, cmd, now);
    case 'create_meal':
      return planCreateMeal(supabase, cmd);
    case 'create_person':
      return planCreatePerson(supabase, cmd);
    case 'delete_person':
      return planDeletePerson(supabase, cmd);
    case 'set_sticker_flag':
      return planStickerFlag(supabase, cmd);
    case 'update_meal':
      return planUpdateMeal(supabase, cmd);
    case 'delete_meal':
      return planDeleteMeal(supabase, cmd);
    case 'set_menu_multiplier':
      return planMenuMultiplier(supabase, cmd, now);
    case 'clear_menu_slot':
      return planClearSlot(supabase, cmd, now);
    case 'create_order':
      return planCreateOrder(supabase, cmd, now);
    case 'delete_order':
      return planDeleteOrder(supabase, cmd, now);
    case 'add_order_item':
    case 'remove_order_item':
      return planOrderItem(supabase, cmd, now);
    case 'bulk_exclusion':
      return planBulkExclusion(supabase, cmd);
    case 'bulk_status':
      return planBulkStatus(supabase, cmd);
    case 'open_page':
      // التنقّل ليس عملية قاعدة بيانات — يُعالَج قبل الوصول إلى هنا
      return problem('تنقّل', cmd.label);
  }
}

/** يحلّل الجملة وإن كانت أمراً يبني خطته. يرجّع null لو ما كانت أمراً. */
export async function planFromText(
  supabase: SupabaseClient,
  text: string,
  now: Date = new Date(),
): Promise<PlanResult | null> {
  const cmd = parseCommand(text);
  if (!cmd) return null;
  if (cmd.kind === 'gap') return gapToProblem(cmd);
  return buildPlan(supabase, cmd, now);
}

// ── المسار الأساسي: الفهم بالارتساء + الحوار ───────────────────────────────

export type TurnResult =
  | { kind: 'plan'; plan: Plan; context: DialogContext; usedContext: string[] }
  | { kind: 'navigate'; href: string; label: string; permission: string | null; context: DialogContext }
  | {
      kind: 'ask';
      question: string;
      field: string;
      options: AskOption[];
      pending: Pending;
      context: DialogContext;
    }
  | { kind: 'problem'; problem: PlanProblem; context: DialogContext }
  | { kind: 'query' };

export interface TurnInput {
  text: string;
  context?: DialogContext;
  pending?: Pending;
  now?: Date;
}

/**
 * دور حواري كامل: يفهم النص بالارتساء بالكيانات، ويكمل جواب سؤال سابق إن
 * وُجد، ثم يبني الخطة. يرجّع 'query' لو ما كان أمراً — فيتولّاه محرّك
 * الاستعلام.
 */
export async function runTurn(supabase: SupabaseClient, input: TurnInput): Promise<TurnResult> {
  const [meals, people] = await Promise.all([loadMeals(supabase), loadPeople(supabase)]);

  const understood = interpret({
    text: input.text,
    people,
    meals,
    context: input.context,
    pending: input.pending,
  });

  if (understood.kind === 'query') return { kind: 'query' };

  if (understood.kind === 'ask') {
    return {
      kind: 'ask',
      question: understood.question,
      field: understood.field,
      options: understood.options,
      pending: understood.pending,
      context: understood.context,
    };
  }

  // التنقّل ليس تعديل بيانات — يُرجَّع فوراً بلا معاينة ولا تأكيد
  if (understood.command.kind === 'open_page') {
    const c = understood.command;
    return { kind: 'navigate', href: c.href, label: c.label, permission: c.permission, context: understood.context };
  }

  const result = await buildPlan(supabase, understood.command, input.now ?? new Date());
  if (result.type === 'problem') return { kind: 'problem', problem: result, context: understood.context };
  return { kind: 'plan', plan: result, context: understood.context, usedContext: understood.usedContext };
}
