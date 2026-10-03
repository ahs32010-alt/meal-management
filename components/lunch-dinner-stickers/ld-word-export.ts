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
import { hasCustomization, LD_CATEGORY, type LdMealCustomization } from './ld-types';
import { LD_FONT_SIZES, dietLines } from './ld-sticker-card';

/**
 * أحجام Word (نقاط) مشتقّة من LD_FONT_SIZES (بكسل الصفحة) بنسبة ثابتة لكل
 * عنصر — النسب هي ما كان مطابقاً بصرياً للصفحة قبل المعايرة، فأي تعديل على
 * LD_FONT_SIZES ينعكس على Word بنفس النسبة.
 */
const WORD_PT = {
  name_ar: LD_FONT_SIZES.name_ar * (14.5 / 24),
  name_en: LD_FONT_SIZES.name_en * (14.5 / 24),
  code: LD_FONT_SIZES.code * (11.5 / 14),
  villa: LD_FONT_SIZES.villa * (11.5 / 14),
  diet_ar: LD_FONT_SIZES.diet_ar * (13 / 16),
  diet_en: LD_FONT_SIZES.diet_en * (11 / 13),
};

// ترجمة النظام الغذائي (dietLines) من نفس مصدر ستيكر الصفحة — كانت هنا نسخة
// مكرّرة، وأي إضافة لنظام جديد في واحدة فقط تُخرج Word مختلفاً عن الشاشة/الـPDF.

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

interface Ctx {
  scale: number;
  /** معامل خط الاسم — أكبر في الستيكر العريض (مثل 8×5) */
  nameScale: number;
  contentPt: number; contentWpx: number; logo: LoadedImage | null; header: LoadedImage | null;
}

/** Code/Villa — زاوية الهيدر اليسرى مقابل الشعار (نفس ستيكر الصفحة) */
function codeVillaParas(ben: Beneficiary, scale: number): Paragraph[] {
  const line = (text: string, pt: number) => new Paragraph({
    alignment: AlignmentType.LEFT, spacing: { after: 0 },
    children: [new TextRun({ text, bold: true, size: sz(pt * scale) })],
  });
  return [
    line(`Code No.: ${ben.code ?? ''}`, WORD_PT.code),
    ...(ben.villa ? [line(`Villa No.: ${ben.villa}`, WORD_PT.villa)] : []),
  ];
}

// محتوى أعلى الستيكر: الهيدر + النظام الغذائي + Code/Villa
// تظليل خلفية الخلية بلون النظام الغذائي (hex بدون #)
const shade = (bg?: string) => (bg ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: bg } } : {});

function topCell(ben: Beneficiary, ctx: Ctx, rowHpx: number, bg?: string): TableCell {
  const { scale, contentPt, contentWpx, logo, header } = ctx;
  const diet = dietLines(ben.diet_type);
  const children: (Paragraph | Table)[] = [];

  // المستند RTL فالخلية الأولى تظهر يميناً: الشعار/الهيدر يميناً، Code/Villa يساراً
  const codeCell = new TableCell({
    width: { size: 30, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
    children: codeVillaParas(ben, scale),
  });
  if (header) {
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders,
      rows: [new TableRow({ children: [
        new TableCell({
          width: { size: 70, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
          children: [center([imageRunFit(header, contentWpx * 0.68, rowHpx * 0.5)], 20)],
        }),
        codeCell,
      ] })],
    }));
  } else {
    // هيدر افتراضي: الشعار يميناً، «خدمات الطعام» وسطاً، Code/Villa يساراً
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: noBorders,
      rows: [new TableRow({
        children: [
          new TableCell({
            width: { size: 22, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: logo ? [imageRunFit(logo, 46 * scale, rowHpx * 0.4)] : [] })],
          }),
          new TableCell({
            width: { size: 48, type: WidthType.PERCENTAGE }, borders: noBorders, verticalAlign: VerticalAlign.CENTER,
            children: [
              center([new TextRun({ text: 'خدمات الطعام', bold: true, size: sz(fitPt('خدمات الطعام', 13 * scale, contentPt * 0.46)), color: '047857', rightToLeft: true })], 0),
              center([new TextRun({ text: 'Food Services', bold: true, size: sz(fitPt('Food Services', 10 * scale, contentPt * 0.46)), color: '047857' })], 0),
            ],
          }),
          codeCell,
        ],
      })],
    }));
  }

  // النظام الغذائي (وسط، سطر واحد، عربي فوق/إنجليزي تحت)
  children.push(center([new TextRun({ text: diet.ar, bold: true, size: sz(fitPt(diet.ar, WORD_PT.diet_ar * scale, contentPt)), underline: {}, rightToLeft: true })], 0, 24));
  if (diet.en) {
    children.push(center([new TextRun({ text: diet.en, bold: true, size: sz(fitPt(diet.en, WORD_PT.diet_en * scale, contentPt)), underline: {} })], 0));
  }

  // رموز الخيارات المؤشّرة (يمين) — Code/Villa انتقلت لزاوية الهيدر
  const flags = STICKER_FLAGS.filter(f => ben[f.key]);
  flags.forEach((f, i) => children.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT, bidirectional: true, spacing: { before: i === 0 ? 24 : 0, after: 0 },
      children: [new TextRun({ text: `${f.symbol} ${f.label}`, bold: true, size: sz(8.5 * scale), rightToLeft: true })],
    }),
  ));

  return new TableCell({ ...shade(bg), borders: noBorders, verticalAlign: VerticalAlign.TOP, margins: { top: 40, bottom: 0, left: 60, right: 60 }, children });
}

// صندوق الاسم (حدّ مزدوج) — وسط الستيكر
function midCell(ben: Beneficiary, ctx: Ctx, bg?: string): TableCell {
  const { nameScale, contentPt } = ctx;
  // كل سطر بحجمه المعتمد، ويصغر فقط ليبقى في سطر واحد
  const arPt = fitPt(ben.name, WORD_PT.name_ar * nameScale, contentPt * 0.88);
  const enPt = ben.english_name ? fitPt(ben.english_name, WORD_PT.name_en * nameScale, contentPt * 0.88) : 0;
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
          center([new TextRun({ text: ben.name, bold: true, size: sz(arPt), rightToLeft: true })], ben.english_name ? 20 : 0),
          ...(ben.english_name ? [center([new TextRun({ text: ben.english_name, bold: true, size: sz(enPt) })], 0)] : []),
        ],
      })],
    })],
  });
  return new TableCell({ ...shade(bg), borders: noBorders, verticalAlign: VerticalAlign.CENTER, margins: { top: 0, bottom: 0, left: 60, right: 60 }, children: [nameBox] });
}

// ألوان قسم التخصيصات — نفس دلالة ستيكرات الفطور (محظور أحمر، بديل أزرق)
const EXCL_COLOR = 'B91C1C';
const ALT_COLOR = '1D4ED8';

// أسفل الستيكر: فاصل + الحساسيات + الملاحظات + تخصيصات الوجبة (إن وُجدت)
function bottomCell(ben: Beneficiary, ctx: Ctx, bg?: string, custom?: LdMealCustomization | null): TableCell {
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

  // تخصيصات الوجبة — آخر الستيكر (تبويب «حسب الوجبة» فقط)
  if (hasCustomization(custom)) {
    const c = custom!;
    const exAr = c.excluded.map(e => e.ar).filter(Boolean);
    const exEn = c.excluded.map(e => e.en).filter(Boolean);
    const altAr = c.alternatives.map(a => a.ar).filter(Boolean);
    const altEn = c.alternatives.map(a => a.en).filter(Boolean);

    children.push(new Paragraph({ spacing: { before: 60, after: 40 }, border: { bottom: BLACK(18) }, children: [new TextRun({ text: '', size: sz(2) })] }));
    // الوجبة + تصنيف الكيس (حار/بارد/سناك) بلونه — نفس سطر الصفحة
    const cat = c.category ? LD_CATEGORY[c.category] : null;
    children.push(center([
      new TextRun({ text: `تخصيصات ${c.mealAr} ${c.mealEn}`, bold: true, size: sz(8.5 * scale), underline: {}, rightToLeft: true }),
      ...(cat ? [new TextRun({ text: ` · ${cat.ar} ${cat.en}`, bold: true, size: sz(8.5 * scale), color: cat.hex.replace('#', ''), rightToLeft: true })] : []),
    ], 30));

    if (exAr.length) {
      children.push(center([
        new TextRun({ text: 'محظور: ', bold: true, size: sz(9 * scale), color: EXCL_COLOR, rightToLeft: true }),
        new TextRun({ text: exAr.join('، '), bold: true, size: sz(9 * scale), color: EXCL_COLOR, rightToLeft: true }),
      ], 0));
      if (exEn.length) {
        children.push(center([new TextRun({ text: `NO: ${exEn.join(' | ')}`, bold: true, size: sz(8 * scale), color: EXCL_COLOR })], 0));
      }
    }

    if (altAr.length) {
      children.push(center([
        new TextRun({ text: 'بديل: ', bold: true, size: sz(9 * scale), color: ALT_COLOR, rightToLeft: true }),
        new TextRun({ text: altAr.join('، '), bold: true, size: sz(9 * scale), color: ALT_COLOR, rightToLeft: true }),
      ], 0, 30));
      if (altEn.length) {
        children.push(center([new TextRun({ text: `YES: ${altEn.join(' | ')}`, bold: true, size: sz(8 * scale), color: ALT_COLOR })], 0));
      }
    }
  }

  return new TableCell({ ...shade(bg), borders: noBorders, verticalAlign: VerticalAlign.BOTTOM, margins: { top: 0, bottom: 40, left: 60, right: 60 }, children });
}

export async function exportLunchDinnerStickers(
  beneficiaries: Beneficiary[],
  headerUrl: string | null,
  widthCm: number,
  heightCm: number,
  dietColors: Record<string, string> = {},
  /**
   * تخصيصات كل ستيكر، موازية لـ`beneficiaries` بالفهرس — تبويب «حسب الوجبة».
   * مصفوفة لا خريطة بالـid عمداً: المستفيد الواحد قد يتكرّر في القائمة بستيكر
   * لكل تصنيف (حار/بارد/سناك)، فخريطة بالـid تدهس تخصيصاته ببعضها.
   */
  customs: (LdMealCustomization | null | undefined)[] = [],
  filename = 'ستيكرات-الغداء-والعشاء.docx',
): Promise<void> {
  const header = headerUrl ? await loadImage(headerUrl) : null;
  const logo = await loadImage('/logo-hope.png');

  const MARGIN_MM = 2;
  const minDim = Math.min(widthCm, heightCm);
  const scale = clamp(minDim / 10, 0.55, 2);
  const contentMm = widthCm * 10 - MARGIN_MM * 2;

  // ارتفاعات ثابتة (EXACT) لصفوف أعلى/وسط/أسفل، مجموعها أقل من ارتفاع الصفحة
  // بهامش أمان — فالجدول ارتفاعه ثابت ويستحيل أن يتجاوز إلى صفحة ثانية.
  const contentH = convertMillimetersToTwip(heightCm * 10 - MARGIN_MM * 2);
  const usable = contentH - 120; // هامش أمان ضد فيض الصفحة
  // صف الأعلى (محتوى متغيّر) يأخذ مساحة أكبر لتفادي القص؛ صف الوسط (الاسم) محتواه معروف.
  // مع التخصيصات ينتقل جزء من مساحة الأعلى والوسط للأسفل — محظور/بديل يحتاج أسطراً إضافية.
  const anyCustom = customs.some(c => hasCustomization(c));
  const r1 = Math.round(usable * (anyCustom ? 0.34 : 0.40));
  const r3 = Math.round(usable * (anyCustom ? 0.42 : 0.30));
  const r2 = usable - r1 - r3;
  const rowHpx = (r1 / 1440) * 96; // ارتفاع صف الأعلى بالبكسل (لتحجيم الهيدر)

  // خط الاسم: في العريض (8×5 مثلاً) يستفيد من العرض، ومحصور بارتفاع صف الاسم
  // (الصف EXACT يقصّ ما يفيض): سطران × 1.2 تباعد + هوامش الصندوق ≈ 12pt
  const r2Pt = r2 / 20;
  const nameScale = Math.min(
    clamp(Math.min(widthCm, heightCm * 1.5) / 10, 0.55, 2),
    Math.max(0.3, (r2Pt - 12) / ((WORD_PT.name_ar + WORD_PT.name_en) * 1.2)),
  );
  const ctx: Ctx = { scale, nameScale, contentPt: contentMm * MM_TO_PT, contentWpx: contentMm * MM_TO_PX, logo, header };

  const sections = beneficiaries.map((ben, i) => {
    const dietKey = ben.diet_type?.trim();
    const bg = dietKey ? dietColors[dietKey]?.replace('#', '') : undefined;
    const frame = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: BLACK(6), bottom: BLACK(6), left: BLACK(6), right: BLACK(6), insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({ height: { value: r1, rule: HeightRule.EXACT }, cantSplit: true, children: [topCell(ben, ctx, rowHpx, bg)] }),
        new TableRow({ height: { value: r2, rule: HeightRule.EXACT }, cantSplit: true, children: [midCell(ben, ctx, bg)] }),
        new TableRow({ height: { value: r3, rule: HeightRule.EXACT }, cantSplit: true, children: [bottomCell(ben, ctx, bg, customs[i])] }),
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
  triggerDownload(blob, filename);
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
