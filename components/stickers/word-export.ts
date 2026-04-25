import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  VerticalAlign,
  PageOrientation,
  convertMillimetersToTwip,
} from 'docx';
import type { ReportData } from '@/lib/types';
import { transliterate } from '@/lib/transliterate';
import { GROUP_COLORS } from './sticker-utils';

export function buildWordCell(
  detail: ReportData['beneficiaryDetails'][0],
  mealTypeAr: string,
  mealTypeEn: string,
  customDict: Record<string, string>,
  groupIndex: number
): string {
  const ben = detail.beneficiary;
  const items = detail.excludedItems ?? [];
  const excludedNames = items.map(({ meal }) => `${meal.name}${meal.is_snack ? ' (snak)' : ''}`).join('، ');
  const excludedTranslit = items.map(({ meal }) => {
    const tr = transliterate(meal.name, customDict);
    return tr ? (meal.is_snack ? `${tr} (snak)` : tr) : '';
  }).filter(Boolean).join(' | ');
  const fixedMealsToday = (detail.fixedItems ?? []).map(m => m.meal.name);
  const altItems = items.filter(e => e.alternative);
  const allBadilNames = [...altItems.map(e => `${e.alternative!.name}${e.meal.is_snack ? ' (snak)' : ''}`), ...fixedMealsToday];
  const altTranslit = [
    ...altItems.map(e => {
      const tr = transliterate(e.alternative!.name, customDict);
      return tr ? (e.meal.is_snack ? `${tr} (snak)` : tr) : '';
    }).filter(Boolean),
    ...fixedMealsToday.map(n => transliterate(n, customDict)).filter(Boolean),
  ].join(' | ');

  const gc = GROUP_COLORS[groupIndex] ?? GROUP_COLORS[0];
  const headerBg = groupIndex === 0 ? '#1e293b' : (
    groupIndex === 1 ? '#7c3aed' : groupIndex === 2 ? '#f43f5e' : groupIndex === 3 ? '#f59e0b' : '#059669'
  );

  const groupLabel = groupIndex > 0 ? ` ★ ${gc.label}` : '';

  return `<td style="width:25%;vertical-align:top;border:2pt solid #cbd5e1;border-radius:8pt;padding:0;direction:rtl;text-align:center;">
  ${groupIndex > 0 ? `<div style="background:${headerBg};color:white;padding:3pt 8pt;font-size:9pt;font-weight:700;text-align:center;">${mealTypeAr} ${mealTypeEn}${groupLabel}</div>` : ''}
  <div style="padding:4pt 8pt;text-align:center;border-bottom:1pt solid #e2e8f0;">
    <span style="font-size:10pt;font-weight:800;color:#dc2626;">Code: ${ben.code}</span>
    ${ben.villa ? `&nbsp;&nbsp;<span style="font-size:10pt;font-weight:800;color:#dc2626;">Villa: ${ben.villa}</span>` : ''}
  </div>
  <div style="padding:5pt 8pt;text-align:center;border-bottom:1pt solid #e2e8f0;">
    <div style="font-size:12pt;font-weight:800;color:#0f172a;">${ben.name}</div>
    ${ben.english_name ? `<div style="font-size:9.5pt;font-weight:600;color:#374151;direction:ltr;">${ben.english_name}</div>` : ''}
  </div>
  <div style="padding:4pt 8pt;text-align:center;border-bottom:1pt solid #e2e8f0;">
    ${excludedNames ? `<div style="font-size:10pt;"><strong>مستبعد: </strong>${excludedNames}</div>` : ''}
    ${allBadilNames.length > 0 ? `<div style="font-size:10pt;"><strong>بديل: </strong>${allBadilNames.join('، ')}</div>` : ''}
  </div>
  <div style="padding:4pt 8pt;">
    ${excludedTranslit ? `<div style="background:#fff1f2;color:#dc2626;border-radius:4pt;padding:3pt 7pt;font-size:9pt;font-weight:700;direction:ltr;text-align:left;margin-bottom:3pt;"><strong>NO: </strong>${excludedTranslit}</div>` : ''}
    ${altTranslit ? `<div style="background:#eff6ff;color:#1d4ed8;border-radius:4pt;padding:3pt 7pt;font-size:9pt;font-weight:700;direction:ltr;text-align:left;"><strong>YES: </strong>${altTranslit}</div>` : ''}
    ${ben.fixed_items ? `<div style="font-size:8pt;color:#475569;margin-top:3pt;padding-top:3pt;border-top:1px dashed #cbd5e1;text-align:center;">إضافات: <strong>${ben.fixed_items}</strong></div>` : ''}
  </div>
</td>`;
}

export async function exportStickersPerPageDocx(
  displayDetails: Array<ReportData['beneficiaryDetails'][0] & { groupIndex: number }>,
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  widthCm: number,
  heightCm: number,
  customDict: Record<string, string> = {},
) {
  const minDim = Math.min(widthCm, heightCm);
  const scale = Math.max(0.6, Math.min(1.6, minDim / 10));
  const fs = (pt: number) => Math.round(pt * scale * 2);

  const buildStickerParagraphs = (
    detail: ReportData['beneficiaryDetails'][0],
    groupIndex: number,
  ): Paragraph[] => {
    const ben = detail.beneficiary;
    const items = detail.excludedItems ?? [];
    const excludedNames = items.map(({ meal }) => `${meal.name}${meal.is_snack ? ' (snak)' : ''}`).join('، ');
    const excludedTranslit = items.map(({ meal }) => {
      const tr = transliterate(meal.name, customDict);
      return tr ? (meal.is_snack ? `${tr} (snak)` : tr) : '';
    }).filter(Boolean).join(' | ');
    const fixedMealsToday = (detail.fixedItems ?? []).map(m => m.meal.name);
    const altItems = items.filter(e => e.alternative);
    const allBadilNames = [
      ...altItems.map(e => `${e.alternative!.name}${e.meal.is_snack ? ' (snak)' : ''}`),
      ...fixedMealsToday,
    ];
    const altTranslit = [
      ...altItems.map(e => {
        const tr = transliterate(e.alternative!.name, customDict);
        return tr ? (e.meal.is_snack ? `${tr} (snak)` : tr) : '';
      }).filter(Boolean),
      ...fixedMealsToday.map(n => transliterate(n, customDict)).filter(Boolean),
    ].join(' | ');

    const gc = GROUP_COLORS[groupIndex] ?? GROUP_COLORS[0];
    const groupLabel = groupIndex > 0 ? ` ★ ${gc.label}` : '';

    const paragraphs: Paragraph[] = [];
    const center = (children: TextRun[], spaceAfter = 60) => new Paragraph({
      alignment: AlignmentType.CENTER,
      bidirectional: true,
      spacing: { after: spaceAfter, before: 0 },
      children,
    });

    paragraphs.push(center([
      new TextRun({ text: `${mealTypeAr} ${mealTypeEn}${groupLabel}`, bold: true, size: fs(11), color: '1e293b' }),
    ]));

    paragraphs.push(center([
      new TextRun({ text: `Code: ${ben.code}`, bold: true, size: fs(13), color: 'dc2626' }),
      ...(ben.villa ? [new TextRun({ text: `    Villa: ${ben.villa}`, bold: true, size: fs(13), color: 'dc2626' })] : []),
    ]));

    paragraphs.push(center([
      new TextRun({ text: ben.name, bold: true, size: fs(16), color: '0f172a' }),
    ]));

    if (ben.english_name) {
      paragraphs.push(center([
        new TextRun({ text: ben.english_name, bold: true, size: fs(12), color: '374151' }),
      ]));
    }

    if (excludedNames) {
      paragraphs.push(center([
        new TextRun({ text: 'مستبعد: ', bold: true, size: fs(12) }),
        new TextRun({ text: excludedNames, size: fs(12) }),
      ]));
    }
    if (allBadilNames.length > 0) {
      paragraphs.push(center([
        new TextRun({ text: 'بديل: ', bold: true, size: fs(12) }),
        new TextRun({ text: allBadilNames.join('، '), size: fs(12) }),
      ]));
    }

    if (excludedTranslit) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40, before: 40 },
        children: [
          new TextRun({ text: 'NO: ', bold: true, size: fs(11), color: 'dc2626' }),
          new TextRun({ text: excludedTranslit, bold: true, size: fs(11), color: 'dc2626' }),
        ],
      }));
    }
    if (altTranslit) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40, before: 0 },
        children: [
          new TextRun({ text: 'YES: ', bold: true, size: fs(11), color: '1d4ed8' }),
          new TextRun({ text: altTranslit, bold: true, size: fs(11), color: '1d4ed8' }),
        ],
      }));
    }

    if (ben.fixed_items) {
      paragraphs.push(center([
        new TextRun({ text: 'إضافات: ', bold: true, size: fs(10), color: '475569' }),
        new TextRun({ text: String(ben.fixed_items), size: fs(10), color: '475569' }),
      ], 0));
    }

    return paragraphs;
  };

  const pageWidth = convertMillimetersToTwip(widthCm * 10);
  const pageHeight = convertMillimetersToTwip(heightCm * 10);

  const sections = displayDetails.map(d => ({
    properties: {
      page: {
        size: {
          width: pageWidth,
          height: pageHeight,
          orientation: PageOrientation.PORTRAIT,
        },
        margin: {
          top:    convertMillimetersToTwip(6),
          bottom: convertMillimetersToTwip(3),
          left:   convertMillimetersToTwip(3),
          right:  convertMillimetersToTwip(3),
          header: convertMillimetersToTwip(0),
          footer: convertMillimetersToTwip(0),
          gutter: 0,
        },
      },
      verticalAlign: VerticalAlign.CENTER,
    },
    children: buildStickerParagraphs(d, d.groupIndex),
  }));

  const doc = new Document({
    creator: 'Khutwat Amal',
    title: filename,
    sections,
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportStickersWord(
  displayDetails: Array<ReportData['beneficiaryDetails'][0] & { groupIndex: number }>,
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  customDict: Record<string, string> = {}
) {
  const rows: string[] = [];
  for (let i = 0; i < displayDetails.length; i += 4) {
    const group = displayDetails.slice(i, i + 4);
    const cells = group.map(d => buildWordCell(d, mealTypeAr, mealTypeEn, customDict, d.groupIndex));
    while (cells.length < 4) cells.push('<td style="width:25%;border:none;"></td>');
    rows.push(`<tr style="vertical-align:top;">${cells.join('')}</tr>`);
  }
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><meta name="ProgId" content="Word.Document">
<style>
  @page { size: A4; margin: 10mm; }
  body { font-family: Arial, sans-serif; direction: rtl; margin: 0; }
  table.main { width: 100%; border-collapse: separate; border-spacing: 5pt; }
</style></head>
<body><table class="main">${rows.join('\n')}</table></body></html>`;
  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${filename}.doc`; a.click();
  URL.revokeObjectURL(url);
}
