'use client';

/**
 * «حصر الأقسام» في صفحة التقارير — كميات الأيام المختارة من المنيو مجمّعة
 * تحت أقسام المطبخ، بعمود لكل يوم + المجموع، مع البدائل تحت قسمها هي.
 * طباعة لكل قسم على حدة (يسلَّم لمسؤوله) أو للكل، وتصدير Excel.
 */

import { useEffect, useState, type ReactNode } from 'react';
import type { EntityType, MealType } from '@/lib/types';
import { MEAL_TYPE_LABELS, ENTITY_TYPE_LABELS_PLURAL } from '@/lib/types';
import { WEEK_TITLES } from '@/lib/menu-utils';
import { formatNow } from '@/lib/date-utils';
import type { KitchenSectionsReport, KitchenSectionBlock, KitchenDay } from '@/lib/kitchen-sections-report';

const DAY_SHORT: Record<number, string> = {
  6: 'سبت', 0: 'أحد', 1: 'إثنين', 2: 'ثلاثاء', 3: 'أربعاء', 4: 'خميس', 5: 'جمعة',
};
const MEAL_SHORT: Record<MealType, string> = { breakfast: 'فطور', lunch: 'غداء', dinner: 'عشاء' };
const MEAL_BADGE: Record<MealType, string> = {
  breakfast: 'bg-yellow-100 text-yellow-800',
  lunch: 'bg-blue-100 text-blue-800',
  dinner: 'bg-purple-100 text-purple-800',
};
const DEFAULT_COLOR = '#64748B';

interface Props {
  /** شبكة اختيار الأسابيع والأيام — نفسها المستخدمة في «فترة زمنية» (اختيار مشترك) */
  grid: ReactNode;
  selections: Record<number, Set<number>>;
  totalSelectedDays: number;
  onClear: () => void;
}

const dayLabel = (d: KitchenDay, multiWeek: boolean) =>
  multiWeek ? `${DAY_SHORT[d.day]} (أ${d.week})` : DAY_SHORT[d.day];

function SectionTable({
  block, days, multiWeek, hasAlt, hasFixed,
}: {
  block: KitchenSectionBlock; days: KitchenDay[]; multiWeek: boolean; hasAlt: boolean; hasFixed: boolean;
}) {
  const color = block.section?.color || DEFAULT_COLOR;
  const dayTotals = days.map(d => block.rows.reduce((s, r) => s + (r.perDay[d.key]?.qty || 0), 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: `${color}1A` }}>
            <th className="table-header text-right min-w-[10rem]">الصنف</th>
            {days.map(d => (
              <th key={d.key} className="table-header text-center whitespace-nowrap">{dayLabel(d, multiWeek)}</th>
            ))}
            <th className="table-header text-center whitespace-nowrap">المجموع</th>
            {hasAlt && <th className="table-header text-center whitespace-nowrap text-orange-700">منها بدائل</th>}
            {hasFixed && <th className="table-header text-center whitespace-nowrap text-violet-700">منها ثابت</th>}
          </tr>
        </thead>
        <tbody>
          {block.rows.map(r => (
            <tr key={r.name} className="border-b border-slate-100 hover:bg-slate-50">
              <td className="table-cell">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-medium text-slate-800">{r.name}</span>
                  {r.mealTypes.map(t => (
                    <span key={t} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${MEAL_BADGE[t]}`}>{MEAL_SHORT[t]}</span>
                  ))}
                </div>
              </td>
              {days.map(d => {
                const c = r.perDay[d.key];
                return (
                  <td key={d.key} className="table-cell text-center whitespace-nowrap">
                    {c?.qty ? (
                      <>
                        <span className="font-bold text-slate-800">{c.qty}</span>
                        {c.alt > 0 && <span className="text-[10px] text-orange-600 mr-1" title="منها بدائل">(ب{c.alt})</span>}
                      </>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                );
              })}
              <td className="table-cell text-center font-bold text-base" style={{ color }}>{r.total}</td>
              {hasAlt && <td className="table-cell text-center text-orange-700">{r.altTotal || '—'}</td>}
              {hasFixed && <td className="table-cell text-center text-violet-700">{r.fixedTotal || '—'}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50 font-bold">
            <td className="table-cell text-xs text-slate-500">المجموع</td>
            {dayTotals.map((t, i) => <td key={days[i].key} className="table-cell text-center">{t || '—'}</td>)}
            <td className="table-cell text-center text-base" style={{ color }}>{block.total}</td>
            {hasAlt && <td className="table-cell text-center text-orange-700">{block.rows.reduce((s, r) => s + r.altTotal, 0) || '—'}</td>}
            {hasFixed && <td className="table-cell text-center text-violet-700">{block.rows.reduce((s, r) => s + r.fixedTotal, 0) || '—'}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function KitchenSectionsReportView({ grid, selections, totalSelectedDays, onClear }: Props) {
  const [mealType, setMealType] = useState<MealType | ''>('');
  const [entityType, setEntityType] = useState<EntityType | ''>('beneficiary');
  const [report, setReport] = useState<KitchenSectionsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** null = لا طباعة؛ 'all' = كل الأقسام؛ وإلا مفتاح القسم */
  const [printKey, setPrintKey] = useState<string | null>(null);

  useEffect(() => {
    if (!printKey) return;
    const done = () => setPrintKey(null);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printKey]);

  const generate = async () => {
    if (totalSelectedDays === 0) return;
    setLoading(true); setError(''); setReport(null);
    try {
      const body = Object.fromEntries(
        Object.entries(selections).filter(([, d]) => d.size > 0).map(([w, d]) => [w, [...d]]),
      );
      const res = await fetch('/api/reports/kitchen-sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selections: body,
          ...(mealType ? { meal_type: mealType } : {}),
          ...(entityType ? { entity_type: entityType } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'حدث خطأ'); else setReport(data);
    } catch { setError('حدث خطأ في الاتصال'); }
    setLoading(false);
  };

  const blockKey = (b: KitchenSectionBlock) => b.section?.id ?? 'none';
  const multiWeek = !!report && new Set(report.days.map(d => d.week)).size > 1;

  const subtitle = report
    ? [
        [...new Set(report.days.map(d => d.week))].map(w => {
          const ds = report.days.filter(d => d.week === w).map(d => DAY_SHORT[d.day]);
          return `${WEEK_TITLES[w as 1 | 2 | 3 | 4]}: ${ds.length === 7 ? 'كل الأيام' : ds.join('، ')}`;
        }).join(' — '),
        report.mealType ? `وجبة ${MEAL_TYPE_LABELS[report.mealType]}` : 'كل الوجبات',
        report.entityType ? ENTITY_TYPE_LABELS_PLURAL[report.entityType] : 'الكل',
      ].join(' · ')
    : '';

  const exportExcel = async () => {
    if (!report) return;
    const { exportWorkbook } = await import('@/lib/xlsx-utils');
    const used = new Set<string>();
    const sheets = report.sections.filter(b => b.rows.length > 0).map(b => {
      let name = (b.section?.name ?? 'بدون قسم').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
      while (used.has(name)) name = `${name.slice(0, 28)} ${used.size}`;
      used.add(name);
      const dayCols = report.days.map(d => dayLabel(d, multiWeek));
      const headers = ['الصنف', 'الوجبة', ...dayCols, 'المجموع', 'منها بدائل', 'منها ثابت'];
      const rows = b.rows.map(r => {
        const row: Record<string, string | number> = {
          'الصنف': r.name,
          'الوجبة': r.mealTypes.map(t => MEAL_SHORT[t]).join(' + '),
        };
        report.days.forEach((d, i) => { row[dayCols[i]] = r.perDay[d.key]?.qty || 0; });
        row['المجموع'] = r.total;
        row['منها بدائل'] = r.altTotal;
        row['منها ثابت'] = r.fixedTotal;
        return row;
      });
      return { name, rows, headers };
    });
    await exportWorkbook(sheets, `حصر_أقسام_المطبخ_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <>
      {/* اختيار الأيام */}
      <div className="card p-5 no-print space-y-4">
        <div>
          <h3 className="label mb-3">اختر الأسابيع والأيام</h3>
          {grid}
          {totalSelectedDays === 0 && (
            <p className="text-xs text-slate-400 mt-2 text-center">انقر على أيام لتحديدها — انقر على اسم اليوم لتحديده في كل الأسابيع</p>
          )}
        </div>
        <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="label">نوع الوجبة</label>
            <select value={mealType} onChange={e => setMealType(e.target.value as MealType | '')} className="input-field">
              <option value="">الكل (فطور + غداء + عشاء)</option>
              <option value="breakfast">فطور</option>
              <option value="lunch">غداء</option>
              <option value="dinner">عشاء</option>
            </select>
          </div>
          <div>
            <label className="label">الفئة المستهدفة</label>
            <select value={entityType} onChange={e => setEntityType(e.target.value as EntityType | '')} className="input-field">
              <option value="">الكل</option>
              <option value="beneficiary">المستفيدون</option>
              <option value="companion">المرافقون</option>
            </select>
          </div>
        </div>
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            {totalSelectedDays > 0 && (
              <>
                <span className="text-xs text-emerald-700 font-medium">{totalSelectedDays} يوم محدد</span>
                <button type="button" onClick={onClear} className="text-xs text-slate-400 hover:text-slate-600 underline">مسح الكل</button>
              </>
            )}
          </div>
          <button
            onClick={generate}
            disabled={totalSelectedDays === 0 || loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full ml-2" />جاري الحساب...</>
              : 'احسب حصر الأقسام'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-5 py-4 rounded-xl no-print">{error}</div>}

      {loading && (
        <div className="card p-10 text-center no-print">
          <div className="animate-spin w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-slate-400 mt-3">جاري حساب كميات كل يوم وتوزيعها على الأقسام...</p>
        </div>
      )}

      {report && !loading && (() => {
        const hasAlt = report.sections.some(b => b.rows.some(r => r.altTotal > 0));
        const hasFixed = report.sections.some(b => b.rows.some(r => r.fixedTotal > 0));
        const visible = report.sections.filter(b => b.rows.length > 0);
        return (
          <div className="space-y-5 kitchen-print" id="report-content">
            {/* ملخص + أزرار */}
            <div className="card p-4 flex items-center justify-between gap-4 flex-wrap no-print">
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <p className="text-xs text-slate-500">الإجمالي</p>
                  <p className="font-bold text-emerald-700 text-lg">{report.grandTotal}</p>
                </div>
                {visible.map(b => (
                  <div key={blockKey(b)} className="flex items-center gap-1.5 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.section?.color || DEFAULT_COLOR }} />
                    <span className="text-slate-600">{b.section?.name ?? 'بدون قسم'}</span>
                    <span className="font-bold text-slate-800">{b.total}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportExcel} className="btn-secondary text-sm">تصدير Excel</button>
                <button onClick={() => setPrintKey('all')} className="btn-primary text-sm">طباعة كل الأقسام</button>
              </div>
            </div>
            <p className="text-xs text-slate-500 no-print">
              {subtitle}
              {hasAlt && <> · <span className="text-orange-600">(ب) = الكمية الجاية من بدائل المستبعدين</span></>}
            </p>

            {visible.map((b, i) => {
              const k = blockKey(b);
              const color = b.section?.color || DEFAULT_COLOR;
              const hiddenInPrint = printKey && printKey !== 'all' && printKey !== k;
              const lastPrinted = printKey === 'all' ? i === visible.length - 1 : printKey === k;
              return (
                <div
                  key={k}
                  className={`card overflow-hidden ${hiddenInPrint ? 'print:hidden' : ''} ${lastPrinted ? '' : 'print:break-after-page'}`}
                  style={{ borderTop: `4px solid ${color}`, breakInside: 'auto' }}
                >
                  {/* عنوان الطباعة */}
                  <div className="hidden print:block text-center pt-3 pb-2 border-b border-slate-300">
                    <h1 className="text-xl font-bold">حصر قسم: {b.section?.name ?? 'بدون قسم'}</h1>
                    <p className="text-xs mt-1">{subtitle}</p>
                  </div>
                  <div className="px-5 py-3 flex items-center justify-between gap-2 print:hidden" style={{ background: `${color}14` }}>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ background: color }} />
                      <h3 className="font-bold text-slate-800">{b.section?.name ?? 'بدون قسم'}</h3>
                      <span className="text-xs text-slate-500">{b.rows.length} صنف · المجموع {b.total}</span>
                    </div>
                    <button
                      onClick={() => setPrintKey(k)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50"
                      style={{ borderColor: color, color }}
                    >
                      طباعة هذا القسم
                    </button>
                  </div>
                  <SectionTable block={b} days={report.days} multiWeek={multiWeek} hasAlt={hasAlt} hasFixed={hasFixed} />
                  <div className="hidden print:block text-[10px] text-slate-500 text-left px-2 py-1">{formatNow()}</div>
                </div>
              );
            })}
          </div>
        );
      })()}
    </>
  );
}
