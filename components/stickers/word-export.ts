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
import { CATEGORY_LABELS } from '@/lib/types';
import { GROUP_COLORS, CATEGORY_THEME } from './sticker-utils';
import { APP_FONT_NAME } from '@/lib/fonts';
import {
  prepareSticker, resolvePageLayout, showsTitle, DEFAULT_SIZES, ALL_SHOWN, DEFAULT_LAYOUT, PARA_SPACING,
  type StickerData, type StickerDetail, type StickerLayout, type FieldMap,
} from './sticker-layout';

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
  /** حجم خط كل عنصر بالنقطة — الافتراضي DEFAULT_SIZES (شبكة A4) */
  sizes?: FieldMap<number>;
  /** العناصر الظاهرة — الافتراضي الكل */
  show?: FieldMap<boolean>;
  /** معامل المسافات بين الفقرات — يُصغَّر مع الخط في المقاسات الصغيرة (الافتراضي 1) */
  spacingScale?: number;
  orderInfo?: { date: string; mealTypeAr: string; weekNumber?: number | null; dayOfWeek?: number | null };
}

const AR_DAYS: Record<number, string> = {
  0: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء',
  4: 'الخميس', 5: 'الجمعة', 6: 'السبت',
};

function buildStickerParagraphs(s: StickerData, opts: ParaOpts = {}): Paragraph[] {
  const S = opts.sizes ?? DEFAULT_SIZES;
  const show = opts.show ?? ALL_SHOWN;
  const sk = opts.spacingScale ?? 1;
  const sp = (tw: number) => Math.round(tw * sk);
  const out: Paragraph[] = [];

  const center = (children: TextRun[], spaceAfter = 60, spaceBefore = 0): Paragraph =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: true,
      spacing: { after: sp(spaceAfter), before: sp(spaceBefore), line: 240 },
      keepLines: true,
      keepNext: true,
      children,
    });

  // Order info line — date | meal | week | day
  if (opts.orderInfo && show.orderInfo) {
    const oi = opts.orderInfo;
    const d = oi.date;
    const dateStr = d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4);
    const parts = [
      dateStr,
      oi.mealTypeAr,
      oi.weekNumber != null ? `أسبوع ${oi.weekNumber}` : null,
      oi.dayOfWeek != null ? (AR_DAYS[oi.dayOfWeek] ?? '') : null,
    ].filter(Boolean);
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: true,
        spacing: { after: sp(PARA_SPACING.orderInfo[1]), before: sp(PARA_SPACING.orderInfo[0]), line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: 'F8FAFC', color: 'auto' },
        children: [
          new TextRun({ text: parts.join(' | '), size: sz(S.orderInfo), color: '64748B' }),
        ],
      }),
    );
  }

  if (show.title && (opts.title || s.groupIndex > 0 || s.category)) {
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
        spacing: { after: sp(PARA_SPACING.title[1]), before: sp(PARA_SPACING.title[0]), line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: fillColor, color: 'auto' },
        children: [
          new TextRun({
            text: titleText.trim(),
            bold: true,
            size: sz(S.title),
            color: 'FFFFFF',
          }),
        ],
      }),
    );
  }

  // Code + Villa
  const codeChildren: TextRun[] = [];
  if (show.code) {
    codeChildren.push(new TextRun({ text: `Code: ${s.ben.code}`, bold: true, size: sz(S.code), color: 'DC2626' }));
  }
  if (show.villa && s.ben.villa) {
    if (codeChildren.length) codeChildren.push(new TextRun({ text: '   ', size: sz(S.villa) }));
    codeChildren.push(new TextRun({ text: `Villa: ${s.ben.villa}`, bold: true, size: sz(S.villa), color: 'DC2626' }));
  }
  if (codeChildren.length) out.push(center(codeChildren, PARA_SPACING.codeVilla[1]));

  // Arabic name (largest)
  if (show.nameAr) {
    out.push(center([
      new TextRun({ text: s.ben.name, bold: true, size: sz(S.nameAr), color: '0F172A' }),
    ], PARA_SPACING.nameAr[1]));
  }

  // English name (smaller, lighter)
  if (show.nameEn && s.ben.english_name) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: false,
        spacing: { after: sp(PARA_SPACING.nameEn[1]), before: sp(PARA_SPACING.nameEn[0]), line: 240 },
        keepLines: true,
        keepNext: true,
        children: [
          new TextRun({ text: s.ben.english_name, bold: true, size: sz(S.nameEn), color: '374151' }),
        ],
      }),
    );
  }

  // مستبعد / بديل
  if (show.excluded && s.excludedNames) {
    out.push(center([
      new TextRun({ text: 'مستبعد: ', bold: true, size: sz(S.excluded), color: 'B91C1C' }),
      new TextRun({ text: s.excludedNames, size: sz(S.excluded), color: '0F172A' }),
    ], PARA_SPACING.excluded[1]));
  }
  if (show.alt && s.altNames) {
    out.push(center([
      new TextRun({ text: 'بديل: ', bold: true, size: sz(S.alt), color: '15803D' }),
      new TextRun({ text: s.altNames, size: sz(S.alt), color: '0F172A' }),
    ], PARA_SPACING.alt[1]));
  }

  // NO / YES (transliterated, LTR direction)
  if (show.noEn && s.excludedTranslit) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        spacing: { after: sp(PARA_SPACING.noEn[1]), before: sp(PARA_SPACING.noEn[0]), line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: 'FFF1F2', color: 'auto' },
        children: [
          new TextRun({ text: ' NO: ', bold: true, size: sz(S.noEn), color: 'DC2626' }),
          new TextRun({ text: s.excludedTranslit, bold: true, size: sz(S.noEn), color: 'DC2626' }),
          new TextRun({ text: ' ', size: sz(S.noEn) }),
        ],
      }),
    );
  }
  if (show.yesEn && s.altTranslit) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        bidirectional: false,
        spacing: { after: sp(PARA_SPACING.yesEn[1]), before: sp(PARA_SPACING.yesEn[0]), line: 240 },
        keepLines: true,
        keepNext: true,
        shading: { type: ShadingType.CLEAR, fill: 'EFF6FF', color: 'auto' },
        children: [
          new TextRun({ text: ' YES: ', bold: true, size: sz(S.yesEn), color: '1D4ED8' }),
          new TextRun({ text: s.altTranslit, bold: true, size: sz(S.yesEn), color: '1D4ED8' }),
          new TextRun({ text: ' ', size: sz(S.yesEn) }),
        ],
      }),
    );
  }

  // إضافات
  if (show.fixed && s.fixedItems) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        bidirectional: true,
        spacing: { after: sp(PARA_SPACING.fixed[1]), before: sp(PARA_SPACING.fixed[0]), line: 240 },
        keepLines: true,
        // Last paragraph in the sticker — don't keepNext so it ends cleanly
        border: { top: DASHED },
        children: [
          new TextRun({ text: 'إضافات: ', bold: true, size: sz(S.fixed), color: '475569' }),
          new TextRun({ text: s.fixedItems, size: sz(S.fixed), color: '475569' }),
        ],
      }),
    );
  }

  // كل العناصر مخفية → فقرة فاضية حتى لا تطلع الخلية/الصفحة بلا محتوى (Word يرفضها)
  if (out.length === 0) out.push(new Paragraph({ children: [] }));

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
  displayDetails: StickerDetail[],
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  customDict: Record<string, string> = {},
  orderDate?: string,
  weekNumber?: number | null,
  dayOfWeek?: number | null,
  show: FieldMap<boolean> = ALL_SHOWN,
) {
  const stickers = displayDetails.map(d => prepareSticker(d, d.groupIndex, d.category, customDict));
  const orderInfo = orderDate ? { date: orderDate, mealTypeAr, weekNumber, dayOfWeek } : undefined;

  const COLS = 4;
  const rows: TableRow[] = [];

  for (let i = 0; i < stickers.length; i += COLS) {
    const group = stickers.slice(i, i + COLS);
    const cells: TableCell[] = group.map(s => new TableCell({
      width: { size: Math.floor(100 / COLS), type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.TOP,
      margins: { top: 100, bottom: 100, left: 110, right: 110 },
      borders: { top: CARD_BORDER, bottom: CARD_BORDER, left: CARD_BORDER, right: CARD_BORDER },
      children: buildStickerParagraphs(s, { title: { mealTypeAr, mealTypeEn }, orderInfo, show }),
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
          run: { font: APP_FONT_NAME, size: sz(10) },
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
  displayDetails: StickerDetail[],
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  widthCm: number,
  heightCm: number,
  customDict: Record<string, string> = {},
  orderDate?: string,
  weekNumber?: number | null,
  dayOfWeek?: number | null,
  layout: StickerLayout = DEFAULT_LAYOUT,
) {
  const orderInfo = orderDate ? { date: orderDate, mealTypeAr, weekNumber, dayOfWeek } : undefined;
  const ctx = { hasOrderInfo: !!orderInfo, mealTypeAr, mealTypeEn };

  const sections = displayDetails.map(d => {
    const data = prepareSticker(d, d.groupIndex, d.category, customDict);
    // نفس الحساب اللي تستخدمه المعاينة في الصفحة — تلقائي (يصغر لين يدخل) أو أحجامك اليدوية
    const page = resolvePageLayout(data, layout, widthCm, heightCm, ctx);
    const marginMm = page.marginMm;
    return {
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(widthCm * 10),
            height: convertMillimetersToTwip(heightCm * 10),
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top:    convertMillimetersToTwip(marginMm),
            bottom: convertMillimetersToTwip(marginMm),
            left:   convertMillimetersToTwip(marginMm),
            right:  convertMillimetersToTwip(marginMm),
            header: 0,
            footer: 0,
            gutter: 0,
          },
        },
        verticalAlign: VerticalAlign.CENTER,
      },
      children: buildStickerParagraphs(data, {
        title: showsTitle(layout.show) ? { mealTypeAr, mealTypeEn } : undefined,
        sizes: page.sizes, spacingScale: page.spacingScale, show: layout.show, orderInfo,
      }),
    };
  });

  const doc = new Document({
    creator: 'Khutwat Amal',
    title: filename,
    styles: {
      default: {
        document: {
          run: { font: APP_FONT_NAME, size: sz(10) },
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

