'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase-client';
import type { Beneficiary } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
// `./ld-word-export` pulls in the docx package (~140KB). Loaded lazily on demand.

const HEADER_KEY = 'ldStickerHeaderUrl';
const DIET_COLORS_KEY = 'ldDietColors';

// لوحة ألوان واضحة وفاتحة (النص الأسود يبقى مقروءاً فوقها)
const COLOR_PALETTE = [
  '#fecaca', // أحمر فاتح
  '#fed7aa', // برتقالي فاتح
  '#fef08a', // أصفر
  '#bbf7d0', // أخضر فاتح
  '#a5f3fc', // سماوي
  '#bfdbfe', // أزرق فاتح
  '#ddd6fe', // بنفسجي فاتح
  '#fbcfe8', // وردي
  '#e2e8f0', // رمادي فاتح
];

// ترجمة إنجليزية لأنواع الأنظمة الغذائية الشائعة — تُعرض كسطر ثانٍ تحت العربي.
const DIET_TYPE_EN: Record<string, string> = {
  'عادي': 'Normal diet',
  'نظام غذائي عادي': 'Normal diet',
  'سكري': 'Diabetic diet',
  'سكر': 'Diabetic diet',
  'لين': 'Soft diet',
  'مهروس': 'Pureed diet',
  'سائل': 'Liquid diet',
  'قليل الملح': 'Low salt diet',
  'قليل الدهون': 'Low fat diet',
  'كلوي': 'Renal diet',
  'نباتي': 'Vegetarian diet',
};

function dietLines(diet?: string): { ar: string; en: string } {
  const ar = (diet ?? '').trim() || 'نظام غذائي عادي';
  return { ar, en: DIET_TYPE_EN[ar] ?? '' };
}

// ── نص يتكيّف تلقائياً ليبقى في سطر واحد داخل عرض الحاوية (يتصغّر/يتكبّر) ──────
function AutoFitText({
  text, maxPx, minPx = 6, bold, underline, dir, color, className,
}: {
  text: string; maxPx: number; minPx?: number; bold?: boolean;
  underline?: boolean; dir?: 'rtl' | 'ltr'; color?: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = maxPx;
      el.style.fontSize = `${size}px`;
      // يتصغّر تدريجياً لين النص يدخل في سطر واحد ضمن عرض الحاوية
      let guard = 200;
      while (size > minPx && el.scrollWidth > el.clientWidth && guard-- > 0) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, maxPx, minPx]);

  return (
    <div
      ref={ref}
      dir={dir}
      className={className}
      style={{
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        width: '100%',
        fontWeight: bold ? 700 : 400,
        textDecoration: underline ? 'underline' : undefined,
        color,
        lineHeight: 1.15,
      }}
    >
      {text}
    </div>
  );
}

// ── الهيدر الافتراضي (لو ما رُفعت صورة هيدر مخصّصة) ──────────────────────────
function DefaultHeader({ s }: { s: number }) {
  return (
    <div className="relative flex items-center justify-center w-full" style={{ paddingBlock: 4 * s }}>
      <div className="text-center leading-tight px-1 min-w-0">
        <AutoFitText text="خدمات الطعام" maxPx={20 * s} bold dir="rtl" color="#047857" />
        <AutoFitText text="Food Services" maxPx={15 * s} bold dir="ltr" color="#047857" />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-hope.png"
        alt="خطوة أمل"
        className="absolute object-contain"
        style={{ right: 4 * s, top: 2 * s, height: 40 * s, width: 'auto' }}
      />
    </div>
  );
}

// ── ستيكر واحد بمقاس ثابت (widthCm × heightCm) ───────────────────────────────
function StickerCard({ ben, headerUrl, widthCm, heightCm, bgColor, innerRef }: {
  ben: Beneficiary; headerUrl: string | null; widthCm: number; heightCm: number;
  bgColor?: string; innerRef?: (el: HTMLDivElement | null) => void;
}) {
  const diet = dietLines(ben.diet_type);
  const s = Math.min(widthCm, heightCm) / 10; // معامل تحجيم نسبةً لـ10سم
  const pad = 8 * s;
  const flags = STICKER_FLAGS.filter(f => ben[f.key]);

  return (
    <div
      ref={innerRef}
      data-ld-sticker
      className="ld-sticker border border-black flex flex-col overflow-hidden shrink-0"
      style={{ width: `${widthCm}cm`, height: `${heightCm}cm`, background: bgColor || '#ffffff' }}
    >
      {/* الهيدر */}
      <div
        className="shrink-0 border-b border-black/70 flex items-center justify-center w-full overflow-hidden"
        style={{ maxHeight: `${heightCm * 0.27}cm` }}
      >
        {headerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={headerUrl} alt="هيدر" className="w-full h-full object-contain" />
        ) : (
          <DefaultHeader s={s} />
        )}
      </div>

      {/* الجسم */}
      <div className="flex-1 min-h-0 flex flex-col" style={{ padding: pad, gap: 6 * s }}>
        {/* النظام الغذائي (وسط، سطر واحد، عربي فوق/إنجليزي تحت) */}
        <div className="shrink-0 text-center">
          <AutoFitText text={diet.ar} maxPx={16 * s} bold underline dir="rtl" />
          {diet.en && <AutoFitText text={diet.en} maxPx={13 * s} bold underline dir="ltr" />}
        </div>

        {/* صف: Code/Villa (يسار) + رموز الخيارات المؤشّرة (يمين).
            الصفحة RTL فأول عنصر يروح يمين — نضع الرموز أولاً (يمين) وCode/Villa أخيراً (يسار). */}
        <div className="flex items-start justify-between shrink-0" style={{ gap: 6 * s, marginTop: 4 * s }}>
          {flags.length > 0 ? (
            <div dir="rtl" className="text-right leading-tight" style={{ fontSize: 10 * s }}>
              {flags.map(f => (
                <div key={f.key} className="font-semibold whitespace-nowrap">
                  <span style={{ fontSize: 13 * s }}>{f.symbol}</span> {f.label}
                </div>
              ))}
            </div>
          ) : <span />}
          <div dir="ltr" className="text-left font-bold leading-tight whitespace-nowrap shrink-0" style={{ fontSize: 12 * s }}>
            <div>Code No.:{ben.code}</div>
            {ben.villa && <div>Villa No.:{ben.villa}</div>}
          </div>
        </div>

        {/* صندوق الاسم — حدّ مزدوج. يأخذ المساحة المتبقية ويتقلّص لصالح الملاحظات الطويلة */}
        <div className="flex-1 min-h-0 overflow-hidden flex items-center">
          <div className="w-full border-2 border-black" style={{ padding: 3 * s }}>
            <div className="border border-black text-center" style={{ paddingInline: 8 * s, paddingBlock: 8 * s }}>
              <AutoFitText text={ben.name} maxPx={22 * s} bold dir="rtl" />
              {ben.english_name && (
                <div style={{ marginTop: 3 * s }}>
                  <AutoFitText text={ben.english_name} maxPx={14 * s} bold dir="ltr" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* فاصل سميك */}
        <div className="border-t-[3px] border-black shrink-0" />

        {/* الحساسيات */}
        <div className="flex items-center justify-between shrink-0 font-bold" style={{ fontSize: 14 * s }}>
          <span dir="ltr">Food Allergy:</span>
          <span>حساسيات وموانع:</span>
        </div>

        {/* الملاحظات */}
        <div className="text-center shrink-0">
          <span className="underline font-bold" style={{ fontSize: 13 * s }}>Notes - الملاحظات</span>
        </div>
        {ben.notes && (
          <div className="text-center text-slate-700 shrink-0 whitespace-pre-wrap break-words" style={{ fontSize: 11 * s }}>
            {ben.notes}
          </div>
        )}
      </div>
    </div>
  );
}

const PRESETS = [
  { w: '10', h: '10' },
  { w: '10', h: '15' },
  { w: '8', h: '5' },
  { w: '6', h: '4' },
];

export default function LunchDinnerStickersView() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [headerUrl, setHeaderUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sizeWidth, setSizeWidth] = useState('10');
  const [sizeHeight, setSizeHeight] = useState('10');
  const [dietColors, setDietColors] = useState<Record<string, string>>({});
  const [hideColored, setHideColored] = useState(false);

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

  const setDietColor = (diet: string, color: string | null) => {
    setDietColors(prev => {
      const next = { ...prev };
      if (color) next[diet] = color; else delete next[diet];
      try { localStorage.setItem(DIET_COLORS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // هل الستيكر ملوّن (نظامه الغذائي له لون)؟
  const isColored = (b: Beneficiary) => !!(b.diet_type?.trim() && dietColors[b.diet_type.trim()]);
  // القائمة المرئية للعرض والتصدير — عند تفعيل الإخفاء نستبعد الملوّنة
  const visibleBeneficiaries = useMemo(
    () => (hideColored ? beneficiaries.filter(b => !isColored(b)) : beneficiaries),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [beneficiaries, hideColored, dietColors],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(HEADER_KEY);
      if (saved) setHeaderUrl(saved);
      const colors = localStorage.getItem(DIET_COLORS_KEY);
      if (colors) setDietColors(JSON.parse(colors) as Record<string, string>);
    } catch {}
  }, []);

  const fetchBeneficiaries = useCallback(async () => {
    setLoading(true);
    setError('');
    const cols = 'id, name, english_name, code, category, villa, diet_type, notes, created_at';
    const flagCols = 'no_fish, no_pasta_sandwich, low_carb';

    const attempt = (select: string, useEntity: boolean) => {
      const q = supabase.from('beneficiaries').select(select);
      return (useEntity ? q.eq('entity_type', 'beneficiary') : q).order('name');
    };

    // تدرّج: مع الأعمدة الجديدة → بدونها (الـmigration ما اشتغل) → بدون entity_type
    let res = await attempt(`${cols}, ${flagCols}, entity_type`, true);
    if (res.error) res = await attempt(`${cols}, entity_type`, true);
    if (res.error) res = await attempt(cols, false);

    const data = res.data;
    const errMsg = res.error?.message ?? null;

    if (errMsg) {
      setError(errMsg);
      setBeneficiaries([]);
    } else {
      setBeneficiaries((data ?? []) as unknown as Beneficiary[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchBeneficiaries(); }, [fetchBeneficiaries]);

  const uploadHeader = async (file: File) => {
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() ?? 'png').toLowerCase();
      const path = `branding/ld-sticker-header-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('signatures')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) { alert(`تعذّر رفع الهيدر: ${upErr.message}`); return; }
      const { data: pub } = supabase.storage.from('signatures').getPublicUrl(path);
      setHeaderUrl(pub.publicUrl);
      try { localStorage.setItem(HEADER_KEY, pub.publicUrl); } catch {}
    } finally {
      setUploading(false);
    }
  };

  const removeHeader = () => {
    setHeaderUrl(null);
    try { localStorage.removeItem(HEADER_KEY); } catch {}
  };

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
    <div className="p-4 md:p-6">
      {/* شريط الإعدادات — لا يظهر في الطباعة */}
      <div className="no-print mb-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">ستيكرات الغداء والعشاء</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              ستيكر ثابت لكل مستفيد — {visibleBeneficiaries.length}
              {hideColored && beneficiaries.length !== visibleBeneficiaries.length
                ? ` ظاهر (مخفي ${beneficiaries.length - visibleBeneficiaries.length} ملوّن)`
                : ' مستفيد'}
            </p>
          </div>
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
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-sm font-semibold">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              {uploading ? 'جاري الرفع...' : (headerUrl ? 'استبدال الهيدر' : 'رفع صورة الهيدر')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) void uploadHeader(f); }}
              />
            </label>
            {headerUrl && (
              <button onClick={removeHeader} className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg font-medium">
                إزالة الهيدر
              </button>
            )}
          </div>
        </div>

        {/* اختيار المقاس + تصدير */}
        <div className="card p-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="label text-xs">العرض (سم)</label>
              <input type="number" min={2} max={30} step="0.1" value={sizeWidth}
                onChange={e => setSizeWidth(e.target.value)} className="input-field w-24" placeholder="10" />
            </div>
            <div>
              <label className="label text-xs">الطول (سم)</label>
              <input type="number" min={2} max={30} step="0.1" value={sizeHeight}
                onChange={e => setSizeHeight(e.target.value)} className="input-field w-24" placeholder="10" />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              {PRESETS.map(p => (
                <button key={`${p.w}x${p.h}`} type="button"
                  onClick={() => { setSizeWidth(p.w); setSizeHeight(p.h); }}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                  {p.w}×{p.h}
                </button>
              ))}
            </div>
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

      {/* ألوان الأنظمة الغذائية — أسفل الصفحة، تلوين الستيكرات حسب النظام */}
      {dietTypes.length > 0 && (
        <div className="no-print card p-4 mt-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800 text-sm">ألوان الأنظمة الغذائية</h3>
            <p className="text-xs text-slate-500">اختر لوناً لكل نظام — تتلوّن ستيكراته تلقائياً</p>
          </div>
          <div className="space-y-2.5">
            {dietTypes.map(diet => {
              const selected = dietColors[diet];
              return (
                <div key={diet} className="flex items-center gap-3 flex-wrap">
                  <span className="font-medium text-sm text-slate-700 w-44 truncate" title={diet}>{diet}</span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {COLOR_PALETTE.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setDietColor(diet, c)}
                        title="اختر هذا اللون"
                        className={`w-7 h-7 rounded-lg border transition-transform hover:scale-110 ${
                          selected === c ? 'ring-2 ring-offset-1 ring-slate-700 border-slate-700' : 'border-slate-300'
                        }`}
                        style={{ background: c }}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => setDietColor(diet, null)}
                      title="بدون لون"
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50 ${
                        !selected ? 'ring-2 ring-offset-1 ring-slate-700 border-slate-700' : 'border-slate-300'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
