/**
 * تخطيط الستيكر القابل للتحكم: أي العناصر تظهر + حجم خط كل عنصر.
 *
 * ملف نقي بلا docx — تستهلكه المعاينة في الصفحة وتصدير Word معاً، فالمعاينة
 * تحسب نفس الأحجام اللي بتطلع في الملف بالضبط.
 */

import type { ReportData, ItemCategory } from '@/lib/types';
import { transliterate } from '@/lib/transliterate';

export type StickerField =
  | 'orderInfo' | 'title' | 'code' | 'villa' | 'nameAr' | 'nameEn'
  | 'excluded' | 'alt' | 'noEn' | 'yesEn' | 'fixed';

export type FieldMap<T> = Record<StickerField, T>;

/** بالترتيب اللي تظهر فيه على الستيكر. defaultPt = الحجم الأصلي (قبل التحجيم بالمقاس). */
export const STICKER_FIELDS: { key: StickerField; label: string; defaultPt: number }[] = [
  { key: 'orderInfo', label: 'التاريخ | الوجبة | الأسبوع | اليوم', defaultPt: 7 },
  { key: 'title',     label: 'شريط الوجبة والتصنيف (غداء LUNCH 🔥)', defaultPt: 9 },
  { key: 'code',      label: 'الكود Code', defaultPt: 11 },
  { key: 'villa',     label: 'الفيلا Villa', defaultPt: 11 },
  { key: 'nameAr',    label: 'الاسم عربي', defaultPt: 14 },
  { key: 'nameEn',    label: 'الاسم إنجليزي', defaultPt: 10 },
  { key: 'excluded',  label: 'مستبعد (عربي)', defaultPt: 9.5 },
  { key: 'alt',       label: 'بديل (عربي)', defaultPt: 9.5 },
  { key: 'noEn',      label: 'NO (إنجليزي)', defaultPt: 9 },
  { key: 'yesEn',     label: 'YES (إنجليزي)', defaultPt: 9 },
  { key: 'fixed',     label: 'إضافات', defaultPt: 8 },
];

const fieldMap = <T,>(f: (key: StickerField, defaultPt: number) => T): FieldMap<T> =>
  Object.fromEntries(STICKER_FIELDS.map(x => [x.key, f(x.key, x.defaultPt)])) as FieldMap<T>;

export const DEFAULT_SIZES: FieldMap<number> = fieldMap((_, pt) => pt);
export const ALL_SHOWN: FieldMap<boolean> = fieldMap(() => true);

export interface StickerLayout {
  /** auto = السلوك القديم (يتحجّم مع المقاس ويصغر لين يدخل) · manual = الأحجام اللي تحددها أنت */
  mode: 'auto' | 'manual';
  show: FieldMap<boolean>;
  /** أحجام الخط بالنقطة (pt) — للوضع اليدوي */
  sizes: FieldMap<number>;
  /** هامش الصفحة بالمللي — للوضع اليدوي */
  marginMm: number;
  /** معامل المسافات بين الأسطر — للوضع اليدوي (1 = الافتراضي) */
  spacing: number;
  /** في الوضع اليدوي: لو النص فاض عن الستيكر يصغّر الكل بنفس النسبة بدل ما يطلع على صفحتين */
  shrinkToFit: boolean;
}

export const DEFAULT_LAYOUT: StickerLayout = {
  mode: 'auto',
  show: ALL_SHOWN,
  sizes: DEFAULT_SIZES,
  marginMm: 4,
  spacing: 1,
  shrinkToFit: false,
};

/** يدمج إعداد محفوظ (قد يكون ناقص حقول من نسخة قديمة) مع الافتراضي. */
export function normalizeLayout(raw: unknown): StickerLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StickerLayout>;
  const num = (v: unknown, d: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;
  return {
    mode: r.mode === 'manual' ? 'manual' : 'auto',
    show: fieldMap(k => (typeof r.show?.[k] === 'boolean' ? r.show[k] : true)),
    sizes: fieldMap((k, d) => num(r.sizes?.[k], d, MIN_PT, MAX_PT)),
    marginMm: num(r.marginMm, DEFAULT_LAYOUT.marginMm, 0, 15),
    spacing: num(r.spacing, 1, 0, 3),
    shrinkToFit: r.shrinkToFit === true,
  };
}

export const MIN_PT = 4;
export const MAX_PT = 72;

// ─── بيانات الستيكر الجاهزة للعرض ───────────────────────────────────────────

export type StickerDetail = ReportData['beneficiaryDetails'][0] & { groupIndex: number; category: ItemCategory | null };

export interface StickerData {
  ben: ReportData['beneficiaryDetails'][0]['beneficiary'];
  groupIndex: number;
  category: ItemCategory | null;
  excludedNames: string;
  excludedTranslit: string;
  altNames: string;
  altTranslit: string;
  fixedItems: string | null;
}

export function prepareSticker(
  detail: ReportData['beneficiaryDetails'][0],
  groupIndex: number,
  category: ItemCategory | null,
  customDict: Record<string, string>,
): StickerData {
  const ben = detail.beneficiary;
  const items = detail.excludedItems ?? [];
  const fixedMealsToday = (detail.fixedItems ?? []).map(m => m.meal.name);
  const altItems = items.filter(e => e.alternative);

  const excludedNames = items
    .map(({ meal }) => `${meal.name}${meal.is_snack ? ' (snak)' : ''}`)
    .join('، ');
  const excludedTranslit = items
    .map(({ meal }) => {
      const tr = transliterate(meal.name, customDict);
      return tr ? (meal.is_snack ? `${tr} (snak)` : tr) : '';
    })
    .filter(Boolean)
    .join(' | ');
  const altNames = [
    ...altItems.map(e => `${e.alternative!.name}${e.meal.is_snack ? ' (snak)' : ''}`),
    ...fixedMealsToday,
  ].join('، ');
  const altTranslit = [
    ...altItems
      .map(e => {
        const tr = transliterate(e.alternative!.name, customDict);
        return tr ? (e.meal.is_snack ? `${tr} (snak)` : tr) : '';
      })
      .filter(Boolean),
    ...fixedMealsToday.map(n => transliterate(n, customDict)).filter(Boolean),
  ].join(' | ');

  return {
    ben,
    groupIndex,
    category,
    excludedNames,
    excludedTranslit,
    altNames,
    altTranslit,
    fixedItems: ben.fixed_items ? String(ben.fixed_items) : null,
  };
}

// ─── المسافات (twip) — مصدر واحد لفقرات Word والمعاينة ──────────────────────

/** [قبل, بعد] بالـtwip لكل فقرة */
export const PARA_SPACING: Record<StickerField | 'codeVilla', [number, number]> = {
  orderInfo: [0, 40],
  title: [0, 80],
  codeVilla: [0, 60],
  code: [0, 60],
  villa: [0, 60],
  nameAr: [0, 30],
  nameEn: [0, 80],
  excluded: [0, 40],
  alt: [0, 80],
  noEn: [40, 40],
  yesEn: [0, 40],
  fixed: [60, 0],
};

// ─── حساب أحجام صفحة ستيكر بمقاس معيّن ───────────────────────────────────────

const mmToPt = (mm: number) => (mm * 72) / 25.4;

export interface PageCtx {
  /** هل يوجد سطر تاريخ/وجبة (أمر تشغيل معروف) */
  hasOrderInfo: boolean;
  mealTypeAr: string;
  mealTypeEn: string;
}

export interface PageLayout {
  /** الحجم النهائي لكل عنصر بالنقطة */
  sizes: FieldMap<number>;
  spacingScale: number;
  marginMm: number;
}

/** هل يُطبع شريط الوجبة/التصنيف لهذا الستيكر؟ (في التصدير بالمقاس العنوان دائماً موجود) */
export const showsTitle = (show: FieldMap<boolean>) => show.title;

function estimateHeightPt(
  s: StickerData, show: FieldMap<boolean>, ctx: PageCtx,
  sizes: FieldMap<number>, spacingScale: number, availWPt: number,
): number {
  // [حجم الخط, النص, المسافة قبل+بعد بالـtwip]
  const paras: [number, string, number][] = [];
  const sp = (k: keyof typeof PARA_SPACING) => PARA_SPACING[k][0] + PARA_SPACING[k][1];
  if (show.orderInfo && ctx.hasOrderInfo) paras.push([sizes.orderInfo, `00/00/0000 | ${ctx.mealTypeAr} | أسبوع 0 | الأربعاء`, sp('orderInfo')]);
  if (showsTitle(show)) paras.push([sizes.title, `${ctx.mealTypeAr} ${ctx.mealTypeEn} سناك ★ ستيكر`, sp('title')]);
  const cv = [show.code ? `Code: ${s.ben.code}` : '', show.villa && s.ben.villa ? `   Villa: ${s.ben.villa}` : ''].join('');
  if (cv) paras.push([Math.max(show.code ? sizes.code : 0, show.villa && s.ben.villa ? sizes.villa : 0), cv, sp('codeVilla')]);
  if (show.nameAr) paras.push([sizes.nameAr, s.ben.name, sp('nameAr')]);
  if (show.nameEn && s.ben.english_name) paras.push([sizes.nameEn, s.ben.english_name, sp('nameEn')]);
  if (show.excluded && s.excludedNames) paras.push([sizes.excluded, `مستبعد: ${s.excludedNames}`, sp('excluded')]);
  if (show.alt && s.altNames) paras.push([sizes.alt, `بديل: ${s.altNames}`, sp('alt')]);
  if (show.noEn && s.excludedTranslit) paras.push([sizes.noEn, ` NO: ${s.excludedTranslit} `, sp('noEn')]);
  if (show.yesEn && s.altTranslit) paras.push([sizes.yesEn, ` YES: ${s.altTranslit} `, sp('yesEn')]);
  if (show.fixed && s.fixedItems) paras.push([sizes.fixed, `إضافات: ${s.fixedItems}`, sp('fixed')]);

  return paras.reduce((h, [f, text, spaceTw]) => {
    const charW = f * 0.6;                     // عرض الحرف التقريبي (محافظ)
    const lines = Math.max(1, Math.ceil((text.length * charW) / availWPt));
    return h + lines * f * 1.5 + (spaceTw * spacingScale) / 20;
  }, 0) + 4; // + حدّ «إضافات» وهامش أمان
}

const scaleSizes = (sizes: FieldMap<number>, k: number): FieldMap<number> =>
  fieldMap(key => sizes[key] * k);

/** أكبر معامل (≤ max) يخلّي الستيكر كامل داخل الصفحة. */
function fitFactor(fits: (k: number) => boolean, max: number): number {
  if (fits(max)) return max;
  let lo = 0.1, hi = max;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** المعامل الأساسي في الوضع التلقائي حسب المقاس (كما كان). */
export const autoBaseScale = (widthCm: number, heightCm: number) =>
  Math.max(0.7, Math.min(1.5, Math.min(widthCm, heightCm) / 11));

/** الهامش التلقائي: يصغر في المقاسات الصغيرة حتى لا يأكل الصفحة. */
export const autoMarginMm = (widthCm: number, heightCm: number) =>
  Math.min(4, Math.min(widthCm, heightCm) * 10 * 0.08);

export function resolvePageLayout(
  s: StickerData, layout: StickerLayout, widthCm: number, heightCm: number, ctx: PageCtx,
): PageLayout {
  const marginMm = layout.mode === 'auto' ? autoMarginMm(widthCm, heightCm) : layout.marginMm;
  const availWPt = mmToPt(widthCm * 10 - 2 * marginMm);
  const availHPt = mmToPt(heightCm * 10 - 2 * marginMm);
  const fitsWith = (base: FieldMap<number>, spacing: (k: number) => number) => (k: number) =>
    estimateHeightPt(s, layout.show, ctx, scaleSizes(base, k), spacing(k), availWPt) <= availHPt * 0.92;

  if (layout.mode === 'auto') {
    const base = autoBaseScale(widthCm, heightCm);
    const spacing = (k: number) => Math.min(1, k / base);
    const k = fitFactor(fitsWith(DEFAULT_SIZES, spacing), base);
    return { sizes: scaleSizes(DEFAULT_SIZES, k), spacingScale: spacing(k), marginMm };
  }

  if (!layout.shrinkToFit) return { sizes: layout.sizes, spacingScale: layout.spacing, marginMm };
  const spacing = (k: number) => layout.spacing * k;
  const k = fitFactor(fitsWith(layout.sizes, spacing), 1);
  return { sizes: scaleSizes(layout.sizes, k), spacingScale: spacing(k), marginMm };
}

/** نقطة بداية الوضع اليدوي: الأحجام اللي كان يعطيها التلقائي لهذا المقاس (مقرّبة لنصف نقطة). */
export function manualFromAuto(widthCm: number, heightCm: number): Pick<StickerLayout, 'sizes' | 'marginMm' | 'spacing'> {
  const base = autoBaseScale(widthCm, heightCm);
  return {
    sizes: fieldMap((_, d) => Math.round(d * base * 2) / 2),
    marginMm: Math.round(autoMarginMm(widthCm, heightCm) * 2) / 2,
    spacing: 1,
  };
}
