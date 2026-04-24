'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { DailyOrder, ReportData } from '@/lib/types';
import { MEAL_TYPE_LABELS, MEAL_TYPE_EN } from '@/lib/types';
import { formatDate, formatDateFull } from '@/lib/date-utils';
import { transliterate } from '@/lib/transliterate';
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
const t = (s: string, dict: Record<string, string>) => dict[s] ?? transliterate(s);

// splits[ben_id][meal_id] = groupIndex  (0 = main sticker, 1 = sticker 2, …)
// meal_ids not present default to group 0
type GroupMap  = Record<string, number>;
type SplitsMap = Record<string, GroupMap>;

const GROUP_COLORS = [
  { bg: 'bg-slate-700',   text: 'text-white', border: 'border-slate-700',   label: 'أصلي'   },
  { bg: 'bg-violet-600',  text: 'text-white', border: 'border-violet-600',  label: 'ستيكر ٢' },
  { bg: 'bg-rose-500',    text: 'text-white', border: 'border-rose-500',    label: 'ستيكر ٣' },
  { bg: 'bg-amber-500',   text: 'text-white', border: 'border-amber-500',   label: 'ستيكر ٤' },
  { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-600', label: 'ستيكر ٥' },
];

function serializeSplits(gm: GroupMap): string[] {
  return Object.entries(gm).filter(([, g]) => g > 0).map(([id, g]) => `${id}:${g}`);
}
function deserializeSplits(arr: string[]): GroupMap {
  const gm: GroupMap = {};
  for (const s of arr) {
    const idx = s.lastIndexOf(':');
    if (idx === -1) { gm[s] = 1; }
    else { gm[s.slice(0, idx)] = parseInt(s.slice(idx + 1)) || 1; }
  }
  return gm;
}
function maxGroup(gm: GroupMap): number {
  return Math.max(0, ...Object.values(gm));
}

// ── Word export ───────────────────────────────────────────────────────────────
function buildWordCell(
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

// ── Per-page sticker export (real .docx with each sticker as its own section) ─────────
async function exportStickersPerPageDocx(
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
  // Font sizes in docx are in half-points (24 = 12pt)
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

    // Meal type header
    paragraphs.push(center([
      new TextRun({ text: `${mealTypeAr} ${mealTypeEn}${groupLabel}`, bold: true, size: fs(11), color: '1e293b' }),
    ]));

    // Code + Villa
    paragraphs.push(center([
      new TextRun({ text: `Code: ${ben.code}`, bold: true, size: fs(13), color: 'dc2626' }),
      ...(ben.villa ? [new TextRun({ text: `    Villa: ${ben.villa}`, bold: true, size: fs(13), color: 'dc2626' })] : []),
    ]));

    // Arabic name (big)
    paragraphs.push(center([
      new TextRun({ text: ben.name, bold: true, size: fs(16), color: '0f172a' }),
    ]));

    // English name
    if (ben.english_name) {
      paragraphs.push(center([
        new TextRun({ text: ben.english_name, bold: true, size: fs(12), color: '374151' }),
      ]));
    }

    // Excluded / Alternative in Arabic
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

    // NO / YES transliteration (LTR)
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

  // Every sticker becomes its own section with the exact custom page size.
  // This is the only way Word guarantees each sticker is on its own page at the chosen size.
  const pageWidth  = convertMillimetersToTwip(widthCm * 10);
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
          // Slightly larger top margin gives breathing room above the centered block
          top:    convertMillimetersToTwip(6),
          bottom: convertMillimetersToTwip(3),
          left:   convertMillimetersToTwip(3),
          right:  convertMillimetersToTwip(3),
          header: convertMillimetersToTwip(0),
          footer: convertMillimetersToTwip(0),
          gutter: 0,
        },
      },
      // Section-level vertical centering (this is where Word actually reads it from)
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


function exportStickersWord(
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

// ── Sticker Card ──────────────────────────────────────────────────────────────
function StickerCard({ detail, mealTypeAr, mealTypeEn, customDict, groupIndex = 0 }: {
  detail: ReportData['beneficiaryDetails'][0];
  mealTypeAr: string;
  mealTypeEn: string;
  customDict: Record<string, string>;
  groupIndex?: number;
}) {
  const gc = GROUP_COLORS[groupIndex] ?? GROUP_COLORS[0];
  const ben = detail.beneficiary;
  const [editMode, setEditMode] = useState(false);
  const [nameAr, setNameAr] = useState(ben.name);
  const [nameEn, setNameEn] = useState(ben.english_name ?? '');
  const [code, setCode] = useState(ben.code);
  const [villa, setVilla] = useState(ben.villa ?? '');

  const [exclusions, setExclusions] = useState(
    detail.excludedItems.map(({ meal, alternative }) => ({
      excludedName: meal.name,
      alternativeName: alternative?.name ?? '',
      isSnack: meal.is_snack,
    }))
  );
  const updateExclusion = (idx: number, field: 'excludedName' | 'alternativeName', val: string) =>
    setExclusions(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  const [fixedMeals, setFixedMeals] = useState(
    (detail.fixedItems ?? []).map(m => m.meal.name)
  );
  const updateFixed = (idx: number, val: string) =>
    setFixedMeals(prev => prev.map((n, i) => i === idx ? val : n));

  const altNames = exclusions.map(e => e.alternativeName);
  const allBadil = [...altNames, ...fixedMeals];
  const hasAnyBadil = allBadil.some(n => n.trim() !== '');

  const excludedTranslitList = exclusions
    .filter(e => e.excludedName.trim())
    .map(e => {
      const tr = transliterate(e.excludedName, customDict);
      return tr ? (e.isSnack ? `${tr} (snak)` : tr) : '';
    }).filter(Boolean);
  const badilTranslitList = [
    ...exclusions
      .filter(e => e.alternativeName.trim())
      .map(e => {
        const tr = transliterate(e.alternativeName, customDict);
        return tr ? (e.isSnack ? `${tr} (snak)` : tr) : '';
      }).filter(Boolean),
    ...fixedMeals.filter(n => n.trim()).map(n => transliterate(n, customDict)).filter(Boolean),
  ];

  const inp = (val: string, onChange: (v: string) => void, dir: 'rtl' | 'ltr' = 'rtl') => (
    <input dir={dir} value={val} onChange={e => onChange(e.target.value)}
      className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:outline-none text-center w-full"
      style={{ font: 'inherit', color: 'inherit' }} />
  );

  return (
    <div className="sticker-card">
      {/* Edit button */}
      <div className="sticker-edit-bar no-print">
        <button type="button" onClick={() => setEditMode(m => !m)} className="sticker-edit-btn">
          {editMode ? 'حفظ ✓' : '✏ تعديل'}
        </button>
      </div>

      {/* Split group badge */}
      {groupIndex > 0 && (
        <div className={`sticker-group-badge ${gc.bg} ${gc.text}`}>
          ★ {gc.label} — {mealTypeAr} {mealTypeEn}
        </div>
      )}

      {/* Code + Villa — one row, centered, red */}
      <div className="sticker-info-row">
        <span><span className="sticker-info-label">Code: </span>
          {editMode ? inp(code, setCode, 'ltr') : <span className="sticker-info-value">{code}</span>}
        </span>
        {(villa || editMode) && (
          <span><span className="sticker-info-label">Villa: </span>
            {editMode ? inp(villa, setVilla, 'ltr') : <span className="sticker-info-value">{villa}</span>}
          </span>
        )}
      </div>

      {/* Names — centered */}
      <div className="sticker-names-block">
        <div className="sticker-name-ar-center">
          {editMode ? inp(nameAr, setNameAr) : nameAr}
        </div>
        {(nameEn || editMode) && (
          <div className="sticker-name-en-center">
            {editMode ? inp(nameEn, setNameEn, 'ltr') : nameEn}
          </div>
        )}
      </div>

      {/* Excluded + Alternative — centered */}
      <div className="sticker-excl-block">
        {exclusions.length > 0 && (
          <div className="sticker-excl-row">
            <span className="sticker-excl-label">مستبعد: </span>
            {exclusions.map((e, i) => (
              <span key={i}>
                {i > 0 && <span style={{ color: '#94a3b8' }}>، </span>}
                {editMode
                  ? <input value={e.excludedName} onChange={ev => updateExclusion(i, 'excludedName', ev.target.value)}
                      className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:outline-none"
                      style={{ font: 'inherit', color: 'inherit', width: 80 }} />
                  : <>{e.excludedName}{e.isSnack && <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.85em' }}> (snak)</span>}</>}
              </span>
            ))}
          </div>
        )}
        {hasAnyBadil && (
          <div className="sticker-alt-row">
            <span className="sticker-alt-label">بديل: </span>
            {exclusions.map((e, i) => e.alternativeName.trim() !== '' && (
              <span key={`alt-${i}`}>
                {i > 0 && <span style={{ color: '#94a3b8' }}>، </span>}
                {editMode
                  ? <input value={e.alternativeName} onChange={ev => updateExclusion(i, 'alternativeName', ev.target.value)}
                      className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:outline-none"
                      style={{ font: 'inherit', color: 'inherit', width: 80 }} />
                  : <>{e.alternativeName}{e.isSnack && <span style={{ color: '#f59e0b', fontWeight: 700, fontSize: '0.85em' }}> (snak)</span>}</>}
              </span>
            ))}
            {fixedMeals.map((name, i) => name.trim() !== '' && (
              <span key={`fix-${i}`}>
                {(exclusions.some(e => e.alternativeName.trim()) || i > 0) && <span style={{ color: '#94a3b8' }}>، </span>}
                {editMode
                  ? <input value={name} onChange={ev => updateFixed(i, ev.target.value)}
                      className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:outline-none"
                      style={{ font: 'inherit', color: 'inherit', width: 80 }} />
                  : name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* NO / YES */}
      <div className="sticker-pills">
        {excludedTranslitList.length > 0 && (
          <div className="sticker-pill-no">
            <span className="sticker-pill-label">NO: </span>{excludedTranslitList.join(' | ')}
          </div>
        )}
        {badilTranslitList.length > 0 && (
          <div className="sticker-pill-yes">
            <span className="sticker-pill-label">YES: </span>{badilTranslitList.join(' | ')}
          </div>
        )}
      </div>

      {ben.fixed_items && (
        <div className="sticker-fixed">
          <span className="sticker-fixed-label">إضافات: </span>{ben.fixed_items}
        </div>
      )}
    </div>
  );
}

// ── Sticker Splitter (new two-panel UX) ──────────────────────────────────────
function StickerSplitter({
  stickerDetails,
  splits,
  onSplitsChange,
  saveStatus,
}: {
  stickerDetails: ReportData['beneficiaryDetails'];
  splits: SplitsMap;
  onSplitsChange: (next: SplitsMap) => void;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}) {
  const [selectedBenId, setSelectedBenId] = useState<string>(stickerDetails[0]?.beneficiary.id ?? '');
  const [search, setSearch] = useState('');

  const filtered = stickerDetails.filter(d =>
    d.beneficiary.name.includes(search) ||
    d.beneficiary.code.includes(search) ||
    (d.beneficiary.villa ?? '').includes(search)
  );

  const selectedDetail = stickerDetails.find(d => d.beneficiary.id === selectedBenId) ?? null;

  const setGroup = (meal_id: string, ben_id: string, g: number) => {
    const prevGm = { ...(splits[ben_id] ?? {}) };
    if (g === 0) { delete prevGm[meal_id]; } else { prevGm[meal_id] = g; }
    onSplitsChange({ ...splits, [ben_id]: prevGm });
  };

  const clearSplit = (ben_id: string) => {
    const next = { ...splits };
    delete next[ben_id];
    onSplitsChange(next);
  };

  // Navigate through list
  const currentIdx = filtered.findIndex(d => d.beneficiary.id === selectedBenId);
  const goPrev = () => { if (currentIdx > 0) setSelectedBenId(filtered[currentIdx - 1].beneficiary.id); };
  const goNext = () => { if (currentIdx < filtered.length - 1) setSelectedBenId(filtered[currentIdx + 1].beneficiary.id); };

  return (
    <div className="card overflow-hidden no-print">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <h3 className="font-bold text-slate-700 text-sm">فصل الستيكرات</h3>
          {Object.values(splits).some(gm => Object.values(gm).some(g => g > 0)) && (
            <span className="badge bg-violet-100 text-violet-700 text-xs">
              {Object.values(splits).filter(gm => Object.values(gm).some(g => g > 0)).length} مفصول
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          {saveStatus === 'saving' && (
            <span className="flex items-center gap-1 text-slate-400">
              <div className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
              جاري الحفظ...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-emerald-600 font-semibold">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              تم الحفظ
            </span>
          )}
          {saveStatus === 'error' && <span className="text-red-500">خطأ في الحفظ</span>}
        </div>
      </div>

      <div className="flex sticker-split-container" style={{ minHeight: 360 }}>
        {/* ── Left: Beneficiary List ── */}
        <div className="w-64 shrink-0 border-l border-slate-100 flex flex-col sticker-split-list">
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="بحث..."
                className="w-full pr-8 pl-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-violet-400 bg-slate-50"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map(detail => {
              const ben = detail.beneficiary;
              const gm = splits[ben.id] ?? {};
              const nGroups = maxGroup(gm);
              const isSelected = ben.id === selectedBenId;
              return (
                <button
                  key={ben.id}
                  type="button"
                  onClick={() => setSelectedBenId(ben.id)}
                  className={`w-full text-right px-3 py-2.5 border-b border-slate-50 transition-colors flex items-center justify-between gap-2 ${
                    isSelected ? 'bg-violet-50 border-r-2 border-r-violet-500' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold truncate ${isSelected ? 'text-violet-800' : 'text-slate-700'}`}>
                      {ben.name}
                    </div>
                    <div className="text-[10px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span>{ben.code}</span>
                      {ben.villa && <span>• {ben.villa}</span>}
                    </div>
                  </div>
                  {nGroups > 0 ? (
                    <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">
                      {nGroups + 1}
                    </span>
                  ) : (
                    <span className="shrink-0 w-2 h-2 rounded-full bg-slate-200" />
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="p-4 text-center text-xs text-slate-400">لا نتائج</div>
            )}
          </div>

          {/* Navigation footer */}
          <div className="p-2 border-t border-slate-100 flex items-center justify-between">
            <button type="button" onClick={goPrev} disabled={currentIdx <= 0}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <span className="text-[10px] text-slate-400">
              {currentIdx + 1} / {filtered.length}
            </span>
            <button type="button" onClick={goNext} disabled={currentIdx >= filtered.length - 1}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Right: Item Assigner ── */}
        <div className="flex-1 p-5 overflow-y-auto sticker-split-editor">
          {!selectedDetail ? (
            <div className="flex items-center justify-center h-full text-sm text-slate-400">
              اختر مستفيداً من القائمة
            </div>
          ) : (() => {
            const ben = selectedDetail.beneficiary;
            const gm = splits[ben.id] ?? {};
            const nGroups = maxGroup(gm);
            const splitCount = Object.values(gm).filter(g => g > 0).length;
            const maxButtonGroup = Math.min(nGroups + 1, GROUP_COLORS.length - 1);

            const exclItems = selectedDetail.excludedItems.map(({ meal, alternative }) => ({
              id: meal.id, label: meal.name, sub: alternative?.name ?? null, type: 'excl' as const,
            }));
            const fixedChips = (selectedDetail.fixedItems ?? []).map(m => ({
              id: m.meal.id, label: m.meal.name + (m.quantity > 1 ? ` ×${m.quantity}` : ''), sub: null, type: 'fixed' as const,
            }));
            const allItems = [...exclItems, ...fixedChips];

            return (
              <div className="space-y-4">
                {/* Beneficiary info */}
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="font-bold text-slate-800 text-base">{ben.name}</h4>
                    {ben.english_name && <p className="text-xs text-slate-400 mt-0.5 direction-ltr">{ben.english_name}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <code className="text-xs bg-slate-100 px-2 py-0.5 rounded text-slate-600">{ben.code}</code>
                      {ben.villa && <span className="badge bg-blue-50 text-blue-600 text-xs">{ben.villa}</span>}
                      {nGroups > 0 && (
                        <span className="badge bg-violet-100 text-violet-700 text-xs">{nGroups + 1} ستيكرات</span>
                      )}
                    </div>
                  </div>
                  {splitCount > 0 && (
                    <button type="button" onClick={() => clearSplit(ben.id)}
                      className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors border border-slate-200">
                      مسح الكل
                    </button>
                  )}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {GROUP_COLORS.slice(0, maxButtonGroup + 2).map((gc, i) => (
                    <span key={i} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${gc.bg} ${gc.text}`}>
                      {gc.label}
                    </span>
                  ))}
                </div>

                {/* Items */}
                <div className="space-y-2">
                  {allItems.map(item => {
                    const currentGroup = gm[item.id] ?? 0;
                    const activeGc = GROUP_COLORS[currentGroup] ?? GROUP_COLORS[0];
                    return (
                      <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 bg-slate-50">
                        {/* Item info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                              item.type === 'fixed' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                            }`}>
                              {item.label}
                            </span>
                            {item.sub && (
                              <span className="text-xs text-slate-500">← <span className="font-medium text-emerald-700">{item.sub}</span></span>
                            )}
                            {item.type === 'fixed' && (
                              <span className="text-[10px] text-blue-400">ثابت</span>
                            )}
                          </div>
                          {currentGroup > 0 && (
                            <div className={`text-[10px] mt-0.5 font-semibold ${activeGc.bg.replace('bg-', 'text-').replace('-600', '-700').replace('-500', '-600')}`}>
                              → {activeGc.label}
                            </div>
                          )}
                        </div>

                        {/* Group buttons */}
                        <div className="flex items-center gap-1 shrink-0">
                          {Array.from({ length: maxButtonGroup + 1 }, (_, g) => {
                            const gc = GROUP_COLORS[g] ?? GROUP_COLORS[0];
                            const isActive = currentGroup === g;
                            return (
                              <button key={g} type="button"
                                onClick={() => setGroup(item.id, ben.id, g)}
                                title={gc.label}
                                className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                                  isActive
                                    ? `${gc.bg} ${gc.text} shadow-sm scale-105`
                                    : 'bg-white border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600'
                                }`}
                              >
                                {g === 0 ? '١' : `${g + 1}`}
                              </button>
                            );
                          })}
                          {maxButtonGroup < GROUP_COLORS.length - 1 && (
                            <button type="button"
                              onClick={() => setGroup(item.id, ben.id, maxButtonGroup + 1)}
                              title={`إضافة ${GROUP_COLORS[maxButtonGroup + 1]?.label}`}
                              className="w-8 h-8 rounded-lg text-sm font-bold bg-white border border-dashed border-slate-300 text-slate-400 hover:border-violet-400 hover:text-violet-500 transition-all"
                            >+</button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {allItems.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-4">لا توجد أصناف</p>
                  )}
                </div>

                {/* Next button */}
                {currentIdx < filtered.length - 1 && (
                  <button type="button" onClick={goNext}
                    className="w-full py-2 text-xs font-semibold text-violet-600 border border-violet-200 rounded-xl hover:bg-violet-50 transition-colors flex items-center justify-center gap-1.5">
                    التالي: {filtered[currentIdx + 1]?.beneficiary.name}
                    <svg className="w-3.5 h-3.5 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function StickersView() {
  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [error, setError] = useState('');
  const [customDict, setCustomDict] = useState<Record<string, string>>({});
  const [splits, setSplits] = useState<SplitsMap>({});
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [sizeWidth, setSizeWidth]   = useState<string>('10');
  const [sizeHeight, setSizeHeight] = useState<string>('10');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSplitsLoad = useRef(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.from('daily_orders').select('id, date, meal_type, created_at').order('date', { ascending: false })
      .then(({ data }) => { if (data) setOrders(data as unknown as DailyOrder[]); setLoadingOrders(false); });
  }, [supabase]);

  useEffect(() => {
    supabase.from('custom_transliterations').select('word, transliteration')
      .then(({ data }) => {
        if (data) {
          const dict: Record<string, string> = {};
          data.forEach((e: { word: string; transliteration: string }) => { dict[e.word] = e.transliteration; });
          setCustomDict(dict);
        }
      });
  }, [supabase]);

  // Auto-save splits (debounced 800ms)
  useEffect(() => {
    if (!selectedOrderId) return;
    if (isFirstSplitsLoad.current) { isFirstSplitsLoad.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        await supabase.from('sticker_splits').delete().eq('order_id', selectedOrderId);
        const rows = Object.entries(splits)
          .filter(([, gm]) => Object.values(gm).some(g => g > 0))
          .map(([beneficiary_id, gm]) => ({
            order_id: selectedOrderId,
            beneficiary_id,
            split_meal_ids: serializeSplits(gm),
          }));
        if (rows.length > 0) await supabase.from('sticker_splits').insert(rows);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } catch {
        setSaveStatus('error');
      }
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splits]);

  const loadReport = async (orderId: string) => {
    if (!orderId) return;
    isFirstSplitsLoad.current = true;
    setLoading(true); setError(''); setReport(null); setSplits({}); setSaveStatus('idle');
    try {
      const [reportRes, splitsRes] = await Promise.all([
        fetch(`/api/orders/${orderId}/report`),
        supabase.from('sticker_splits').select('beneficiary_id, split_meal_ids').eq('order_id', orderId),
      ]);
      const data = await reportRes.json();
      if (!reportRes.ok) { setError(data.error || 'حدث خطأ'); }
      else {
        setReport(data);
        if (splitsRes.data) {
          const loaded: SplitsMap = {};
          splitsRes.data.forEach((row: { beneficiary_id: string; split_meal_ids: string[] }) => {
            loaded[row.beneficiary_id] = deserializeSplits(row.split_meal_ids);
          });
          setSplits(loaded);
        }
      }
    } catch { setError('حدث خطأ في الاتصال'); }
    setLoading(false);
  };

  const stickerDetails = report?.beneficiaryDetails.filter(d =>
    d.excludedItems.length > 0 || (d.fixedItems ?? []).length > 0
  ) ?? [];
  const mealTypeAr = report ? MEAL_TYPE_LABELS[report.order.meal_type] : '';
  const mealTypeEn = report ? MEAL_TYPE_EN[report.order.meal_type] : '';

  // Expand splits into per-group sticker details
  const displayDetails = stickerDetails.flatMap(detail => {
    const gm = splits[detail.beneficiary.id] ?? {};
    const nGroups = maxGroup(gm);

    if (nGroups === 0) return [{ ...detail, groupIndex: 0 }];

    const result: Array<typeof detail & { groupIndex: number }> = [];
    for (let g = 0; g <= nGroups; g++) {
      const groupExcluded = detail.excludedItems.filter(item => (gm[item.meal.id] ?? 0) === g);
      const groupFixed    = (detail.fixedItems ?? []).filter(m => (gm[m.meal.id] ?? 0) === g);
      if (groupExcluded.length > 0 || groupFixed.length > 0) {
        result.push({ ...detail, excludedItems: groupExcluded, fixedItems: groupFixed, groupIndex: g });
      }
    }
    return result;
  });

  const handleExportWord = () => {
    if (!report || displayDetails.length === 0) return;
    const fn = `ستيكرات_${new Date(report.order.date).toISOString().slice(0, 10)}_${mealTypeAr}`;
    exportStickersWord(displayDetails, mealTypeAr, mealTypeEn, fn, customDict);
  };

  const handleExportPerPage = async () => {
    if (!report || displayDetails.length === 0) return;
    const w = parseFloat(sizeWidth);
    const h = parseFloat(sizeHeight);
    if (!w || !h || w < 2 || h < 2 || w > 30 || h > 30) {
      alert('أدخل أبعاداً صالحة (2 إلى 30 سم لكل بُعد)');
      return;
    }
    const fn = `ستيكرات_${new Date(report.order.date).toISOString().slice(0, 10)}_${mealTypeAr}_${w}x${h}سم`;
    try {
      await exportStickersPerPageDocx(displayDetails, mealTypeAr, mealTypeEn, fn, w, h, customDict);
    } catch (e) {
      alert('حدث خطأ أثناء إنشاء الملف');
      console.error(e);
    }
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between no-print">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">الستيكرات</h1>
          <p className="text-slate-500 text-sm mt-0.5">طباعة ستيكر لكل مستفيد عنده استبعاد</p>
        </div>
        {report && displayDetails.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={handleExportWord} className="btn-secondary text-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              تصدير Word ({displayDetails.length})
            </button>
            <button onClick={() => window.print()} className="btn-primary">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              طباعة ({displayDetails.length})
            </button>
          </div>
        )}
      </div>

      {/* Order selector */}
      <div className="card p-4 no-print">
        <label className="label">اختر أمر التشغيل</label>
        {loadingOrders ? <div className="input-field text-slate-400">جاري التحميل...</div> : (
          <select value={selectedOrderId} onChange={e => { setSelectedOrderId(e.target.value); loadReport(e.target.value); }} className="input-field">
            <option value="">-- اختر أمر تشغيل --</option>
            {orders.map(o => (
              <option key={o.id} value={o.id}>{formatDate(o.date)} — {MEAL_TYPE_LABELS[o.meal_type]}</option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="card p-10 text-center">
          <div className="animate-spin w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-slate-400 mt-3">جاري التحميل...</p>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl no-print">{error}</div>}
      {report && !loading && stickerDetails.length === 0 && (
        <div className="card p-10 text-center text-slate-400 no-print">لا يوجد مستفيدون بتخصيصات في هذا الأمر</div>
      )}

      {/* Sticker grid */}
      {report && !loading && stickerDetails.length > 0 && (
        <>
          <div id="stickers-content">
            {/* Print-only header */}
            <div className="sticker-print-header">
              <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 3 }}>
                ستيكرات — خطوة أمل
              </div>
              <div style={{ fontSize: 13, color: '#374151', fontWeight: 600 }}>
                {report && formatDateFull(report.order.date)} &nbsp;|&nbsp; {mealTypeAr} {mealTypeEn}
              </div>
            </div>

            <div className="no-print text-sm text-slate-500 px-1 mb-3">
              {displayDetails.length} ستيكر
              {displayDetails.length !== stickerDetails.length && (
                <span className="text-violet-600 mr-2">({displayDetails.length - stickerDetails.length} مفصول)</span>
              )}
            </div>

            <div className="sticker-wrap">
              <div className="sticker-grid">
                {displayDetails.map((detail) => (
                  <StickerCard
                    key={`${detail.beneficiary.id}_g${detail.groupIndex}_${detail.excludedItems.map(i => i.meal.id).join(',')}_${(detail.fixedItems ?? []).map(m => m.meal.id).join(',')}`}
                    detail={detail}
                    mealTypeAr={mealTypeAr}
                    mealTypeEn={mealTypeEn}
                    customDict={customDict}
                    groupIndex={detail.groupIndex}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Splitter */}
          <StickerSplitter
            stickerDetails={stickerDetails}
            splits={splits}
            onSplitsChange={setSplits}
            saveStatus={saveStatus}
          />

          {/* ── Size-based Word export ─────────────────────────────────────── */}
          <div className="card p-5 no-print">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4v4M16 4v4M4 10h16" />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-slate-800 text-sm">الستيكرات حسب المقاس</h3>
                <p className="text-xs text-slate-500">ملف Word فيه كل ستيكر في صفحة منفصلة بالمقاس اللي تحدده — للطباعة على طابعة الملصقات مباشرة</p>
              </div>
            </div>

            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="label text-xs">العرض (سم)</label>
                <input
                  type="number"
                  min={2}
                  max={30}
                  step="0.1"
                  value={sizeWidth}
                  onChange={e => setSizeWidth(e.target.value)}
                  className="input-field w-28"
                  placeholder="10"
                />
              </div>
              <div>
                <label className="label text-xs">الطول (سم)</label>
                <input
                  type="number"
                  min={2}
                  max={30}
                  step="0.1"
                  value={sizeHeight}
                  onChange={e => setSizeHeight(e.target.value)}
                  className="input-field w-28"
                  placeholder="10"
                />
              </div>

              {/* Preset shortcuts */}
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { w: '10', h: '10' },
                  { w: '10', h: '15' },
                  { w: '8',  h: '5'  },
                  { w: '6',  h: '4'  },
                ].map(p => (
                  <button
                    key={`${p.w}x${p.h}`}
                    type="button"
                    onClick={() => { setSizeWidth(p.w); setSizeHeight(p.h); }}
                    className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                  >
                    {p.w}×{p.h}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExportPerPage}
                disabled={displayDetails.length === 0}
                className="btn-primary text-sm disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                تصدير Word ({displayDetails.length} صفحة)
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mt-3">
              💡 افتح الملف في Word ثم اطبعه — كل ستيكر في صفحة منفصلة بمقاس {sizeWidth || '—'}×{sizeHeight || '—'} سم.
              الخط يتكيّف تلقائياً مع المقاس المختار.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
