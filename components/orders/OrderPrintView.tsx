'use client';

import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import type { Meal } from '@/lib/types';

interface MealCount { meal: Meal; gets?: number; qty?: number; quantity?: number; fixedQty?: number }
interface BeneficiaryDetail {
  beneficiary: { id: string; name: string; code: string; villa?: string; category: string };
  excludedItems: { meal: Meal; alternative: Meal | null }[];
  fixedItems: { meal: Meal; quantity: number }[];
}
interface FullReport {
  order: { id: string; date: string; meal_type: string; week_number?: number | null; week_of_month?: number | null; day_of_week?: number | null };
  itemsSummary: MealCount[];
  beneficiaryDetails: BeneficiaryDetail[];
  mainMealsSummary: MealCount[];
  snackMealsSummary: MealCount[];
  altSummary: MealCount[];
  snackAltSummary: MealCount[];
  fixedSummary: MealCount[];
}

function arabicDate(dateStr: string) {
  const d = new Date(dateStr);
  const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const [y, m, day] = dateStr.split('-');
  return `${dayNames[d.getDay()]} ${day}-${m}-${y}`;
}

const WEEK_LABELS: Record<number, string> = {
  1: 'الأسبوع الأول',
  2: 'الأسبوع الثاني',
  3: 'الأسبوع الثالث',
  4: 'الأسبوع الرابع',
};

// Layout color palette — matches the reference PDF
const PALETTE = {
  title:   { bg: '#eff6ff', border: '#1e3a8a', text: '#1e3a8a' }, // indigo/blue header
  main:    { bg: '#16a34a', text: '#fff' },  // green
  alt:     { bg: '#e11d48', text: '#fff' },  // rose
  snack:   { bg: '#ea580c', text: '#fff' },  // orange
  snackAlt:{ bg: '#f59e0b', text: '#fff' },  // amber
  fixed:   { bg: '#7c3aed', text: '#fff' },  // purple
  stats:   { bg: '#0ea5e9', text: '#fff' },  // sky-blue
  bens:    { bg: '#6d28d9', text: '#fff' },  // deep purple
};

export default function OrderPrintView({ orderId }: { orderId: string }) {
  const [report, setReport] = useState<FullReport | null>(null);
  const [error, setError] = useState('');
  const [showFixedSection, setShowFixedSection] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('orderPrintShowFixed') !== '0' : true
  );
  const [showCustomSection, setShowCustomSection] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('orderPrintShowCustom') !== '0' : true
  );
  // Always start unchecked — user must explicitly toggle it on each time
  const [fitOnePage, setFitOnePage] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/report`);
    if (!res.ok) { setError('تعذّر تحميل البيانات'); return; }
    setReport(await res.json());
  }, [orderId]);

  useEffect(() => { load(); }, [load]);

  // Auto-scale to fit one A4 page (297mm at 96dpi ≈ 1123px, minus 6mm margins ≈ 1080px)
  useLayoutEffect(() => {
    if (!report) return;
    if (!fitOnePage) { setScale(1); return; }
    const el = pageRef.current;
    if (!el) return;
    const TARGET_HEIGHT = 1080;
    (el.style as any).zoom = '1';
    const h = el.scrollHeight;
    const s = h <= TARGET_HEIGHT ? 1 : Math.max(0.3, TARGET_HEIGHT / h);
    setScale(s);
  }, [report, fitOnePage, showFixedSection, showCustomSection]);

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#c00' }}>
      {error}
    </div>
  );

  if (!report) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, fontFamily: 'sans-serif', color: '#555' }}>
      <div style={{ width: 36, height: 36, border: '3px solid #10b981', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p>جاري تحضير أمر التشغيل...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const { order, mainMealsSummary, snackMealsSummary, altSummary, snackAltSummary, fixedSummary, itemsSummary, beneficiaryDetails } = report;
  const mealLabel = MEAL_TYPE_LABELS[order.meal_type as keyof typeof MEAL_TYPE_LABELS] || order.meal_type;
  const withCustom = beneficiaryDetails.filter(d => d.excludedItems.length > 0 || d.fixedItems.length > 0);
  const fileBaseName = `order-${order.date}-${order.meal_type}`;

  // ── Export helpers ────────────────────────────────────────────────────────
  const buildHtml = () => {
    const node = pageRef.current;
    if (!node) return '';
    const prevZoom = (node.style as any).zoom;
    (node.style as any).zoom = '1';
    const contentHtml = node.outerHTML;
    (node.style as any).zoom = prevZoom;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>أمر تشغيل — ${arabicDate(order.date)} — ${mealLabel}</title>
<style>
  body { margin: 0; padding: 12px; background: #f1f5f9; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Make the page container fluid in preview — overrides the fixed 210mm width */
  #order-print-root {
    width: 100% !important;
    max-width: 100% !important;
    padding: 16px !important;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    background: #fff;
    border-radius: 8px;
  }
  #order-print-root table { width: 100% !important; table-layout: auto !important; }
  #order-print-root td, #order-print-root th { word-break: break-word; }
  /* Keep two-column grids responsive: collapse to 1 column on narrow screens */
  @media (max-width: 720px) {
    #order-print-root [style*="grid-template-columns: 1fr 1fr"] {
      grid-template-columns: 1fr !important;
    }
  }
  @media print {
    @page { size: A4 portrait; margin: 5mm; }
    body { padding: 0; background: #fff; }
    .preview-toolbar { display: none !important; }
    #order-print-root { box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; }
  }
</style>
</head>
<body>
<div class="preview-toolbar" style="position:sticky; top:0; z-index:1000; background:#1e293b; color:#fff; padding:10px 16px; display:flex; align-items:center; justify-content:space-between; direction:rtl; font-family:inherit; margin:-12px -12px 12px; box-shadow:0 2px 8px rgba(0,0,0,0.1);">
  <strong style="font-size:14px;">معاينة أمر التشغيل — ${arabicDate(order.date)} — ${mealLabel}</strong>
  <div style="display:flex; gap:8px;">
    <button onclick="(function(){var css='body{margin:0;padding:12px;background:#fff;font-family:Segoe UI,Tahoma,Arial,sans-serif}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}#order-print-root{width:100%!important;max-width:100%!important;padding:0!important}#order-print-root table{width:100%!important;table-layout:auto!important}#order-print-root td,#order-print-root th{word-break:break-word}@media (max-width:720px){#order-print-root [style*=\\'grid-template-columns: 1fr 1fr\\']{grid-template-columns:1fr!important}}@media print{@page{size:A4 portrait;margin:5mm}body{padding:0}}';var a=document.createElement('a');var h='<!DOCTYPE html><html lang=\\'ar\\' dir=\\'rtl\\'><head><meta charset=\\'UTF-8\\'><meta name=\\'viewport\\' content=\\'width=device-width,initial-scale=1\\'><title>أمر تشغيل</title><style>'+css+'</style></head><body>'+document.querySelector('#order-print-root').outerHTML+'</body></html>';var b=new Blob([h],{type:'text/html;charset=utf-8'});a.href=URL.createObjectURL(b);a.download='${fileBaseName}.html';document.body.appendChild(a);a.click();document.body.removeChild(a);})();" style="background:#10b981;color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-weight:600;font-size:13px;font-family:inherit;">⬇ حفظ كملف HTML</button>
    <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;border-radius:6px;padding:6px 16px;cursor:pointer;font-weight:600;font-size:13px;font-family:inherit;">🖨 طباعة</button>
    <button onclick="window.close()" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-family:inherit;">إغلاق</button>
  </div>
</div>
${contentHtml}
</body>
</html>`;
  };

  const previewHtml = () => {
    const html = buildHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const exportAsWord = () => {
    const node = pageRef.current;
    if (!node) return;
    const prevZoom = (node.style as any).zoom;
    (node.style as any).zoom = '1';
    const contentHtml = node.outerHTML;
    (node.style as any).zoom = prevZoom;

    // Word HTML envelope — opens natively in Microsoft Word with styles/colors preserved
    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40" lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>أمر تشغيل</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  @page { size: A4 portrait; margin: 8mm; mso-page-orientation: portrait; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; }
  table { border-collapse: collapse; }
</style>
</head>
<body>
${contentHtml}
</body>
</html>`;

    const blob = new Blob(['﻿', wordHtml], { type: 'application/msword' });
    triggerDownload(blob, `${fileBaseName}.doc`);
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Base styles
  const s: Record<string, React.CSSProperties> = {
    page: {
      fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif",
      fontSize: 11, color: '#1e293b', background: '#fff',
      direction: 'rtl', padding: '6mm 8mm',
      width: '210mm', maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box',
    },
    titleBar: {
      fontSize: 22, fontWeight: 800, color: PALETTE.title.text,
      textAlign: 'center', padding: '8px 0', marginBottom: 6,
    },
    infoBar: {
      background: PALETTE.title.bg,
      border: `1.5px solid ${PALETTE.title.border}`,
      borderRadius: 8,
      padding: '8px 14px',
      textAlign: 'center',
      lineHeight: 1.7,
      marginBottom: 10,
    },
    infoMain: { fontSize: 15, fontWeight: 700, color: '#0f172a' },
    infoLine: { fontSize: 12, color: '#1e293b' },
    sectionHeader: {
      padding: '6px 14px', fontWeight: 700, fontSize: 14.5,
      textAlign: 'right' as const,
    },
    table: { width: '100%', borderCollapse: 'collapse' as const, border: '1px solid #94a3b8' },
    th: {
      background: '#f1f5f9', padding: '5px 12px',
      borderBottom: '1px solid #94a3b8', borderLeft: '1px solid #cbd5e1',
      textAlign: 'right' as const, fontWeight: 700, fontSize: 13, color: '#334155',
    },
    td: {
      padding: '5px 12px', borderBottom: '1px solid #e2e8f0',
      borderLeft: '1px solid #e2e8f0', fontSize: 13.5,
    },
    tdNum: {
      padding: '5px 12px', borderBottom: '1px solid #e2e8f0',
      borderLeft: '1px solid #e2e8f0', fontSize: 14.5, fontWeight: 700,
      textAlign: 'center' as const, width: 60,
    },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },

    // Tighter styles for the beneficiary table (more rows → smaller cells)
    bensHeader: {
      padding: '5px 12px', fontWeight: 700, fontSize: 12.5,
      textAlign: 'right' as const,
    },
    bensTh: {
      background: '#f1f5f9', padding: '2.5px 6px',
      borderBottom: '1px solid #94a3b8', borderLeft: '1px solid #cbd5e1',
      textAlign: 'right' as const, fontWeight: 700, fontSize: 10, color: '#334155',
      lineHeight: 1.2,
    },
    bensTd: {
      padding: '2px 6px', borderBottom: '1px solid #e2e8f0',
      borderLeft: '1px solid #e2e8f0', fontSize: 10, lineHeight: 1.25,
    },
  };

  // Simple table for main/alt/snack sections
  const SectionTable = ({ title, color, items, numLabel, numKey }: {
    title: string;
    color: { bg: string; text: string };
    items: MealCount[];
    numLabel: string;
    numKey: 'gets' | 'qty' | 'quantity';
  }) => (
    <div className="print-section" style={{ breakInside: 'avoid' }}>
      <div style={{ ...s.sectionHeader, background: color.bg, color: color.text }}>{title}</div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>{title.includes('بديل') || title.includes('بدائل') ? 'الصنف البديل' : title.includes('سناك') ? 'السناك' : 'الصنف'}</th>
            <th style={{ ...s.th, textAlign: 'center', width: 60 }}>{numLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={2} style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }}>—</td></tr>
          ) : items.map((x, i) => (
            <tr key={x.meal.id}>
              <td style={s.td}>{i + 1}. {x.meal.name}</td>
              <td style={s.tdNum}>{(x[numKey] as number) || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // Compact grid used for "أصناف يومية ثابتة" and "إحصاء الأصناف"
  // Renders `columns` columns of (qty | name) pairs
  const CompactGrid = ({ title, color, items, numKey, columns = 4 }: {
    title: string;
    color: { bg: string; text: string };
    items: MealCount[];
    numKey: 'qty' | 'quantity' | 'gets';
    columns?: number;
  }) => {
    if (items.length === 0) return null;
    const rows = Math.ceil(items.length / columns);
    const cellsPerRow = columns;
    return (
      <div className="print-section" style={{ breakInside: 'avoid', marginBottom: 8 }}>
        <div style={{ ...s.sectionHeader, background: color.bg, color: color.text }}>{title}</div>
        <table style={s.table}>
          <tbody>
            {Array.from({ length: rows }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                {Array.from({ length: cellsPerRow }).map((_, colIdx) => {
                  const item = items[rowIdx * cellsPerRow + colIdx];
                  if (!item) return (
                    <React.Fragment key={colIdx}>
                      <td style={{ ...s.tdNum, width: 36, background: '#fafafa' }}>&nbsp;</td>
                      <td style={{ ...s.td, background: '#fafafa' }}>&nbsp;</td>
                    </React.Fragment>
                  );
                  const n = (item[numKey] as number) || 0;
                  return (
                    <React.Fragment key={colIdx}>
                      <td style={{ ...s.tdNum, width: 36 }}>{n}</td>
                      <td style={s.td}>{item.meal.name}</td>
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; }
        body { background: #e2e8f0; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .print-page { page-break-inside: avoid; break-inside: avoid; }
        .print-section { page-break-inside: avoid; break-inside: avoid; }

        @media print {
          @page { size: A4 portrait; margin: 5mm; }
          html, body { background: #fff !important; width: auto !important; height: auto !important; }
          .no-print { display: none !important; }
          .print-page {
            width: 100% !important;
            max-width: 100% !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* Print action bar */}
      <div className="no-print" style={{ background: '#1e293b', color: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontFamily: 'sans-serif', direction: 'rtl' }}>
        <span style={{ fontWeight: 600 }}>معاينة أمر التشغيل — {mealLabel} {arabicDate(order.date)}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 12, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showFixedSection}
              onChange={e => {
                setShowFixedSection(e.target.checked);
                localStorage.setItem('orderPrintShowFixed', e.target.checked ? '1' : '0');
              }}
              style={{ cursor: 'pointer', accentColor: '#7c3aed' }}
            />
            إظهار الأصناف الثابتة
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 12, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showCustomSection}
              onChange={e => {
                setShowCustomSection(e.target.checked);
                localStorage.setItem('orderPrintShowCustom', e.target.checked ? '1' : '0');
              }}
              style={{ cursor: 'pointer', accentColor: '#6d28d9' }}
            />
            إظهار تخصيصات المستفيدين
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 12, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={fitOnePage}
              onChange={e => setFitOnePage(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: '#10b981' }}
            />
            احتواء في صفحة واحدة
          </label>
          <button
            onClick={() => {
              requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
            }}
            style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}
          >
            ⬇ PDF
          </button>
          <button
            onClick={exportAsWord}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}
          >
            ⬇ Word
          </button>
          <button
            onClick={previewHtml}
            style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}
          >
            👁 عرض HTML
          </button>
          <button
            onClick={() => window.close()}
            style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
          >
            إغلاق
          </button>
        </div>
      </div>

      <div
        id="order-print-root"
        ref={pageRef}
        className="print-page"
        style={{
          ...s.page,
          ...(scale !== 1 ? ({ zoom: scale } as React.CSSProperties) : {}),
        }}
      >
        {/* ── Title ── */}
        <div style={s.titleBar}>أمر تشغيل — خطوة أمل</div>

        {/* ── Info box ── */}
        <div style={s.infoBar}>
          <div style={s.infoMain}>{arabicDate(order.date)}</div>
          <div style={s.infoLine}>نوع الوجبة: <strong>{mealLabel}</strong></div>
          {(() => {
            const wk = order.week_number ?? order.week_of_month;
            return wk && WEEK_LABELS[wk] ? (
              <div style={s.infoLine}>الأسبوع: <strong>{WEEK_LABELS[wk]}</strong></div>
            ) : null;
          })()}
        </div>

        {/* ── Main + Alt side-by-side ── */}
        {(mainMealsSummary.length > 0 || altSummary.length > 0) && (
          <div style={s.grid2}>
            <SectionTable title="الأصناف الرئيسية" color={PALETTE.main} items={mainMealsSummary} numLabel="الكمية" numKey="gets" />
            <SectionTable title="الأصناف البديلة" color={PALETTE.alt} items={altSummary} numLabel="العدد" numKey="qty" />
          </div>
        )}

        {/* ── Snacks + Snack alts ── */}
        {(snackMealsSummary.length > 0 || snackAltSummary.length > 0) && (
          <div style={s.grid2}>
            <SectionTable title="السناكات المختارة" color={PALETTE.snack} items={snackMealsSummary} numLabel="الكمية" numKey="gets" />
            {snackAltSummary.length > 0 ? (
              <SectionTable title="بدائل السناكات" color={PALETTE.snackAlt} items={snackAltSummary} numLabel="العدد" numKey="qty" />
            ) : <div />}
          </div>
        )}

        {/* ── Fixed items — 4-column compact grid ── */}
        {showFixedSection && fixedSummary.length > 0 && (
          <CompactGrid title="أصناف يومية ثابتة" color={PALETTE.fixed} items={fixedSummary} numKey="qty" columns={4} />
        )}

        {/* ── Items summary — 4-column compact grid ── */}
        {itemsSummary.length > 0 && (
          <CompactGrid title="إحصاء الأصناف" color={PALETTE.stats} items={itemsSummary} numKey="quantity" columns={4} />
        )}

        {/* ── Beneficiary custom details ── */}
        {showCustomSection && withCustom.length > 0 && (
          <div className="print-section" style={{ breakInside: 'avoid' }}>
            <div style={{ ...s.bensHeader, background: PALETTE.bens.bg, color: PALETTE.bens.text }}>
              تخصيصات المستفيدين
            </div>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.bensTh, textAlign: 'center', width: 36 }}>الكود</th>
                  <th style={{ ...s.bensTh, textAlign: 'center', width: 36 }}>الفيلا</th>
                  <th style={s.bensTh}>الاسم</th>
                  <th style={s.bensTh}>الأصناف المستبعدة</th>
                  <th style={s.bensTh}>البدائل والأصناف اليومية الثابتة</th>
                </tr>
              </thead>
              <tbody>
                {withCustom.map(detail => {
                  const excludedNames = detail.excludedItems.map(x => x.meal.name).join(' | ');
                  const altParts: string[] = [];
                  detail.excludedItems.forEach(x => { if (x.alternative) altParts.push(x.alternative.name); });
                  detail.fixedItems.forEach(f => {
                    altParts.push(f.quantity > 1 ? `${f.quantity} ${f.meal.name}` : f.meal.name);
                  });
                  return (
                    <tr key={detail.beneficiary.id}>
                      <td style={{ ...s.bensTd, textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>{detail.beneficiary.code}</td>
                      <td style={{ ...s.bensTd, textAlign: 'center' }}>{detail.beneficiary.villa || '—'}</td>
                      <td style={{ ...s.bensTd, fontWeight: 600 }}>{detail.beneficiary.name}</td>
                      <td style={s.bensTd}>{excludedNames || '—'}</td>
                      <td style={s.bensTd}>{altParts.length ? altParts.join(' | ') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

