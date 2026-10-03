import type { Meal, MealType, ItemCategory, MenuItem, EntityType } from '@/lib/types';
import type { MenuImportRow } from '@/lib/menu-import';
import { CATEGORY_MARK_RE, CAT_FROM_AR } from '@/lib/sheet-marks';
import {
  MENU_DAYS,
  MEAL_SECTIONS,
  WEEK_NUMBERS,
  WEEK_TITLES,
  SNACK_POSITION_OFFSET,
  buildSlotMap,
  normalizeSlot,
  slotKey,
  effectiveCategory,
  mainPosition,
  snackPosition,
} from '@/lib/menu-utils';
import { APP_FONT_NAME } from '@/lib/fonts';

// ─── Layout ─────────────────────────────────────────────────────────────────
//   Row 0:  Title — merged across all columns
//   Row 1:  Day headers — Sat..Fri  +  "اليوم" label column
//   Per meal type (فطور / غداء / عشاء):
//     hotRows   rows — category=hot,   label= "الفطور"/"الغداء"/"العشاء"
//     coldRows  rows — category=cold,  label= "بارد"
//     snackRows rows — category=snack, label= "سناك"
//
// Columns are written right-to-left (col 0 = الجمعة, col 6 = السبت) so the
// sheet renders correctly in RTL mode.
//
// ⚠️ عدد صفوف كل قسم **يتمدّد** حسب أكبر خانة في البيانات ولا ينزل تحت الحد
// الأدنى أدناه. قبل ذلك كانت الأقسام ثابتة (٥ حار / ٣ بارد / ٤ سناك)، فأي خانة
// فيها ٦ أصناف حارة كانت تفقد السادس بصمت عند التصدير — ويختفي نهائياً عند
// إعادة الرفع بوضع الاستبدال.

const MIN_HOT_ROWS   = 5;
const MIN_COLD_ROWS  = 3;
const MIN_SNACK_ROWS = 4;

const COL_DAYS        = [...MENU_DAYS].reverse(); // [Fri, Thu, Wed, Tue, Mon, Sun, Sat]
const NUM_DAY_COLS    = COL_DAYS.length;           // 7
const LABEL_COL_INDEX = NUM_DAY_COLS;              // rightmost col = "اليوم"
const TOTAL_COLS      = NUM_DAY_COLS + 1;

const COLD_LABEL  = 'بارد';
const SNACK_LABEL = 'سناك';
const DAY_COL_LABEL = 'اليوم';

/**
 * فئة المنيو (مستفيدين/مرافقين) تُكتب في عنوان كل ورقة وفي اسم الملف. بدونها
 * كان ملف منيو المستفيدين يُرفع على تبويب المرافقين (أو العكس) بلا أي تنبيه،
 * وأي صنف يحمل نفس الاسم في الفئتين يُستورد للفئة الخطأ.
 */
const ENTITY_MENU_LABEL: Record<EntityType, string> = {
  beneficiary: 'منيو المستفيدين',
  companion:   'منيو المرافقين',
};
/** جذر الكلمة — يطابق «المستفيدين/المستفيدون/مستفيدين» و«المرافقين/مرافقين». */
const ENTITY_STEM: Record<EntityType, string> = {
  beneficiary: 'مستفيد',
  companion:   'مرافق',
};
/** شرح رموز الخلية — يُكتب في صف العنوان ليفهم المستخدم ما يعدّله. */
const CELL_LEGEND = '(×ن = المضاعف، +ن أو -ن = كمية إضافية)';

/** فئة المنيو المذكورة في نص (اسم ورقة أو عنوان) — أو undefined لو لم تُذكر. */
function entityMentioned(text: string): EntityType | undefined {
  const n = norm(text);
  if (n.includes(ENTITY_STEM.companion))   return 'companion';
  if (n.includes(ENTITY_STEM.beneficiary)) return 'beneficiary';
  return undefined;
}

/** أقصى عدد أصناف في القسم الواحد — الـposition للأساسي يجب أن يبقى تحت إزاحة السناك. */
const MAX_ROWS_PER_SECTION = SNACK_POSITION_OFFSET;

interface SectionLayout {
  startRow: number;
  rows:     number;
  category: ItemCategory;
  label:    string;
  meal_type: MealType;
}

/** تخطيط الأقسام لعدد صفوف معطى — يُستخدم للتصدير وللقراءة الاحتياطية. */
function buildSectionLayout(hotRows: number, coldRows: number, snackRows: number): SectionLayout[] {
  const out: SectionLayout[] = [];
  let row = 2; // after title (0) + header (1)
  for (const s of MEAL_SECTIONS) {
    out.push({ startRow: row, rows: hotRows,   category: 'hot',   label: s.label,   meal_type: s.meal_type });
    row += hotRows;
    out.push({ startRow: row, rows: coldRows,  category: 'cold',  label: COLD_LABEL,  meal_type: s.meal_type });
    row += coldRows;
    out.push({ startRow: row, rows: snackRows, category: 'snack', label: SNACK_LABEL, meal_type: s.meal_type });
    row += snackRows;
  }
  return out;
}

/** التخطيط القديم ثابت الأحجام — احتياطي لقراءة ملفات صُدِّرت قبل هذا التعديل. */
const LEGACY_SECTIONS = buildSectionLayout(MIN_HOT_ROWS, MIN_COLD_ROWS, MIN_SNACK_ROWS);

// ─── Fill colours ────────────────────────────────────────────────────────────
const HEADER_FILL    = { fgColor: { rgb: 'FFF1F5F9' } };
const HOT_CELL_FILL  = { fgColor: { rgb: 'FFFFF7F5' } }; // very light warm
const COLD_CELL_FILL = { fgColor: { rgb: 'FFF0F9FF' } }; // very light sky
const SNACK_FILL     = { fgColor: { rgb: 'FFFCE7B5' } }; // amber

const LABEL_FILL_BREAKFAST = { fgColor: { rgb: 'FFFEF3C7' } };
const LABEL_FILL_LUNCH     = { fgColor: { rgb: 'FFD1FAE5' } };
const LABEL_FILL_DINNER    = { fgColor: { rgb: 'FFFCE7E7' } };
const LABEL_FILL_COLD      = { fgColor: { rgb: 'FFE0F2FE' } };
const LABEL_FILL_SNACK     = { fgColor: { rgb: 'FFFCE7B5' } };

function labelFill(sec: SectionLayout) {
  if (sec.category === 'cold')  return LABEL_FILL_COLD;
  if (sec.category === 'snack') return LABEL_FILL_SNACK;
  if (sec.meal_type === 'breakfast') return LABEL_FILL_BREAKFAST;
  if (sec.meal_type === 'lunch')     return LABEL_FILL_LUNCH;
  return LABEL_FILL_DINNER;
}

function cellFill(sec: SectionLayout) {
  if (sec.category === 'snack') return SNACK_FILL;
  if (sec.category === 'cold')  return COLD_CELL_FILL;
  return HOT_CELL_FILL;
}

const BORDER = {
  top:    { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
  bottom: { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
  left:   { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
  right:  { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
};

// ─── Cell text ──────────────────────────────────────────────────────────────

/** توحيد النص: مسافات غير قياسية، محارف صفرية العرض، ثم تقليص المسافات. */
export function norm(s: string): string {
  return String(s)
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')  // مسافات غير قياسية
    .replace(/[\u200B-\u200F\u061C\u2066-\u2069\uFEFF]/g, '')        // محارف صفرية العرض/اتجاه
    .replace(/\s+/g, ' ')
    .trim();
}

/** تحويل الأرقام العربية/الفارسية إلى لاتينية — للأرقام فقط، لا لأسماء الأصناف. */
function latinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
          .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

const MULT_TOKEN  = /^[×xX*]\s*(\d{1,3})$/;
const EXTRA_TOKEN = /^([+\-])(\d{1,6})$/;

/** نص خلية الصنف كما يُكتب في الملف: «الاسم ×المضاعف +الكمية الإضافية». */
export function formatCellText(name: string, multiplier: number, extra: number): string {
  const parts = [name];
  if (multiplier > 1) parts.push(`×${multiplier}`);
  if (extra !== 0)    parts.push(`${extra > 0 ? '+' : '-'}${Math.abs(extra)}`);
  return parts.join(' ');
}

export interface ParsedCell {
  name:       string;
  multiplier: number;
  extra:      number;
  /** رسالة خطأ لو اللاحقة مقروءة لكن قيمتها خارج المسموح (مثل ×0 أو ×150) */
  invalid?:   string;
}

/**
 * يفكّ نص الخلية إلى (اسم، مضاعف، كمية إضافية).
 *
 * القاعدة الحاسمة: **الاسم أولاً**. نجرّب النص كاملاً كاسم صنف معروف، وما نقص
 * منه شيئاً إلا لو ما انعرف. الطريقة القديمة كانت تبحث عن `+رقم` أو `-رقم` في
 * أي موضع من النص، فاسم مثل «عصير برتقال-2» كان يُقرأ اسماً «عصير برتقال»
 * وكمية إضافية «-2» — أي نقص صامت في العدد بعد كل عملية رفع.
 */
export function parseCellText(text: string, isKnownName: (name: string) => boolean): ParsedCell {
  let base = norm(text);
  let multiplier = 1;
  let extra = 0;
  let sawMult = false;
  let sawExtra = false;
  let invalid: string | undefined;

  // نقشّر لاحقتين على الأكثر (مضاعف + كمية إضافية) من نهاية النص
  for (let guard = 0; guard < 2; guard++) {
    if (!base || isKnownName(base)) break;
    const m = base.match(/\s(\S+)$/);
    if (!m || m.index === undefined) break;
    const token = latinDigits(m[1]);

    const mult = token.match(MULT_TOKEN);
    if (mult && !sawMult) {
      const n = parseInt(mult[1], 10);
      // سابقاً كانت القيمة خارج المدى تُستبدل بـ١ بصمت — الآن خطأ واضح
      if (n >= 1 && n <= 100) multiplier = n;
      else invalid = `المضاعف ×${n} غير مقبول — المسموح من ×1 إلى ×100`;
      sawMult = true;
      base = base.slice(0, m.index).trim();
      continue;
    }

    const ex = token.match(EXTRA_TOKEN);
    if (ex && !sawExtra) {
      const n = parseInt(ex[2], 10);
      if (n >= 0 && n <= 999_999) extra = ex[1] === '-' ? -n : n;
      sawExtra = true;
      base = base.slice(0, m.index).trim();
      continue;
    }

    break;
  }

  return invalid ? { name: base, multiplier, extra, invalid } : { name: base, multiplier, extra };
}

// ─── Export ─────────────────────────────────────────────────────────────────

/** أكبر عدد أصناف لكل فئة عبر كل الخانات — يحدّد ارتفاع أقسام الملف. */
function measureSections(items: MenuItem[]): { hotRows: number; coldRows: number; snackRows: number } {
  const counts = new Map<string, { hot: number; cold: number; snack: number }>();
  for (const it of items) {
    const k = slotKey(it.week_number, it.day_of_week, it.meal_type);
    const c = counts.get(k) ?? { hot: 0, cold: 0, snack: 0 };
    c[effectiveCategory(it)] += 1;
    counts.set(k, c);
  }
  let hot = 0, cold = 0, snack = 0;
  for (const c of counts.values()) {
    hot   = Math.max(hot,   c.hot);
    cold  = Math.max(cold,  c.cold);
    snack = Math.max(snack, c.snack);
  }
  return {
    hotRows:   Math.max(MIN_HOT_ROWS,   hot),
    coldRows:  Math.max(MIN_COLD_ROWS,  cold),
    snackRows: Math.max(MIN_SNACK_ROWS, snack),
  };
}

export interface MenuWorkbookOptions {
  /** فئة المنيو — تُكتب في عنوان كل ورقة. الافتراضي: من الأصناف نفسها. */
  entityType?: EntityType;
  /** قائمة الأصناف — احتياط لاسم الصنف لو ما وصل مع صف المنيو (join ناقص). */
  meals?: Meal[];
}

export function buildMenuWorkbook(XLSX: typeof import('xlsx'), items: MenuItem[], opts: MenuWorkbookOptions = {}) {
  const wb = XLSX.utils.book_new();
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Views) wb.Workbook.Views = [];
  wb.Workbook.Views[0] = { RTL: true };

  const { hotRows, coldRows, snackRows } = measureSections(items);
  const sections = buildSectionLayout(hotRows, coldRows, snackRows);
  const totalRows = 2 + MEAL_SECTIONS.length * (hotRows + coldRows + snackRows);
  const entityType = opts.entityType ?? items.find(i => i.entity_type)?.entity_type;
  const mealNameById = new Map((opts.meals ?? []).map(m => [m.id, m.name] as const));
  const nameOf = (it: MenuItem) => it.meals?.name ?? mealNameById.get(it.meal_id) ?? '';

  for (const week of WEEK_NUMBERS) {
    const title = [WEEK_TITLES[week], entityType ? ENTITY_MENU_LABEL[entityType] : '', CELL_LEGEND]
      .filter(Boolean).join(' — ');
    const sheet = buildWeekSheet(XLSX, items.filter(i => i.week_number === week), week, sections, totalRows, title, nameOf);
    XLSX.utils.book_append_sheet(wb, sheet, WEEK_TITLES[week]);
  }
  return wb;
}

/**
 * التصدير — ومع منيو فارغ يُنتج **قالباً** بنفس التخطيط تماماً (العناوين
 * والأقسام)، فالقالب والتصدير ملف واحد يُقرأ بنفس الكود.
 */
export async function exportMenuXLSX(items: MenuItem[], meals: Meal[], entityType?: EntityType) {
  const XLSX = await import('xlsx');
  const wb = buildMenuWorkbook(XLSX, items, { entityType, meals });
  const entityPart = entityType ? `${ENTITY_MENU_LABEL[entityType].replace(/\s+/g, '_')}_` : '';
  XLSX.writeFile(wb, `قائمة_الطعام_${entityPart}${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function buildWeekSheet(
  XLSX: typeof import('xlsx'),
  weekItems: MenuItem[],
  week: number,
  sections: SectionLayout[],
  totalRows: number,
  title: string,
  nameOf: (it: MenuItem) => string,
) {
  const matrix: (string | null)[][] = Array.from({ length: totalRows }, () => Array(TOTAL_COLS).fill(null));

  // Row 0: title
  matrix[0][0] = title;

  // Row 1: day headers
  COL_DAYS.forEach((d, idx) => { matrix[1][idx] = d.label; });
  matrix[1][LABEL_COL_INDEX] = DAY_COL_LABEL;

  // Section labels
  for (const s of sections) {
    matrix[s.startRow][LABEL_COL_INDEX] = s.label;
  }

  // Data cells — نكتب أصناف كل خانة بنفس الترتيب المعروض في الشاشة تماماً،
  // فالملف صورة طبق الأصل عن الشبكة والرفع بدون تعديل لا يغيّر شيئاً.
  const slots = buildSlotMap(weekItems);
  for (const s of sections) {
    for (let colIdx = 0; colIdx < NUM_DAY_COLS; colIdx++) {
      const day = COL_DAYS[colIdx].value;
      const slotItems = slots.get(slotKey(week, day, s.meal_type)) ?? [];
      const inSection = slotItems.filter(i => effectiveCategory(i) === s.category);

      for (let r = 0; r < inSection.length && r < s.rows; r++) {
        const item = inSection[r];
        matrix[s.startRow + r][colIdx] = formatCellText(
          nameOf(item),
          item.multiplier ?? 1,
          item.extra_quantity ?? 0,
        );
      }
    }
  }

  // AOA → worksheet
  const ws = XLSX.utils.aoa_to_sheet(matrix.map(row => row.map(c => c ?? '')));

  // Column widths
  const cols: { wch: number }[] = Array(TOTAL_COLS).fill(null).map(() => ({ wch: 18 }));
  cols[LABEL_COL_INDEX] = { wch: 12 };
  ws['!cols'] = cols;

  // Row heights
  ws['!rows'] = Array.from({ length: totalRows }, (_, i) => ({ hpt: i === 0 ? 26 : 22 }));

  // Merges
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: TOTAL_COLS - 1 } });
  for (const s of sections) {
    merges.push({
      s: { r: s.startRow, c: LABEL_COL_INDEX },
      e: { r: s.startRow + s.rows - 1, c: LABEL_COL_INDEX },
    });
  }
  ws['!merges'] = merges;

  // Cell styles
  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < TOTAL_COLS; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { v: '', t: 's' };
      const cell = ws[addr];
      cell.s = cell.s ?? {};
      cell.s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true, readingOrder: 2 };
      cell.s.font = { name: APP_FONT_NAME, sz: r === 0 ? 13 : 11, bold: r === 0 || r === 1 || c === LABEL_COL_INDEX };
      cell.s.border = BORDER;

      if (r === 0) {
        cell.s.fill = { fgColor: { rgb: 'FFFFFFFF' } };
      } else if (r === 1) {
        cell.s.fill = HEADER_FILL;
      } else if (c === LABEL_COL_INDEX) {
        const sec = sections.find(s => r >= s.startRow && r < s.startRow + s.rows);
        cell.s.fill = sec ? labelFill(sec) : HEADER_FILL;
      } else {
        const sec = sections.find(s => r >= s.startRow && r < s.startRow + s.rows);
        if (sec) cell.s.fill = cellFill(sec);
      }
    }
  }

  ws['!sheetView'] = [{ rightToLeft: true } as unknown as never];
  return ws;
}

// ─── Import ─────────────────────────────────────────────────────────────────

export type ImportedRow = MenuImportRow;

export interface ParsedMenuImport {
  rows:   MenuImportRow[];
  errors: string[];
  weeks:  number[];
}

/**
 * يقرأ تخطيط الورقة من محتواها بدل افتراض أرقام صفوف ثابتة:
 *   • أعمدة الأيام تُعرف من صف العناوين (فتُقرأ الملفات مهما كان ترتيب الأعمدة).
 *   • بداية كل قسم تُعرف من عمود «اليوم» (الفطور/بارد/سناك…)، فيقبل الملف
 *     أقساماً بأي ارتفاع — بما فيها الملفات القديمة ثابتة الأحجام.
 */
function readSheetLayout(matrix: string[][]): { headerRow: number; dayCols: { col: number; day: number }[]; sections: SectionLayout[] } | null {
  const dayByLabel = new Map(MENU_DAYS.map(d => [norm(d.label), d.value]));

  let headerRow = -1;
  let dayCols: { col: number; day: number }[] = [];
  for (let r = 0; r < Math.min(matrix.length, 6); r++) {
    const row = matrix[r] ?? [];
    const found: { col: number; day: number }[] = [];
    for (let c = 0; c < row.length; c++) {
      const day = dayByLabel.get(norm(row[c] ?? ''));
      if (day !== undefined && !found.some(f => f.day === day)) found.push({ col: c, day });
    }
    if (found.length > dayCols.length) { dayCols = found; headerRow = r; }
    if (found.length === MENU_DAYS.length) break;
  }
  if (headerRow < 0 || dayCols.length === 0) return null;

  // عمود التسميات = أول عمود بعد أعمدة الأيام يحمل «اليوم» أو تسمية قسم معروفة
  const dayColSet = new Set(dayCols.map(d => d.col));
  const sectionLabels = new Map<string, { meal_type?: MealType; category: ItemCategory }>([
    ...MEAL_SECTIONS.map(s => [norm(s.label), { meal_type: s.meal_type, category: 'hot' as ItemCategory }] as const),
    [norm(COLD_LABEL),  { category: 'cold'  as ItemCategory }],
    [norm(SNACK_LABEL), { category: 'snack' as ItemCategory }],
  ]);

  let labelCol = -1;
  const maxCol = Math.max(...matrix.map(r => (r ?? []).length), TOTAL_COLS);
  for (let c = 0; c < maxCol && labelCol < 0; c++) {
    if (dayColSet.has(c)) continue;
    if (norm(matrix[headerRow]?.[c] ?? '') === DAY_COL_LABEL) labelCol = c;
  }
  if (labelCol < 0) {
    // بدون عنوان «اليوم»: نبحث عن العمود الذي يحمل تسميات الأقسام
    for (let c = 0; c < maxCol && labelCol < 0; c++) {
      if (dayColSet.has(c)) continue;
      for (let r = headerRow + 1; r < matrix.length; r++) {
        if (sectionLabels.has(norm(matrix[r]?.[c] ?? ''))) { labelCol = c; break; }
      }
    }
  }
  if (labelCol < 0) return null;

  // حدود الأقسام: كل خلية غير فارغة في عمود التسميات تبدأ قسماً جديداً
  const starts: { row: number; meal_type?: MealType; category: ItemCategory }[] = [];
  let currentMealType: MealType | undefined;
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const label = norm(matrix[r]?.[labelCol] ?? '');
    if (!label) continue;
    const def = sectionLabels.get(label);
    if (!def) continue;
    if (def.meal_type) currentMealType = def.meal_type;
    if (!currentMealType) continue; // قسم بارد/سناك قبل أي عنوان وجبة — نتجاهله
    starts.push({ row: r, meal_type: currentMealType, category: def.category });
  }
  if (starts.length === 0) return null;

  const sections: SectionLayout[] = starts.map((s, i) => ({
    startRow: s.row,
    rows: (i + 1 < starts.length ? starts[i + 1].row : matrix.length) - s.row,
    category: s.category,
    label: '',
    meal_type: s.meal_type as MealType,
  }));

  return { headerRow, dayCols, sections };
}

/** مُحلِّل قابل للاختبار — يفصل قراءة الملف عن منطق التحويل. */
export function parseMenuWorkbook(
  XLSX: typeof import('xlsx'),
  wb: import('xlsx').WorkBook,
  meals: Meal[],
  opts: { entityType?: EntityType } = {},
): ParsedMenuImport {
  const errors: string[] = [];
  const rows: ImportedRow[] = [];
  const touchedWeeks = new Set<number>();

  // ── فهارس البحث عن الصنف ──────────────────────────────────────────────────
  const mealByNameType = new Map<string, Meal[]>();
  const mealByName     = new Map<string, Meal[]>();
  const push = (map: Map<string, Meal[]>, key: string, meal: Meal) => {
    const list = map.get(key);
    if (list) list.push(meal); else map.set(key, [meal]);
  };
  for (const m of meals) {
    const n = norm(m.name);
    push(mealByNameType, `${n}|${m.type}|${m.is_snack ? '1' : '0'}`, m);
    push(mealByName, n, m);
  }
  const isKnownName = (name: string) => mealByName.has(norm(name));
  const isSnackMeal = (m: Meal) => m.is_snack === true || m.category === 'snack';

  // ورقة → أسبوع. نقبل الاسم المطابق تماماً، أو اسماً يحوي عنوان الأسبوع
  // (مثل «الأسبوع الأول مستفيدين» في ملف النسخة الاحتياطية)، أو رقم الأسبوع
  // وحده («1» / «أسبوع 1» / «Week 1»). سابقاً كان أي رقم في أي موضع يكفي، فورقة
  // مثل «Sheet1» أو «ملاحظات 2» تُقرأ أسبوعاً — وفي وضع الاستبدال تمسحه.
  const weekOfSheet = (sheetName: string): number | undefined => {
    const n = norm(sheetName);
    const num = latinDigits(n).match(/^(?:ال)?(?:أسبوع|اسبوع|week)?\s*([1-4])$/i);
    return WEEK_NUMBERS.find(w => norm(WEEK_TITLES[w]) === n)
        ?? WEEK_NUMBERS.find(w => n.includes(norm(WEEK_TITLES[w])))
        ?? (num ? WEEK_NUMBERS.find(w => w === Number(num[1])) : undefined);
  };

  // ملف النسخة الاحتياطية فيه منيو الفئتين (أوراق بلاحقة «مستفيدين»/«مرافقين»)
  // — نأخذ أوراق الفئة المفتوحة فقط ونتجاهل الأخرى بدل رفض الملف كاملاً.
  const otherEntitySheets: string[] = [];
  const isOtherEntity = (text: string) => {
    if (!opts.entityType) return false;
    const e = entityMentioned(text);
    return e !== undefined && e !== opts.entityType;
  };

  // ورقتان لنفس الأسبوع تعني ملفاً فيه منيو الفئتين معاً — دمجهما يخلط
  // منيو المستفيدين بالمرافقين بصمت، فنرفض بدل أن نخمّن.
  const sheetByWeek = new Map<number, string>();
  for (const sheetName of wb.SheetNames) {
    const w = weekOfSheet(sheetName);
    if (w === undefined) continue;
    if (isOtherEntity(sheetName)) { otherEntitySheets.push(sheetName); continue; }
    const prev = sheetByWeek.get(w);
    if (prev) {
      errors.push(`الورقتان "${prev}" و"${sheetName}" تخصّان ${WEEK_TITLES[w as 1 | 2 | 3 | 4]} — أبقِ ورقة واحدة لكل أسبوع`);
      continue;
    }
    sheetByWeek.set(w, sheetName);
  }

  for (const sheetName of wb.SheetNames) {
    const week = weekOfSheet(sheetName);
    if (!week) continue;
    if (sheetByWeek.get(week) !== sheetName) continue;

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as string[][];

    const layout = readSheetLayout(matrix);
    const dayCols = layout?.dayCols ?? COL_DAYS.map((d, col) => ({ col, day: d.value }));
    const sections = layout?.sections ?? LEGACY_SECTIONS;

    // عنوان الورقة (ما فوق صف الأيام) يذكر فئة المنيو — لو كانت الفئة الأخرى
    // نرفض بدل أن نكتب منيو المستفيدين فوق منيو المرافقين.
    const titleText = matrix.slice(0, layout?.headerRow ?? 1).flat().join(' ');
    if (isOtherEntity(titleText)) {
      const e = entityMentioned(titleText)!;
      errors.push(
        `الورقة "${sheetName}" تخصّ ${ENTITY_MENU_LABEL[e]} — افتح تبويب «${ENTITY_MENU_LABEL[e]}» ثم استورد الملف`
      );
      continue;
    }
    touchedWeeks.add(week);

    // خانة = (يوم | نوع وجبة). نجمع أصنافها بترتيب الأقسام (حار ثم بارد ثم سناك)
    // ثم نُسند الـposition حسب الاصطلاح الموحّد، فالترتيب في الملف = الترتيب في
    // الشاشة = الترتيب بعد إعادة الرفع.
    type Pending = { meal: Meal; category: ItemCategory; multiplier: number; extra: number; where: string };
    const bySlot = new Map<string, { day: number; meal_type: MealType; mains: Pending[]; snacks: Pending[] }>();

    for (const s of sections) {
      for (const { col, day } of dayCols) {
        for (let r = 0; r < s.rows; r++) {
          const cellRow = s.startRow + r;
          const raw = matrix[cellRow]?.[col];
          const cellText = raw ? norm(String(raw)) : '';
          if (!cellText) continue;

          const where = `الورقة "${sheetName}" — ${MENU_DAYS.find(d => d.value === day)?.label ?? ''} صف ${cellRow + 1}`;

          // لاحقة الفئة @حار/@بارد/@سناك — توافق مع ملفات قديمة.
          // التعبير من lib/sheet-marks: استخدام \b هنا كان يعني ألا تُطابق أبداً.
          let category: ItemCategory = s.category;
          let text = cellText;
          const catMatch = text.match(CATEGORY_MARK_RE);
          if (catMatch) {
            category = CAT_FROM_AR[catMatch[1]] ?? s.category;
            text = norm(text.replace(catMatch[0], ''));
          }

          const { name, multiplier, extra, invalid } = parseCellText(text, isKnownName);
          if (!name) continue;
          if (invalid) {
            errors.push(`${where}: "${name}" — ${invalid}`);
            continue;
          }

          const exact = mealByNameType.get(`${norm(name)}|${s.meal_type}|${category === 'snack' ? '1' : '0'}`);
          const candidates = (exact && exact.length > 0) ? exact : mealByName.get(norm(name));
          if (!candidates || candidates.length === 0) {
            errors.push(`${where}: الصنف "${name}" غير موجود في قاعدة الأصناف`);
            continue;
          }
          const meal = candidates[0];

          // السناك لازم يكون في قسم السناك — وإلا يُعرض في مكان ويُطبخ بمنطق آخر
          const mealIsSnack = isSnackMeal(meal);
          if (mealIsSnack !== (category === 'snack')) {
            errors.push(
              mealIsSnack
                ? `${where}: "${meal.name}" صنف سناك — مكانه قسم "سناك"`
                : `${where}: "${meal.name}" ليس سناكاً — لا يوضع في قسم "سناك"`
            );
            continue;
          }

          // الأساسي: الفئة (حار/بارد) تُؤخذ من الصنف نفسه كما في الشاشة؛ القسم
          // احتياط فقط لو الصنف بلا فئة. وإلا صنف بارد في قسم الحار يُكتب «حار»
          // ثم يُصلَّح عند الفتح — أي «تعديل» وهمي في كل رفع.
          if (category !== 'snack' && (meal.category === 'hot' || meal.category === 'cold')) {
            category = meal.category;
          }

          const slot = bySlot.get(`${day}|${s.meal_type}`) ?? { day, meal_type: s.meal_type, mains: [], snacks: [] };
          (category === 'snack' ? slot.snacks : slot.mains).push({ meal, category, multiplier, extra, where });
          bySlot.set(`${day}|${s.meal_type}`, slot);
        }
      }
    }

    // ── تحويل الخانات إلى صفوف مع تحقق السعة والتكرار ────────────────────────
    for (const slot of bySlot.values()) {
      const dayLabel = MENU_DAYS.find(d => d.value === slot.day)?.label ?? '';
      const slotWhere = `الورقة "${sheetName}" — ${dayLabel}`;

      const emit = (list: Pending[], cap: number, isSnack: boolean) => {
        if (list.length > cap) {
          errors.push(`${slotWhere}: عدد أصناف ${isSnack ? 'السناك' : 'الوجبة'} (${list.length}) أكبر من الحد الأقصى (${cap})`);
          return;
        }
        list.forEach((p, i) => {
          rows.push({
            week_number:    week,
            day_of_week:    slot.day,
            meal_type:      slot.meal_type,
            meal_id:        p.meal.id,
            category:       p.category,
            position:       isSnack ? snackPosition(i) : mainPosition(i),
            multiplier:     p.multiplier,
            extra_quantity: p.extra,
          });
        });
      };

      // الصنف الواحد ما يتكرر في نفس الخانة (قيد فريد في قاعدة البيانات)
      const seen = new Set<string>();
      for (const p of [...slot.mains, ...slot.snacks]) {
        const k = `${slot.meal_type}|${p.meal.id}`;
        if (seen.has(k)) errors.push(`${slotWhere}: الصنف "${p.meal.name}" مكرّر في نفس الخانة`);
        seen.add(k);
      }

      // لا سقف عند ٨/٤: الشاشة والتصدير يتّسعان لأي عدد، فالسقف القديم كان
      // يرفض ملفاً صدّرناه نحن. الحد الوحيد أن يبقى position الأساسي تحت ١٠٠.
      emit(slot.mains,  MAX_ROWS_PER_SECTION, false);
      emit(slot.snacks, MAX_ROWS_PER_SECTION, true);
    }
  }

  if (touchedWeeks.size === 0 && otherEntitySheets.length > 0 && opts.entityType) {
    const other: EntityType = opts.entityType === 'beneficiary' ? 'companion' : 'beneficiary';
    errors.push(`الملف يخصّ ${ENTITY_MENU_LABEL[other]} — افتح تبويب «${ENTITY_MENU_LABEL[other]}» ثم استورد الملف`);
  }

  return {
    rows,
    errors,
    weeks: Array.from(touchedWeeks).sort((a, b) => a - b),
  };
}

export async function importMenuXLSX(file: File, meals: Meal[], entityType?: EntityType): Promise<ParsedMenuImport> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  return parseMenuWorkbook(XLSX, wb, meals, { entityType });
}

// ─── تحقّق الدورة ────────────────────────────────────────────────────────────

export interface RoundTripResult {
  ok: boolean;
  /** عدد الأصناف التي عبرت الدورة سليمة */
  matched: number;
  issues: string[];
}

/**
 * يصدّر المنيو الحالي في الذاكرة ثم يستورده ويقارن — بلا أي كتابة ولا تنزيل.
 * يكشف فوراً أي انحراف بين ما يُكتب في الملف وما يُقرأ منه، فلا نكتشفه بعد
 * أن يفقد المستخدم بيانات. تُستدعى من زر «تحقّق من الملف» في صفحة المنيو.
 */
export function verifyMenuRoundTrip(
  XLSX: typeof import('xlsx'),
  items: MenuItem[],
  meals: Meal[],
): RoundTripResult {
  const issues: string[] = [];

  const wb = buildMenuWorkbook(XLSX, items, { meals });
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const reread = XLSX.read(new Uint8Array(buf), { type: 'array' });
  const parsed = parseMenuWorkbook(XLSX, reread, meals);

  for (const e of parsed.errors) issues.push(`قراءة: ${e}`);

  // الحالة المتوقّعة = المنيو الحالي بعد التطبيع (نفس ما يكتبه التصدير)
  const mealName = (id: string) => meals.find(m => m.id === id)?.name ?? id;
  const expected = new Map<string, MenuImportRow>();
  for (const [, slotItems] of buildSlotMap(items)) {
    for (const { item, category, position } of normalizeSlot(slotItems)) {
      expected.set(`${item.week_number}|${item.day_of_week}|${item.meal_type}|${item.meal_id}`, {
        week_number: item.week_number,
        day_of_week: item.day_of_week,
        meal_type: item.meal_type,
        meal_id: item.meal_id,
        category,
        position,
        multiplier: item.multiplier ?? 1,
        extra_quantity: item.extra_quantity ?? 0,
      });
    }
  }

  const actual = new Map<string, MenuImportRow>(parsed.rows.map(r =>
    [`${r.week_number}|${r.day_of_week}|${r.meal_type}|${r.meal_id}`, r] as const));

  let matched = 0;
  for (const [key, exp] of expected) {
    const got = actual.get(key);
    const where = `${WEEK_TITLES[exp.week_number as 1 | 2 | 3 | 4]} — ${MENU_DAYS.find(d => d.value === exp.day_of_week)?.label} — «${mealName(exp.meal_id)}»`;
    if (!got) { issues.push(`${where}: يختفي من الملف`); continue; }

    const diffs: string[] = [];
    if (got.category !== exp.category)             diffs.push(`الفئة ${exp.category}→${got.category}`);
    if (got.position !== exp.position)             diffs.push(`الترتيب ${exp.position}→${got.position}`);
    if (got.multiplier !== exp.multiplier)         diffs.push(`المضاعف ${exp.multiplier}→${got.multiplier}`);
    if (got.extra_quantity !== exp.extra_quantity) diffs.push(`الكمية الإضافية ${exp.extra_quantity}→${got.extra_quantity}`);
    if (diffs.length > 0) issues.push(`${where}: ${diffs.join('، ')}`);
    else matched++;
  }

  for (const [key, got] of actual) {
    if (!expected.has(key)) issues.push(`صنف زائد في الملف: «${mealName(got.meal_id)}»`);
  }

  return { ok: issues.length === 0, matched, issues };
}
