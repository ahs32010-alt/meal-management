/**
 * حصر أقسام المطبخ — يجمّع كميات الأيام المختارة تحت أقسام المطبخ
 * (kitchen-sections-migration) بعمود لكل يوم.
 *
 * لا يحسب أي كمية بنفسه: كل يوم = استدعاء buildMenuPeriodReport لذاك اليوم
 * وحده (نفس معادلة تقرير الفترة وأمر التشغيل: الأساسي بعد المستبعدين ×
 * المضاعف + الكمية الإضافية + البدائل + الثابت). هنا فقط إعادة ترتيب.
 *
 * الصنف نفسه بأكثر من وجبة (رز أصفر غداء + رز أصفر عشاء) صفّان مختلفان في
 * الأصناف — نجمعهما في سطر واحد بالاسم داخل القسم، لأن المطبخ يجهّزهما معاً.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EntityType, KitchenSection, MealType } from '@/lib/types';
import { buildMenuPeriodReport, type MenuPeriodReport } from '@/lib/menu-period-report';

/** ترتيب الأيام في المنيو — السبت أولاً */
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
const MEAL_TYPE_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner'];

export interface KitchenDay { key: string; week: number; day: number }

export interface KitchenCell { qty: number; alt: number; fixed: number }

export interface KitchenRow {
  name: string;
  mealTypes: MealType[];
  perDay: Record<string, KitchenCell>;
  total: number;
  altTotal: number;
  fixedTotal: number;
}

export interface KitchenSectionBlock {
  /** null = أصناف بلا قسم */
  section: Pick<KitchenSection, 'id' | 'name' | 'color'> | null;
  rows: KitchenRow[];
  total: number;
}

export interface KitchenSectionsReport {
  days: KitchenDay[];
  sections: KitchenSectionBlock[];
  mealType?: MealType;
  entityType?: EntityType;
  grandTotal: number;
}

export const dayKey = (week: number, day: number) => `${week}-${day}`;

/** يرتّب (أسبوع، يوم) كما في المنيو */
export function orderedDays(selections: Record<string, number[]>): KitchenDay[] {
  const out: KitchenDay[] = [];
  Object.keys(selections).map(Number).sort((a, b) => a - b).forEach(week => {
    const days = new Set(selections[String(week)]);
    DAY_ORDER.forEach(day => { if (days.has(day)) out.push({ key: dayKey(week, day), week, day }); });
  });
  return out;
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ');

/**
 * التجميع الصافي — منفصل عن القراءة من القاعدة عشان يُختبر.
 * perDayReports: تقرير كل يوم (null = لا أصناف في المنيو لذاك اليوم).
 */
export function aggregateKitchenSections(
  days: KitchenDay[],
  perDayReports: Array<MenuPeriodReport | null>,
  sections: KitchenSection[],
  sectionByMeal: Record<string, string>,
): Pick<KitchenSectionsReport, 'days' | 'sections' | 'grandTotal'> {
  const sectionIds = new Set(sections.map(s => s.id));
  // sectionId ('' = بلا قسم) → اسم الصنف → السطر
  const blocks = new Map<string, Map<string, KitchenRow>>();

  days.forEach((d, i) => {
    const rep = perDayReports[i];
    if (!rep) return;
    const altById: Record<string, number> = {};
    [...rep.aggregated.altSummary, ...rep.aggregated.snackAltSummary]
      .forEach(x => { altById[x.meal.id] = (altById[x.meal.id] || 0) + x.qty; });
    const fixedById: Record<string, number> = {};
    rep.aggregated.fixedSummary.forEach(x => { fixedById[x.meal.id] = (fixedById[x.meal.id] || 0) + x.qty; });

    rep.aggregated.itemsSummary.forEach(({ meal, quantity }) => {
      if (!quantity) return;
      const sid = sectionIds.has(sectionByMeal[meal.id]) ? sectionByMeal[meal.id] : '';
      const block = blocks.get(sid) ?? new Map<string, KitchenRow>();
      blocks.set(sid, block);
      const name = normName(meal.name);
      const row = block.get(name) ?? { name, mealTypes: [], perDay: {}, total: 0, altTotal: 0, fixedTotal: 0 };
      block.set(name, row);
      if (!row.mealTypes.includes(meal.type)) row.mealTypes.push(meal.type);
      const cell = row.perDay[d.key] ?? { qty: 0, alt: 0, fixed: 0 };
      cell.qty += quantity;
      cell.alt += altById[meal.id] || 0;
      cell.fixed += fixedById[meal.id] || 0;
      row.perDay[d.key] = cell;
      row.total += quantity;
      row.altTotal += altById[meal.id] || 0;
      row.fixedTotal += fixedById[meal.id] || 0;
    });
  });

  const toBlock = (section: KitchenSectionBlock['section'], sid: string): KitchenSectionBlock => {
    const rows = [...(blocks.get(sid)?.values() ?? [])];
    rows.forEach(r => r.mealTypes.sort((a, b) => MEAL_TYPE_ORDER.indexOf(a) - MEAL_TYPE_ORDER.indexOf(b)));
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ar'));
    return { section, rows, total: rows.reduce((s, r) => s + r.total, 0) };
  };

  const out = [...sections]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(s => toBlock({ id: s.id, name: s.name, color: s.color ?? null }, s.id));
  const unassigned = toBlock(null, '');
  if (unassigned.rows.length > 0) out.push(unassigned);

  return { days, sections: out, grandTotal: out.reduce((s, b) => s + b.total, 0) };
}

/** يشغّل حساب الفترة لكل يوم على حدة (بتوازٍ محدود) ثم يجمّع حسب الأقسام */
export async function buildKitchenSectionsReport(
  supabase: SupabaseClient,
  params: { selections: Record<string, number[]>; meal_type?: MealType; entity_type?: EntityType },
): Promise<KitchenSectionsReport | { error: string }> {
  const days = orderedDays(params.selections);

  const [secRes, mapRes] = await Promise.all([
    supabase.from('kitchen_sections').select('id, name, color, sort_order').order('sort_order'),
    supabase.from('meal_kitchen_sections').select('meal_id, section_id'),
  ]);
  const err = secRes.error ?? mapRes.error;
  if (err) {
    return /kitchen_sections|does not exist|schema cache/i.test(err.message)
      ? { error: 'شغّل supabase/kitchen-sections-migration.sql أولاً' }
      : { error: err.message };
  }
  const sectionByMeal: Record<string, string> = {};
  ((mapRes.data ?? []) as { meal_id: string; section_id: string }[])
    .forEach(r => { sectionByMeal[r.meal_id] = r.section_id; });

  const reports: Array<MenuPeriodReport | null> = new Array(days.length).fill(null);
  const CONCURRENCY = 4;
  for (let i = 0; i < days.length; i += CONCURRENCY) {
    const batch = days.slice(i, i + CONCURRENCY);
    const res = await Promise.all(batch.map(d => buildMenuPeriodReport(supabase, {
      selections: { [d.week]: [d.day] },
      meal_type: params.meal_type,
      entity_type: params.entity_type,
    })));
    res.forEach((r, j) => { reports[i + j] = r; });
  }

  return {
    ...aggregateKitchenSections(days, reports, (secRes.data ?? []) as KitchenSection[], sectionByMeal),
    mealType: params.meal_type,
    entityType: params.entity_type,
  };
}
