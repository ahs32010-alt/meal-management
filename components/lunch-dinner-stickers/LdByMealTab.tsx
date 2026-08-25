'use client';

/**
 * تبويب «حسب الوجبة» — نفس ستيكر الغداء/العشاء، لكن مربوط بأمر تشغيل:
 * تختار الأمر (غداء أو عشاء) فتطلع ستيكرات ذلك اليوم، وفي آخر كل ستيكر
 * تخصيصات المستفيد لهذه الوجبة (محظور/بديل) بنفس أسلوب ستيكرات الفطور.
 *
 * بيانات الستيكر تُدمج من مصدرين:
 *   • تقرير الأمر  → المحظور والبديل والأصناف الثابتة لهذا اليوم
 *   • جدول المستفيدين → رموز الخيارات (لا يفضل السمك…) التي لا يحملها التقرير
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import type { Beneficiary, DailyOrder, MealType, ReportData } from '@/lib/types';
import { MEAL_TYPE_LABELS, MEAL_TYPE_EN, DAY_LABELS } from '@/lib/types';
import { formatDateFull } from '@/lib/date-utils';
import { transliterate } from '@/lib/transliterate';
import LdOrderPicker from './LdOrderPicker';
import StickerCard from './ld-sticker-card';
import { fetchStickerBeneficiaries } from './ld-fetch';
import { splitDetailByCategory } from './ld-split';
import { readSnapshot, writeSnapshot } from '@/lib/view-snapshot';
import { DietColorsPanel, HeaderControls, SizeFields, type LdSettings } from './ld-settings';
import type { LdMealCustomization } from './ld-types';
// `./ld-word-export` pulls in the docx package (~140KB). Loaded lazily on demand.

/** وجبات هذه الصفحة — الفطور له صفحته الخاصة (/stickers). */
const LD_MEALS: MealType[] = ['lunch', 'dinner'];

interface StickerRow {
  /** مفتاح فريد للستيكر — المستفيد قد يكون له أكثر من ستيكر (واحد لكل تصنيف) */
  key: string;
  ben: Beneficiary;
  custom: LdMealCustomization;
  hasCustom: boolean;
}

export default function LdByMealTab({ settings }: { settings: LdSettings }) {
  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [benMap, setBenMap] = useState<Map<string, Beneficiary>>(new Map());
  const [customDict, setCustomDict] = useState<Record<string, string>>({});

  const [sizeWidth, setSizeWidth] = useState('10');
  const [sizeHeight, setSizeHeight] = useState('10');
  const [onlyWithCustom, setOnlyWithCustom] = useState(false);
  const [hideColored, setHideColored] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const { headerUrl, dietColors } = settings;

  const w = Math.min(Math.max(parseFloat(sizeWidth) || 10, 2), 30);
  const h = Math.min(Math.max(parseFloat(sizeHeight) || 10, 2), 30);

  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const setNode = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodesRef.current.set(id, el);
    else nodesRef.current.delete(id);
  }, []);

  // ── أوامر التشغيل (غداء/عشاء فقط) ─────────────────────────────────────────
  useEffect(() => {
    const loadOrders = async () => {
      const cached = readSnapshot<DailyOrder[]>('ld:orders');
      if (cached) { setOrders(cached); setLoadingOrders(false); }
      // قراءة على دفعات — بدونها يقصّ PostgREST القائمة عند ١٠٠٠ أمر بصمت
      // الـselect ديناميكي فما يقدر TypeScript يستنتج شكل الصف — نقصّه يدوياً
      const fetchOrders = (withEntity: boolean) =>
        fetchAllRows((from, to) =>
          supabase
            .from('daily_orders')
            .select(`id, date, meal_type, week_number, day_of_week, created_at${withEntity ? ', entity_type' : ''}`)
            .in('meal_type', LD_MEALS)
            .order('date', { ascending: false })
            .order('id')
            .range(from, to));
      let res = await fetchOrders(true);
      if (res.error) res = await fetchOrders(false);
      if (res.data) {
        const fresh = res.data as unknown as DailyOrder[];
        setOrders(fresh);
        writeSnapshot('ld:orders', fresh);
      }
      setLoadingOrders(false);
    };
    void loadOrders();
  }, []);

  // ── بيانات المستفيدين (لرموز الخيارات) + قاموس النقحرة ────────────────────
  useEffect(() => {
    (async () => {
      // بدون فلترة النوع — أمر التشغيل قد يكون لمرافقين
      const { data } = await fetchStickerBeneficiaries(false);
      setBenMap(new Map(data.map(b => [b.id, b])));
    })();
    supabase.from('custom_transliterations').select('word, transliteration')
      .then(({ data }) => {
        if (!data) return;
        const dict: Record<string, string> = {};
        (data as { word: string; transliteration: string }[])
          .forEach(e => { dict[e.word] = e.transliteration; });
        setCustomDict(dict);
      });
  }, []);

  const loadReport = useCallback(async (orderId: string) => {
    setLoading(true); setError(''); setReport(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/report`);
      const data = await res.json();
      if (!res.ok) setError(data.error || 'حدث خطأ');
      else setReport(data as ReportData);
    } catch {
      setError('حدث خطأ في الاتصال');
    }
    setLoading(false);
  }, []);

  const mealAr = report ? MEAL_TYPE_LABELS[report.order.meal_type] : '';
  const mealEn = report ? MEAL_TYPE_EN[report.order.meal_type] : '';

  // ── بناء صفوف الستيكرات: بيانات المستفيد + تخصيصات هذا الأمر ──────────────
  const rows: StickerRow[] = useMemo(() => {
    if (!report) return [];
    const tr = (name: string, isSnack: boolean) => {
      const out = transliterate(name, customDict);
      if (!out) return '';
      return isSnack ? `${out} (snak)` : out;
    };

    return report.beneficiaryDetails.flatMap(detail => {
      // لقطة التقرير لا تحمل رموز الخيارات (لا يفضل السمك…)، وقد تكون قديمة في
      // الاسم/الفيلا/الملاحظات. فالبيانات الحيّة تفوز، واللقطة تسدّ النقص فقط —
      // بهذا يخرج نفس الشخص بنفس الستيكر في التبويبين.
      const full = benMap.get(detail.beneficiary.id);
      const ben: Beneficiary = full ? { ...detail.beneficiary, ...full } : detail.beneficiary;

      // الفصل بالتصنيف — دالة نقيّة مشتركة، مختبَرة في tests/ld-split.test.ts
      return splitDetailByCategory(detail).map(group => {
        const excluded = group.excluded
          .map(e => ({ ar: e.meal.name, en: tr(e.meal.name, e.meal.is_snack) }));
        const alternatives = [
          ...group.excluded.filter(e => e.alternative?.name?.trim())
            .map(e => ({ ar: e.alternative!.name, en: tr(e.alternative!.name, e.alternative!.is_snack) })),
          ...group.fixed.map(f => ({ ar: f.meal.name, en: tr(f.meal.name, f.meal.is_snack) })),
        ];
        return {
          key: `${ben.id}__${group.category ?? 'none'}`,
          ben,
          custom: { mealAr, mealEn, category: group.category, excluded, alternatives },
          hasCustom: excluded.length > 0 || alternatives.length > 0,
        };
      });
    });
  }, [report, benMap, customDict, mealAr, mealEn]);

  const isColored = useCallback(
    (b: Beneficiary) => !!(b.diet_type?.trim() && dietColors[b.diet_type.trim()]),
    [dietColors],
  );

  const visibleRows = useMemo(
    () => rows
      .filter(r => (onlyWithCustom ? r.hasCustom : true))
      .filter(r => (hideColored ? !isColored(r.ben) : true)),
    [rows, onlyWithCustom, hideColored, isColored],
  );

  const dietTypes = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { const d = r.ben.diet_type?.trim(); if (d) set.add(d); });
    return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
  }, [rows]);

  const withCustomCount = rows.filter(r => r.hasCustom).length;
  // كم ستيكر زاد بسبب الفصل بالتصنيف (مستفيد له حار وبارد = ستيكران)
  const splitExtra = rows.length - (report?.beneficiaryDetails.length ?? 0);

  // ── التصدير ───────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!visibleRows.length) return;
    setExporting(true);
    try {
      // مصفوفة موازية لا خريطة بالـid: المستفيد الواحد قد يكون له عدة ستيكرات
      // (حار/بارد/سناك) فالمفتاح بالـid يدهس بعضه.
      const { exportLunchDinnerStickers } = await import('./ld-word-export');
      await exportLunchDinnerStickers(
        visibleRows.map(r => r.ben), headerUrl, w, h, dietColors,
        visibleRows.map(r => r.custom),
        report ? `ستيكرات-${mealAr}-${report.order.date}.docx` : undefined,
      );
    } catch (e) {
      alert(`تعذّر التصدير: ${e instanceof Error ? e.message : 'خطأ غير معروف'}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    if (!visibleRows.length) return;
    setExportingPdf(true);
    setProgress({ done: 0, total: visibleRows.length });
    try {
      const nodes = visibleRows
        .map(r => nodesRef.current.get(r.key))
        .filter((el): el is HTMLDivElement => !!el);
      if (!nodes.length) { alert('لا توجد ستيكرات للتصدير — انتظر تحميل الصفحة كاملة ثم أعد المحاولة'); return; }
      const { exportLunchDinnerStickersPdf } = await import('./ld-pdf-export');
      const res = await exportLunchDinnerStickersPdf(
        nodes, w, h, (done, total) => setProgress({ done, total }),
        report ? `ستيكرات-${mealAr}-${report.order.date}.pdf` : undefined,
      );
      if (res.failed > 0) alert(`تم التصدير: ${res.captured} ستيكر. تعذّر التقاط ${res.failed}.`);
    } catch (e) {
      alert(`تعذّر تصدير PDF: ${e instanceof Error ? e.message : 'خطأ غير معروف'}`);
    } finally {
      setExportingPdf(false);
      setProgress(null);
    }
  };

  const orderInfo = report ? [
    formatDateFull(report.order.date),
    `${mealAr} ${mealEn}`,
    (report.order.week_number ?? report.order.week_of_month) != null
      ? `أسبوع ${report.order.week_number ?? report.order.week_of_month}` : null,
    report.order.day_of_week != null ? DAY_LABELS[report.order.day_of_week] : null,
  ].filter(Boolean).join('  |  ') : '';

  return (
    <div>
      <div className="no-print mb-5 space-y-4">
        <p className="text-slate-500 text-sm">
          اختر أمر تشغيل الغداء أو العشاء — تطلع ستيكرات ذلك اليوم وفي آخر كل ستيكر محظور المستفيد وبديله.
        </p>

        {/* اختيار أمر التشغيل */}
        <div className="card p-4">
          <LdOrderPicker
            orders={orders}
            value={selectedOrderId}
            loading={loadingOrders}
            onChange={id => {
              setSelectedOrderId(id);
              if (id) void loadReport(id);
              else { setReport(null); setError(''); }
            }}
          />
        </div>

        {report && (
          <>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-700">
                {orderInfo}
                <span className="text-slate-400 font-normal mr-2">
                  — {visibleRows.length} ستيكر ({withCustomCount} فيه تخصيصات
                  {splitExtra > 0 ? `، ${splitExtra} مفصول بالتصنيف` : ''})
                </span>
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors">
                  <input type="checkbox" checked={onlyWithCustom}
                    onChange={e => setOnlyWithCustom(e.target.checked)}
                    className="w-4 h-4 accent-emerald-600 cursor-pointer" />
                  <span className="text-sm text-slate-700 font-medium">من عنده تخصيصات فقط</span>
                </label>
                <button
                  onClick={() => setHideColored(v => !v)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
                    hideColored ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {hideColored ? 'إظهار الكل' : 'إخفاء الملوّنة'}
                </button>
                <HeaderControls settings={settings} />
              </div>
            </div>

            {/* المقاس + التصدير */}
            <div className="card p-4">
              <div className="flex items-end gap-3 flex-wrap">
                <SizeFields w={sizeWidth} h={sizeHeight} setW={setSizeWidth} setH={setSizeHeight} />
                <button onClick={handleExportPdf} disabled={exportingPdf || exporting || !visibleRows.length}
                  className="btn-primary text-sm disabled:opacity-50">
                  {exportingPdf
                    ? (progress ? `جاري التصدير ${progress.done}/${progress.total}...` : 'جاري التصدير...')
                    : `تصدير PDF (${visibleRows.length} ستيكر)`}
                </button>
                <button onClick={handleExport} disabled={exporting || exportingPdf || !visibleRows.length}
                  className="btn-secondary text-sm disabled:opacity-50">
                  {exporting ? 'جاري التصدير...' : 'تصدير Word'}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-3">
                💡 كل ستيكر في صفحة منفصلة بمقاس {sizeWidth || '—'}×{sizeHeight || '—'} سم بالضبط. المعاينة بالأسفل بنفس المقاس.
              </p>
            </div>

            <DietColorsPanel dietTypes={dietTypes} settings={settings} />
          </>
        )}
      </div>

      {error && (
        <div className="no-print bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">جاري التحميل...</div>
      ) : !selectedOrderId ? (
        <div className="py-16 text-center text-slate-400 text-sm no-print">اختر أمر تشغيل لعرض ستيكرات اليوم.</div>
      ) : report && visibleRows.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          {onlyWithCustom ? 'لا يوجد مستفيدون بتخصيصات في هذا الأمر.' : 'لا توجد ستيكرات للعرض.'}
        </div>
      ) : (
        <div className="flex flex-wrap gap-4 justify-center md:justify-start">
          {visibleRows.map(({ key, ben, custom }) => (
            <StickerCard key={key} ben={ben} headerUrl={headerUrl} widthCm={w} heightCm={h}
              bgColor={ben.diet_type?.trim() ? dietColors[ben.diet_type.trim()] : undefined}
              custom={custom}
              innerRef={el => setNode(key, el)} />
          ))}
        </div>
      )}
    </div>
  );
}
