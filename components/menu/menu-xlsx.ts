import type { Meal, MealType, ItemCategory, MenuItem } from '@/lib/types';
import type { MenuImportRow } from '@/lib/menu-import';
import {
  MENU_DAYS,
  MEAL_SECTIONS,
  WEEK_NUMBERS,
  WEEK_TITLES,
  MAIN_ROWS_PER_MEAL,
  SNACK_ROWS_PER_MEAL,
  buildSlotMap,
  slotKey,
  effectiveCategory,
  mainPosition,
  snackPosition,
} from '@/lib/menu-utils';

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

  // نقشّر لاحقتين على الأكثر (مضاعف + كمية إضافية) من نهاية النص
  for (let guard = 0; guard < 2; guard++) {
    if (!base || isKnownName(base)) break;
    const m = base.match(/\s(\S+)$/);
    if (!m || m.index === undefined) break;
    const token = latinDigits(m[1]);

    const mult = token.match(MULT_TOKEN);
    if (mult && !sawMult) {
      const n = parseInt(mult[1], 10);
      if (n >= 1 && n <= 100) multiplier = n;
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

  return { name: base, multiplier, extra };
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

export function buildMenuWorkbook(XLSX: typeof import('xlsx'), items: MenuItem[]) {
  const wb = XLSX.utils.book_new();
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Views) wb.Workbook.Views = [];
  wb.Workbook.Views[0] = { RTL: true };

  const { hotRows, coldRows, snackRows } = measureSections(items);
  const sections = buildSectionLayout(hotRows, coldRows, snackRows);
  const totalRows = 2 + MEAL_SECTIONS.length * (hotRows + coldRows + snackRows);

  for (const week of WEEK_NUMBERS) {
    const sheet = buildWeekSheet(XLSX, items.filter(i => i.week_number === week), week, sections, totalRows);
    XLSX.utils.book_append_sheet(wb, sheet, WEEK_TITLES[week]);
  }
  return wb;
}

export async function exportMenuXLSX(items: MenuItem[], _meals: Meal[]) {
  const XLSX = await import('xlsx');
  const wb = buildMenuWorkbook(XLSX, items);
  XLSX.writeFile(wb, `قائمة_الطعام_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function buildWeekSheet(
  XLSX: typeof import('xlsx'),
  weekItems: MenuItem[],
  week: number,
  sections: SectionLayout[],
  totalRows: number,
) {
  const matrix: (string | null)[][] = Array.from({ length: totalRows }, () => Array(TOTAL_COLS).fill(null));

  // Row 0: title
  matrix[0][0] = WEEK_TITLES[week as 1 | 2 | 3 | 4];

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
          item.meals?.name ?? '',
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
      cell.s.font = { name: 'Cairo', sz: r === 0 ? 13 : 11, bold: r === 0 || r === 1 || c === LABEL_COL_INDEX };
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
function readSheetLayout(matrix: string[][]): { dayCols: { col: number; day: number }[]; sections: SectionLayout[] } | null {
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

  return { dayCols, sections };
}

/** مُحلِّل قابل للاختبار — يفصل قراءة الملف عن منطق التحويل. */
export function parseMenuWorkbook(
  XLSX: typeof import('xlsx'),
  wb: import('xlsx').WorkBook,
  meals: Meal[],
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

  for (const sheetName of wb.SheetNames) {
    const week = WEEK_NUMBERS.find(w =>
      norm(WEEK_TITLES[w]) === norm(sheetName) ||
      norm(sheetName).includes(String(w))
    );
    if (!week) continue;

    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as string[][];

    const layout = readSheetLayout(matrix);
    const dayCols = layout?.dayCols ?? COL_DAYS.map((d, col) => ({ col, day: d.value }));
    const sections = layout?.sections ?? LEGACY_SECTIONS;
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

          // لاحقة الفئة @حار/@بارد/@سناك — توافق مع ملفات قديمة
          let category: ItemCategory = s.category;
          let text = cellText;
          const catMatch = text.match(/@\s*(حار|بارد|سناك)\b/);
          if (catMatch) {
            category = catMatch[1] === 'حار' ? 'hot' : catMatch[1] === 'بارد' ? 'cold' : 'snack';
            text = norm(text.replace(catMatch[0], ''));
          }

          const { name, multiplier, extra } = parseCellText(text, isKnownName);
          if (!name) continue;

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
          errors.push(`${slotWhere}: عدد أصناف ${isSnack ? 'السناك' : 'الوجبة'} (${list.length}) أكبر من السعة (${cap})`);
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

      emit(slot.mains,  MAIN_ROWS_PER_MEAL,  false);
      emit(slot.snacks, SNACK_ROWS_PER_MEAL, true);
    }
  }

  return {
    rows,
    errors,
    weeks: Array.from(touchedWeeks).sort((a, b) => a - b),
  };
}

export async function importMenuXLSX(file: File, meals: Meal[]): Promise<ParsedMenuImport> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  return parseMenuWorkbook(XLSX, wb, meals);
}
