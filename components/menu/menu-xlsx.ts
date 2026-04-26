import type { Meal, MealType, ItemCategory, MenuItem } from '@/lib/types';
import { MENU_DAYS, MEAL_SECTIONS, MAIN_ROWS_PER_MEAL, SNACK_ROWS_PER_MEAL, WEEK_NUMBERS, WEEK_TITLES } from '@/lib/menu-utils';

// ─── Layout (matches the menu image exactly) ────────────────────────────────
//   Row 1:  Title — merged across cols A..H
//   Row 2:  Headers — Sat..Fri then "اليوم" (label column)
//   Rows 3..7   — breakfast main (5),  H merged "الفطور"
//   Rows 8..9   — breakfast snack (2), H merged "سناك"
//   Rows 10..14 — lunch main (5),      H merged "الغداء"
//   Rows 15..16 — lunch snack (2),     H merged "سناك"
//   Rows 17..21 — dinner main (5),     H merged "العشاء"
//   Rows 22..23 — dinner snack (2),    H merged "سناك"
//
// Columns are written right-to-left (col A = الجمعة, col G = السبت) so when
// Excel/Numbers renders RTL the layout matches the image. We then mark the
// sheet as RTL on the workbook.

const COL_DAYS = [...MENU_DAYS].reverse(); // [Fri, Thu, Wed, Tue, Mon, Sun, Sat]
const NUM_DAY_COLS = COL_DAYS.length; // 7
const LABEL_COL_INDEX = NUM_DAY_COLS;  // 0-based; col index of the "اليوم" column

// Per (meal_type, isSnack) → starting row (0-based) and count
interface SectionLayout { startRow: number; rows: number; isSnack: boolean; label: string; meal_type: MealType }
function buildSectionLayout(): SectionLayout[] {
  const out: SectionLayout[] = [];
  let row = 2; // start after title (0) + header (1)
  for (const s of MEAL_SECTIONS) {
    out.push({ startRow: row, rows: MAIN_ROWS_PER_MEAL, isSnack: false, label: s.label, meal_type: s.meal_type });
    row += MAIN_ROWS_PER_MEAL;
    out.push({ startRow: row, rows: SNACK_ROWS_PER_MEAL, isSnack: true, label: 'سناك', meal_type: s.meal_type });
    row += SNACK_ROWS_PER_MEAL;
  }
  return out;
}
const SECTIONS = buildSectionLayout();

const SNACK_FILL = { fgColor: { rgb: 'FFFCE7B5' } };  // amber/yellow background for snack rows
const HEADER_FILL = { fgColor: { rgb: 'FFF1F5F9' } };
const LABEL_FILL_BREAKFAST = { fgColor: { rgb: 'FFFEF3C7' } };
const LABEL_FILL_LUNCH     = { fgColor: { rgb: 'FFD1FAE5' } };
const LABEL_FILL_DINNER    = { fgColor: { rgb: 'FFFCE7E7' } };
const LABEL_FILL_SNACK     = { fgColor: { rgb: 'FFFCE7B5' } };

function labelFill(label: string) {
  if (label === 'الفطور') return LABEL_FILL_BREAKFAST;
  if (label === 'الغداء') return LABEL_FILL_LUNCH;
  if (label === 'العشاء') return LABEL_FILL_DINNER;
  return LABEL_FILL_SNACK;
}

const BORDER = {
  top:    { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
  bottom: { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
  left:   { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
  right:  { style: 'thin' as const, color: { rgb: 'FFCBD5E1' } },
};

const TOTAL_ROWS = 2 + MEAL_SECTIONS.length * (MAIN_ROWS_PER_MEAL + SNACK_ROWS_PER_MEAL);
const TOTAL_COLS = NUM_DAY_COLS + 1;

// ─── Export ─────────────────────────────────────────────────────────────────

export async function exportMenuXLSX(items: MenuItem[], _meals: Meal[]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  // Mark workbook RTL
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
  // 2D matrix [row][col]
  const matrix: (string | null)[][] = Array.from({ length: TOTAL_ROWS }, () => Array(TOTAL_COLS).fill(null));

  // Row 0: Title (will be merged later)
  matrix[0][0] = WEEK_TITLES[week as 1 | 2 | 3 | 4];

  // Row 1: Day headers (right-to-left rendering means col 0 = Friday on the left, col 6 = Saturday on the right)
  COL_DAYS.forEach((d, idx) => { matrix[1][idx] = d.label; });
  matrix[1][LABEL_COL_INDEX] = 'اليوم';

  // Section labels (col index = NUM_DAY_COLS) at the start row of each section
  for (const s of SECTIONS) {
    matrix[s.startRow][LABEL_COL_INDEX] = s.label;
  }

  // Fill data cells
  for (const s of SECTIONS) {
    for (const colDayIdx in COL_DAYS) {
      const colIdx = Number(colDayIdx);
      const day = COL_DAYS[colIdx].value;
      const slotItems = weekItems
        .filter(i => i.day_of_week === day && i.meal_type === s.meal_type
                  && (s.isSnack ? i.category === 'snack' : i.category !== 'snack'))
        .sort((a, b) => {
          // hot first, then cold (for mains); position as tiebreaker
          if (a.category !== b.category) {
            const r = (c: ItemCategory) => c === 'hot' ? 0 : c === 'cold' ? 1 : 2;
            return r(a.category) - r(b.category);
          }
          return a.position - b.position;
        });

      for (let r = 0; r < s.rows; r++) {
        const item = slotItems[r];
        if (item) {
          const name = item.meals?.name ?? '';
          const mult = item.multiplier ?? 1;
          // الفئة الافتراضية للقسم: "snack" في صفوف السناك، "hot" في الصفوف الرئيسية.
          // نضيف لاحقة `@بارد` (أو `@حار/@سناك`) فقط لو الفئة تختلف عن الافتراض،
          // عشان الملفات القديمة بدون اللاحقة تبقى صالحة.
          const sectionDefault: ItemCategory = s.isSnack ? 'snack' : 'hot';
          const catSuffix = item.category && item.category !== sectionDefault
            ? ` @${item.category === 'cold' ? 'بارد' : item.category === 'hot' ? 'حار' : 'سناك'}`
            : '';
          let cell = mult > 1 ? `${name} ×${mult}` : name;
          cell += catSuffix;
          matrix[s.startRow + r][colIdx] = cell;
        }
      }
    }
  }

  // Convert matrix → AOA
  const ws = XLSX.utils.aoa_to_sheet(matrix.map(row => row.map(c => c ?? '')));

  // Column widths
  const cols: { wch: number }[] = Array(TOTAL_COLS).fill({ wch: 18 });
  cols[LABEL_COL_INDEX] = { wch: 12 };
  ws['!cols'] = cols;

  // Row heights (all the same)
  ws['!rows'] = Array.from({ length: TOTAL_ROWS }, (_, i) => ({ hpt: i === 0 ? 26 : 22 }));

  // Merges
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  // Title merge across all columns
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: TOTAL_COLS - 1 } });
  // Section label merges in the rightmost column
  for (const s of SECTIONS) {
    merges.push({ s: { r: s.startRow, c: LABEL_COL_INDEX }, e: { r: s.startRow + s.rows - 1, c: LABEL_COL_INDEX } });
  }
  ws['!merges'] = merges;

  // Apply styling per cell
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
        // Determine which section this row belongs to
        const sec = SECTIONS.find(s => r >= s.startRow && r < s.startRow + s.rows);
        cell.s.fill = labelFill(sec?.label ?? '');
      } else {
        // Data cell
        const sec = SECTIONS.find(s => r >= s.startRow && r < s.startRow + s.rows);
        if (sec?.isSnack) cell.s.fill = SNACK_FILL;
      }
    }
  }

  // Mark the worksheet as RTL
  ws['!sheetView'] = [{ rightToLeft: true } as unknown as never];

  return ws;
}

// ─── Import ─────────────────────────────────────────────────────────────────

interface ImportedRow {
  week_number: number;
  day_of_week: number;
  meal_type: MealType;
  meal_id: string;
  category: ItemCategory;
  position: number;
  multiplier: number;
}

export async function importMenuXLSX(file: File, meals: Meal[]): Promise<{
  rows: ImportedRow[];
  errors: string[];
  weeks: number[];
}> {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const errors: string[] = [];
  const rows: ImportedRow[] = [];
  const touchedWeeks = new Set<number>();

  // Normalize: lookup map of meal name → meal info
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
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
    // Match sheet name against expected week titles
    const week = WEEK_NUMBERS.find(w => norm(WEEK_TITLES[w]) === norm(sheetName)
      || norm(sheetName).includes(String(w))
      || norm(sheetName).includes(`${w}`));
    if (!week) continue;

    touchedWeeks.add(week);
    const ws = wb.Sheets[sheetName];
    const matrix: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as string[][];

    for (const s of SECTIONS) {
      for (let colIdx = 0; colIdx < NUM_DAY_COLS; colIdx++) {
        const day = COL_DAYS[colIdx].value;
        for (let r = 0; r < s.rows; r++) {
          const cellRow = s.startRow + r;
          const raw = matrix[cellRow]?.[colIdx];
          let cellText = raw ? norm(String(raw)) : '';
          if (!cellText) continue;

          // استخراج لاحقة الفئة `@بارد/@حار/@سناك` أينما كانت في النص.
          // الافتراضي: "snack" في صفوف السناك، "hot" في الصفوف الرئيسية.
          let category: ItemCategory = s.isSnack ? 'snack' : 'hot';
          const catMatch = cellText.match(/@\s*(حار|بارد|سناك)\b/);
          if (catMatch) {
            category = catMatch[1] === 'حار' ? 'hot' : catMatch[1] === 'بارد' ? 'cold' : 'snack';
            cellText = cellText.replace(catMatch[0], '').trim();
          }

          // Parse optional " ×N" or " *N" suffix from the cell text
          let multiplier = 1;
          const multMatch = cellText.match(/[\s ]*[×x*]\s*(\d+)\s*$/i);
          if (multMatch) {
            const n = parseInt(multMatch[1], 10);
            if (n >= 1 && n <= 100) multiplier = n;
            cellText = cellText.slice(0, multMatch.index).trim();
          }

          const name = cellText;
          if (!name) continue;

          // Try exact match by (name, meal_type, is_snack)
          const exactKey = `${name}|${s.meal_type}|${s.isSnack ? '1' : '0'}`;
          let candidates = mealByNameType.get(exactKey);
          if (!candidates || candidates.length === 0) {
            // Fall back to any meal with this name
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
            meal_type: s.meal_type,
            meal_id: meal.id,
            category,
            position: (s.isSnack ? 100 : 0) + r,
            multiplier,
          });
        }
      }
    }
  }

  // Deduplicate by (week, day, meal_type, meal_id) — last one wins
  const seen = new Map<string, ImportedRow>();
  for (const r of rows) {
    const k = `${r.week_number}|${r.day_of_week}|${r.meal_type}|${r.meal_id}`;
    seen.set(k, r);
  }

  return {
    rows: Array.from(seen.values()),
    errors,
    weeks: Array.from(touchedWeeks),
  };
}
