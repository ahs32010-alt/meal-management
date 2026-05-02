'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { DeliveryOrder, DeliveryPrintHeader } from '@/lib/types';
import { DELIVERY_MEAL_TYPE_LABELS } from '@/lib/types';

function arabicDate(dateStr: string) {
  const d = new Date(dateStr);
  const dayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const [y, m, day] = dateStr.split('-');
  return `${dayNames[d.getDay()]} ${day}-${m}-${y}`;
}

const PALETTE = {
  title: { bg: '#eff6ff', border: '#1e3a8a', text: '#1e3a8a' },
  header: { bg: '#0ea5e9', text: '#fff' },
};

export default function DeliveryOrderPrintView({ deliveryOrderId }: { deliveryOrderId: string }) {
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [header, setHeader] = useState<DeliveryPrintHeader | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [orderRes, headerRes] = await Promise.all([
      fetch(`/api/delivery-orders/${deliveryOrderId}`),
      fetch(`/api/delivery-print-header`),
    ]);
    if (!orderRes.ok) { setError('تعذّر تحميل البيانات'); return; }
    setOrder(await orderRes.json());
    if (headerRes.ok) setHeader(await headerRes.json());
  }, [deliveryOrderId]);

  useEffect(() => { load(); }, [load]);

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#c00' }}>
      {error}
    </div>
  );

  if (!order) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, fontFamily: 'sans-serif', color: '#555' }}>
      <div style={{ width: 36, height: 36, border: '3px solid #10b981', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p>جاري تحضير أمر التسليم...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  const items = order.delivery_order_items ?? [];

  // ── Styles ────────────────────────────────────────────────────────────────
  const s: Record<string, React.CSSProperties> = {
    page: {
      fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif",
      fontSize: 12, color: '#1e293b', background: '#fff',
      direction: 'rtl', padding: '8mm 10mm',
      width: '210mm', maxWidth: '100%', margin: '0 auto', boxSizing: 'border-box',
    },
    titleBar: {
      fontSize: 24, fontWeight: 800, color: PALETTE.title.text,
      textAlign: 'center', padding: '8px 0', marginBottom: 6,
    },
    subTitle: {
      textAlign: 'center', fontSize: 14, color: '#475569', fontWeight: 600, marginBottom: 12,
    },
    orderNumberBar: {
      background: PALETTE.title.bg,
      border: `1.5px solid ${PALETTE.title.border}`,
      borderRadius: 8,
      padding: '8px 14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
      fontSize: 13,
    },
    infoGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 0,
      border: '1.5px solid #94a3b8',
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 12,
    },
    infoCell: {
      padding: '8px 12px',
      borderBottom: '1px solid #cbd5e1',
      borderLeft: '1px solid #cbd5e1',
      display: 'flex',
      gap: 8,
      alignItems: 'center',
    },
    infoLabel: { fontWeight: 700, color: '#475569', minWidth: 90, fontSize: 12 },
    infoValue: { fontWeight: 600, color: '#0f172a', fontSize: 13 },
    creatorBox: {
      border: '1.5px solid #94a3b8',
      borderRadius: 8,
      overflow: 'hidden',
      marginBottom: 12,
    },
    creatorHeader: {
      background: '#f1f5f9',
      padding: '6px 12px',
      fontWeight: 700,
      fontSize: 13,
      borderBottom: '1px solid #94a3b8',
      color: '#334155',
    },
    creatorGrid: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 0,
    },
    table: { width: '100%', borderCollapse: 'collapse', border: '1.5px solid #1e293b' },
    th: {
      background: PALETTE.header.bg, color: PALETTE.header.text,
      padding: '8px 10px',
      borderLeft: '1px solid rgba(255,255,255,0.3)',
      textAlign: 'right', fontWeight: 700, fontSize: 13,
    },
    thNum: {
      background: PALETTE.header.bg, color: PALETTE.header.text,
      padding: '8px 10px',
      borderLeft: '1px solid rgba(255,255,255,0.3)',
      textAlign: 'center', fontWeight: 700, fontSize: 13,
    },
    td: {
      padding: '8px 10px', borderBottom: '1px solid #cbd5e1',
      borderLeft: '1px solid #e2e8f0', fontSize: 13,
    },
    tdNum: {
      padding: '8px 10px', borderBottom: '1px solid #cbd5e1',
      borderLeft: '1px solid #e2e8f0', fontSize: 14, fontWeight: 700,
      textAlign: 'center',
    },
    sigCell: {
      padding: '4px 6px', borderBottom: '1px solid #cbd5e1',
      borderLeft: '1px solid #e2e8f0',
      textAlign: 'center', minWidth: 130, height: 38,
    },
    notesBox: {
      marginTop: 12,
      border: '1.5px solid #94a3b8',
      borderRadius: 8,
      overflow: 'hidden',
    },
    notesHeader: {
      background: '#f1f5f9',
      padding: '6px 12px',
      fontWeight: 700,
      fontSize: 13,
      borderBottom: '1px solid #94a3b8',
      color: '#334155',
    },
    notesBody: {
      padding: '10px 12px',
      minHeight: 60,
      fontSize: 12.5,
      color: '#1e293b',
      whiteSpace: 'pre-wrap' as const,
    },
    signatureBox: {
      marginTop: 12,
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
    },
    sigBlock: {
      border: '1.5px solid #94a3b8',
      borderRadius: 8,
      overflow: 'hidden',
    },
    sigBlockHeader: {
      background: '#f1f5f9',
      padding: '6px 12px',
      fontWeight: 700,
      fontSize: 13,
      borderBottom: '1px solid #94a3b8',
      color: '#334155',
    },
    sigBlockBody: {
      padding: 8,
      minHeight: 80,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  };

  return (
    <>
      <style>{`
        html, body { margin: 0; padding: 0; }
        body { background: #e2e8f0; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .print-page { page-break-inside: avoid; break-inside: avoid; }
        @media print {
          @page { size: A4 portrait; margin: 6mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-page {
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print" style={{ background: '#1e293b', color: '#fff', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontFamily: 'sans-serif', direction: 'rtl' }}>
        <span style={{ fontWeight: 600 }}>أمر التسليم {order.order_number} — {arabicDate(order.date)}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => requestAnimationFrame(() => requestAnimationFrame(() => window.print()))}
            style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}
          >
            🖨 طباعة / PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}
          >
            إغلاق
          </button>
        </div>
      </div>

      <div id="delivery-print-root" className="print-page" style={s.page}>
        {/* الهيدر — 3 أعمدة: يسار شركة | وسط شعار | يمين عنوان */}
        <PrintHeader header={header} />

        {/* رقم الأمر + التاريخ */}
        <div style={s.orderNumberBar}>
          <div>
            <span style={{ fontWeight: 700, color: '#475569' }}>رقم الأمر: </span>
            <span style={{ fontWeight: 800, fontSize: 16, color: PALETTE.title.text, fontFamily: 'monospace' }}>
              {order.order_number}
            </span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
            {arabicDate(order.date)}
          </div>
        </div>

        {/* بيانات الأمر */}
        <div style={s.infoGrid}>
          <div style={s.infoCell}>
            <span style={s.infoLabel}>نوع الوجبة:</span>
            <span style={s.infoValue}>{DELIVERY_MEAL_TYPE_LABELS[order.meal_type]}</span>
          </div>
          <div style={{ ...s.infoCell, borderLeft: 'none' }}>
            <span style={s.infoLabel}>اليوم:</span>
            <span style={s.infoValue}>{arabicDate(order.date).split(' ')[0]}</span>
          </div>
          <div style={{ ...s.infoCell, borderBottom: 'none' }}>
            <span style={s.infoLabel}>موقع التسليم:</span>
            <span style={s.infoValue}>{order.delivery_locations?.name ?? '—'}</span>
          </div>
          <div style={{ ...s.infoCell, borderLeft: 'none', borderBottom: 'none' }}>
            <span style={s.infoLabel}>المدينة:</span>
            <span style={s.infoValue}>{order.delivery_locations?.cities?.name ?? '—'}</span>
          </div>
        </div>

        {/* بيانات المنشئ */}
        <div style={s.creatorBox}>
          <div style={s.creatorHeader}>أُنشئ بواسطة</div>
          <div style={s.creatorGrid}>
            <div style={s.infoCell}>
              <span style={s.infoLabel}>الاسم:</span>
              <span style={s.infoValue}>{order.created_by_name ?? '—'}</span>
            </div>
            <div style={{ ...s.infoCell, borderLeft: 'none' }}>
              <span style={s.infoLabel}>الجوال:</span>
              <span style={{ ...s.infoValue, direction: 'ltr' }}>{order.created_by_phone ?? '—'}</span>
            </div>
            <div style={{ ...s.infoCell, borderBottom: 'none' }}>
              <span style={s.infoLabel}>تاريخ التوصيل:</span>
              <span style={s.infoValue}>{order.delivery_date ? arabicDate(order.delivery_date) : '—'}</span>
            </div>
            <div style={{ ...s.infoCell, borderLeft: 'none', borderBottom: 'none' }}>
              <span style={s.infoLabel}>وقت التوصيل:</span>
              <span style={s.infoValue}>{order.delivery_time ? order.delivery_time.slice(0, 5) : '—'}</span>
            </div>
          </div>
        </div>

        {/* جدول الأصناف */}
        <table style={s.table}>
          <thead>
            <tr>
              <th style={{ ...s.thNum, width: 40 }}>م</th>
              <th style={s.th}>وصف الصنف</th>
              <th style={{ ...s.thNum, width: 90 }}>نوع الوجبة</th>
              <th style={{ ...s.thNum, width: 70 }}>العدد</th>
              <th style={{ ...s.thNum, width: 140 }}>توقيع الاستلام</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...s.td, textAlign: 'center', color: '#94a3b8', padding: 20 }}>
                  لا توجد أصناف
                </td>
              </tr>
            ) : items.map((it, idx) => (
              <tr key={it.id}>
                <td style={s.tdNum}>{idx + 1}</td>
                <td style={s.td}>{it.display_name}</td>
                <td style={{ ...s.tdNum, fontWeight: 600 }}>{DELIVERY_MEAL_TYPE_LABELS[it.meal_type]}</td>
                <td style={s.tdNum}>{it.quantity}</td>
                <td style={s.sigCell}>
                  {it.receiver_signature_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.receiver_signature_url} alt="توقيع" style={{ maxHeight: 32, maxWidth: 120 }} />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* الملاحظات */}
        <div style={s.notesBox}>
          <div style={s.notesHeader}>الملاحظات</div>
          <div style={s.notesBody}>{order.notes ?? ''}</div>
        </div>

        {/* التواقيع */}
        <div style={s.signatureBox}>
          <div style={s.sigBlock}>
            <div style={s.sigBlockHeader}>توقيع المنشئ</div>
            <div style={s.sigBlockBody}>
              {order.creator_signature_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={order.creator_signature_url} alt="توقيع المنشئ" style={{ maxHeight: 70, maxWidth: '100%' }} />
              ) : (
                <span style={{ color: '#94a3b8', fontSize: 11 }}>(فراغ للتوقيع اليدوي)</span>
              )}
            </div>
          </div>
          <div style={s.sigBlock}>
            <div style={s.sigBlockHeader}>توقيع المستلم</div>
            <div style={s.sigBlockBody}>
              {order.receiver_signature_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={order.receiver_signature_url} alt="توقيع المستلم" style={{ maxHeight: 70, maxWidth: '100%' }} />
              ) : (
                <span style={{ color: '#94a3b8', fontSize: 11 }}>(فراغ للتوقيع اليدوي)</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── PrintHeader ─────────────────────────────────────────────────────────────
// 3 أعمدة بـRTL: العنصر الأول يظهر على اليمين، الأخير على اليسار
function PrintHeader({ header }: { header: DeliveryPrintHeader | null }) {
  const titleAr = header?.title_ar || 'أمر تسليم';
  const titleEn = header?.title_en || 'Delivery Note';
  const companyEn = header?.company_name_en || '';
  const companyAr = header?.company_name_ar || '';
  const addr1 = header?.address_line1 || '';
  const addr2 = header?.address_line2 || '';
  const cr = header?.cr_number || '';
  const vat = header?.vat_number || '';

  const wrapperStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 10,
    marginBottom: 10,
    borderBottom: '2px solid #1e293b',
  };

  return (
    <div style={wrapperStyle}>
      {/* يمين (RTL: العنصر الأول) — العنوان */}
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', lineHeight: 1.1 }}>
          {titleAr}
        </div>
        <div style={{ fontSize: 13, color: '#475569', fontWeight: 600, marginTop: 4, direction: 'ltr', textAlign: 'right' }}>
          {titleEn}
        </div>
      </div>

      {/* وسط — الشعار */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {header?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={header.logo_url} alt="شعار" style={{ maxHeight: 80, maxWidth: 100, objectFit: 'contain' }} />
        ) : (
          <div style={{ width: 80, height: 80, border: '1px dashed #cbd5e1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 10 }}>
            الشعار
          </div>
        )}
      </div>

      {/* يسار (RTL: العنصر الأخير) — معلومات الشركة */}
      <div style={{ textAlign: 'left', fontSize: 11, lineHeight: 1.55, color: '#1e293b' }}>
        {companyEn && <div style={{ fontWeight: 700, direction: 'ltr' }}>{companyEn}</div>}
        {companyAr && <div style={{ fontWeight: 700 }}>{companyAr}</div>}
        {addr1 && <div style={{ direction: 'ltr', textAlign: 'left' }}>{addr1}</div>}
        {addr2 && <div style={{ direction: 'ltr', textAlign: 'left' }}>{addr2}</div>}
        {cr  && <div style={{ direction: 'ltr', textAlign: 'left' }}><span style={{ fontWeight: 700 }}>CR:</span> {cr}</div>}
        {vat && <div style={{ direction: 'ltr', textAlign: 'left' }}><span style={{ fontWeight: 700 }}>Vat No:</span> {vat}</div>}
      </div>
    </div>
  );
}
