import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  AlignmentType,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
  HeightRule,
  ShadingType,
  convertMillimetersToTwip,
  PageOrientation,
} from 'docx';
import type { Beneficiary } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';

const DIET_TYPE_EN: Record<string, string> = {
  'عادي': 'Normal diet',
  'نظام غذائي عادي': 'Normal diet',
  'سكري': 'Diabetic diet',
  'سكر': 'Diabetic diet',
  'لين': 'Soft diet',
  'مهروس': 'Pureed diet',
  'سائل': 'Liquid diet',
  'قليل الملح': 'Low salt diet',
  'قليل الدهون': 'Low fat diet',
  'كلوي': 'Renal diet',
  'نباتي': 'Vegetarian diet',
};

function dietLines(diet?: string): { ar: string; en: string } {
  const ar = (diet ?? '').trim() || 'نظام غذائي عادي';
  return { ar, en: DIET_TYPE_EN[ar] ?? '' };
}

const sz = (pt: number) => Math.round(pt * 2); // half-points
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MM_TO_PT = 72 / 25.4;
const MM_TO_PX = 96 / 25.4;

// تصغير حجم الخط (نقاط) ليبقى النص في سطر واحد ضمن العرض المتاح
function fitPt(text: string, basePt: number, contentPt: number, factor = 0.52, min = 6): number {
  const len = Math.max(text.length, 1);
  return Math.max(min, Math.min(basePt, contentPt / (len * factor)));
}

type ImgType = 'png' | 'jpg' | 'gif' | 'bmp';
interface LoadedImage { data: Uint8Array; width: number; height: number; type: ImgType }

function detectType(data: Uint8Array): ImgType {
  if (data[0] === 0xff && data[1] === 0xd8) return 'jpg';
  if (data[0] === 0x47 && data[1] === 0x49) return 'gif';
  if (data[0] === 0x42 && data[1] === 0x4d) return 'bmp';
  return 'png';
}

async function loadImage(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const dim = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
      img.onerror = reject;
      img.src = url;
    });
    return { data: buf, width: dim.w, height: dim.h, type: detectType(buf) };
  } catch {
    return null;
  }
}

function imageRunFit(img: LoadedImage, maxWpx: number, maxHpx: number): ImageRun {
  let wpx = maxWpx;
  let hpx = wpx * (img.height / img.width);
  if (hpx > maxHpx) { hpx = maxHpx; wpx = hpx * (img.width / img.height); }
  return new ImageRun({
    data: img.data, type: img.type,
    transformation: { width: Math.round(wpx), height: Math.round(hpx) },
  });
}

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const BLACK = (size: number, style: (typeof BorderStyle)[keyof typeof BorderStyle] = BorderStyle.SINGLE) =>
  ({ style, size, color: '000000' } as const);

function center(children: TextRun[], after = 30, before = 0): Paragraph {
  return new Paragraph({ alignment: AlignmentType.CENTER, bidirectional: true, spacing: { after, before }, children });
}

interface Ctx { scale: number; contentPt: number; contentWpx: number; logo: LoadedImage | null; header: LoadedImage | null }

// محتوى أعلى الستيكر: الهيدر + النظام الغذائي + Code/Villa
// تظليل خلفية الخلية بلون النظام الغذائي (hex بدون #)
const shade = (bg?: string) => (bg ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg } } : {});

function topCell(ben: Beneficiary, ctx: Ctx, rowHpx: number, bg?: string): TableCell {
  const { scale, contentPt, contentWpx, logo, header } = ctx;
  const diet = dietLines(ben.diet_type);
  const children: (Paragraph | Table)[] = [];

  if (header) {
    children.push(center([imageRunFit(header, contentWpx, rowHpx * 0.5)], 20));
  } else {
    // هيدر افتراضي: نص "خدمات الطعام / Food Services" يسار + الشعار يمين
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 28, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: logo ? [imageRunFit(logo, 46 * scale, rowHpx * 0.4)] : [] })],
          }),
          new TableCell({
            width: { size: 72, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
            children: [
              center([new TextRun({ text: 'خدمات الطعام', bold: true, size: sz(14 * scale), color: '047857', rightToLeft: true })], 0),
              center([new TextRun({ text: 'Food Services', bold: true, size: sz(11 * scale), color: '047857' })], 0),
            ],
          }),
        ],
      })],
    }));
  }

  // النظام الغذائي (وسط، سطر واحد، عربي فوق/إنجليزي تحت)
  children.push(center([new TextRun({ text: diet.ar, bold: true, size: sz(fitPt(diet.ar, 13 * scale, contentPt)), underline: {}, rightToLeft: true })], 0, 24));
  if (diet.en) {
    children.push(center([new TextRun({ text: diet.en, bold: true, size: sz(fitPt(diet.en, 11 * scale, contentPt)), underline: {} })], 0));
  }

  // صف: Code/Villa (يسار) + رموز الخيارات المؤشّرة (يمين)
  const flags = STICKER_FLAGS.filter(f => ben[f.key]);
  const codeVilla: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 0 }, children: [new TextRun({ text: `Code No.:${ben.code ?? ''}`, bold: true, size: sz(10 * scale) })] }),
  ];
  if (ben.villa) {
    codeVilla.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { after: 0 }, children: [new TextRun({ text: `Villa No.:${ben.villa}`, bold: true, size: sz(10 * scale) })] }));
  }
  const flagParas = flags.map(f =>
    new Paragraph({ alignment: AlignmentType.RIGHT, bidirectional: true, spacing: { after: 0 }, children: [new TextRun({ text: `${f.symbol} ${f.label}`, bold: true, size: sz(8.5 * scale), rightToLeft: true })] })
  );
  // المستند RTL فالخلية الأولى تظهر يميناً — نضع الرموز أولاً (يمين) وCode/Villa ثانياً (يسار)
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders,
    rows: [new TableRow({ children: [
      new TableCell({ width: { size: 62, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.TOP, margins: { top: 24, bottom: 0, left: 0, right: 0 }, children: flagParas.length ? flagParas : [new Paragraph({ children: [] })] }),
      new TableCell({ width: { size: 38, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.TOP, margins: { top: 24, bottom: 0, left: 0, right: 0 }, children: codeVilla }),
    ] })],
  }));

  return new TableCell({ ...shade(bg), borders: noBorders, verticalAlign: VerticalAlign.TOP, margins: { top: 40, bottom: 0, left: 60, right: 60 }, children });
}

// صندوق الاسم (حدّ مزدوج) — وسط الستيكر
function midCell(ben: Beneficiary, ctx: Ctx, bg?: string): TableCell {
  const { scale, contentPt } = ctx;
  const nameBox = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: BLACK(12, BorderStyle.DOUBLE), bottom: BLACK(12, BorderStyle.DOUBLE),
      left: BLACK(12, BorderStyle.DOUBLE), right: BLACK(12, BorderStyle.DOUBLE),
      insideHorizontal: NONE, insideVertical: NONE,
    },
    rows: [new TableRow({
      children: [new TableCell({
        margins: { top: 80, bottom: 80, left: 80, right: 80 }, verticalAlign: VerticalAlign.CENTER,
        children: [
          center([new TextRun({ text: ben.name, bold: true, size: sz(fitPt(ben.name, 16 * scale, contentPt * 0.9)), rightToLeft: true })], ben.english_name ? 24 : 0),
          ...(ben.english_name ? [center([new TextRun({ text: ben.english_name, bold: true, size: sz(fitPt(ben.english_name, 12 * scale, contentPt * 0.9)) })], 0)] : []),
        ],
      })],
    })],
  });
  return new TableCell({ ...shade(bg), borders: noBorders, verticalAlign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 60, right: 60 }, children: [nameBox] });
}

// أسفل الستيكر: فاصل + الحساسيات + الملاحظات
function bottomCell(ben: Beneficiary, ctx: Ctx, bg?: string): TableCell {
  const { scale } = ctx;
  const children: (Paragraph | Table)[] = [];

  // فاصل سميك
  children.push(new Paragraph({ spacing: { before: 0, after: 50 }, border: { bottom: BLACK(18) }, children: [new TextRun({ text: '', size: sz(2) })] }));

  // الحساسيات (عمودان)
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders,
    rows: [new TableRow({
      children: [
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: 'Food Allergy:', bold: true, size: sz(11 * scale) })] })] }),
        new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: noBorders, children: [new Paragraph({ alignment: AlignmentType.RIGHT, bidirectional: true, children: [new TextRun({ text: 'حساسيات وموانع:', bold: true, size: sz(11 * scale), rightToLeft: true })] })] }),
      ],
    })],
  }));

  // الملاحظات
  children.push(center([new TextRun({ text: 'Notes - الملاحظات', bold: true, size: sz(11 * scale), underline: {}, rightToLeft: true })], 0, 60));
  if (ben.notes) {
    children.push(center([new TextRun({ text: String(ben.notes), size: sz(9 * scale), rightToLeft: true })], 0, 24));
  }

  return new TableCell({ ...shade(bg), borders: noBorders, verticalAlign: VerticalAlign.BOTTOM, margins: { top: 0, bottom: 40, left: 60, right: 60 }, children });
}

export async function exportLunchDinnerStickers(
  beneficiaries: Beneficiary[],
  headerUrl: string | null,
  widthCm: number,
  heightCm: number,
  dietColors: Record<string, string> = {},
): Promise<void> {
  const header = headerUrl ? await loadImage(headerUrl) : null;
  const logo = await loadImage('/logo-hope.png');

  const MARGIN_MM = 2;
  const minDim = Math.min(widthCm, heightCm);
  const scale = clamp(minDim / 10, 0.55, 2);
  const contentMm = widthCm * 10 - MARGIN_MM * 2;
  const ctx: Ctx = { scale, contentPt: contentMm * MM_TO_PT, contentWpx: contentMm * MM_TO_PX, logo, header };

  // ارتفاعات ثابتة (EXACT) لصفوف أعلى/وسط/أسفل، مجموعها أقل من ارتفاع الصفحة
  // بهامش أمان — فالجدول ارتفاعه ثابت ويستحيل أن يتجاوز إلى صفحة ثانية.
  const contentH = convertMillimetersToTwip(heightCm * 10 - MARGIN_MM * 2);
  const usable = contentH - 120; // هامش أمان ضد فيض الصفحة
  // صف الأعلى (محتوى متغيّر) يأخذ مساحة أكبر لتفادي القص؛ صف الوسط (الاسم) محتواه معروف
  const r1 = Math.round(usable * 0.40);
  const r3 = Math.round(usable * 0.30);
  const r2 = usable - r1 - r3;
  const rowHpx = (r1 / 1440) * 96; // ارتفاع صف الأعلى بالبكسل (لتحجيم الهيدر)

  const sections = beneficiaries.map(ben => {
    const dietKey = ben.diet_type?.trim();
    const bg = dietKey ? dietColors[dietKey]?.replace('#', '') : undefined;
    const frame = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: BLACK(6), bottom: BLACK(6), left: BLACK(6), right: BLACK(6), insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({ height: { value: r1, rule: HeightRule.EXACT }, cantSplit: true, children: [topCell(ben, ctx, rowHpx, bg)] }),
        new TableRow({ height: { value: r2, rule: HeightRule.EXACT }, cantSplit: true, children: [midCell(ben, ctx, bg)] }),
        new TableRow({ height: { value: r3, rule: HeightRule.EXACT }, cantSplit: true, children: [bottomCell(ben, ctx, bg)] }),
      ],
    });
    return {
      properties: {
        page: {
          size: { width: convertMillimetersToTwip(widthCm * 10), height: convertMillimetersToTwip(heightCm * 10), orientation: PageOrientation.PORTRAIT },
          margin: { top: convertMillimetersToTwip(MARGIN_MM), bottom: convertMillimetersToTwip(MARGIN_MM), left: convertMillimetersToTwip(MARGIN_MM), right: convertMillimetersToTwip(MARGIN_MM), header: 0, footer: 0, gutter: 0 },
        },
      },
      children: [frame],
    };
  });

  const doc = new Document({
    creator: 'Khutwat Amal',
    title: 'ستيكرات الغداء والعشاء',
    styles: { default: { document: { run: { font: 'Cairo', size: sz(10) } } } },
    sections: sections.length ? sections : [{ children: [new Paragraph({ children: [] })] }],
  });

  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, 'ستيكرات-الغداء-والعشاء.docx');
}

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
