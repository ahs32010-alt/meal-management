import type { DietSystem, EntityType, Meal, MealType } from '@/lib/types';
import { ENTITY_TYPE_LABELS_PLURAL, MEAL_TYPE_LABELS } from '@/lib/types';

/**
 * صيغة ملف «النظام الغذائي» — مصدر واحد للتصدير والاستيراد والقالب.
 *
 * صف لكل (نظام × صنف مستبعد)، والنظام بلا استبعادات يُكتب صفاً واحداً بخانات
 * صنف فارغة حتى لا يضيع عند الاستيراد. الصنف يُعرَّف بالاسم + الوجبة + سناك +
 * الفئة، لأن الاسم وحده يتكرر (فواكه فطور/فواكه عشاء، صنف المستفيدين/المرافقين).
 * البديل يُبحث عنه ضمن أصناف نفس الوجبة ونفس «سناك» — نفس قاعدة محرّر الصفحة.
 *
 * إسناد النظام للمستفيدين يُحرَّر من صفحة المستفيد، فلا يدخل هذا الملف.
 */

export const DIET_COL_NAME     = 'النظام';
export const DIET_COL_DESC     = 'الوصف';
export const DIET_COL_MEAL     = 'الصنف المستبعد';
export const DIET_COL_MEAL_TYPE = 'وجبة الصنف';
export const DIET_COL_SNACK    = 'سناك';
export const DIET_COL_ENTITY   = 'فئة الصنف';
export const DIET_COL_ALT      = 'البديل';

export const DIET_HEADERS = [
  DIET_COL_NAME, DIET_COL_DESC, DIET_COL_MEAL, DIET_COL_MEAL_TYPE, DIET_COL_SNACK, DIET_COL_ENTITY, DIET_COL_ALT,
];
export const DIET_REQUIRED_HEADERS = [DIET_COL_NAME, DIET_COL_MEAL];
export const DIET_TEMPLATE_ROW = ['سكري', 'يستبعد الحلى', 'كيكة', 'عشاء', 'نعم', ENTITY_TYPE_LABELS_PLURAL.beneficiary, 'فاكهة'];

type MealLite = Pick<Meal, 'id' | 'name' | 'type' | 'is_snack' | 'entity_type'>;

const clean = (v: string | undefined | null) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** مفتاح اسم النظام — نفس قيد القاعدة: lower(btrim(name)) */
export const dietNameKey = (name: string) => clean(name).toLowerCase();

const TYPE_ORDER: Record<MealType, number> = { breakfast: 0, lunch: 1, dinner: 2 };
const TYPE_FROM_TEXT: Record<string, MealType> = {
  ...Object.fromEntries((Object.entries(MEAL_TYPE_LABELS) as [MealType, string][]).map(([k, v]) => [v, k])),
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner',
};
const ENTITY_FROM_TEXT: Record<string, EntityType> = {
  [ENTITY_TYPE_LABELS_PLURAL.beneficiary]: 'beneficiary',
  [ENTITY_TYPE_LABELS_PLURAL.companion]: 'companion',
  'مستفيد': 'beneficiary', 'مستفيدين': 'beneficiary',
  'مرافق': 'companion', 'مرافقين': 'companion',
  beneficiary: 'beneficiary', companion: 'companion',
};
const YES = new Set(['نعم', 'yes', 'true', '1', 'y', '✓']);
const NO = new Set(['لا', 'no', 'false', '0', 'n']);

// ─── التصدير ────────────────────────────────────────────────────────────────

export function buildDietRows(
  diets: Pick<DietSystem, 'name' | 'description' | 'exclusions'>[],
  meals: MealLite[],
): Record<string, string>[] {
  const mealById = new Map(meals.map(m => [m.id, m]));
  const rows: Record<string, string>[] = [];
  for (const d of diets) {
    const base = { [DIET_COL_NAME]: d.name, [DIET_COL_DESC]: d.description ?? '' };
    const excl = (d.exclusions ?? [])
      .map(x => ({ meal: mealById.get(x.meal_id), alt: x.alternative_meal_id ? mealById.get(x.alternative_meal_id) : undefined }))
      // صنف محذوف لا يمكن إعادة ربطه — الحذف المتسلسل يزيله من القاعدة أصلاً
      .filter((x): x is { meal: MealLite; alt: MealLite | undefined } => !!x.meal)
      .sort((a, b) =>
        TYPE_ORDER[a.meal.type] - TYPE_ORDER[b.meal.type]
        || Number(a.meal.is_snack) - Number(b.meal.is_snack)
        || a.meal.name.localeCompare(b.meal.name, 'ar'));
    if (excl.length === 0) {
      rows.push({ ...base, [DIET_COL_MEAL]: '', [DIET_COL_MEAL_TYPE]: '', [DIET_COL_SNACK]: '', [DIET_COL_ENTITY]: '', [DIET_COL_ALT]: '' });
      continue;
    }
    for (const { meal, alt } of excl) {
      rows.push({
        ...base,
        [DIET_COL_MEAL]:      meal.name,
        [DIET_COL_MEAL_TYPE]: MEAL_TYPE_LABELS[meal.type] ?? meal.type,
        [DIET_COL_SNACK]:     meal.is_snack ? 'نعم' : 'لا',
        [DIET_COL_ENTITY]:    meal.entity_type ? ENTITY_TYPE_LABELS_PLURAL[meal.entity_type] : '',
        [DIET_COL_ALT]:       alt?.name ?? '',
      });
    }
  }
  return rows;
}

// ─── الاستيراد ──────────────────────────────────────────────────────────────

export interface ParsedDiet {
  name: string;
  /** undefined = عمود الوصف غائب عن الملف، فلا نمسح الوصف الحالي */
  description: string | null | undefined;
  exclusions: { meal_id: string; alternative_meal_id: string | null }[];
}

/**
 * يجمّع صفوف الملف حسب النظام ويحلّ أسماء الأصناف إلى معرّفاتها.
 * أي خطأ يُرجَع برقم صفه — والمستدعي لا يكتب شيئاً ما دامت هناك أخطاء.
 */
export function parseDietRows(
  rows: Record<string, string>[],
  meals: MealLite[],
): { diets: ParsedDiet[]; errors: string[] } {
  const errors: string[] = [];
  const byKey = new Map<string, ParsedDiet & { seen: Set<string> }>();
  const hasDescCol = rows.some(r => DIET_COL_DESC in r);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `صف ${i + 2}`;
    const name = clean(row[DIET_COL_NAME]);
    if (!name) {
      // صف فارغ تماماً يُتجاهل؛ صف فيه بيانات بلا اسم نظام خطأ
      if (Object.values(row).some(v => clean(v))) errors.push(`${label}: اسم النظام مطلوب`);
      continue;
    }

    const key = dietNameKey(name);
    let diet = byKey.get(key);
    if (!diet) {
      diet = { name, description: hasDescCol ? null : undefined, exclusions: [], seen: new Set() };
      byKey.set(key, diet);
    }
    const desc = clean(row[DIET_COL_DESC]);
    if (desc && !diet.description) diet.description = desc;

    const mealName = clean(row[DIET_COL_MEAL]);
    const altName = clean(row[DIET_COL_ALT]);
    if (!mealName) {
      if (altName) errors.push(`${label} (${name}): البديل "${altName}" بلا صنف مستبعد`);
      continue;
    }

    // ── الصنف المستبعد ──
    const typeRaw = clean(row[DIET_COL_MEAL_TYPE]);
    const type = typeRaw ? (TYPE_FROM_TEXT[typeRaw] ?? TYPE_FROM_TEXT[typeRaw.toLowerCase()]) : undefined;
    if (typeRaw && !type) { errors.push(`${label} (${mealName}): وجبة الصنف "${typeRaw}" غير صحيحة — القيم المقبولة: فطور، غداء، عشاء`); continue; }

    const snackRaw = clean(row[DIET_COL_SNACK]).toLowerCase();
    const isSnack = YES.has(snackRaw) ? true : NO.has(snackRaw) ? false : undefined;
    if (snackRaw && isSnack === undefined) { errors.push(`${label} (${mealName}): قيمة «سناك» "${snackRaw}" غير مفهومة — اكتب نعم أو لا`); continue; }

    const entRaw = clean(row[DIET_COL_ENTITY]);
    const entity = entRaw ? ENTITY_FROM_TEXT[entRaw] : undefined;
    if (entRaw && !entity) { errors.push(`${label} (${mealName}): فئة الصنف "${entRaw}" غير معروفة — المقبول: ${ENTITY_TYPE_LABELS_PLURAL.beneficiary}، ${ENTITY_TYPE_LABELS_PLURAL.companion}`); continue; }

    const candidates = meals
      .filter(m => clean(m.name) === mealName)
      .filter(m => type === undefined || m.type === type)
      .filter(m => isSnack === undefined || m.is_snack === isSnack)
      // صنف بلا entity_type (قبل ترقية المرافقين) يُعدّ للمستفيدين
      .filter(m => entity === undefined || (m.entity_type ?? 'beneficiary') === entity);
    const where = [type && MEAL_TYPE_LABELS[type], isSnack === true ? 'سناك' : null, entity && ENTITY_TYPE_LABELS_PLURAL[entity]]
      .filter(Boolean).join(' · ');
    if (candidates.length === 0) {
      errors.push(`${label} (${name}): الصنف "${mealName}"${where ? ` (${where})` : ''} غير موجود في صفحة الأصناف`);
      continue;
    }
    // نفس الاسم في أكثر من وجبة/فئة ولم يُحدَّد أيّها — لا نخمّن
    const distinct = new Set(candidates.map(m => `${m.type}|${m.is_snack}|${m.entity_type ?? 'beneficiary'}`));
    if (distinct.size > 1) {
      errors.push(`${label} (${name}): الصنف "${mealName}" موجود في أكثر من وجبة أو فئة — حدّد «${DIET_COL_MEAL_TYPE}» و«${DIET_COL_SNACK}» و«${DIET_COL_ENTITY}»`);
      continue;
    }
    const meal = candidates[0];

    if (diet.seen.has(meal.id)) { errors.push(`${label} (${name}): الصنف "${mealName}" مكرر في نفس النظام`); continue; }

    // ── البديل: من نفس الوجبة ونفس «سناك»، ونفضّل نفس فئة الصنف ──
    let altId: string | null = null;
    if (altName) {
      const pool = meals.filter(m => clean(m.name) === altName && m.type === meal.type && m.is_snack === meal.is_snack && m.id !== meal.id);
      const sameEntity = pool.filter(m => (m.entity_type ?? 'beneficiary') === (meal.entity_type ?? 'beneficiary'));
      const alt = (sameEntity[0] ?? pool[0]);
      if (!alt) {
        errors.push(`${label} (${name}): البديل "${altName}" غير موجود ضمن أصناف ${MEAL_TYPE_LABELS[meal.type]}${meal.is_snack ? ' (سناك)' : ''}`);
        continue;
      }
      altId = alt.id;
    }

    diet.seen.add(meal.id);
    diet.exclusions.push({ meal_id: meal.id, alternative_meal_id: altId });
  }

  const diets = [...byKey.values()].map(({ seen: _seen, ...d }) => d);
  return { diets, errors };
}
