import type { Meal, MealType, ItemCategory, MenuItem } from '@/lib/types';
import { MENU_DAYS, MEAL_SECTIONS, WEEK_NUMBERS, WEEK_TITLES } from '@/lib/menu-utils';

// ─── Layout ─────────────────────────────────────────────────────────────────
//   Row 0:  Title — merged across all columns
//   Row 1:  Day headers — Sat..Fri  +  "اليوم" label column
//   Per meal type (فطور / غداء / عشاء):
//     HOT_ROWS   rows — category=hot,   label= "الفطور"/"الغداء"/"العشاء"
//     COLD_ROWS  rows — category=cold,  label= "بارد"
//     SNACK_ROWS rows — category=snack, label= "سناك"
//
// Columns are written right-to-left (col 0 = الجمعة, col 6 = السبت) so the
// sheet renders correctly in RTL mode.

const HOT_ROWS   = 5;
const COLD_ROWS  = 3;
const SNACK_ROWS = 4;

const COL_DAYS        = [...MENU_DAYS].reverse(); // [Fri, Thu, Wed, Tue, Mon, Sun, Sat]
const NUM_DAY_COLS    = COL_DAYS.length;           // 7
const LABEL_COL_INDEX = NUM_DAY_COLS;              // rightmost col = "اليوم"

interface SectionLayout {
  startRow: number;
  rows:     number;
  category: ItemCategory;
  label:    string;
  meal_type: MealType;
}

function buildSectionLayout(): SectionLayout[] {
  const out: SectionLayout[] = [];
  let row = 2; // after title (0) + header (1)
  for (const s of MEAL_SECTIONS) {
    out.push({ startRow: row, rows: HOT_ROWS,   category: 'hot',   label: s.label,  meal_type: s.meal_type });
    row += HOT_ROWS;
    out.push({ startRow: row, rows: COLD_ROWS,  category: 'cold',  label: 'بارد',   meal_type: s.meal_type });
    row += COLD_ROWS;
    out.push({ startRow: row, rows: SNACK_ROWS, category: 'snack', label: 'سناك',   meal_type: s.meal_type });
    row += SNACK_ROWS;
  }
  return out;
}
const SECTIONS   = buildSectionLayout();
const TOTAL_ROWS = 2 + MEAL_SECTIONS.length * (HOT_ROWS + COLD_ROWS + SNACK_ROWS);
const TOTAL_COLS = NUM_DAY_COLS + 1;

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

// ─── Export ─────────────────────────────────────────────────────────────────

export async function exportMenuXLSX(items: MenuItem[], _meals: Meal[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  if (!wb.Workbook) wb.Workbook = {};
  if (!wb.Workbook.Views) wb.Workbook.Views = [];
  wb.Workbook.Views[0] = { RTL: true };

  for (const week of WEEK_NUMBERS) {
    const sheet = buildWeekSheet(XLSX, items.filter(i => i.week_number === week), week);
    XLSX.utils.book_append_sheet(wb, sheet, WEEK_TITLES[week]);
  }

  XLSX.writeFile(wb, `قائمة_الطعام_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function buildWeekSheet(XLSX: typeof import('xlsx'), weekItems: MenuItem[], week: number) {
  const matrix: (string | null)[][] = Array.from({ length: TOTAL_ROWS }, () => Array(TOTAL_COLS).fill(null));

  // Row 0: title
  matrix[0][0] = WEEK_TITLES[week as 1 | 2 | 3 | 4];

  // Row 1: day headers
  COL_DAYS.forEach((d, idx) => { matrix[1][idx] = d.label; });
  matrix[1][LABEL_COL_INDEX] = 'اليوم';

  // Section labels
  for (const s of SECTIONS) {
    matrix[s.startRow][LABEL_COL_INDEX] = s.label;
  }

  // Data cells — one section per category, no @suffix needed
  for (const s of SECTIONS) {
    for (let colIdx = 0; colIdx < NUM_DAY_COLS; colIdx++) {
      const day = COL_DAYS[colIdx].value;
      const slotItems = weekItems
        .filter(i =>
          i.day_of_week   === day         &&
          i.meal_type     === s.meal_type &&
          i.category      === s.category
        )
        .sort((a, b) => a.position - b.position);

      for (let r = 0; r < s.rows; r++) {
        const item = slotItems[r];
        if (!item) continue;
        const name = item.meals?.name ?? '';
        const mult = item.multiplier ?? 1;
        matrix[s.startRow + r][colIdx] = mult > 1 ? `${name} ×${mult}` : name;
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
  ws['!rows'] = Array.from({ length: TOTAL_ROWS }, (_, i) => ({ hpt: i === 0 ? 26 : 22 }));

  // Merges
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: TOTAL_COLS - 1 } });
  for (const s of SECTIONS) {
    merges.push({
      s: { r: s.startRow, c: LABEL_COL_INDEX },
      e: { r: s.startRow + s.rows - 1, c: LABEL_COL_INDEX },
    });
  }
  ws['!merges'] = merges;

  // Cell styles
  for (let r = 0; r < TOTAL_ROWS; r++) {
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
        const sec = SECTIONS.find(s => r >= s.startRow && r < s.startRow + s.rows);
        cell.s.fill = sec ? labelFill(sec) : HEADER_FILL;
      } else {
        const sec = SECTIONS.find(s => r >= s.startRow && r < s.startRow + s.rows);
        if (sec) cell.s.fill = cellFill(sec);
      }
    }
  }

  ws['!sheetView'] = [{ rightToLeft: true } as unknown as never];
  return ws;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface ImportedRow {
  week_number: number;
  day_of_week: number;
  meal_type:   MealType;
  meal_id:     string;
  category:    ItemCategory;
  position:    number;
  multiplier:  number;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function importMenuXLSX(file: File, meals: Meal[]): Promise<{
  rows:   ImportedRow[];
  errors: string[];
  weeks:  number[];
}> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const errors: string[] = [];
  const rows: ImportedRow[] = [];
  const touchedWeeks = new Set<number>();

  // Meal lookup maps
  const mealByNameType = new Map<string, Meal[]>();
  for (const m of meals) {
    const k = `${norm(m.name)}|${m.type}|${m.is_snack ? '1' : '0'}`;
    const list = mealByNameType.get(k) ?? [];
    list.push(m);
    mealByNameType.set(k, list);
  }
  const mealByName = new Map<string, Meal[]>();
  for (const m of meals) {
    const list = mealByName.get(norm(m.name)) ?? [];
    list.push(m);
    mealByName.set(norm(m.name), list);
  }

  for (const sheetName of wb.SheetNames) {
    const week = WEEK_NUMBERS.find(w =>
      norm(WEEK_TITLES[w]) === norm(sheetName) ||
      norm(sheetName).includes(String(w))
    );
    if (!week) continue;

    touchedWeeks.add(week);
    const ws = wb.Sheets[sheetName];
    const matrix: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as string[][];

    for (const s of SECTIONS) {
      const isSnack = s.category === 'snack';
      for (let colIdx = 0; colIdx < NUM_DAY_COLS; colIdx++) {
        const day = COL_DAYS[colIdx].value;
        for (let r = 0; r < s.rows; r++) {
          const cellRow = s.startRow + r;
          const raw = matrix[cellRow]?.[colIdx];
          let cellText = raw ? norm(String(raw)) : '';
          if (!cellText) continue;

          // Category: comes from the section by default.
          // @بارد / @حار / @سناك suffix can override (backward compat with old files).
          let category: ItemCategory = s.category;
          const catMatch = cellText.match(/@\s*(حار|بارد|سناك)\b/);
          if (catMatch) {
            category = catMatch[1] === 'حار' ? 'hot' : catMatch[1] === 'بارد' ? 'cold' : 'snack';
            cellText = cellText.replace(catMatch[0], '').trim();
          }

          // Multiplier: " ×N" or " *N" or " xN"
          let multiplier = 1;
          const multMatch = cellText.match(/[\s ]*[×x*]\s*(\d+)\s*$/i);
          if (multMatch) {
            const n = parseInt(multMatch[1], 10);
            if (n >= 1 && n <= 100) multiplier = n;
            cellText = cellText.slice(0, multMatch.index).trim();
          }

          const name = cellText;
          if (!name) continue;

          // Find meal: exact (name, meal_type, is_snack) then fall back to name only
          const exactKey = `${name}|${s.meal_type}|${isSnack ? '1' : '0'}`;
          let candidates = mealByNameType.get(exactKey);
          if (!candidates || candidates.length === 0) {
            candidates = mealByName.get(name);
          }
          if (!candidates || candidates.length === 0) {
            errors.push(`الورقة "${sheetName}" — صف ${cellRow + 1}: الصنف "${name}" غير موجود في قاعدة الأصناف`);
            continue;
          }
          const meal = candidates[0];

          rows.push({
            week_number: week,
            day_of_week: day,
            meal_type:   s.meal_type,
            meal_id:     meal.id,
            category,
            position:    r,
            multiplier,
          });
        }
      }
    }
  }

  // Deduplicate by (week, day, meal_type, meal_id) — last wins
  const seen = new Map<string, ImportedRow>();
  for (const r of rows) {
    const k = `${r.week_number}|${r.day_of_week}|${r.meal_type}|${r.meal_id}`;
    seen.set(k, r);
  }

  return {
    rows:   Array.from(seen.values()),
    errors,
    weeks:  Array.from(touchedWeeks),
  };
}
