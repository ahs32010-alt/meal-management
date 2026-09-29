'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
import { APP_TIME_ZONE } from '@/lib/date-utils';
import type { FixedExtrasReport } from '@/lib/fixed-extras-period';
import { exportPagesToPdf } from '@/components/reports/node-pdf-export';
import { formatMoney } from '@/lib/costs';

/**
 * نسخة الطباعة من «حصر الإضافات»: صفحات A4 مصمَّمة للورق (٧٩٤×١١٢٣ بكسل =
 * A4 عند ٩٦dpi) بخط كبير وترويسة وترقيم. تُرسم خارج الشاشة، تُقاس صفوفها
 * أولاً ثم تُوزَّع على الصفحات بلا قطع صف، وبعدها تُصدَّر وتُزال.
 */

const PAGE_W = 794;
const PAGE_H = 1123;
const PAD_X = 48;
const PAD_Y = 44;
const FOOTER_H = 44;
const CONTENT_H = PAGE_H - PAD_Y * 2 - FOOTER_H;
const SECTION_GAP = 28;

const C = {
  brand: '#047857',
  brandSoft: '#ecfdf5',
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  zebra: '#f8fafc',
};

const FONT = "'Cairo', Tahoma, Arial, sans-serif";

/** 2026-09-01 → 01/09/2026 — أرقام قصيرة لا تنكسر على سطرين مثل اسم الشهر */
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const stampNow = () => {
  const d = new Date();
  const date = d.toLocaleDateString('en-GB', { timeZone: APP_TIME_ZONE });
  const time = d.toLocaleTimeString('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit' });
  return `${date} — ${time}`;
};

type Report = FixedExtrasReport;
type Page = { first: boolean; main: number[]; mainTotal: boolean; bens: number[] };

const th: CSSProperties = {
  background: C.brand, color: '#fff', fontSize: 14, fontWeight: 700, lineHeight: 1.35,
  padding: '9px 6px', textAlign: 'center', border: `1px solid ${C.brand}`,
};
const td: CSSProperties = {
  fontSize: 16, color: C.ink, padding: '8px 6px', textAlign: 'center',
  border: `1px solid ${C.line}`, lineHeight: 1.45, overflowWrap: 'anywhere',
};
/** خلية الأسماء — محاذاة لليمين بهامش أوسع */
const tdName: CSSProperties = { ...td, textAlign: 'right', paddingRight: 10, fontWeight: 600 };
const num: CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

function FirstHeader({ report }: { report: Report }) {
  const info: [string, string][] = [
    ['الفترة', `من ${dmy(report.from)} إلى ${dmy(report.to)}`],
    ['عدد الأيام', `${report.days} يوم`],
    ['الوجبات', report.mealTypes.map(t => MEAL_TYPE_LABELS[t]).join(' + ')],
    ['الفئة', report.entityType ? ENTITY_TYPE_LABELS_PLURAL[report.entityType] : 'الكل'],
  ];
  return (
    <div style={{ paddingBottom: SECTION_GAP }}>
      <div style={{ borderBottom: `3px solid ${C.brand}`, paddingBottom: 14, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, color: C.muted, fontWeight: 600 }}>مركز خطوة أمل</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: C.ink, lineHeight: 1.3 }}>حصر الأصناف اليومية الإضافية</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <div style={{ textAlign: 'center', background: C.brandSoft, border: `2px solid ${C.brand}`, borderRadius: 12, padding: '6px 16px' }}>
            <div style={{ fontSize: 13, color: C.brand, fontWeight: 700 }}>إجمالي الإضافات</div>
            <div style={{ fontSize: 28, color: C.brand, fontWeight: 800, lineHeight: 1.2 }}>{report.grandTotal}</div>
          </div>
          <div style={{ textAlign: 'center', background: C.brandSoft, border: `2px solid ${C.brand}`, borderRadius: 12, padding: '6px 16px' }}>
            <div style={{ fontSize: 13, color: C.brand, fontWeight: 700 }}>إجمالي السعر (ريال)</div>
            <div dir="ltr" style={{ fontSize: 28, color: C.brand, fontWeight: 800, lineHeight: 1.2 }}>{formatMoney(report.grandTotalPrice)}</div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.7fr 1.3fr 0.9fr', gap: 10 }}>
        {info.map(([k, v]) => (
          <div key={k} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: '8px 12px', background: C.zebra }}>
            <div style={{ fontSize: 13, color: C.muted, fontWeight: 600 }}>{k}</div>
            <div style={{ fontSize: 15, color: C.ink, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContHeader() {
  return (
    <div style={{ paddingBottom: 18 }}>
      <div style={{ borderBottom: `2px solid ${C.brand}`, paddingBottom: 8, fontSize: 18, fontWeight: 800, color: C.ink }}>
        حصر الأصناف اليومية الإضافية <span style={{ color: C.muted, fontWeight: 600, fontSize: 14 }}>— تابع</span>
      </div>
    </div>
  );
}

function MainTable({ report, rows, total }: { report: Report; rows: number[]; total: boolean }) {
  const cols = report.mealTypes;
  const colTotal = (t: MealType) => report.rows.reduce((s, r) => s + (r.byMealType[t] || 0), 0);
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: 32 }} />
        <col />
        {cols.map(t => <col key={t} style={{ width: 52 }} />)}
        <col style={{ width: 62 }} />
        <col style={{ width: 70 }} />
        <col style={{ width: 92 }} />
        <col style={{ width: 72 }} />
      </colgroup>
      <thead data-m="main-head">
        <tr>
          <th style={th}>#</th>
          <th style={{ ...th, textAlign: 'right', paddingRight: 10 }}>الصنف</th>
          {cols.map(t => <th key={t} style={th}>{MEAL_TYPE_LABELS[t]}</th>)}
          <th style={th}>العدد</th>
          <th style={th}>سعر<br />الحبة</th>
          <th style={th}>الإجمالي<br /><span style={{ fontSize: 11, fontWeight: 600 }}>(ريال)</span></th>
          <th style={{ ...th, fontSize: 13 }}>عدد<br />الأشخاص</th>
        </tr>
      </thead>
      <tbody>
        {report.rows.length === 0 && (
          <tr><td colSpan={cols.length + 6} style={{ ...td, color: C.muted, padding: 24 }}>لا توجد إضافات مسجّلة لهذه الفترة</td></tr>
        )}
        {rows.map(i => {
          const r = report.rows[i];
          return (
            <tr key={r.meal.id} data-m="main-row" style={{ background: i % 2 ? C.zebra : '#fff' }}>
              <td style={{ ...td, color: C.muted, fontSize: 13 }}>{i + 1}</td>
              <td style={tdName}>
                {r.meal.name}
                {r.manual > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#0369a1', marginRight: 6, whiteSpace: 'nowrap' }}>
                    ({r.manual === r.total ? 'يدوي' : `منها ${r.manual} يدوي`})
                  </span>
                )}
              </td>
              {cols.map(t => <td key={t} style={{ ...td, ...num }}>{r.byMealType[t] || <span style={{ color: '#cbd5e1' }}>—</span>}</td>)}
              <td style={{ ...td, ...num, fontWeight: 800, fontSize: 18, color: C.brand }}>{r.total}</td>
              <td style={{ ...td, ...num, fontSize: 14 }}>
                {r.unitPrice === null ? <span style={{ color: '#d97706', fontSize: 12 }}>بلا سعر</span> : formatMoney(r.unitPrice)}
              </td>
              <td style={{ ...td, ...num, fontSize: 15, fontWeight: 700, color: C.brand }}>
                {r.unitPrice === null ? <span style={{ color: '#cbd5e1' }}>—</span> : formatMoney(r.totalPrice)}
              </td>
              <td style={{ ...td, ...num, color: C.muted, fontSize: 14 }}>{r.beneficiaries}</td>
            </tr>
          );
        })}
        {total && report.rows.length > 0 && (
          <tr data-m="main-total" style={{ background: C.brandSoft }}>
            <td style={{ ...td, borderTop: `2px solid ${C.brand}` }} />
            <td style={{ ...tdName, fontWeight: 800, borderTop: `2px solid ${C.brand}` }}>المجموع</td>
            {cols.map(t => <td key={t} style={{ ...td, ...num, fontWeight: 800, borderTop: `2px solid ${C.brand}` }}>{colTotal(t)}</td>)}
            <td style={{ ...td, ...num, fontWeight: 800, fontSize: 18, color: C.brand, borderTop: `2px solid ${C.brand}` }}>{report.grandTotal}</td>
            <td style={{ ...td, borderTop: `2px solid ${C.brand}` }} />
            <td style={{ ...td, ...num, fontWeight: 800, fontSize: 15, color: C.brand, borderTop: `2px solid ${C.brand}` }}>{formatMoney(report.grandTotalPrice)}</td>
            <td style={{ ...td, borderTop: `2px solid ${C.brand}` }} />
          </tr>
        )}
      </tbody>
    </table>
  );
}

function BenTable({ report, rows, gapBefore }: { report: Report; rows: number[]; gapBefore: boolean }) {
  return (
    <div style={{ paddingTop: gapBefore ? SECTION_GAP : 0 }}>
      <div data-m="ben-title" style={{ fontSize: 18, fontWeight: 800, color: C.ink, paddingBottom: 10 }}>
        التفصيل حسب المستفيد <span style={{ color: C.muted, fontWeight: 600, fontSize: 14 }}>({report.byBeneficiary.length})</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 32 }} />
          <col style={{ width: 168 }} />
          <col style={{ width: 70 }} />
          <col />
          <col style={{ width: 56 }} />
          <col style={{ width: 84 }} />
        </colgroup>
        <thead data-m="ben-head">
          <tr>
            <th style={th}>#</th>
            <th style={{ ...th, textAlign: 'right', paddingRight: 10 }}>المستفيد</th>
            <th style={th}>الكود</th>
            <th style={{ ...th, textAlign: 'right', paddingRight: 10 }}>الإضافات</th>
            <th style={th}>العدد</th>
            <th style={th}>السعر<br /><span style={{ fontSize: 11, fontWeight: 600 }}>(ريال)</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(i => {
            const b = report.byBeneficiary[i];
            return (
              <tr key={b.id} data-m="ben-row" style={{ background: i % 2 ? C.zebra : '#fff' }}>
                <td style={{ ...td, color: C.muted, fontSize: 13 }}>{i + 1}</td>
                <td style={{ ...tdName, fontSize: 15 }}>{b.name}</td>
                <td style={{ ...td, ...num, fontSize: 13, color: C.muted }}>{b.code}</td>
                <td style={{ ...tdName, fontWeight: 400, fontSize: 14, lineHeight: 1.6 }}>
                  {/* الفاصل خارج الـspan — هو نقطة الالتفاف بين الأصناف، والصنف نفسه لا ينكسر عن كميته */}
                  {b.items.map((x, k) => (
                    <span key={x.meal.id}>
                      {k > 0 && '، '}
                      <span style={{ whiteSpace: 'nowrap' }}>{x.meal.name} <b style={{ color: C.brand }}>×{x.qty}</b></span>
                    </span>
                  ))}
                </td>
                <td style={{ ...td, ...num, fontWeight: 800, color: C.brand }}>{b.total}</td>
                <td style={{ ...td, ...num, fontSize: 14, fontWeight: 700, color: C.brand }}>{formatMoney(b.totalPrice)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PageFrame({ children, index, count, stamp }: { children: React.ReactNode; index: number; count: number; stamp: string }) {
  return (
    <div
      dir="rtl"
      style={{
        width: PAGE_W, height: PAGE_H, background: '#fff', fontFamily: FONT, boxSizing: 'border-box',
        padding: `${PAD_Y}px ${PAD_X}px`, position: 'relative', overflow: 'hidden',
      }}
    >
      {children}
      <div style={{
        position: 'absolute', left: PAD_X, right: PAD_X, bottom: PAD_Y - 10, height: FOOTER_H - 10,
        borderTop: `1px solid ${C.line}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: C.muted,
      }}>
        <span>صدر في {stamp}</span>
        <span>صفحة {index + 1} من {count}</span>
      </div>
    </div>
  );
}

/** يوزّع الصفوف على الصفحات حسب ارتفاعاتها المقاسة. */
function paginate(report: Report, includeBens: boolean, m: {
  first: number; cont: number; mainHead: number; mainRows: number[]; mainTotal: number;
  benTitle: number; benHead: number; benRows: number[];
}): Page[] {
  const pages: Page[] = [];
  let cur: Page = { first: true, main: [], mainTotal: false, bens: [] };
  let used = m.first;
  const newPage = () => {
    pages.push(cur);
    cur = { first: false, main: [], mainTotal: false, bens: [] };
    used = m.cont;
  };

  m.mainRows.forEach((h, i) => {
    const need = h + (cur.main.length === 0 ? m.mainHead : 0);
    if (used + need > CONTENT_H) newPage();
    used += h + (cur.main.length === 0 ? m.mainHead : 0);
    cur.main.push(i);
  });
  if (report.rows.length === 0) used += m.mainHead + 72;
  const totalNeed = m.mainTotal + (cur.main.length === 0 ? m.mainHead : 0);
  if (report.rows.length > 0 && used + totalNeed > CONTENT_H) newPage();
  used += report.rows.length > 0 ? totalNeed : 0;
  cur.mainTotal = true;

  if (includeBens) {
    m.benRows.forEach((h, i) => {
      const head = cur.bens.length === 0
        ? m.benTitle + m.benHead + (cur.main.length > 0 || cur.mainTotal ? SECTION_GAP : 0)
        : 0;
      if (used + head + h > CONTENT_H) newPage();
      used += (cur.bens.length === 0 ? m.benTitle + m.benHead + (cur.main.length > 0 || cur.mainTotal ? SECTION_GAP : 0) : 0) + h;
      cur.bens.push(i);
    });
  }
  pages.push(cur);
  return pages;
}

export default function FixedExtrasPdf({ report, includeBens, onDone }: {
  report: Report;
  includeBens: boolean;
  onDone: (error?: string) => void;
}) {
  const measureRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<Page[] | null>(null);
  const [stamp] = useState(stampNow);
  const allMain = report.rows.map((_, i) => i);
  const allBens = includeBens ? report.byBeneficiary.map((_, i) => i) : [];

  // ① القياس — بعد تحميل الخط، وإلا تطلع الارتفاعات بخط بديل
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { await document.fonts?.ready; } catch { /* نكمل بلا انتظار */ }
      const root = measureRef.current;
      if (cancelled || !root) return;
      const h = (sel: string) => (root.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect().height ?? 0;
      const hs = (sel: string) => Array.from(root.querySelectorAll(sel)).map(el => el.getBoundingClientRect().height);
      setPages(paginate(report, includeBens, {
        first: h('[data-m="first"]'),
        cont: h('[data-m="cont"]'),
        mainHead: h('[data-m="main-head"]'),
        mainRows: hs('[data-m="main-row"]'),
        mainTotal: h('[data-m="main-total"]'),
        benTitle: h('[data-m="ben-title"]'),
        benHead: h('[data-m="ben-head"]'),
        benRows: hs('[data-m="ben-row"]'),
      }));
    })();
    return () => { cancelled = true; };
  }, [report, includeBens]);

  // ② التصدير — بعد رسم الصفحات
  useEffect(() => {
    if (!pages) return;
    const root = pagesRef.current;
    if (!root) return;
    const nodes = Array.from(root.children) as HTMLElement[];
    exportPagesToPdf(nodes, `حصر-الإضافات-${report.from}-إلى-${report.to}.pdf`)
      .then(() => onDone())
      .catch(() => onDone('تعذّر إنشاء ملف PDF'));
    // onDone يتغيّر مع كل رسم — التصدير يجري مرة واحدة لكل توزيع
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, report]);

  const offscreen: CSSProperties = { position: 'fixed', top: 0, left: -100000, pointerEvents: 'none' };

  return (
    <div aria-hidden style={offscreen}>
      {!pages && (
        <div ref={measureRef} dir="rtl" style={{ width: PAGE_W - PAD_X * 2, fontFamily: FONT }}>
          <div data-m="first"><FirstHeader report={report} /></div>
          <div data-m="cont"><ContHeader /></div>
          <MainTable report={report} rows={allMain} total />
          {includeBens && <BenTable report={report} rows={allBens} gapBefore={false} />}
        </div>
      )}
      {pages && (
        <div ref={pagesRef}>
          {pages.map((p, idx) => (
            <PageFrame key={idx} index={idx} count={pages.length} stamp={stamp}>
              {p.first ? <FirstHeader report={report} /> : <ContHeader />}
              {(p.main.length > 0 || p.mainTotal) && (
                <MainTable report={report} rows={p.main} total={p.mainTotal} />
              )}
              {p.bens.length > 0 && (
                <BenTable report={report} rows={p.bens} gapBefore={p.main.length > 0 || p.mainTotal} />
              )}
            </PageFrame>
          ))}
        </div>
      )}
    </div>
  );
}
