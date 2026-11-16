/**
 * ستيكرات العينات — منطق نقي بلا React (يُختبر وحده).
 *
 * الصفحة مستقلة تماماً: لا تكتب في أي جدول، ولا تعدّل ملفات ستيكرات الفطور
 * أو الغداء والعشاء — تقرأ أصناف أمر التشغيل فقط (الرئيسية + السناكات، بلا
 * البدائل لأنها ليست ضمن order_items أصلاً).
 */

import type { EntityType, ItemCategory, Meal, MealType } from '@/lib/types';
import { transliterate } from '@/lib/transliterate';

// ─── التصميم ─────────────────────────────────────────────────────────────────

export type SampleField =
  | 'logo' | 'title' | 'meal' | 'entity' | 'item' | 'itemEn' | 'production' | 'expiry' | 'note';

/** بالترتيب اللي تظهر فيه على الستيكر. defaultPx = الحجم لستيكر 10×10 ويتناسب مع المقاس. */
export const SAMPLE_FIELDS: { key: SampleField; label: string; defaultPx: number; defaultShow: boolean }[] = [
  { key: 'logo',       label: 'الشعار',                         defaultPx: 34, defaultShow: true },
  { key: 'meal',       label: 'نوع الوجبة (فوق بجانب الشعار)',  defaultPx: 26, defaultShow: true },
  { key: 'title',      label: 'العنوان (عينة SAMPLE)',          defaultPx: 24, defaultShow: true },
  { key: 'entity',     label: 'الفئة (مستفيدين/مرافقين)',        defaultPx: 15, defaultShow: true },
  { key: 'item',       label: 'اسم الصنف عربي',                 defaultPx: 24, defaultShow: true },
  { key: 'itemEn',     label: 'اسم الصنف إنجليزي',              defaultPx: 17, defaultShow: true },
  { key: 'production', label: 'تاريخ الإنتاج Production',       defaultPx: 14, defaultShow: false },
  { key: 'expiry',     label: 'تاريخ الانتهاء Expiry',          defaultPx: 16, defaultShow: true },
  { key: 'note',       label: 'ملاحظة الحفظ',                    defaultPx: 12, defaultShow: false },
];

export type SampleFieldMap<T> = Record<SampleField, T>;

const fieldMap = <T,>(f: (x: (typeof SAMPLE_FIELDS)[number]) => T): SampleFieldMap<T> =>
  Object.fromEntries(SAMPLE_FIELDS.map(x => [x.key, f(x)])) as SampleFieldMap<T>;

export interface SampleDesign {
  titleAr: string;
  titleEn: string;
  /** لون التمييز (شريط العنوان وتاريخ الانتهاء) */
  accent: string;
  /** شريط العنوان معبّأ باللون (نص أبيض) أو نص ملوّن على أبيض */
  titleFilled: boolean;
  /** إطار حول الستيكر */
  border: boolean;
  /** صلاحية العينة بالأيام من تاريخ أمر التشغيل */
  expiryDays: number;
  noteAr: string;
  noteEn: string;
  show: SampleFieldMap<boolean>;
  /** أحجام الخط بالبكسل لستيكر 10×10 (الشعار = ارتفاعه) */
  sizes: SampleFieldMap<number>;
}

export const MIN_PX = 6;
export const MAX_PX = 80;

export const DEFAULT_DESIGN: SampleDesign = {
  titleAr: 'عينة',
  titleEn: 'SAMPLE',
  accent: '#B91C1C',
  titleFilled: true,
  border: true,
  expiryDays: 3,
  noteAr: 'تُحفظ مبرّدة',
  noteEn: 'Keep refrigerated',
  show: fieldMap(f => f.defaultShow),
  sizes: fieldMap(f => f.defaultPx),
};

const HEX = /^#[0-9a-f]{6}$/i;

/** يدمج إعداداً محفوظاً (قد يكون ناقصاً أو من نسخة أقدم) مع الافتراضي. */
export function normalizeDesign(raw: unknown): SampleDesign {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SampleDesign>;
  const str = (v: unknown, d: string, max = 60) => (typeof v === 'string' ? v.slice(0, max) : d);
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  return {
    titleAr: str(r.titleAr, DEFAULT_DESIGN.titleAr),
    titleEn: str(r.titleEn, DEFAULT_DESIGN.titleEn),
    accent: typeof r.accent === 'string' && HEX.test(r.accent) ? r.accent : DEFAULT_DESIGN.accent,
    titleFilled: typeof r.titleFilled === 'boolean' ? r.titleFilled : DEFAULT_DESIGN.titleFilled,
    border: typeof r.border === 'boolean' ? r.border : DEFAULT_DESIGN.border,
    expiryDays: Math.round(num(r.expiryDays, DEFAULT_DESIGN.expiryDays, 0, 60)),
    noteAr: str(r.noteAr, DEFAULT_DESIGN.noteAr, 120),
    noteEn: str(r.noteEn, DEFAULT_DESIGN.noteEn, 120),
    show: fieldMap(f => (typeof r.show?.[f.key] === 'boolean' ? r.show[f.key] : f.defaultShow)),
    sizes: fieldMap(f => num(r.sizes?.[f.key], f.defaultPx, MIN_PX, MAX_PX)),
  };
}

// ─── التواريخ ────────────────────────────────────────────────────────────────

/** 'YYYY-MM-DD' + أيام → 'YYYY-MM-DD' (بالـUTC — بلا انزلاق المنطقة الزمنية). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return dateISO.slice(0, 10);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY' */
export const formatDMY = (dateISO: string) => {
  const s = dateISO.slice(0, 10);
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};

// ─── النصوص الثابتة ثنائية اللغة ─────────────────────────────────────────────

export const MEAL_AR: Record<MealType, string> = { breakfast: 'فطور', lunch: 'غداء', dinner: 'عشاء' };
export const MEAL_EN: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };
export const ENTITY_AR: Record<EntityType, string> = { beneficiary: 'المستفيدين', companion: 'المرافقين' };
export const ENTITY_EN: Record<EntityType, string> = { beneficiary: 'Beneficiaries', companion: 'Companions' };

// ─── الأصناف ─────────────────────────────────────────────────────────────────

export interface SampleItem {
  /** معرّف صف order_items — فريد داخل الأمر */
  key: string;
  mealId: string;
  nameAr: string;
  nameEn: string;
  isSnack: boolean;
  category: ItemCategory | null;
}

/** صف order_items كما يُقرأ للصفحة */
export interface SampleOrderItemRow {
  id: string;
  meal_id: string;
  display_name?: string | null;
  category?: ItemCategory | null;
  meals?: Pick<Meal, 'id' | 'name' | 'is_snack'> & { english_name?: string | null; category?: ItemCategory | null } | null;
}

/** «chicken kabsa» → «Chicken Kabsa» */
const titleCase = (s: string) => s.replace(/\b([a-z])/g, c => c.toUpperCase());

const CAT_RANK: Record<ItemCategory, number> = { hot: 0, cold: 1, snack: 2 };

/**
 * أصناف الأمر → أصناف الستيكرات: الرئيسية أولاً (حار ثم بارد) ثم السناكات،
 * بترتيبها داخل الأمر. الاسم = اسم العرض في الأمر إن وُجد وإلا اسم الصنف.
 * الإنجليزي = الاسم الإنجليزي للصنف، وإلا نقحرة (قاموس الترجمة المخصص أولاً).
 */
export function buildSampleItems(rows: SampleOrderItemRow[], dict: Record<string, string> = {}): SampleItem[] {
  const items = rows
    .filter(r => (r.display_name?.trim() || r.meals?.name?.trim()))
    .map((r, i) => {
      const nameAr = (r.display_name?.trim() || r.meals?.name?.trim())!;
      const category = r.category ?? r.meals?.category ?? null;
      const isSnack = !!r.meals?.is_snack || category === 'snack';
      const en = r.meals?.english_name?.trim();
      return {
        idx: i,
        item: {
          key: r.id,
          mealId: r.meal_id,
          nameAr,
          nameEn: en || titleCase(dict[nameAr] ?? transliterate(nameAr, dict)),
          isSnack,
          category,
        } satisfies SampleItem,
      };
    });
  const rank = (x: SampleItem) => (x.isSnack ? 10 : 0) + (x.category ? CAT_RANK[x.category] : 0);
  return items
    .sort((a, b) => rank(a.item) - rank(b.item) || a.idx - b.idx)
    .map(x => x.item);
}

/** يكرّر كل صنف مختار بعدد نسخه — هذي هي قائمة الستيكرات النهائية. */
export function expandStickers<T extends { key: string }>(
  items: T[], selected: ReadonlySet<string>, copies: Record<string, number>,
): { item: T; copy: number; uid: string }[] {
  const out: { item: T; copy: number; uid: string }[] = [];
  for (const it of items) {
    if (!selected.has(it.key)) continue;
    const n = Math.max(1, Math.min(50, Math.floor(copies[it.key] ?? 1) || 1));
    for (let c = 1; c <= n; c++) out.push({ item: it, copy: c, uid: `${it.key}#${c}` });
  }
  return out;
}
