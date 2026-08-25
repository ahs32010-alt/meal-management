'use client';

/**
 * تبويب «ثابتة» — ستيكر واحد لكل مستفيد، بلا ارتباط بأمر تشغيل.
 * (كان هو محتوى صفحة ستيكرات الغداء والعشاء كلها قبل إضافة تبويب «حسب الوجبة»).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Beneficiary } from '@/lib/types';
import StickerCard from './ld-sticker-card';
import { fetchStickerBeneficiaries } from './ld-fetch';
import { readSnapshot, writeSnapshot } from '@/lib/view-snapshot';
import { DietColorsPanel, HeaderControls, SizeFields, type LdSettings } from './ld-settings';
// `./ld-word-export` pulls in the docx package (~140KB). Loaded lazily on demand.

export default function LdFixedTab({ settings }: { settings: LdSettings }) {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sizeWidth, setSizeWidth] = useState('10');
  const [sizeHeight, setSizeHeight] = useState('10');
  const [hideColored, setHideColored] = useState(false);

  const { headerUrl, dietColors } = settings;

  const w = Math.min(Math.max(parseFloat(sizeWidth) || 10, 2), 30);
  const h = Math.min(Math.max(parseFloat(sizeHeight) || 10, 2), 30);

  // مراجع لعُقد الستيكرات المعروضة — نلتقطها كصور مطابقة تماماً للـPDF
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const setNode = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodesRef.current.set(id, el);
    else nodesRef.current.delete(id);
  }, []);

  // كل الأنظمة الغذائية المسجّلة (قيم diet_type المميّزة)
  const dietTypes = useMemo(() => {
    const set = new Set<string>();
    beneficiaries.forEach(b => { const d = b.diet_type?.trim(); if (d) set.add(d); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [beneficiaries]);

  // هل الستيكر ملوّن (نظامه الغذائي له لون)؟
  const isColored = (b: Beneficiary) => !!(b.diet_type?.trim() && dietColors[b.diet_type.trim()]);
  // القائمة المرئية للعرض والتصدير — عند تفعيل الإخفاء نستبعد الملوّنة
  const visibleBeneficiaries = useMemo(
    () => (hideColored ? beneficiaries.filter(b => !isColored(b)) : beneficiaries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beneficiaries, hideColored, dietColors],
  );

  const loadBeneficiaries = useCallback(async () => {
    // آخر لقطة تُرسم فوراً، والطلب يستبدلها بمجرّد وصوله
    const snap = readSnapshot<Beneficiary[]>('ld:fixed');
    if (snap) { setBeneficiaries(snap); setLoading(false); } else { setLoading(true); }
    setError('');
    const { data, error: err } = await fetchStickerBeneficiaries(true);
    if (err) { setError(err); setBeneficiaries([]); }
    else { setBeneficiaries(data); writeSnapshot('ld:fixed', data); }
    setLoading(false);
  }, []);

  useEffect(() => { void loadBeneficiaries(); }, [loadBeneficiaries]);

  const handleExport = async () => {
    if (!visibleBeneficiaries.length) return;
    setExporting(true);
    try {
      const { exportLunchDinnerStickers } = await import('./ld-word-export');
      await exportLunchDinnerStickers(visibleBeneficiaries, headerUrl, w, h, dietColors);
    } catch (e) {
      alert(`تعذّر التصدير: ${e instanceof Error ? e.message : 'خطأ غير معروف'}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!visibleBeneficiaries.length) return;
    setExportingPdf(true);
    setProgress({ done: 0, total: visibleBeneficiaries.length });
    try {
      // نلتقط عُقد الستيكرات المرئية بالترتيب — الـPDF طبق الأصل من الصفحة
      const nodes = visibleBeneficiaries
        .map(b => nodesRef.current.get(b.id))
        .filter((el): el is HTMLDivElement => !!el);
      if (!nodes.length) { alert('لا توجد ستيكرات للتصدير — انتظر تحميل الصفحة كاملة ثم أعد المحاولة'); return; }
      const { exportLunchDinnerStickersPdf } = await import('./ld-pdf-export');
      const res = await exportLunchDinnerStickersPdf(nodes, w, h, (done, total) => setProgress({ done, total }));
      if (res.failed > 0) {
        alert(`تم التصدير: ${res.captured} ستيكر. تعذّر التقاط ${res.failed}.`);
      }
    } catch (e) {
      alert(`تعذّر تصدير PDF: ${e instanceof Error ? e.message : 'خطأ غير معروف'}`);
    } finally {
      setExportingPdf(false);
      setProgress(null);
    }
  };

  return (
    <div>
      {/* شريط الإعدادات — لا يظهر في الطباعة */}
      <div className="no-print mb-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <p className="text-slate-500 text-sm">
            ستيكر ثابت لكل مستفيد — {visibleBeneficiaries.length}
            {hideColored && beneficiaries.length !== visibleBeneficiaries.length
              ? ` ظاهر (مخفي ${beneficiaries.length - visibleBeneficiaries.length} ملوّن)`
              : ' مستفيد'}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setHideColored(v => !v)}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                hideColored ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {hideColored
                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.542 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />}
              </svg>
              {hideColored ? 'إظهار الكل' : 'إخفاء الستيكرات الملوّنة'}
            </button>
            <HeaderControls settings={settings} />
          </div>
        </div>

        {/* اختيار المقاس + تصدير */}
        <div className="card p-4">
          <div className="flex items-end gap-3 flex-wrap">
            <SizeFields w={sizeWidth} h={sizeHeight} setW={setSizeWidth} setH={setSizeHeight} />
            <button onClick={handleExportPdf} disabled={exportingPdf || exporting || !visibleBeneficiaries.length}
              className="btn-primary text-sm disabled:opacity-50">
              {exportingPdf
                ? (progress ? `جاري التصدير ${progress.done}/${progress.total}...` : 'جاري التصدير...')
                : `تصدير PDF (${visibleBeneficiaries.length} ستيكر)`}
            </button>
            <button onClick={handleExport} disabled={exporting || exportingPdf || !visibleBeneficiaries.length}
              className="btn-secondary text-sm disabled:opacity-50">
              {exporting ? 'جاري التصدير...' : 'تصدير Word'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            💡 افتح الملف في Word ثم اطبعه — كل ستيكر في صفحة منفصلة بمقاس {sizeWidth || '—'}×{sizeHeight || '—'} سم بالضبط.
            المعاينة بالأسفل بنفس المقاس.
          </p>
        </div>

        {/* ألوان الأنظمة الغذائية — قسم قابل للطيّ */}
        <DietColorsPanel dietTypes={dietTypes} settings={settings} />
      </div>

      {error && (
        <div className="no-print bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">جاري التحميل...</div>
      ) : beneficiaries.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">لا يوجد مستفيدون.</div>
      ) : visibleBeneficiaries.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">كل الستيكرات ملوّنة ومخفيّة. اضغط «إظهار الكل».</div>
      ) : (
        <div className="flex flex-wrap gap-4 justify-center md:justify-start">
          {visibleBeneficiaries.map(ben => (
            <StickerCard key={ben.id} ben={ben} headerUrl={headerUrl} widthCm={w} heightCm={h}
              bgColor={ben.diet_type?.trim() ? dietColors[ben.diet_type.trim()] : undefined}
              innerRef={el => setNode(ben.id, el)} />
          ))}
        </div>
      )}
    </div>
  );
}
