'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { DailyOrder, ReportData } from '@/lib/types';
import { MEAL_TYPE_LABELS, MEAL_TYPE_EN } from '@/lib/types';
import { formatDate } from '@/lib/date-utils';
import { transliterate } from '@/lib/transliterate';
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
  const excludedNames = items.map(({ meal }) => meal.name).join('، ');
  const excludedTranslit = items.map(({ meal }) => transliterate(meal.name, customDict)).filter(Boolean).join(' | ');
  const fixedMealsToday = (detail.fixedItems ?? []).map(m => m.name);
  const altItems = items.filter(e => e.alternative);
  const allBadilNames = [...altItems.map(e => e.alternative!.name), ...fixedMealsToday];
  const altTranslit = allBadilNames.map(n => transliterate(n, customDict)).filter(Boolean).join(' | ');

  const gc = GROUP_COLORS[groupIndex] ?? GROUP_COLORS[0];
  const headerBg = groupIndex === 0 ? '#1e293b' : (
    groupIndex === 1 ? '#7c3aed' : groupIndex === 2 ? '#f43f5e' : groupIndex === 3 ? '#f59e0b' : '#059669'
  );

  const groupLabel = groupIndex > 0 ? ` ★ ${gc.label}` : '';

  return `<td style="width:25%;vertical-align:top;border:2pt solid #cbd5e1;border-radius:8pt;padding:0;direction:rtl;text-align:center;">
  ${groupIndex > 0 ? `<div style="background:${headerBg};color:white;padding:3pt 8pt;font-size:9pt;font-weight:700;text-align:center;">${mealTypeAr} ${mealTypeEn}${groupLabel}</div>` : ''}
  <div style="padding:5pt 8pt 3pt;text-align:center;border-bottom:1pt solid #e2e8f0;">
    <div style="font-size:14pt;font-weight:800;color:#dc2626;">Code: ${ben.code}</div>
    ${ben.villa ? `<div style="font-size:14pt;font-weight:800;color:#dc2626;">Villa: ${ben.villa}</div>` : ''}
  </div>
  <div style="padding:5pt 8pt;text-align:center;border-bottom:1pt solid #e2e8f0;">
    <div style="font-size:13pt;font-weight:800;color:#0f172a;">${ben.name}</div>
    ${ben.english_name ? `<div style="font-size:11pt;font-weight:600;color:#374151;direction:ltr;">${ben.english_name}</div>` : ''}
  </div>
  <div style="padding:5pt 8pt;text-align:right;border-bottom:1pt solid #e2e8f0;">
    ${excludedNames ? `<div style="font-size:11pt;"><strong>مستبعد: </strong>${excludedNames}</div>` : ''}
    ${allBadilNames.length > 0 ? `<div style="font-size:11pt;"><strong>بديل: </strong>${allBadilNames.join('، ')}</div>` : ''}
  </div>
  <div style="padding:5pt 8pt;">
    ${excludedTranslit ? `<div style="background:#fff1f2;color:#dc2626;border-radius:5pt;padding:3pt 7pt;font-size:10pt;font-weight:700;direction:ltr;text-align:left;margin-bottom:4pt;"><strong>NO: </strong>${excludedTranslit}</div>` : ''}
    ${altTranslit ? `<div style="background:#eff6ff;color:#2563eb;border-radius:5pt;padding:3pt 7pt;font-size:10pt;font-weight:700;direction:ltr;text-align:left;"><strong>YES: </strong>${altTranslit}</div>` : ''}
    ${ben.fixed_items ? `<div style="font-size:8.5pt;color:#475569;margin-top:4pt;padding-top:3pt;border-top:1px dashed #cbd5e1;">إضافات: <strong>${ben.fixed_items}</strong></div>` : ''}
  </div>
</td>`;
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
    }))
  );
  const updateExclusion = (idx: number, field: 'excludedName' | 'alternativeName', val: string) =>
    setExclusions(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));

  const [fixedMeals, setFixedMeals] = useState(
    (detail.fixedItems ?? []).map(m => m.name)
  );
  const updateFixed = (idx: number, val: string) =>
    setFixedMeals(prev => prev.map((n, i) => i === idx ? val : n));

  const altNames  = exclusions.map(e => e.alternativeName);
  const allBadil  = [...altNames, ...fixedMeals];
  const hasAnyBadil = allBadil.some(n => n.trim() !== '');

  const excludedTranslitList = exclusions
    .map(e => e.excludedName)
    .filter(n => n.trim())
    .map(n => transliterate(n, customDict))
    .filter(Boolean);
  const badilTranslitList = allBadil
    .filter(n => n.trim())
    .map(n => transliterate(n, customDict))
    .filter(Boolean);

  const cardBorderStyle = groupIndex > 0
    ? { borderColor: groupIndex === 1 ? '#7c3aed' : groupIndex === 2 ? '#f43f5e' : groupIndex === 3 ? '#f59e0b' : '#059669' }
    : undefined;

  const inp = (val: string, onChange: (v: string) => void, dir: 'rtl' | 'ltr' = 'rtl') => (
    <input
      dir={dir}
      value={val}
      onChange={e => onChange(e.target.value)}
      className="bg-yellow-50 border border-yellow-300 rounded px-1 focus:outline-none text-center w-full"
      style={{ font: 'inherit', color: 'inherit' }}
    />
  );

  return (
    <div className="sticker-card" style={cardBorderStyle}>
      {/* Edit button */}
      <div className="sticker-edit-bar no-print">
        <button type="button" onClick={() => setEditMode(m => !m)} className="sticker-edit-btn">
          {editMode ? 'حفظ ✓' : 'تعديل المعلومات 📝'}
        </button>
      </div>

      {/* Group badge */}
      {groupIndex > 0 && (
        <div className={`sticker-group-badge ${gc.bg} ${gc.text}`}>★ {gc.label} — {mealTypeAr} {mealTypeEn}</div>
      )}

      {/* Code */}
      <div className="sticker-info-row">
        <span className="sticker-info-label">Code:</span>
        {editMode ? inp(code, setCode, 'ltr') : <span className="sticker-info-value">{code}</span>}
      </div>

      {/* Villa */}
      {(villa || editMode) && (
        <div className="sticker-info-row">
          <span className="sticker-info-label">Villa:</span>
          {editMode ? inp(villa, setVilla, 'ltr') : <span className="sticker-info-value">{villa}</span>}
        </div>
      )}

      {/* Names */}
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

      {/* Excluded + Alternative */}
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
                  : e.excludedName}
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
                  : e.alternativeName}
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

      {/* NO / YES pills */}
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
  const setGroup = (meal_id: string, ben_id: string, g: number) => {
    const prevGm = { ...(splits[ben_id] ?? {}) };
    if (g === 0) {
      delete prevGm[meal_id];
    } else {
      prevGm[meal_id] = g;
    }
    onSplitsChange({ ...splits, [ben_id]: prevGm });
  };

  const clearSplit = (ben_id: string) => {
    const next = { ...splits };
    delete next[ben_id];
    onSplitsChange(next);
  };

  const hasSplits = Object.values(splits).some(gm => Object.values(gm).some(g => g > 0));

  return (
    <div className="card overflow-hidden no-print">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <h3 className="font-bold text-slate-700 text-sm">فصل الستيكرات</h3>
          {hasSplits && (
            <span className="badge bg-violet-100 text-violet-700 text-xs">
              {Object.values(splits).filter(gm => Object.values(gm).some(g => g > 0)).length} مستفيد مفصول
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
          {saveStatus === 'error' && <span className="text-red-500">خطأ في الحفظ</span>}
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Legend */}
        <div className="flex items-center gap-2 flex-wrap">
          {GROUP_COLORS.map((gc, i) => (
            <span key={i} className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${gc.bg} ${gc.text}`}>
              <span>{gc.label}</span>
            </span>
          ))}
          <span className="text-xs text-slate-400 mr-1">— اضغط أي صنف لتحديد الستيكر المناسب</span>
        </div>

        {stickerDetails.map(detail => {
          const ben = detail.beneficiary;
          const gm = splits[ben.id] ?? {};
          const nGroups = maxGroup(gm);
          const splitCount = Object.values(gm).filter(g => g > 0).length;

          const exclItems = detail.excludedItems.map(({ meal, alternative }) => ({
            id: meal.id, label: meal.name, sub: alternative?.name ?? null, type: 'excl' as const,
          }));
          const fixedChips = (detail.fixedItems ?? []).map(m => ({
            id: m.id, label: m.name, sub: null, type: 'fixed' as const,
          }));
          const allItems = [...exclItems, ...fixedChips];

          // How many group buttons to show per item: 0..nGroups + 1 new slot (capped at 4)
          const maxButtonGroup = Math.min(nGroups + 1, GROUP_COLORS.length - 1);

          return (
            <div key={ben.id} className={`border rounded-xl overflow-hidden ${nGroups > 0 ? 'border-violet-300' : 'border-slate-200'}`}>
              {/* Beneficiary header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-800">{ben.name}</span>
                  <code className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{ben.code}</code>
                </div>
                <div className="flex items-center gap-2">
                  {nGroups > 0 && (
                    <span className="text-xs text-violet-600 font-semibold">{nGroups + 1} ستيكرات</span>
                  )}
                  {splitCount > 0 && (
                    <button type="button" onClick={() => clearSplit(ben.id)}
                      className="text-xs text-slate-400 hover:text-red-500 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors">
                      مسح الكل
                    </button>
                  )}
                </div>
              </div>

              {/* Items */}
              <div className="p-3 flex flex-wrap gap-2">
                {allItems.map(item => {
                  const currentGroup = gm[item.id] ?? 0;
                  const activeGc = GROUP_COLORS[currentGroup] ?? GROUP_COLORS[0];

                  return (
                    <div key={item.id} className="flex items-stretch rounded-lg overflow-hidden border border-slate-200 shadow-sm">
                      {/* Item chip */}
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        currentGroup > 0
                          ? `${activeGc.bg} ${activeGc.text}`
                          : item.type === 'fixed'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-red-50 text-red-700'
                      }`}>
                        <span>{item.label}</span>
                        {item.sub && <span className="opacity-60">← {item.sub}</span>}
                        {item.type === 'fixed' && <span className="opacity-50 text-[10px]">ثابت</span>}
                      </div>

                      {/* Group selector buttons */}
                      <div className="flex border-r border-slate-200">
                        {Array.from({ length: maxButtonGroup + 1 }, (_, g) => {
                          const gc = GROUP_COLORS[g] ?? GROUP_COLORS[0];
                          const isActive = currentGroup === g;
                          return (
                            <button key={g} type="button"
                              onClick={() => setGroup(item.id, ben.id, g)}
                              title={gc.label}
                              className={`w-7 h-full flex items-center justify-center text-[10px] font-bold border-r border-slate-200 last:border-r-0 transition-colors ${
                                isActive
                                  ? `${gc.bg} ${gc.text}`
                                  : 'bg-white text-slate-400 hover:bg-slate-100'
                              }`}
                            >
                              {g === 0 ? '١' : `${g + 1}`}
                            </button>
                          );
                        })}
                        {/* + button to unlock one more group level */}
                        {maxButtonGroup < GROUP_COLORS.length - 1 && (
                          <button type="button"
                            onClick={() => setGroup(item.id, ben.id, maxButtonGroup + 1)}
                            title={`إضافة ${GROUP_COLORS[maxButtonGroup + 1]?.label}`}
                            className="w-7 h-full flex items-center justify-center text-[11px] font-bold bg-white text-slate-300 hover:bg-violet-50 hover:text-violet-500 transition-colors"
                          >+</button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {allItems.length === 0 && (
                  <span className="text-xs text-slate-300 italic py-1.5">لا توجد أصناف</span>
                )}
              </div>
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
      const groupFixed    = (detail.fixedItems ?? []).filter(m => (gm[m.id] ?? 0) === g);
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
              {displayDetails.map((detail) => (
                <StickerCard
                  key={`${detail.beneficiary.id}_g${detail.groupIndex}_${detail.excludedItems.map(i => i.meal.id).join(',')}_${(detail.fixedItems ?? []).map(m => m.id).join(',')}`}
                  detail={detail}
                  mealTypeAr={mealTypeAr}
                  mealTypeEn={mealTypeEn}
                  customDict={customDict}
                  groupIndex={detail.groupIndex}
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
