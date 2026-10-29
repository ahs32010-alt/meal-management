'use client';

// تفكيك طلب الموافقة إلى تغييرات مستقلة — كل محظور، كل بديل، كل صنف ثابت،
// كل حقل — عشان الأدمن يوافق على بعضها ويرفض الباقي بدل «الكل أو لا شيء».
//
// الفكرة: نقارن الطلب بالحالة الحالية في القاعدة لحظة المراجعة، فيطلع لنا
// قائمة تغييرات بمعرّفات ثابتة (ex:<meal_id>، fm:<مفتاح>، field:<عمود>…).
// عند الاعتماد الجزئي نبني payload جديد = الحالة الحالية + التغييرات المختارة
// فقط، ونمرّره لنفس approveAction — فالتنفيذ الفعلي مسار واحد لا يتكرر.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppUser } from './permissions';
import { DAY_LABELS, DAYS_ORDER, MEAL_TYPE_LABELS, type MealType } from './types';
import {
  approveAction, rejectAction,
  type CreatePayload, type DietPayload, type PendingAction,
} from './pending-actions';

export interface PendingChange {
  id: string;
  label: string;
  kind: 'add' | 'remove' | 'change';
  /** جزء لا يقبل الفصل (إنشاء السجل نفسه، الحذف) — يُعتمد مع أي اعتماد */
  locked?: boolean;
}

export interface ChangeSet {
  changes: PendingChange[];
  /** payload يحمل التغييرات المختارة فقط فوق الحالة الحالية */
  build: (selected: Set<string>) => Record<string, unknown> | null;
  /** ملاحظة تُعرض فوق القائمة (مثلاً: السجل محذوف) */
  note?: string;
  /** تعريف بالسجل كما هو الآن — يوضّح للمراجع «وش هو» قبل ما يقرر */
  context?: { title: string; lines: { label: string; value: string }[] };
}

const FIELD_LABELS: Record<string, string> = {
  name: 'الاسم',
  english_name: 'الاسم بالإنجليزي',
  code: 'الكود',
  category: 'الفئة',
  villa: 'الفيلا',
  diet_type: 'النظام الغذائي',
  notes: 'الملاحظات',
  no_fish: 'بدون سمك',
  no_pasta_sandwich: 'بدون باستا/ساندويتش',
  low_carb: 'قليل الكربوهيدرات',
  custom_ld_meals: 'وجبات غداء/عشاء مخصّصة',
  is_active: 'مفعّل',
  description: 'الوصف',
  type: 'الوجبة',
  is_snack: 'سناك',
  meal_id: 'الصنف',
  multiplier: 'المضاعف',
  entity_type: 'النوع',
};

const CAT_LABELS: Record<string, string> = { hot: 'حار', cold: 'بارد', snack: 'سناك' };

/** تطبيع للمقارنة: null/''/undefined سواء، والكائنات بالـJSON */
function norm(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v).trim();
}

function show(v: unknown, mealName: (id: string) => string, key: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (key === 'meal_id' && typeof v === 'string') return mealName(v);
  if (key === 'type') return MEAL_TYPE_LABELS[v as MealType] ?? String(v);
  if (key === 'category' && typeof v === 'string') return CAT_LABELS[v] ?? v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function nameMap(supabase: SupabaseClient, table: 'meals' | 'diet_systems', ids: (string | null | undefined)[]) {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return new Map<string, string>();
  const { data } = await supabase.from(table).select('id, name').in('id', unique);
  return new Map(((data ?? []) as { id: string; name: string }[]).map(m => [m.id, m.name]));
}

type ExRow = { meal_id: string; alternative_meal_id: string | null };
type FmRow = CreatePayload['fixed_meals'][number];
type DietFx = NonNullable<DietPayload['fixed_meals']>[number];

const fmKey = (f: { meal_id: string; meal_type: string; day_of_week: number }) =>
  `${f.meal_id}|${f.meal_type}|${f.day_of_week}`;

/** الحقول اللي تحدد هوية/سلوك الصنف الثابت — تغيّر أي منها = «تعديل» */
const fmSig = (f: FmRow) => JSON.stringify([
  f.quantity ?? 1, f.category ?? null, !!f.is_alternative, [...(f.suppress_if_meal_ids ?? [])].sort(),
]);

/** تغييرات الحقول: مفتاح لكل عمود اختلف بين الحالي والمطلوب */
function fieldChanges(
  cur: Record<string, unknown> | null,
  next: Record<string, unknown>,
  mealName: (id: string) => string,
): PendingChange[] {
  const out: PendingChange[] = [];
  for (const k of Object.keys(next)) {
    if (cur && norm(cur[k]) === norm(next[k])) continue;
    const label = FIELD_LABELS[k] ?? k;
    out.push({
      id: `field:${k}`,
      kind: 'change',
      label: cur
        ? `${label}: «${show(cur[k], mealName, k)}» ← «${show(next[k], mealName, k)}»`
        : `${label}: «${show(next[k], mealName, k)}»`,
    });
  }
  return out;
}

function pickFields(next: Record<string, unknown>, selected: Set<string>) {
  return Object.fromEntries(Object.entries(next).filter(([k]) => selected.has(`field:${k}`)));
}

/** فرق الاستبعادات (صنف ← بديل) — مشترك بين المستفيد والنظام الغذائي */
function exclusionChanges(before: ExRow[], after: ExRow[], mealName: (id: string) => string): PendingChange[] {
  const out: PendingChange[] = [];
  const b = new Map(before.map(e => [e.meal_id, e.alternative_meal_id ?? null]));
  const a = new Map(after.map(e => [e.meal_id, e.alternative_meal_id ?? null]));
  const alt = (id: string | null) => (id ? mealName(id) : 'بدون بديل');
  for (const [mid, newAlt] of a) {
    if (!b.has(mid)) {
      out.push({ id: `ex:${mid}`, kind: 'add', label: `حظر ${mealName(mid)} — البديل: ${alt(newAlt)}` });
    } else if ((b.get(mid) ?? null) !== newAlt) {
      out.push({ id: `ex:${mid}`, kind: 'change', label: `تغيير بديل ${mealName(mid)}: ${alt(b.get(mid) ?? null)} ← ${alt(newAlt)}` });
    }
  }
  for (const [mid, oldAlt] of b) {
    if (!a.has(mid)) out.push({ id: `ex:${mid}`, kind: 'remove', label: `إلغاء حظر ${mealName(mid)}${oldAlt ? ` (كان بديله ${mealName(oldAlt)})` : ''}` });
  }
  return out;
}

/** الحالة الحالية + تغييرات الاستبعاد المختارة فقط */
function applyExclusions(before: ExRow[], after: ExRow[], selected: Set<string>): ExRow[] {
  const res = new Map(before.map(e => [e.meal_id, e.alternative_meal_id ?? null]));
  const a = new Map(after.map(e => [e.meal_id, e.alternative_meal_id ?? null]));
  for (const mid of new Set([...res.keys(), ...a.keys()])) {
    if (!selected.has(`ex:${mid}`)) continue;
    if (a.has(mid)) res.set(mid, a.get(mid) ?? null);
    else res.delete(mid);
  }
  return [...res].map(([meal_id, alternative_meal_id]) => ({ meal_id, alternative_meal_id }));
}

// ── المستفيد / المرافق ──────────────────────────────────────────────────────

async function beneficiaryChangeSet(supabase: SupabaseClient, pa: PendingAction): Promise<ChangeSet> {
  const cp = pa.payload as unknown as CreatePayload | null;
  const noun = pa.entity_type === 'companion' ? 'المرافق' : 'المستفيد';
  if (!cp?.beneficiary) return { changes: [], build: () => null, note: 'الطلب ما يحمل بيانات.' };

  const isCreate = pa.action === 'create';
  let curBen: Record<string, unknown> | null = null;
  let curEx: ExRow[] = [];
  let curFm: FmRow[] = [];
  let curDiets: string[] = [];
  let curOv: unknown[] | null = null;

  if (!isCreate && pa.entity_id) {
    const id = pa.entity_id;
    const exWithDiet = supabase.from('exclusions').select('meal_id, alternative_meal_id, diet_id').eq('beneficiary_id', id);
    const [bRes, exRes0, fmRes, dRes, ovRes] = await Promise.all([
      supabase.from('beneficiaries').select('*').eq('id', id).maybeSingle(),
      exWithDiet,
      supabase.from('beneficiary_fixed_meals').select('*').eq('beneficiary_id', id),
      supabase.from('beneficiary_diets').select('diet_id').eq('beneficiary_id', id),
      supabase.from('beneficiary_menu_overrides').select('*').eq('beneficiary_id', id),
    ]);
    if (!bRes.data) {
      return { changes: [], build: () => null, note: `⚠ ${noun} غير موجود حالياً — يحتمل أنه انحذف. ارفض الطلب.` };
    }
    curBen = bRes.data as Record<string, unknown>;
    // ترقية الأنظمة ما اتشغّلت → ما فيه diet_id، وكل الصفوف شخصية
    const exRes = exRes0.error
      ? await supabase.from('exclusions').select('meal_id, alternative_meal_id').eq('beneficiary_id', id)
      : exRes0;
    curEx = ((exRes.data ?? []) as (ExRow & { diet_id?: string | null })[])
      .filter(r => !r.diet_id)
      .map(r => ({ meal_id: r.meal_id, alternative_meal_id: r.alternative_meal_id ?? null }));
    // الشخصية فقط — صفوف الأنظمة (diet_id) تكتبها مزامنة القاعدة، والطلب ما يحملها
    curFm = ((fmRes.data ?? []) as Record<string, unknown>[])
      .filter(r => !r.diet_id)
      .map(r => {
        const { id: _i, beneficiary_id: _b, created_at: _c, updated_at: _u, diet_id: _d, ...rest } = r;
        return rest as unknown as FmRow;
      });
    curDiets = dRes.error ? [] : ((dRes.data ?? []) as { diet_id: string }[]).map(r => r.diet_id);
    curOv = ovRes.error ? null : ((ovRes.data ?? []) as Record<string, unknown>[]);
  }

  const meals = await nameMap(supabase, 'meals', [
    ...curEx.flatMap(e => [e.meal_id, e.alternative_meal_id]),
    ...(cp.exclusions ?? []).flatMap(e => [e.meal_id, e.alternative_meal_id]),
    ...curFm.map(f => f.meal_id),
    ...(cp.fixed_meals ?? []).map(f => f.meal_id),
  ]);
  const diets = await nameMap(supabase, 'diet_systems', [...curDiets, ...(cp.diet_ids ?? [])]);
  const mealName = (id: string) => meals.get(id) ?? 'صنف محذوف';
  const dietName = (id: string) => diets.get(id) ?? 'نظام محذوف';

  const changes: PendingChange[] = [];
  if (isCreate) {
    changes.push({ id: 'base', kind: 'add', locked: true, label: `إضافة ${noun} «${pa.entity_name ?? ''}» بالبيانات الأساسية` });
  } else {
    changes.push(...fieldChanges(curBen, cp.beneficiary, mealName));
  }

  changes.push(...exclusionChanges(curEx, cp.exclusions ?? [], mealName));

  // الأصناف الثابتة
  const fmLabel = (f: FmRow) =>
    `${mealName(f.meal_id)} — ${DAY_LABELS[f.day_of_week] ?? f.day_of_week} ${MEAL_TYPE_LABELS[f.meal_type as MealType] ?? f.meal_type}` +
    ` ×${f.quantity ?? 1}${f.category ? ` ${CAT_LABELS[f.category] ?? f.category}` : ''}${f.is_alternative ? ' · بديل' : ''}`;
  const bFm = new Map(curFm.map(f => [fmKey(f), f]));
  const aFm = new Map((cp.fixed_meals ?? []).map(f => [fmKey(f), f]));
  for (const [k, f] of aFm) {
    const old = bFm.get(k);
    if (!old) changes.push({ id: `fm:${k}`, kind: 'add', label: `إضافة صنف ثابت: ${fmLabel(f)}` });
    else if (fmSig(old) !== fmSig(f)) changes.push({ id: `fm:${k}`, kind: 'change', label: `تعديل صنف ثابت: ${fmLabel(old)} ← ${fmLabel(f)}` });
  }
  for (const [k, f] of bFm) {
    if (!aFm.has(k)) changes.push({ id: `fm:${k}`, kind: 'remove', label: `إزالة صنف ثابت: ${fmLabel(f)}` });
  }

  // الأنظمة الغذائية — غياب المفتاح = الطلب ما يمسّها
  if (cp.diet_ids) {
    for (const d of cp.diet_ids) if (!curDiets.includes(d)) changes.push({ id: `diet:${d}`, kind: 'add', label: `إسناد النظام الغذائي «${dietName(d)}»` });
    for (const d of curDiets) if (!cp.diet_ids.includes(d)) changes.push({ id: `diet:${d}`, kind: 'remove', label: `إلغاء إسناد النظام الغذائي «${dietName(d)}»` });
  }

  // قرارات المنيو المخصّص — كتلة واحدة (تُكتب استبدالاً كاملاً)
  if (cp.menu_overrides !== undefined) {
    const sig = (rows: unknown[]) => rows
      .map(r => {
        const o = r as Record<string, unknown>;
        return JSON.stringify([o.week_number, o.day_of_week, o.meal_type, o.action, o.base_meal_id ?? null, o.target_meal_id ?? null, o.quantity ?? 1, !!o.is_alternative]);
      })
      .sort().join('\n');
    const differs = curOv === null ? cp.menu_overrides.length > 0 : sig(curOv) !== sig(cp.menu_overrides);
    if (differs) {
      changes.push({ id: 'ov', kind: 'change', label: `تعديل قرارات المنيو المخصّص (${cp.menu_overrides.length} قرار بعد التعديل)` });
    }
  }

  const build = (selected: Set<string>): Record<string, unknown> => {
    const fm = new Map(curFm.map(f => [fmKey(f), f]));
    for (const k of new Set([...bFm.keys(), ...aFm.keys()])) {
      if (!selected.has(`fm:${k}`)) continue;
      const f = aFm.get(k);
      if (f) fm.set(k, f); else fm.delete(k);
    }
    let dietIds: string[] | undefined;
    if (cp.diet_ids) {
      dietIds = curDiets.filter(d => !(selected.has(`diet:${d}`) && !cp.diet_ids!.includes(d)));
      for (const d of cp.diet_ids) if (!dietIds.includes(d) && selected.has(`diet:${d}`)) dietIds.push(d);
    }
    const out: CreatePayload = {
      beneficiary: isCreate ? cp.beneficiary : pickFields(cp.beneficiary, selected),
      exclusions: applyExclusions(curEx, cp.exclusions ?? [], selected),
      fixed_meals: [...fm.values()],
      ...(dietIds !== undefined ? { diet_ids: dietIds } : {}),
      ...(selected.has('ov') ? { menu_overrides: cp.menu_overrides } : {}),
    };
    return out as unknown as Record<string, unknown>;
  };

  return { changes, build };
}

// ── النظام الغذائي ─────────────────────────────────────────────────────────

/**
 * تعريف بالنظام الغذائي كما هو في القاعدة الآن: وصفه، أصنافه المستبعدة
 * وبدائلها، أصنافه الثابتة، ولمن هو مسند — عشان المراجع يعرف أي نظام يعدّل.
 */
async function dietContext(supabase: SupabaseClient, dietId: string): Promise<ChangeSet['context']> {
  const [dRes, exRes, fxRes, bRes] = await Promise.all([
    supabase.from('diet_systems').select('name, description').eq('id', dietId).maybeSingle(),
    supabase.from('diet_system_exclusions').select('meal_id, alternative_meal_id').eq('diet_id', dietId),
    // الجدول غائب قبل diet-fixed-meals-migration → خطأ نتجاهله
    supabase.from('diet_system_fixed_meals').select('day_of_week, meal_type, meal_id, quantity, is_alternative').eq('diet_id', dietId),
    supabase.from('beneficiary_diets').select('beneficiaries(name)').eq('diet_id', dietId),
  ]);
  if (!dRes.data) return undefined;
  const d = dRes.data as { name: string; description: string | null };
  const ex = (exRes.data ?? []) as ExRow[];
  const fx = (fxRes.error ? [] : fxRes.data ?? []) as DietFx[];
  const meals = await nameMap(supabase, 'meals', [...ex.flatMap(e => [e.meal_id, e.alternative_meal_id]), ...fx.map(r => r.meal_id)]);
  const mealName = (id: string) => meals.get(id) ?? 'صنف محذوف';

  // الثابتة مجمّعة بالصنف والوجبة: «فول (فطور) — كل الأيام ×2»
  const groups = new Map<string, { r: DietFx; days: number[] }>();
  for (const r of fx) {
    const k = `${r.meal_id}|${r.meal_type}`;
    const g = groups.get(k);
    if (g) g.days.push(r.day_of_week); else groups.set(k, { r, days: [r.day_of_week] });
  }
  const fixedText = [...groups.values()].map(({ r, days }) => {
    const dayText = days.length === 7 ? 'كل الأيام' : DAYS_ORDER.filter(x => days.includes(x)).map(x => DAY_LABELS[x]).join('، ');
    return `${mealName(r.meal_id)} (${MEAL_TYPE_LABELS[r.meal_type as MealType] ?? r.meal_type}) — ${dayText}` +
      `${r.quantity > 1 ? ` ×${r.quantity}` : ''}${r.is_alternative ? ' · بديل' : ''}`;
  });

  const names = ((bRes.data ?? []) as unknown as { beneficiaries: { name: string } | null }[])
    .map(x => x.beneficiaries?.name).filter((x): x is string => !!x);
  const shown = names.slice(0, 10).join('، ');

  return {
    title: `النظام الغذائي «${d.name}» حالياً`,
    lines: [
      ...(d.description ? [{ label: 'الوصف', value: d.description }] : []),
      {
        label: `الأصناف المستبعدة (${ex.length})`,
        value: ex.length === 0 ? 'لا شيء'
          : ex.map(e => `${mealName(e.meal_id)}${e.alternative_meal_id ? ` ← ${mealName(e.alternative_meal_id)}` : ''}`).join('، '),
      },
      ...(fxRes.error ? [] : [{ label: `الأصناف الثابتة (${groups.size})`, value: fixedText.length === 0 ? 'لا شيء' : fixedText.join('، ') }]),
      {
        label: `مسند لـ ${names.length} شخص`,
        value: names.length === 0 ? 'لا أحد' : `${shown}${names.length > 10 ? ` و${names.length - 10} غيرهم` : ''}`,
      },
    ],
  };
}

async function dietChangeSet(supabase: SupabaseClient, pa: PendingAction): Promise<ChangeSet> {
  const p = pa.payload as unknown as DietPayload | null;
  if (!p?.diet) return { changes: [], build: () => null, note: 'الطلب ما يحمل بيانات.' };
  const isCreate = pa.action === 'create';
  let cur: Record<string, unknown> | null = null;
  let curEx: ExRow[] = [];
  let curFx: DietFx[] = [];
  if (!isCreate && pa.entity_id) {
    const [dRes, exRes, fxRes] = await Promise.all([
      supabase.from('diet_systems').select('name, description').eq('id', pa.entity_id).maybeSingle(),
      supabase.from('diet_system_exclusions').select('meal_id, alternative_meal_id').eq('diet_id', pa.entity_id),
      p.fixed_meals
        ? supabase.from('diet_system_fixed_meals').select('day_of_week, meal_type, meal_id, quantity, is_alternative').eq('diet_id', pa.entity_id)
        : Promise.resolve({ data: [] as DietFx[] }),
    ]);
    if (!dRes.data) return { changes: [], build: () => null, note: '⚠ النظام غير موجود حالياً — يحتمل أنه انحذف. ارفض الطلب.' };
    cur = dRes.data as Record<string, unknown>;
    curEx = (exRes.data ?? []) as ExRow[];
    curFx = ((fxRes.data ?? []) as DietFx[]).map(r => ({ ...r, is_alternative: r.is_alternative === true }));
  }
  const meals = await nameMap(supabase, 'meals', [
    ...[...curEx, ...(p.exclusions ?? [])].flatMap(e => [e.meal_id, e.alternative_meal_id]),
    ...curFx.map(r => r.meal_id),
    ...(p.fixed_meals ?? []).map(r => r.meal_id),
  ]);
  const mealName = (id: string) => meals.get(id) ?? 'صنف محذوف';

  const changes: PendingChange[] = isCreate
    ? [{ id: 'base', kind: 'add', locked: true, label: `إنشاء النظام الغذائي «${p.diet.name ?? ''}»${p.diet.description ? ` — ${p.diet.description}` : ''}` }]
    : fieldChanges(cur, p.diet, mealName);
  const context = !isCreate && pa.entity_id ? await dietContext(supabase, pa.entity_id) : undefined;
  changes.push(...exclusionChanges(curEx, p.exclusions ?? [], mealName));

  // الأصناف الثابتة — تغيير لكل صف (صنف + وجبة + يوم)
  const fxKey = (r: DietFx) => `${r.day_of_week}|${r.meal_type}|${r.meal_id}`;
  const fxLabel = (r: DietFx) =>
    `${mealName(r.meal_id)} — ${DAY_LABELS[r.day_of_week] ?? r.day_of_week} ${MEAL_TYPE_LABELS[r.meal_type as MealType] ?? r.meal_type}` +
    ` ×${r.quantity}${r.is_alternative ? ' · بديل' : ''}`;
  const bFx = new Map(curFx.map(r => [fxKey(r), r]));
  const aFx = new Map((p.fixed_meals ?? []).map(r => [fxKey(r), r]));
  if (p.fixed_meals) {
    for (const [k, r] of aFx) {
      const old = bFx.get(k);
      if (!old) changes.push({ id: `dfx:${k}`, kind: 'add', label: `صنف ثابت للنظام: ${fxLabel(r)}` });
      else if (old.quantity !== r.quantity || old.is_alternative !== r.is_alternative) {
        changes.push({ id: `dfx:${k}`, kind: 'change', label: `تعديل صنف ثابت للنظام: ${fxLabel(old)} ← ${fxLabel(r)}` });
      }
    }
    for (const [k, r] of bFx) {
      if (!aFx.has(k)) changes.push({ id: `dfx:${k}`, kind: 'remove', label: `إزالة صنف ثابت من النظام: ${fxLabel(r)}` });
    }
  }

  const build = (selected: Set<string>): Record<string, unknown> => {
    let fixed: DietFx[] | undefined;
    if (p.fixed_meals) {
      const res = new Map(bFx);
      for (const k of new Set([...bFx.keys(), ...aFx.keys()])) {
        if (!selected.has(`dfx:${k}`)) continue;
        const r = aFx.get(k);
        if (r) res.set(k, r); else res.delete(k);
      }
      fixed = [...res.values()];
    }
    const out: DietPayload = {
      diet: isCreate ? p.diet : pickFields(p.diet as Record<string, unknown>, selected),
      exclusions: applyExclusions(curEx, p.exclusions ?? [], selected),
      ...(fixed ? { fixed_meals: fixed } : {}),
    };
    return out as unknown as Record<string, unknown>;
  };
  return { changes, build, context };
}

// ── الأصناف وبنود المنيو (payload = أعمدة الجدول مباشرة) ──────────────────

async function rowChangeSet(supabase: SupabaseClient, pa: PendingAction): Promise<ChangeSet> {
  const payload = pa.payload ?? {};
  const table = pa.entity_type === 'menu_item' ? 'menu_items' : 'meals';
  if (pa.action === 'create') {
    const meals = await nameMap(supabase, 'meals', [payload.meal_id as string | undefined]);
    return {
      changes: [
        { id: 'base', kind: 'add', locked: true, label: `إضافة «${pa.entity_name ?? ''}»` },
        ...fieldChanges(null, payload, id => meals.get(id) ?? 'صنف محذوف').map(c => ({ ...c, locked: true })),
      ],
      build: () => payload,
    };
  }
  if (!pa.entity_id) return { changes: [], build: () => null, note: 'الطلب ناقص.' };
  const { data: cur } = await supabase.from(table).select('*').eq('id', pa.entity_id).maybeSingle();
  if (!cur) return { changes: [], build: () => null, note: '⚠ السجل غير موجود حالياً — يحتمل أنه انحذف. ارفض الطلب.' };
  const meals = await nameMap(supabase, 'meals', [payload.meal_id as string | undefined, (cur as Record<string, unknown>).meal_id as string | undefined]);
  return {
    changes: fieldChanges(cur as Record<string, unknown>, payload, id => meals.get(id) ?? 'صنف محذوف'),
    build: selected => pickFields(payload, selected),
  };
}

const NOUNS: Record<string, string> = {
  beneficiary: 'المستفيد', companion: 'المرافق', meal: 'الصنف', menu_item: 'بند المنيو', diet: 'النظام الغذائي',
};

/** تفكيك الطلب لتغييرات مستقلة مقابل حالة القاعدة الآن */
export async function loadChangeSet(supabase: SupabaseClient, pa: PendingAction): Promise<ChangeSet> {
  if (pa.action === 'delete') {
    return {
      changes: [{ id: 'base', kind: 'remove', locked: true, label: `حذف ${NOUNS[pa.entity_type] ?? ''} «${pa.entity_name ?? ''}»` }],
      build: () => null,
      // حذف نظام غذائي يمسّ كل من هو مسند له — نعرّف بالنظام قبل القرار
      context: pa.entity_type === 'diet' && pa.entity_id ? await dietContext(supabase, pa.entity_id) : undefined,
    };
  }
  if (pa.entity_type === 'diet') return dietChangeSet(supabase, pa);
  if (pa.entity_type === 'meal' || pa.entity_type === 'menu_item') return rowChangeSet(supabase, pa);
  return beneficiaryChangeSet(supabase, pa);
}

/**
 * اعتماد جزئي: يُنفَّذ المختار فقط، والباقي يُسجَّل كمرفوض في reject_reason
 * فيشوفه صاحب الطلب. لو ما اختير شيء قابل للتنفيذ → الطلب كله مرفوض.
 *
 * نعيد حساب التغييرات من القاعدة لحظة الاعتماد (مو من الشاشة) عشان لو تغيّر
 * شيء بين الفتح والضغط ما نكتب فوقه حالة قديمة.
 */
export async function approveSelected(
  supabase: SupabaseClient,
  admin: AppUser,
  pa: PendingAction,
  selected: Set<string>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cs = await loadChangeSet(supabase, pa);
  const chosen = cs.changes.filter(c => c.locked || selected.has(c.id));
  const rejected = cs.changes.filter(c => !c.locked && !selected.has(c.id));

  if (chosen.length === 0) {
    const { error } = await rejectAction(supabase, admin, pa, 'رُفضت كل التغييرات المطلوبة');
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  if (rejected.length === 0) return approveAction(supabase, admin, pa);

  const payload = cs.build(new Set(chosen.map(c => c.id)));
  const r = await approveAction(supabase, admin, { ...pa, payload });
  if (!r.ok) return r;
  const { error } = await supabase.from('pending_actions')
    .update({ reject_reason: `اعتُمد جزئياً — رُفض: ${rejected.map(c => c.label).join('، ')}` })
    .eq('id', pa.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}
