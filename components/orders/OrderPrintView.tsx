'use client';

import { useState, useEffect, useCallback } from 'react';
import { MEAL_TYPE_LABELS, DAY_LABELS } from '@/lib/types';
import type { Meal } from '@/lib/types';

interface MealCount { meal: Meal; gets?: number; qty?: number; quantity?: number; fixedQty?: number }
interface BeneficiaryDetail {
  beneficiary: { id: string; name: string; code: string; villa?: string; category: string };
  excludedItems: { meal: Meal; alternative: Meal | null }[];
  fixedItems: { meal: Meal; quantity: number }[];
}
interface FullReport {
  order: { id: string; date: string; meal_type: string };
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
  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  return `${dayNames[d.getDay()]} ${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}

function weekNumber(dateStr: string) {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
}

export default function OrderPrintView({ orderId }: { orderId: string }) {
  const [report, setReport] = useState<FullReport | null>(null);
  const [error, setError] = useState('');
  const [showFixedSection, setShowFixedSection] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/orders/${orderId}/report`);
    if (!res.ok) { setError('تعذّر تحميل البيانات'); return; }
    setReport(await res.json());
  }, [orderId]);

  useEffect(() => { load(); }, [load]);


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

  const s: Record<string, React.CSSProperties> = {
    page: { fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif", fontSize: 9, color: '#1e293b', background: '#fff', direction: 'rtl', padding: '10mm 12mm', minHeight: '297mm', width: '210mm', margin: '0 auto', boxSizing: 'border-box' },
    header: { background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', color: '#fff', borderRadius: 8, padding: '10px 16px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontSize: 15, fontWeight: 700, letterSpacing: 0.5 },
    headerMeta: { display: 'flex', gap: 20, fontSize: 9, opacity: 0.85 },
    headerBadge: { background: 'rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 8px', fontWeight: 600 },
    section: { marginBottom: 7 },
    sectionHeader: { padding: '4px 10px', borderRadius: '6px 6px 0 0', fontWeight: 700, fontSize: 8.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    table: { width: '100%', borderCollapse: 'collapse', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 6px 6px', overflow: 'hidden' },
    th: { background: '#f8fafc', padding: '3px 8px', borderBottom: '1px solid #e2e8f0', textAlign: 'right', fontWeight: 700, fontSize: 8, color: '#475569' },
    td: { padding: '3px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 8.5 },
    tdNum: { padding: '3px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 10, fontWeight: 700, textAlign: 'center' },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 },
    grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 },
    chip: { display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '3px 8px', borderRadius: 4, fontSize: 8.5, fontWeight: 600, border: '1px solid' },
    summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 },
    summaryCell: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 7px', borderRadius: 4, border: '1px solid', fontSize: 8 },
    tfoot: { background: '#f8fafc', fontWeight: 700 },
  };

  const SectionTable = ({ title, bgColor, textColor, borderColor, items, numKey, numLabel }: {
    title: string; bgColor: string; textColor: string; borderColor: string;
    items: MealCount[]; numKey: 'gets' | 'qty' | 'quantity'; numLabel: string;
  }) => (
    <div style={s.section}>
      <div style={{ ...s.sectionHeader, background: bgColor, color: textColor }}>
        <span>{title}</span>
        <span style={{ opacity: 0.8, fontSize: 8 }}>
          المجموع: {items.reduce((sum, x) => sum + ((x[numKey] as number) || 0), 0)}
        </span>
      </div>
      {items.length === 0 ? (
        <div style={{ border: `1px solid ${borderColor}`, borderTop: 'none', padding: '6px 10px', color: '#94a3b8', fontSize: 8, textAlign: 'center', borderRadius: '0 0 6px 6px' }}>
          لا يوجد
        </div>
      ) : (
        <table style={{ ...s.table, borderColor }}>
          <thead>
            <tr>
              <th style={s.th}>الصنف</th>
              <th style={{ ...s.th, textAlign: 'center', width: 50 }}>{numLabel}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(x => (
              <tr key={x.meal.id}>
                <td style={s.td}>{x.meal.name}</td>
                <td style={s.tdNum}>{(x[numKey] as number) || 0}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={s.tfoot}>
              <td style={{ ...s.td, color: '#64748b', fontSize: 8 }}>المجموع</td>
              <td style={s.tdNum}>{items.reduce((sum, x) => sum + ((x[numKey] as number) || 0), 0)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { margin: 0; }
          .no-print { display: none !important; }
        }
        body { background: #e2e8f0; }
      `}</style>

      {/* Print action bar */}
      <div className="no-print" style={{ background: '#1e293b', color: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontFamily: 'sans-serif', direction: 'rtl' }}>
        <span style={{ fontWeight: 600 }}>معاينة أمر التشغيل — {mealLabel} {arabicDate(order.date)}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#94a3b8', fontSize: 12, userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={showFixedSection}
              onChange={e => setShowFixedSection(e.target.checked)}
              style={{ cursor: 'pointer', accentColor: '#7c3aed' }}
            />
            إظهار الأصناف الثابتة
          </label>
          <button
            onClick={() => window.print()}
            style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}
          >
            ⬇ تصدير PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
          >
            إغلاق
          </button>
        </div>
      </div>

      <div style={s.page}>
        {/* ── Header ── */}
        <div style={s.header}>
          <div>
            <div style={s.headerTitle}>أمر تشغيل — خطوة أمل</div>
            <div style={{ fontSize: 10, opacity: 0.75, marginTop: 3 }}>{arabicDate(order.date)}</div>
          </div>
          <div style={s.headerMeta}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ opacity: 0.6, fontSize: 7.5, marginBottom: 2 }}>نوع الوجبة</div>
              <div style={s.headerBadge}>{mealLabel}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ opacity: 0.6, fontSize: 7.5, marginBottom: 2 }}>الأسبوع</div>
              <div style={s.headerBadge}>رقم {weekNumber(order.date)}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ opacity: 0.6, fontSize: 7.5, marginBottom: 2 }}>لديهم تخصيصات</div>
              <div style={s.headerBadge}>{withCustom.length} مستفيد</div>
            </div>
          </div>
        </div>

        {/* ── الأصناف الرئيسية + البدائل ── */}
        {(mainMealsSummary.length > 0 || altSummary.length > 0) && (
          <div style={s.grid2}>
            <SectionTable title="الأصناف الرئيسية" bgColor="#065f46" textColor="#fff" borderColor="#a7f3d0" items={mainMealsSummary} numKey="gets" numLabel="الكمية" />
            <SectionTable title="الأصناف البديلة" bgColor="#92400e" textColor="#fff" borderColor="#fde68a" items={altSummary} numKey="qty" numLabel="العدد" />
          </div>
        )}

        {/* ── السناكات + بدائلها ── */}
        {(snackMealsSummary.length > 0 || snackAltSummary.length > 0) && (
          <div style={s.grid2}>
            <SectionTable title="السناكات المختارة" bgColor="#78350f" textColor="#fff" borderColor="#fcd34d" items={snackMealsSummary} numKey="gets" numLabel="الكمية" />
            <SectionTable title="بدائل السناكات" bgColor="#451a03" textColor="#fef3c7" borderColor="#fcd34d" items={snackAltSummary} numKey="qty" numLabel="العدد" />
          </div>
        )}

        {/* ── الأصناف الثابتة ── */}
        {showFixedSection && fixedSummary && fixedSummary.length > 0 && (
          <div style={s.section}>
            <div style={{ ...s.sectionHeader, background: '#4c1d95', color: '#fff' }}>
              <span>الأصناف الثابتة اليومية</span>
              <span style={{ opacity: 0.75, fontSize: 8 }}>
                المجموع: {fixedSummary.reduce((s, x) => s + (x.qty || 0), 0)}
              </span>
            </div>
            <div style={{ border: '1px solid #ddd6fe', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {fixedSummary.map(({ meal, qty }) => (
                  <div key={meal.id} style={{ ...s.chip, background: '#f5f3ff', borderColor: '#c4b5fd', color: '#5b21b6' }}>
                    <span>{meal.name}</span>
                    <span style={{ background: '#7c3aed', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: 9 }}>{qty}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── إحصاء الأصناف ── */}
        {itemsSummary.length > 0 && (
          <div style={s.section}>
            <div style={{ ...s.sectionHeader, background: '#1e293b', color: '#fff' }}>
              <span>إحصاء الأصناف الكلي</span>
              <span style={{ opacity: 0.65, fontSize: 8 }}>
                المجموع: {itemsSummary.reduce((s, x) => s + (x.quantity || 0), 0)}
              </span>
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 6px 6px', padding: 8 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {itemsSummary.map(({ meal, quantity }) => (
                  <div key={meal.id} style={{
                    ...s.chip,
                    background: meal.is_snack ? '#fffbeb' : '#f8fafc',
                    borderColor: meal.is_snack ? '#fcd34d' : '#cbd5e1',
                    color: meal.is_snack ? '#92400e' : '#334155',
                  }}>
                    <span>{meal.name}</span>
                    <span style={{ background: meal.is_snack ? '#f59e0b' : '#475569', color: '#fff', borderRadius: 3, padding: '1px 5px', fontSize: 9 }}>{quantity}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── تخصيصات المستفيدين ── */}
        {withCustom.length > 0 && (
          <div style={s.section}>
            <div style={{ ...s.sectionHeader, background: '#1d4ed8', color: '#fff' }}>
              <span>تخصيصات المستفيدين</span>
              <span style={{ opacity: 0.75, fontSize: 8 }}>{withCustom.length} مستفيد</span>
            </div>
            <table style={{ ...s.table, borderColor: '#bfdbfe' }}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 24 }}>#</th>
                  <th style={s.th}>الكود</th>
                  <th style={s.th}>الاسم</th>
                  <th style={s.th}>الفيلا</th>
                  <th style={s.th}>الأصناف المستبعدة</th>
                  <th style={s.th}>البدائل والأصناف الثابتة</th>
                </tr>
              </thead>
              <tbody>
                {withCustom.map((detail, i) => (
                  <tr key={detail.beneficiary.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                    <td style={{ ...s.td, color: '#94a3b8', textAlign: 'center' }}>{i + 1}</td>
                    <td style={{ ...s.td, fontFamily: 'monospace', fontWeight: 700, color: '#3730a3' }}>{detail.beneficiary.code}</td>
                    <td style={{ ...s.td, fontWeight: 600 }}>{detail.beneficiary.name}</td>
                    <td style={{ ...s.td, textAlign: 'center', color: '#2563eb' }}>{detail.beneficiary.villa || '—'}</td>
                    <td style={s.td}>
                      {detail.excludedItems.length === 0
                        ? <span style={{ color: '#cbd5e1' }}>—</span>
                        : detail.excludedItems.map(({ meal }) => (
                          <span key={meal.id} style={{ ...s.chip, background: '#fef2f2', borderColor: '#fca5a5', color: '#b91c1c', marginLeft: 3, marginBottom: 2 }}>
                            {meal.name}{meal.is_snack && <span style={{ color: '#f59e0b', fontWeight: 700 }}> (snak)</span>}
                          </span>
                        ))}
                    </td>
                    <td style={s.td}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {detail.excludedItems.map(({ meal, alternative }) =>
                          alternative ? (
                            <span key={meal.id} style={{ ...s.chip, background: '#f0fdf4', borderColor: '#86efac', color: '#166534' }}>
                              {alternative.name}{meal.is_snack && <span style={{ color: '#f59e0b', fontWeight: 700 }}> (snak)</span>}
                            </span>
                          ) : null
                        )}
                        {detail.fixedItems.map(({ meal, quantity }) => (
                          <span key={meal.id} style={{ ...s.chip, background: '#f5f3ff', borderColor: '#c4b5fd', color: '#5b21b6' }}>
                            ثابت: {meal.name}{quantity > 1 ? ` ×${quantity}` : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: 7.5 }}>
          <span>نظام إدارة الوجبات — خطوة أمل</span>
          <span>{new Date().toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </>
  );
}
