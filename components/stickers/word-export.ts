import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  VerticalAlign,
  PageOrientation,
  convertMillimetersToTwip,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
} from 'docx';
import type { ReportData, ItemCategory } from '@/lib/types';
import { CATEGORY_LABELS } from '@/lib/types';
import { transliterate } from '@/lib/transliterate';
import { GROUP_COLORS, CATEGORY_THEME } from './sticker-utils';

// ─── helpers ────────────────────────────────────────────────────────────────

interface StickerData {
  ben: ReportData['beneficiaryDetails'][0]['beneficiary'];
  groupIndex: number;
  category: ItemCategory | null;
  excludedNames: string;
  excludedTranslit: string;
  altNames: string;
  altTranslit: string;
  fixedItems: string | null;
}

function prepareSticker(
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

// docx font sizes are in half-points
const sz = (pt: number) => Math.round(pt * 2);

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const CARD_BORDER = { style: BorderStyle.SINGLE, size: 8, color: 'CBD5E1' } as const;
const DASHED = { style: BorderStyle.DASHED, size: 4, color: 'CBD5E1' } as const;

const GROUP_HEADER_BG: Record<number, string> = {
  0: '1E293B',
  1: '7C3AED',
  2: 'F43F5E',
  3: 'F59E0B',
  4: '059669',
};

// ─── paragraphs that compose a single sticker (used by both exports) ────────

interface ParaOpts {
  title?: { mealTypeAr: string; mealTypeEn: string };
  // Font scale — 1.0 for grid, larger for per-page based on sticker size
  scale?: number;
}

function buildStickerParagraphs(s: StickerData, opts: ParaOpts = {}): Paragraph[] {
  const k = opts.scale ?? 1;
  const fs = (pt: number) => sz(pt * k);
  const out: Paragraph[] = [];

  const center = (children: TextRun[], spaceAfter = 60, spaceBefore = 0): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: true,
      spacing: { after: spaceAfter, before: spaceBefore, line: 240 },
      keepLines: true,
      keepNext: true,
      children,
    });

  if (opts.title || s.groupIndex > 0 || s.category) {
    const gc = GROUP_COLORS[s.groupIndex] ?? GROUP_COLORS[0];
    const ct = s.category ? CATEGORY_THEME[s.category] : null;
    const groupLabel = s.groupIndex > 0 ? ` ★ ${gc.label}` : '';
    const categoryLabel = ct ? ` ${ct.icon} ${CATEGORY_LABELS[s.category!]}` : '';
    const titleText = opts.title
      ? `${opts.title.mealTypeAr} ${opts.title.mealTypeEn}${categoryLabel}${groupLabel}`
      : `${categoryLabel}${groupLabel}`;
    const fillColor = ct ? ct.hex : (GROUP_HEADER_BG[s.groupIndex] ?? '1E293B');
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: true,
        spacing: { after: 80, before: 0, line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: fillColor, color: 'auto' },
        children: [
          new TextRun({
            text: titleText.trim(),
            bold: true,
            size: fs(9),
            color: 'FFFFFF',
          }),
        ],
      }),
    );
  }

  // Code + Villa
  const codeRun = new TextRun({ text: `Code: ${s.ben.code}`, bold: true, size: fs(11), color: 'DC2626' });
  const codeChildren: TextRun[] = [codeRun];
  if (s.ben.villa) {
    codeChildren.push(new TextRun({ text: '   ', size: fs(11) }));
    codeChildren.push(new TextRun({ text: `Villa: ${s.ben.villa}`, bold: true, size: fs(11), color: 'DC2626' }));
  }
  out.push(center(codeChildren, 60));

  // Arabic name (largest)
  out.push(center([
    new TextRun({ text: s.ben.name, bold: true, size: fs(14), color: '0F172A' }),
  ], 30));

  // English name (smaller, lighter)
  if (s.ben.english_name) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: false,
        spacing: { after: 80, before: 0, line: 240 },
        keepLines: true,
        keepNext: true,
        children: [
          new TextRun({ text: s.ben.english_name, bold: true, size: fs(10), color: '374151' }),
        ],
      }),
    );
  }

  // مستبعد / بديل
  if (s.excludedNames) {
    out.push(center([
      new TextRun({ text: 'مستبعد: ', bold: true, size: fs(9.5), color: 'B91C1C' }),
      new TextRun({ text: s.excludedNames, size: fs(9.5), color: '0F172A' }),
    ], 40));
  }
  if (s.altNames) {
    out.push(center([
      new TextRun({ text: 'بديل: ', bold: true, size: fs(9.5), color: '15803D' }),
      new TextRun({ text: s.altNames, size: fs(9.5), color: '0F172A' }),
    ], 80));
  }

  // NO / YES (transliterated, LTR direction)
  if (s.excludedTranslit) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        spacing: { after: 40, before: 40, line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: 'FFF1F2', color: 'auto' },
        children: [
          new TextRun({ text: ' NO: ', bold: true, size: fs(9), color: 'DC2626' }),
          new TextRun({ text: s.excludedTranslit, bold: true, size: fs(9), color: 'DC2626' }),
          new TextRun({ text: ' ', size: fs(9) }),
        ],
      }),
    );
  }
  if (s.altTranslit) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        spacing: { after: 40, before: 0, line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: 'EFF6FF', color: 'auto' },
        children: [
          new TextRun({ text: ' YES: ', bold: true, size: fs(9), color: '1D4ED8' }),
          new TextRun({ text: s.altTranslit, bold: true, size: fs(9), color: '1D4ED8' }),
          new TextRun({ text: ' ', size: fs(9) }),
        ],
      }),
    );
  }

  // إضافات
  if (s.fixedItems) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: true,
        spacing: { after: 0, before: 60, line: 240 },
        keepLines: true,
        // Last paragraph in the sticker — don't keepNext so it ends cleanly
        border: { top: DASHED },
        children: [
          new TextRun({ text: 'إضافات: ', bold: true, size: fs(8), color: '475569' }),
          new TextRun({ text: s.fixedItems, size: fs(8), color: '475569' }),
        ],
      }),
    );
  } else if (out.length > 0) {
    // Mark the final paragraph as not keepNext so it doesn't grab the next sticker
    // (when sequencing in per-page export). This is a minor cleanup.
  }

  return out;
}

// ─── empty cell (fills the row when there are <4 stickers) ──────────────────

function emptyCell(): TableCell {
  return new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    borders: { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER },
    children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
  });
}

// ─── A4 grid export (4 stickers per row, no row may split) ──────────────────

export async function exportStickersWord(
  displayDetails: Array<ReportData['beneficiaryDetails'][0] & { groupIndex: number; category: ItemCategory | null }>,
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  customDict: Record<string, string> = {},
) {
  const stickers = displayDetails.map(d => prepareSticker(d, d.groupIndex, d.category, customDict));

  const COLS = 4;
  const rows: TableRow[] = [];

  for (let i = 0; i < stickers.length; i += COLS) {
    const group = stickers.slice(i, i + COLS);
    const cells: TableCell[] = group.map(s => new TableCell({
      width: { size: Math.floor(100 / COLS), type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 100, bottom: 100, left: 110, right: 110 },
      borders: { top: CARD_BORDER, bottom: CARD_BORDER, left: CARD_BORDER, right: CARD_BORDER },
      children: buildStickerParagraphs(s, { title: { mealTypeAr, mealTypeEn } }),
    }));
    while (cells.length < COLS) cells.push(emptyCell());

    rows.push(
      new TableRow({
        cantSplit: true, // ← prevents a sticker row from breaking across pages
        children: cells,
      }),
    );
  }

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: {
      top: NO_BORDER,
      bottom: NO_BORDER,
      left: NO_BORDER,
      right: NO_BORDER,
      insideHorizontal: NO_BORDER,
      insideVertical: NO_BORDER,
    },
  });

  const doc = new Document({
    creator: 'Khutwat Amal',
    title: filename,
    styles: {
      default: {
        document: {
          run: { font: 'Cairo', size: sz(10) },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(210),
            height: convertMillimetersToTwip(297),
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top:    convertMillimetersToTwip(8),
            bottom: convertMillimetersToTwip(8),
            left:   convertMillimetersToTwip(8),
            right:  convertMillimetersToTwip(8),
            header: 0,
            footer: 0,
            gutter: 0,
          },
        },
      },
      children: [table],
    }],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${filename}.docx`);
}

// ─── Per-page export (one sticker per page, custom size) ────────────────────

export async function exportStickersPerPageDocx(
  displayDetails: Array<ReportData['beneficiaryDetails'][0] & { groupIndex: number; category: ItemCategory | null }>,
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  widthCm: number,
  heightCm: number,
  customDict: Record<string, string> = {},
) {
  const minDim = Math.min(widthCm, heightCm);
  // Conservative scale: small stickers stay readable, large ones don't get jumbo fonts
  const scale = Math.max(0.7, Math.min(1.5, minDim / 11));

  const sections = displayDetails.map(d => {
    const data = prepareSticker(d, d.groupIndex, d.category, customDict);
    return {
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(widthCm * 10),
            height: convertMillimetersToTwip(heightCm * 10),
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top:    convertMillimetersToTwip(4),
            bottom: convertMillimetersToTwip(4),
            left:   convertMillimetersToTwip(4),
            right:  convertMillimetersToTwip(4),
            header: 0,
            footer: 0,
            gutter: 0,
          },
        },
        verticalAlign: VerticalAlign.CENTER,
      },
      children: buildStickerParagraphs(data, { title: { mealTypeAr, mealTypeEn }, scale }),
    };
  });

  const doc = new Document({
    creator: 'Khutwat Amal',
    title: filename,
    styles: {
      default: {
        document: {
          run: { font: 'Cairo', size: sz(10) },
        },
      },
    },
    sections,
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, `${filename}.docx`);
}

// ─── shared download helper ─────────────────────────────────────────────────

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

