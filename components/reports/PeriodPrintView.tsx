'use client';

import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
import { WEEK_TITLES, MENU_DAYS } from '@/lib/menu-utils';
import type { MenuPeriodReport } from '@/lib/menu-period-report';
import type { Meal, MealType, EntityType } from '@/lib/types';

interface MealCount { meal: Meal; gets?: number; qty?: number; quantity?: number }

const PALETTE = {
  title:    { bg: '#eff6ff', border: '#1e3a8a', text: '#1e3a8a' },
  main:     { bg: '#16a34a', text: '#fff' },
  alt:      { bg: '#e11d48', text: '#fff' },
  snack:    { bg: '#ea580c', text: '#fff' },
  snackAlt: { bg: '#f59e0b', text: '#fff' },
  fixed:    { bg: '#7c3aed', text: '#fff' },
  stats:    { bg: '#0ea5e9', text: '#fff' },
  weeks:    { bg: '#334155', text: '#fff' },
};

const DAY_SHORT: Record<number, string> = {
  6: 'سبت', 0: 'أحد', 1: 'إثنين', 2: 'ثلاثاء', 3: 'أربعاء', 4: 'خميس', 5: 'جمعة',
};

function formatSelectionsLabel(selections: Record<string, number[]>): string {
  return Object.entries(selections)
    .map(([w, days]) => {
      const weekLabel = WEEK_TITLES[Number(w) as 1 | 2 | 3 | 4];
      const daysLabel = days.length === 7 ? 'كل الأيام' : days.map(d => DAY_SHORT[d]).join('، ');
      return `${weekLabel} (${daysLabel})`;
    })
    .join(' | ');
}

// ── Shared sub-components ────────────────────────────────────────────────────
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
    borderRadius: 8, padding: '8px 14px',
    textAlign: 'center', lineHeight: 1.7, marginBottom: 10,
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
};

function SectionTable({ title, color, items, numKey }: {
  title: string;
  color: { bg: string; text: string };
  items: MealCount[];
  numKey: 'gets' | 'qty' | 'quantity';
}) {
  return (
    <div style={{ breakInside: 'avoid' }}>
      <div style={{ ...s.sectionHeader, background: color.bg, color: color.text }}>{title}</div>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>الصنف</th>
            <th style={{ ...s.th, textAlign: 'center', width: 60 }}>الكمية</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0
            ? <tr><td colSpan={2} style={{ ...s.td, textAlign: 'center', color: '#94a3b8' }}>—</td></tr>
            : items.map((x, i) => (
              <tr key={x.meal.id}>
                <td style={s.td}>{i + 1}. {x.meal.name}</td>
                <td style={s.tdNum}>{(x[numKey] as number) || 0}</td>
              </tr>
            ))}
        </tbody>
        {items.length > 0 && (
          <tfoot>
            <tr>
              <td style={{ ...s.td, fontWeight: 700, color: '#334155' }}>المجموع</td>
              <td style={{ ...s.tdNum, background: '#f8fafc' }}>
                {items.reduce((sum, x) => sum + ((x[numKey] as number) || 0), 0)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function CompactGrid({ title, color, items, numKey, columns = 4 }: {
  title: string;
  color: { bg: string; text: string };
  items: MealCount[];
  numKey: 'qty' | 'quantity' | 'gets';
  columns?: number;
}) {
  if (items.length === 0) return null;
  const rows = Math.ceil(items.length / columns);
  return (
    <div style={{ breakInside: 'avoid', marginBottom: 8 }}>
      <div style={{ ...s.sectionHeader, background: color.bg, color: color.text }}>{title}</div>
      <table style={s.table}>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <tr key={rowIdx}>
              {Array.from({ length: columns }).map((_, colIdx) => {
                const item = items[rowIdx * columns + colIdx];
                if (!item) return (
                  <React.Fragment key={colIdx}>
                    <td style={{ ...s.tdNum, width: 36, background: '#fafafa' }}>&nbsp;</td>
                    <td style={{ ...s.td, background: '#fafafa' }}>&nbsp;</td>
                  </React.Fragment>
                );
                return (
                  <React.Fragment key={colIdx}>
                    <td style={{ ...s.tdNum, width: 36 }}>{(item[numKey] as number) || 0}</td>
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
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  selectionsParam: string;   // JSON-encoded selections
  mealType?: MealType;
  entityType?: EntityType;
}

export default function PeriodPrintView({ selectionsParam, mealType, entityType }: Props) {
  const [report, setReport] = useState<MenuPeriodReport | null>(null);
  const [error, setError] = useState('');
  const [fitOnePage, setFitOnePage] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const load = useCallback(async () => {
    let selections: Record<string, number[]>;
    try { selections = JSON.parse(selectionsParam); }
    catch { setError('بيانات غير صالحة'); return; }

    const res = await fetch('/api/reports/menu-period', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selections,
        ...(mealType ? { meal_type: mealType } : {}),
        ...(entityType ? { entity_type: entityType } : {}),
      }),
    });
    if (!res.ok) { setError('تعذّر تحميل البيانات'); return; }
    setReport(await res.json());
  }, [selectionsParam, mealType, entityType]);

  useEffect(() => { load(); }, [load]);

  useLayoutEffect(() => {
    if (!report) return;
    if (!fitOnePage) { setScale(1); return; }
    const el = pageRef.current;
    if (!el) return;
    const TARGET = 1080;
    (el.style as unknown as Record<string, string>).zoom = '1';
    const h = el.scrollHeight;
    setScale(h <= TARGET ? 1 : Math.max(0.3, TARGET / h));
  }, [report, fitOnePage]);

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#c00' }}>
      {error}
    </div>
  );

  if (!report) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, fontFamily: 'sans-serif', color: '#555' }}>
      <div style={{ width: 36, height: 36, border: '3px solid #10b981', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p>جاري تحضير تقرير الفترة...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const { aggregated, weeksSummary, processedSlots } = report;
  const totalItems = aggregated.itemsSummary.reduce((s, x) => s + x.quantity, 0);
  const selectionsLabel = formatSelectionsLabel(report.selections);
  const fileBaseName = `period-report-${Object.keys(report.selections).join('-')}`;

  const buildHtml = () => {
    const node = pageRef.current;
    if (!node) return '';
    const prev = (node.style as unknown as Record<string, string>).zoom;
    (node.style as unknown as Record<string, string>).zoom = '1';
    const html = node.outerHTML;
    (node.style as unknown as Record<string, string>).zoom = prev;
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>تقرير فترة زمنية</title>
<style>
  body { margin: 0; padding: 12px; background: #f1f5f9; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  #period-print-root { width: 100% !important; max-width: 100% !important; padding: 16px !important; box-shadow: 0 2px 12px rgba(0,0,0,.08); background: #fff; border-radius: 8px; }
  #period-print-root table { width: 100% !important; table-layout: auto !important; }
  @media print { @page { size: A4 portrait; margin: 5mm; } body { padding: 0; background: #fff; } .preview-toolbar { display: none !important; } #period-print-root { box-shadow: none !important; border-radius: 0 !important; padding: 0 !important; } }
</style>
</head>
<body>
<div class="preview-toolbar" style="position:sticky;top:0;z-index:1000;background:#1e293b;color:#fff;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;direction:rtl;font-family:inherit;margin:-12px -12px 12px;">
  <strong style="font-size:14px;">معاينة تقرير الفترة الزمنية</strong>
  <div style="display:flex;gap:8px;">
    <button onclick="window.print()" style="background:#10b981;color:#fff;border:none;border-radius:6px;padding:6px 14px;cursor:pointer;font-weight:600;font-size:13px;font-family:inherit;">🖨 طباعة / PDF</button>
    <button onclick="window.close()" style="background:transparent;color:#94a3b8;border:1px solid #475569;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px;font-family:inherit;">إغلاق</button>
  </div>
</div>
${html}
</body>
</html>`;
  };

  const exportAsWord = () => {
    const node = pageRef.current;
    if (!node) return;
    const prev = (node.style as unknown as Record<string, string>).zoom;
    (node.style as unknown as Record<string, string>).zoom = '1';
    const html = node.outerHTML;
    (node.style as unknown as Record<string, string>).zoom = prev;
    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>تقرير فترة زمنية</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page { size: A4 portrait; margin: 8mm; } body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; } table { border-collapse: collapse; }</style>
</head><body>${html}</body></html>`;
    const blob = new Blob(['﻿', wordHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileBaseName}.doc`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const previewHtml = () => {
    const html = buildHtml();
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; }
        body { background: #e2e8f0; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @media print {
          @page { size: A4 portrait; margin: 5mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          #period-print-root { width: 100% !important; max-width: 100% !important; padding: 0 !important; margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ background: '#1e293b', color: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontFamily: 'sans-serif', direction: 'rtl' }}>
        <span style={{ fontWeight: 600 }}>تقرير الفترة الزمنية — خطوة أمل</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            onClick={() => requestAnimationFrame(() => requestAnimationFrame(() => window.print()))}
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

      {/* Print body */}
      <div
        id="period-print-root"
        ref={pageRef}
        style={{
          ...s.page,
          ...(scale !== 1 ? ({ zoom: scale } as React.CSSProperties) : {}),
        }}
      >
        <div style={s.titleBar}>تقرير فترة زمنية — خطوة أمل</div>

        <div style={s.infoBar}>
          <div style={s.infoMain}>{selectionsLabel}</div>
          {report.mealType && (
            <div style={s.infoLine}>نوع الوجبة: <strong>{MEAL_TYPE_LABELS[report.mealType]}</strong></div>
          )}
          {report.entityType && (
            <div style={s.infoLine}>الفئة: <strong>{ENTITY_TYPE_LABELS_PLURAL[report.entityType]}</strong></div>
          )}
          <div style={s.infoLine}>
            {processedSlots} خانة محسوبة &nbsp;|&nbsp; الإجمالي: <strong>{totalItems}</strong> صنف
          </div>
        </div>

        {/* Weeks summary strip */}
        {weeksSummary.length > 0 && (
          <div style={{ breakInside: 'avoid', marginBottom: 8 }}>
            <div style={{ ...s.sectionHeader, background: PALETTE.weeks.bg, color: PALETTE.weeks.text }}>
              الأسابيع والأيام المشمولة
            </div>
            <table style={s.table}>
              <tbody>
                <tr>
                  {weeksSummary.map(ws => (
                    <td key={ws.week} style={{ ...s.td, textAlign: 'center' as const, verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{WEEK_TITLES[ws.week as 1 | 2 | 3 | 4]}</div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                        {ws.days.length === MENU_DAYS.length ? 'كل الأيام' : ws.days.map(d => DAY_SHORT[d]).join('، ')}
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0ea5e9', marginTop: 2 }}>{ws.totalItems}</div>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Main + Alt */}
        {(aggregated.mainMealsSummary.length > 0 || aggregated.altSummary.length > 0) && (
          <div style={s.grid2}>
            <SectionTable title="الأصناف الرئيسية" color={PALETTE.main} items={aggregated.mainMealsSummary as MealCount[]} numKey="gets" />
            <SectionTable title="الأصناف البديلة" color={PALETTE.alt} items={aggregated.altSummary as MealCount[]} numKey="qty" />
          </div>
        )}

        {/* Snacks + Snack alts */}
        {(aggregated.snackMealsSummary.length > 0 || aggregated.snackAltSummary.length > 0) && (
          <div style={s.grid2}>
            <SectionTable title="السناكات المختارة" color={PALETTE.snack} items={aggregated.snackMealsSummary as MealCount[]} numKey="gets" />
            {aggregated.snackAltSummary.length > 0
              ? <SectionTable title="بدائل السناكات" color={PALETTE.snackAlt} items={aggregated.snackAltSummary as MealCount[]} numKey="qty" />
              : <div />}
          </div>
        )}

        {/* Fixed items */}
        <CompactGrid title="الأصناف الثابتة" color={PALETTE.fixed} items={aggregated.fixedSummary as MealCount[]} numKey="qty" columns={4} />

        {/* Total items */}
        <CompactGrid title="إحصاء الأصناف الكلي" color={PALETTE.stats} items={aggregated.itemsSummary as MealCount[]} numKey="quantity" columns={4} />
      </div>
    </>
  );
}
