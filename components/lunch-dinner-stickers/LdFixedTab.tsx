'use client';

/**
 * تبويب «ثابتة» — ستيكر واحد لكل مستفيد، بلا ارتباط بأمر تشغيل.
 * (كان هو محتوى صفحة ستيكرات الغداء والعشاء كلها قبل إضافة تبويب «حسب الوجبة»).
 */

import { Fragment, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Beneficiary } from '@/lib/types';
import StickerCard from './ld-sticker-card';
import { fetchStickerBeneficiaries } from './ld-fetch';
import { readSnapshot, writeSnapshot } from '@/lib/view-snapshot';
import {
  ColorFilterControl, DietColorsPanel, DietGroupHeader, HeaderControls, SizeFields, SortByDietToggle,
  colorFilterSuffix, matchesColorFilter, type ColorFilter, type LdSettings,
} from './ld-settings';
import { effectiveDietOrder, sortByDietOrder } from './ld-diet-order';
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
  const [colorFilter, setColorFilter] = useState<ColorFilter>('all');
  const [sortByDiet, setSortByDiet] = useState(true);

  const { headerUrl, dietColors, dietOrder } = settings;

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
  const coloredCount = useMemo(
    () => beneficiaries.filter(isColored).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beneficiaries, dietColors],
  );
  const dietOf = (b: Beneficiary) => b.diet_type?.trim() ?? '';
  // القائمة المرئية للعرض والتصدير — حسب فلتر اللون (الكل/البيضاء/الملوّنة)،
  // ثم مرتّبة حسب ترتيب الأنظمة الغذائية حتى يطلع الـPDF/Word مفروزاً
  const visibleBeneficiaries = useMemo(() => {
    const filtered = beneficiaries.filter(b => matchesColorFilter(colorFilter, isColored(b)));
    return sortByDiet ? sortByDietOrder(filtered, dietOf, effectiveDietOrder(dietTypes, dietOrder)) : filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beneficiaries, colorFilter, dietColors, sortByDiet, dietTypes, dietOrder]);
  const groupCounts = useMemo(() => {
    const m = new Map<string, number>();
    visibleBeneficiaries.forEach(b => m.set(dietOf(b), (m.get(dietOf(b)) ?? 0) + 1));
    return m;
  }, [visibleBeneficiaries]);

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
      await exportLunchDinnerStickers(
        visibleBeneficiaries, headerUrl, w, h, dietColors, undefined,
        `ستيكرات-الغداء-والعشاء${colorFilterSuffix(colorFilter)}.docx`,
      );
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
      const res = await exportLunchDinnerStickersPdf(
        nodes, w, h, (done, total) => setProgress({ done, total }),
        `ستيكرات-الغداء-والعشاء${colorFilterSuffix(colorFilter)}.pdf`,
      );
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
            {colorFilter === 'all' ? ' مستفيد' : ` ظاهر من ${beneficiaries.length}`}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <ColorFilterControl value={colorFilter} onChange={setColorFilter}
              counts={{ white: beneficiaries.length - coloredCount, colored: coloredCount }} />
            <SortByDietToggle checked={sortByDiet} onChange={setSortByDiet} />
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
        <div className="py-16 text-center text-slate-400 text-sm">
          {colorFilter === 'colored' ? 'لا توجد ستيكرات ملوّنة — حدّد ألوان الأنظمة الغذائية أولاً.' : 'لا توجد ستيكرات بيضاء.'}
        </div>
      ) : (
        <div className="flex flex-wrap gap-4 justify-center md:justify-start">
          {visibleBeneficiaries.map((ben, i) => {
            const diet = dietOf(ben);
            const newGroup = sortByDiet && (i === 0 || dietOf(visibleBeneficiaries[i - 1]) !== diet);
            return (
              <Fragment key={ben.id}>
                {newGroup && (
                  <DietGroupHeader diet={diet} color={dietColors[diet]} count={groupCounts.get(diet) ?? 0}
                    index={[...groupCounts.keys()].indexOf(diet) + 1} />
                )}
                <StickerCard ben={ben} headerUrl={headerUrl} widthCm={w} heightCm={h}
                  bgColor={diet ? dietColors[diet] : undefined}
                  innerRef={el => setNode(ben.id, el)} />
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
