'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { DailyOrder, ReportData } from '@/lib/types';
import { MEAL_TYPE_LABELS, MEAL_TYPE_EN } from '@/lib/types';
import { formatDate } from '@/lib/date-utils';
import { transliterate } from '@/lib/transliterate';

// splits: beneficiary_id → set of meal_ids that go to a separate sticker
type SplitsMap = Record<string, Set<string>>;

// ── Word export ───────────────────────────────────────────────────────────────
function buildWordCell(
  detail: ReportData['beneficiaryDetails'][0],
  mealTypeAr: string,
  mealTypeEn: string,
  customDict: Record<string, string>
): string {
  const ben = detail.beneficiary;
  const items = detail.excludedItems ?? [];
  const excludedNames = items.map(({ meal }) => meal.name).join('، ');
  const excludedTranslit = items.map(({ meal }) => transliterate(meal.name, customDict)).join(' | ');
  const altNames = items.map(({ alternative }) => alternative ? alternative.name : '—').join('، ');
  const altTranslit = items.map(({ alternative }) => alternative ? transliterate(alternative.name, customDict) : '—').join(' | ');

  const metaLine = [
    `<strong style="font-size:10.5pt;">${ben.code}</strong>`,
    ben.villa ? `<span style="font-size:10pt;">فيلا ${ben.villa}</span>` : '',
  ].filter(Boolean).join(' &nbsp;|&nbsp; ');

  return `<td style="width:25%;vertical-align:top;border:2pt solid #1e293b;padding:0;direction:rtl;text-align:right;">
  <div style="background:#1e293b;color:white;padding:5pt 8pt;display:flex;justify-content:space-between;align-items:center;">
    <span style="font-size:13pt;font-weight:800;">${mealTypeAr}</span>
    <span style="font-size:9pt;opacity:0.65;letter-spacing:1px;">${mealTypeEn}</span>
  </div>
  <div style="padding:6pt 8pt;">
    <div style="margin-bottom:4pt;">${metaLine}</div>
    <div style="font-size:14pt;font-weight:800;color:#0f172a;line-height:1.2;">${ben.name}</div>
    ${ben.english_name ? `<div style="font-size:9.5pt;color:#475569;direction:ltr;text-align:right;margin-bottom:4pt;">${ben.english_name}</div>` : '<div style="margin-bottom:4pt;"></div>'}
    <div style="border-top:1.5px solid #cbd5e1;padding-top:4pt;">
      <div style="font-size:11pt;font-weight:800;color:#cc0000;">مستبعد</div>
      <div style="font-size:10.5pt;font-weight:700;color:#cc0000;margin-bottom:1pt;">${excludedNames}</div>
      <div style="font-size:11pt;font-weight:800;color:#cc0000;">no</div>
      <div style="font-size:8.5pt;color:#9ca3af;font-style:italic;direction:ltr;text-align:left;margin-bottom:5pt;">${excludedTranslit}</div>
      <div style="font-size:11pt;font-weight:800;color:#059669;">بديل</div>
      <div style="font-size:10.5pt;font-weight:700;color:#059669;margin-bottom:1pt;">${altNames}</div>
      <div style="font-size:11pt;font-weight:800;color:#059669;">yes</div>
      <div style="font-size:8.5pt;color:#9ca3af;font-style:italic;direction:ltr;text-align:left;">${altTranslit}</div>
    </div>
    ${ben.fixed_items ? `<div style="font-size:8.5pt;color:#475569;margin-top:4pt;padding-top:3pt;border-top:1px dashed #cbd5e1;">إضافات: <strong>${ben.fixed_items}</strong></div>` : ''}
  </div>
</td>`;
}

function exportStickersWord(
  displayDetails: Array<ReportData['beneficiaryDetails'][0]>,
  mealTypeAr: string,
  mealTypeEn: string,
  filename: string,
  customDict: Record<string, string> = {}
) {
  const rows: string[] = [];
  for (let i = 0; i < displayDetails.length; i += 4) {
    const group = displayDetails.slice(i, i + 4);
    const cells = group.map(d => buildWordCell(d, mealTypeAr, mealTypeEn, customDict));
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

// ── Editable field ────────────────────────────────────────────────────────────
function EditableField({ value, onChange, className, dir = 'rtl' }: {
  value: string; onChange: (v: string) => void; className?: string; dir?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input autoFocus dir={dir} value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={e => e.key === 'Enter' && setEditing(false)}
        className={`${className ?? ''} bg-yellow-50 border border-yellow-400 rounded px-1 focus:outline-none w-full`}
        style={{ font: 'inherit', color: 'inherit' }}
      />
    );
  }
  return (
    <span
      className={`${className ?? ''} cursor-pointer hover:bg-yellow-50 hover:outline hover:outline-1 hover:outline-yellow-300 rounded px-0.5 no-print-outline`}
      title="اضغط للتعديل"
      onClick={() => setEditing(true)}
    >{value}</span>
  );
}

// ── Sticker Card ──────────────────────────────────────────────────────────────
function StickerCard({ detail, mealTypeAr, mealTypeEn, customDict, isSplitCard = false }: {
  detail: ReportData['beneficiaryDetails'][0];
  mealTypeAr: string;
  mealTypeEn: string;
  customDict: Record<string, string>;
  isSplitCard?: boolean;
}) {
  const ben = detail.beneficiary;
  const [nameAr, setNameAr] = useState(ben.name);
  const [nameEn, setNameEn] = useState(ben.english_name ?? '');
  const [code, setCode] = useState(ben.code);
  const [villa, setVilla] = useState(ben.villa ?? '');

  const [exclusions, setExclusions] = useState(
    detail.excludedItems.map(({ meal, alternative }) => ({
      excludedName: meal.name,
      alternativeName: alternative?.name ?? '',   // empty = no alternative
    }))
  );
  const updateExclusion = (idx: number, field: 'excludedName' | 'alternativeName', val: string) =>
    setExclusions(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  // Fixed meals already filtered for today's day+mealType by the API
  const fixedMealsToday = (detail.fixedItems ?? []).map(m => m.name);

  const altItems = exclusions.filter(e => e.alternativeName.trim() !== '');
  const allBadilNames = [...altItems.map(e => e.alternativeName), ...fixedMealsToday];
  const allBadilTranslit = allBadilNames.map(n => transliterate(n, customDict));

  return (
    <div className="sticker-card" style={isSplitCard ? { borderColor: '#7c3aed' } : undefined}>
      <div className="sticker-header" style={isSplitCard ? { background: '#7c3aed' } : undefined}>
        <span className="sticker-mode-ar">{mealTypeAr}</span>
        <span className="sticker-mode-en">{mealTypeEn}{isSplitCard ? ' ★' : ''}</span>
      </div>

      <div className="sticker-meta">
        <EditableField value={code} onChange={setCode} className="sticker-code" />
        <EditableField value={villa} onChange={setVilla} className="sticker-villa" />
      </div>

      <div className="sticker-names">
        <div className="sticker-name-ar"><EditableField value={nameAr} onChange={setNameAr} /></div>
        <div className="sticker-name-en"><EditableField value={nameEn} onChange={setNameEn} dir="ltr" /></div>
      </div>

      <div className="sticker-exclusions">
        <div className="sticker-section-label" style={{ color: '#dc2626' }}>مستبعد</div>
        <div className="sticker-names-row sticker-item-excluded">
          {exclusions.map((e, i) => (
            <span key={i}>
              {i > 0 && <span className="text-slate-400">، </span>}
              <EditableField value={e.excludedName} onChange={v => updateExclusion(i, 'excludedName', v)} className="sticker-item-excluded" />
            </span>
          ))}
        </div>
        <div className="sticker-section-label" style={{ color: '#dc2626', marginTop: 2 }}>no</div>
        <div className="sticker-translit-line" style={{ direction: 'ltr', textAlign: 'left', display: 'block' }}>
          {exclusions.map(e => transliterate(e.excludedName, customDict)).join(' | ')}
        </div>

        <div className="sticker-section-label" style={{ color: '#059669', marginTop: 6 }}>بديل</div>
        <div className="sticker-names-row sticker-item-alt">
          {allBadilNames.length === 0 ? (
            <span className="sticker-no-alt">لا يوجد</span>
          ) : (
            allBadilNames.map((name, i) => (
              <span key={i}>
                {i > 0 && <span className="text-slate-400">، </span>}
                <span className="sticker-item-alt font-semibold">{name}</span>
              </span>
            ))
          )}
        </div>
        <div className="sticker-section-label" style={{ color: '#059669', marginTop: 2 }}>yes</div>
        <div className="sticker-translit-line" style={{ direction: 'ltr', textAlign: 'left', display: 'block' }}>
          {allBadilTranslit.join(' | ') || '—'}
        </div>
      </div>

      {ben.fixed_items && (
        <div className="sticker-fixed">
          <span className="sticker-fixed-label">إضافات: </span>{ben.fixed_items}
        </div>
      )}
    </div>
  );
}

// ── Split Section ─────────────────────────────────────────────────────────────
function SplitSection({
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
  const [expanded, setExpanded] = useState<string | null>(null);

  const toggle = (meal_id: string, ben_id: string) => {
    const current = new Set(splits[ben_id] ?? []);
    current.has(meal_id) ? current.delete(meal_id) : current.add(meal_id);
    onSplitsChange({ ...splits, [ben_id]: current });
  };

  const clearSplit = (ben_id: string) => {
    const next = { ...splits };
    delete next[ben_id];
    onSplitsChange(next);
  };

  const hasSplits = Object.values(splits).some(s => s.size > 0);

  return (
    <div className="card overflow-hidden no-print">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <h3 className="font-bold text-slate-700 text-sm">فصل الستيكرات</h3>
          {hasSplits && (
            <span className="badge bg-violet-100 text-violet-700 text-xs">
              {Object.values(splits).filter(s => s.size > 0).length} مستفيد مفصول
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs">
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
          {saveStatus === 'error' && (
            <span className="text-red-500">خطأ في الحفظ</span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2">
        <p className="text-xs text-slate-500 mb-3">اضغط على الأصناف المستبعدة لنقلها إلى ستيكر منفصل. الأصناف الخضراء ستنتقل لستيكر جديد والبقية تبقى في الأصلي.</p>
        {stickerDetails.map(detail => {
          const ben = detail.beneficiary;
          const splitSet = splits[ben.id] ?? new Set<string>();
          const isOpen = expanded === ben.id;
          const splitCount = splitSet.size;

          return (
            <div key={ben.id} className={`border rounded-xl overflow-hidden transition-all ${splitCount > 0 ? 'border-violet-300' : 'border-slate-200'}`}>
              {/* Row header */}
              <button type="button" onClick={() => setExpanded(isOpen ? null : ben.id)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-right hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-sm text-slate-800">{ben.name}</span>
                  <code className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{ben.code}</code>
                  <span className="text-xs text-slate-400">{detail.excludedItems.length} محظور</span>
                </div>
                <div className="flex items-center gap-2">
                  {splitCount > 0 && (
                    <span className="badge bg-violet-100 text-violet-700 text-xs">{splitCount} منقول</span>
                  )}
                  {splitCount > 0 && (
                    <button type="button" onClick={e => { e.stopPropagation(); clearSplit(ben.id); }}
                      className="text-xs text-slate-400 hover:text-red-500 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors">
                      مسح
                    </button>
                  )}
                  <svg className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {/* Expanded: show exclusion chips */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50/50">
                  <div className="flex gap-4">
                    {/* Main sticker side */}
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-slate-500 mb-2">يبقى في الأصلي</div>
                      <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-white rounded-lg border border-slate-200">
                        {detail.excludedItems.filter(item => !splitSet.has(item.meal.id)).map(({ meal, alternative }) => (
                          <button key={meal.id} type="button" onClick={() => toggle(meal.id, ben.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-semibold hover:bg-violet-100 hover:text-violet-700 transition-colors group">
                            <span>{meal.name}</span>
                            {alternative && <span className="text-red-400 group-hover:text-violet-400">← {alternative.name}</span>}
                            <svg className="w-3 h-3 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                          </button>
                        ))}
                        {detail.excludedItems.filter(item => !splitSet.has(item.meal.id)).length === 0 && (
                          <span className="text-xs text-slate-400 m-auto">لا يوجد</span>
                        )}
                      </div>
                    </div>

                    {/* Split sticker side */}
                    <div className="flex-1">
                      <div className="text-xs font-semibold text-violet-600 mb-2">ينتقل للستيكر المفصول ★</div>
                      <div className="flex flex-wrap gap-2 min-h-[40px] p-2 bg-white rounded-lg border border-violet-200">
                        {detail.excludedItems.filter(item => splitSet.has(item.meal.id)).map(({ meal, alternative }) => (
                          <button key={meal.id} type="button" onClick={() => toggle(meal.id, ben.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold hover:bg-red-100 hover:text-red-700 transition-colors group">
                            <svg className="w-3 h-3 opacity-50 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                            <span>{meal.name}</span>
                            {alternative && <span className="text-violet-400 group-hover:text-red-400">← {alternative.name}</span>}
                          </button>
                        ))}
                        {splitSet.size === 0 && (
                          <span className="text-xs text-slate-400 m-auto">اضغط على صنف لنقله هنا</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstSplitsLoad = useRef(true);
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    supabase.from('daily_orders').select('id, date, meal_type, created_at').order('date', { ascending: false })
      .then(({ data }) => { if (data) setOrders(data as DailyOrder[]); setLoadingOrders(false); })
      .catch(err => { console.error('Error fetching orders:', err); setLoadingOrders(false); });
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

  // Auto-save splits whenever they change (debounced 800ms)
  useEffect(() => {
    if (!selectedOrderId) return;
    if (isFirstSplitsLoad.current) { isFirstSplitsLoad.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      try {
        await supabase.from('sticker_splits').delete().eq('order_id', selectedOrderId);
        const rows = Object.entries(splits)
          .filter(([, set]) => set.size > 0)
          .map(([beneficiary_id, set]) => ({
            order_id: selectedOrderId,
            beneficiary_id,
            split_meal_ids: Array.from(set),
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
        // Load saved splits
        if (splitsRes.data) {
          const loaded: SplitsMap = {};
          splitsRes.data.forEach((row: { beneficiary_id: string; split_meal_ids: string[] }) => {
            loaded[row.beneficiary_id] = new Set(row.split_meal_ids);
          });
          setSplits(loaded);
        }
      }
    } catch { setError('حدث خطأ في الاتصال'); }
    setLoading(false);
  };

  const stickerDetails = report?.beneficiaryDetails.filter(d => d.excludedItems.length > 0) ?? [];
  const mealTypeAr = report ? MEAL_TYPE_LABELS[report.order.meal_type] : '';
  const mealTypeEn = report ? MEAL_TYPE_EN[report.order.meal_type] : '';

  // Expand splits into separate detail objects
  const displayDetails = stickerDetails.flatMap(detail => {
    const splitSet = splits[detail.beneficiary.id];
    if (!splitSet || splitSet.size === 0) return [{ ...detail, isSplit: false }];
    const mainItems = detail.excludedItems.filter(item => !splitSet.has(item.meal.id));
    const splitItems = detail.excludedItems.filter(item => splitSet.has(item.meal.id));
    const result: Array<typeof detail & { isSplit: boolean }> = [];
    if (mainItems.length > 0) result.push({ ...detail, excludedItems: mainItems, isSplit: false });
    if (splitItems.length > 0) result.push({ ...detail, excludedItems: splitItems, isSplit: true });
    return result;
  });

  const handleExportWord = () => {
    if (!report || displayDetails.length === 0) return;
    const fn = `ستيكرات_${new Date(report.order.date).toISOString().slice(0, 10)}_${mealTypeAr}`;
    exportStickersWord(displayDetails, mealTypeAr, mealTypeEn, fn, customDict);
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
            <div className="no-print text-sm text-slate-500 px-1 mb-3">
              {displayDetails.length} ستيكر — {Math.ceil(displayDetails.length / 4)} صف
              {displayDetails.length !== stickerDetails.length && (
                <span className="text-violet-600 mr-2">({displayDetails.length - stickerDetails.length} ستيكر مفصول)</span>
              )}
            </div>
            <div className="sticker-grid">
              {displayDetails.map((detail, idx) => (
                <StickerCard
                  key={`${detail.beneficiary.id}_${idx}`}
                  detail={detail}
                  mealTypeAr={mealTypeAr}
                  mealTypeEn={mealTypeEn}
                  customDict={customDict}
                  isSplitCard={(detail as typeof detail & { isSplit: boolean }).isSplit}
                />
              ))}
            </div>
          </div>

          {/* Split section */}
          <SplitSection
            stickerDetails={stickerDetails}
            splits={splits}
            onSplitsChange={setSplits}
            saveStatus={saveStatus}
          />
        </>
      )}
    </div>
  );
}
