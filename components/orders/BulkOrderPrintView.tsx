'use client';

import React, { useEffect, useState } from 'react';
import { MEAL_TYPE_LABELS } from '@/lib/types';
import type { Meal } from '@/lib/types';

interface MealCount { meal: Meal; gets?: number; qty?: number; quantity?: number; fixedQty?: number }
interface BeneficiaryDetail {
  beneficiary: { id: string; name: string; code: string; villa?: string; category: string };
  excludedItems: { meal: Meal; alternative: Meal | null }[];
  fixedItems: { meal: Meal; quantity: number }[];
}
interface FullReport {
  order: { id: string; date: string; meal_type: string; week_number?: number | null; week_of_month?: number | null; entity_type?: string | null };
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
  1: 'الأسبوع الأول', 2: 'الأسبوع الثاني', 3: 'الأسبوع الثالث', 4: 'الأسبوع الرابع',
};

const PALETTE = {
  title:    { bg: '#eff6ff', border: '#1e3a8a', text: '#1e3a8a' },
  main:     { bg: '#16a34a', text: '#fff' },
  alt:      { bg: '#e11d48', text: '#fff' },
  snack:    { bg: '#ea580c', text: '#fff' },
  snackAlt: { bg: '#f59e0b', text: '#fff' },
  fixed:    { bg: '#7c3aed', text: '#fff' },
  stats:    { bg: '#0ea5e9', text: '#fff' },
  bens:     { bg: '#6d28d9', text: '#fff' },
};

const s: Record<string, React.CSSProperties> = {
  page:      { fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif", fontSize: 11, color: '#1e293b', background: '#fff', direction: 'rtl', padding: '6mm 8mm', width: '210mm', maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box' },
  titleBar:  { fontSize: 22, fontWeight: 800, color: PALETTE.title.text, textAlign: 'center', padding: '8px 0', marginBottom: 6 },
  infoBar:   { background: PALETTE.title.bg, border: `1.5px solid ${PALETTE.title.border}`, borderRadius: 8, padding: '8px 14px', textAlign: 'center', lineHeight: 1.7, marginBottom: 10 },
  infoMain:  { fontSize: 15, fontWeight: 700, color: '#0f172a' },
  infoLine:  { fontSize: 12, color: '#1e293b' },
  secHeader: { padding: '6px 14px', fontWeight: 700, fontSize: 14.5, textAlign: 'right' as const },
  table:     { width: '100%', borderCollapse: 'collapse' as const, border: '1px solid #94a3b8' },
  th:        { background: '#f1f5f9', padding: '5px 12px', borderBottom: '1px solid #94a3b8', borderLeft: '1px solid #cbd5e1', textAlign: 'right' as const, fontWeight: 700, fontSize: 13, color: '#334155' },
  td:        { padding: '5px 12px', borderBottom: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0', fontSize: 13.5 },
  tdNum:     { padding: '5px 12px', borderBottom: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0', fontSize: 14.5, fontWeight: 700, textAlign: 'center' as const, width: 60 },
  grid2:     { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
  bensTh:    { background: '#f1f5f9', padding: '2.5px 6px', borderBottom: '1px solid #94a3b8', borderLeft: '1px solid #cbd5e1', textAlign: 'right' as const, fontWeight: 700, fontSize: 10, color: '#334155', lineHeight: 1.2 },
  bensTd:    { padding: '2px 6px', borderBottom: '1px solid #e2e8f0', borderLeft: '1px solid #e2e8f0', fontSize: 10, lineHeight: 1.25 },
};

function SectionTable({ title, color, items, numLabel, numKey }: {
  title: string; color: { bg: string; text: string }; items: MealCount[]; numLabel: string; numKey: 'gets' | 'qty' | 'quantity';
}) {
  return (
    <div style={{ breakInside: 'avoid' }}>
      <div style={{ ...s.secHeader, background: color.bg, color: color.text }}>{title}</div>
      <table style={s.table}>
        <thead><tr>
          <th style={s.th}>{title.includes('بديل') || title.includes('بدائل') ? 'الصنف البديل' : title.includes('سناك') ? 'السناك' : 'الصنف'}</th>
          <th style={{ ...s.th, textAlign: 'center', width: 60 }}>{numLabel}</th>
        </tr></thead>
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
      </table>
    </div>
  );
}

function CompactGrid({ title, color, items, numKey, columns = 4 }: {
  title: string; color: { bg: string; text: string }; items: MealCount[]; numKey: 'qty' | 'quantity' | 'gets'; columns?: number;
}) {
  if (items.length === 0) return null;
  const rows = Math.ceil(items.length / columns);
  return (
    <div style={{ breakInside: 'avoid', marginBottom: 8 }}>
      <div style={{ ...s.secHeader, background: color.bg, color: color.text }}>{title}</div>
      <table style={s.table}>
        <tbody>
          {Array.from({ length: rows }).map((_, ri) => (
            <tr key={ri}>
              {Array.from({ length: columns }).map((_, ci) => {
                const item = items[ri * columns + ci];
                if (!item) return (
                  <React.Fragment key={ci}>
                    <td style={{ ...s.tdNum, width: 36, background: '#fafafa' }}>&nbsp;</td>
                    <td style={{ ...s.td, background: '#fafafa' }}>&nbsp;</td>
                  </React.Fragment>
                );
                return (
                  <React.Fragment key={ci}>
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

function SingleOrderContent({ report, showFixed, showCustom }: { report: FullReport; showFixed: boolean; showCustom: boolean }) {
  const { order, mainMealsSummary, snackMealsSummary, altSummary, snackAltSummary, fixedSummary, itemsSummary, beneficiaryDetails } = report;
  const mealLabel = MEAL_TYPE_LABELS[order.meal_type as keyof typeof MEAL_TYPE_LABELS] || order.meal_type;
  const withCustom = beneficiaryDetails.filter(d => d.excludedItems.length > 0 || d.fixedItems.length > 0);
  const wk = order.week_number ?? order.week_of_month;

  return (
    <div style={s.page}>
      <div style={s.titleBar}>أمر تشغيل — خطوة أمل</div>
      <div style={s.infoBar}>
        <div style={s.infoMain}>{arabicDate(order.date)}</div>
        <div style={s.infoLine}>نوع الوجبة: <strong>{mealLabel}</strong></div>
        <div style={s.infoLine}>الفئة: <strong>{order.entity_type === 'companion' ? 'المرافقون' : 'المستفيدون'}</strong></div>
        {wk && WEEK_LABELS[wk] ? <div style={s.infoLine}>الأسبوع: <strong>{WEEK_LABELS[wk]}</strong></div> : null}
      </div>

      {(mainMealsSummary.length > 0 || altSummary.length > 0) && (
        <div style={s.grid2}>
          <SectionTable title="الأصناف الرئيسية" color={PALETTE.main} items={mainMealsSummary} numLabel="الكمية" numKey="gets" />
          <SectionTable title="الأصناف البديلة" color={PALETTE.alt} items={altSummary} numLabel="العدد" numKey="qty" />
        </div>
      )}

      {(snackMealsSummary.length > 0 || snackAltSummary.length > 0) && (
        <div style={s.grid2}>
          <SectionTable title="السناكات المختارة" color={PALETTE.snack} items={snackMealsSummary} numLabel="الكمية" numKey="gets" />
          {snackAltSummary.length > 0
            ? <SectionTable title="بدائل السناكات" color={PALETTE.snackAlt} items={snackAltSummary} numLabel="العدد" numKey="qty" />
            : <div />}
        </div>
      )}

      {showFixed && <CompactGrid title="أصناف يومية ثابتة" color={PALETTE.fixed} items={fixedSummary} numKey="qty" columns={4} />}
      {itemsSummary.length > 0 && <CompactGrid title="إحصاء الأصناف" color={PALETTE.stats} items={itemsSummary} numKey="quantity" columns={4} />}

      {showCustom && withCustom.length > 0 && (
        <div style={{ breakInside: 'avoid' }}>
          <div style={{ ...s.secHeader, fontSize: 12.5, background: PALETTE.bens.bg, color: PALETTE.bens.text }}>تخصيصات المستفيدين</div>
          <table style={s.table}>
            <thead><tr>
              <th style={{ ...s.bensTh, textAlign: 'center', width: 36 }}>الكود</th>
              <th style={{ ...s.bensTh, textAlign: 'center', width: 36 }}>الفيلا</th>
              <th style={s.bensTh}>الاسم</th>
              <th style={s.bensTh}>الأصناف المستبعدة</th>
              <th style={s.bensTh}>البدائل والأصناف الثابتة</th>
            </tr></thead>
            <tbody>
              {withCustom.map(detail => {
                const excludedNames = detail.excludedItems.map(x => x.meal.name).join(' | ');
                const altParts: string[] = [];
                detail.excludedItems.forEach(x => { if (x.alternative) altParts.push(x.alternative.name); });
                detail.fixedItems.forEach(f => { altParts.push(f.quantity > 1 ? `${f.quantity} ${f.meal.name}` : f.meal.name); });
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
  );
}

export default function BulkOrderPrintView({ orderIds }: { orderIds: string[] }) {
  const [reports, setReports] = useState<(FullReport | null)[]>([]);
  const [loaded, setLoaded] = useState(0);
  const [showFixed, setShowFixed] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('orderPrintShowFixed') !== '0' : true
  );
  const [showCustom, setShowCustom] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('orderPrintShowCustom') !== '0' : true
  );

  useEffect(() => {
    if (orderIds.length === 0) return;
    const results: (FullReport | null)[] = new Array(orderIds.length).fill(null);
    let done = 0;

    orderIds.forEach((id, i) => {
      fetch(`/api/orders/${id}/report`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          results[i] = data;
          done++;
          setLoaded(done);
          if (done === orderIds.length) setReports([...results]);
        })
        .catch(() => {
          done++;
          setLoaded(done);
          if (done === orderIds.length) setReports([...results]);
        });
    });
  }, [orderIds]);

  const allLoaded = loaded === orderIds.length && reports.length === orderIds.length;
  const validReports = reports.filter(Boolean) as FullReport[];

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; }
        body { background: #e2e8f0; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .order-block { page-break-after: always; break-after: page; }
        .order-block:last-child { page-break-after: avoid; break-after: avoid; }
        .order-block > div { break-inside: auto; }
        @media print {
          @page { size: A4 portrait; margin: 5mm; }
          html, body {
            background: #fff !important;
            width: auto !important;
            height: auto !important;
          }
          .no-print { display: none !important; }
          .order-block {
            width: 100% !important;
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
          .order-block > div {
            width: 100% !important;
            max-width: 100% !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ background: '#1e293b', color: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontFamily: 'sans-serif', direction: 'rtl', position: 'sticky', top: 0, zIndex: 100 }}>
        <span style={{ fontWeight: 600 }}>
          تصدير بكج أوامر التشغيل —{' '}
          {allLoaded ? `${validReports.length} أمر` : `جاري التحميل... (${loaded} / ${orderIds.length})`}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 12, userSelect: 'none' }}>
            <input type="checkbox" checked={showFixed} onChange={e => { setShowFixed(e.target.checked); localStorage.setItem('orderPrintShowFixed', e.target.checked ? '1' : '0'); }} style={{ cursor: 'pointer', accentColor: '#7c3aed' }} />
            إظهار الأصناف الثابتة
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 12, userSelect: 'none' }}>
            <input type="checkbox" checked={showCustom} onChange={e => { setShowCustom(e.target.checked); localStorage.setItem('orderPrintShowCustom', e.target.checked ? '1' : '0'); }} style={{ cursor: 'pointer', accentColor: '#6d28d9' }} />
            إظهار التخصيصات
          </label>
          <button
            onClick={() => { if (allLoaded) window.print(); }}
            disabled={!allLoaded}
            style={{ background: allLoaded ? '#10b981' : '#64748b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: allLoaded ? 'pointer' : 'not-allowed', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}
          >
            ⬇ PDF الكل
          </button>
          <button onClick={() => window.close()} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            إغلاق
          </button>
        </div>
      </div>

      {/* Loading state */}
      {!allLoaded && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 16, fontFamily: 'sans-serif', color: '#555' }}>
          <div style={{ width: 36, height: 36, border: '3px solid #10b981', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ margin: 0 }}>جاري تحميل الأوامر... ({loaded} / {orderIds.length})</p>
          <div style={{ width: 280, background: '#e2e8f0', borderRadius: 99, overflow: 'hidden', height: 8 }}>
            <div style={{ width: `${orderIds.length ? (loaded / orderIds.length) * 100 : 0}%`, background: '#10b981', height: '100%', transition: 'width 0.3s' }} />
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Orders */}
      {allLoaded && validReports.map(report => (
        <div key={report.order.id} className="order-block">
          <SingleOrderContent report={report} showFixed={showFixed} showCustom={showCustom} />
        </div>
      ))}
    </>
  );
}
