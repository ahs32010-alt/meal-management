'use client';

import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase-client';
import type { Beneficiary } from '@/lib/types';
import { STICKER_FLAGS } from '@/lib/sticker-flags';
// `./ld-word-export` pulls in the docx package (~140KB). Loaded lazily on demand.

const HEADER_KEY = 'ldStickerHeaderUrl';
const DIET_COLORS_KEY = 'ldDietColors';

// ── لوحة ألوان بنمط Microsoft Word ──────────────────────────────────────────
function hexToRgb(h: string): [number, number, number] {
  const x = h.replace('#', '');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}
function toHex2(n: number) { return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'); }
function mixColor(hex: string, target: string, amt: number) {
  const a = hexToRgb(hex), b = hexToRgb(target);
  return '#' + [0, 1, 2].map(i => toHex2(a[i] + (b[i] - a[i]) * amt)).join('');
}
// تدرّج عمودي لكل لون: من الفاتح (أعلى) إلى الغامق (أسفل)
function colorRamp(base: string): string[] {
  return [
    mixColor(base, '#ffffff', 0.8),
    mixColor(base, '#ffffff', 0.6),
    mixColor(base, '#ffffff', 0.35),
    base,
    mixColor(base, '#000000', 0.3),
    mixColor(base, '#000000', 0.55),
  ];
}
// صف الألوان القياسية (زي شريط Word)
const STANDARD_COLORS = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
// أعمدة التدرّجات — كل عمود لون أساسي بدرجاته
const RAMP_BASES = ['#808080', '#C0504D', '#F79646', '#FFC000', '#9BBB59', '#4BACC6', '#4F81BD', '#1F497D', '#8064A2', '#D63384'];
const RAMP_COLUMNS = RAMP_BASES.map(colorRamp);

function ColorSwatch({ color, selected, onPick }: { color: string; selected?: string; onPick: (c: string) => void }) {
  const sel = !!selected && selected.toLowerCase() === color.toLowerCase();
  return (
    <button
      type="button"
      onClick={() => onPick(color)}
      title={color}
      className="rounded-[4px] transition-transform hover:scale-125"
      style={{ width: 18, height: 18, background: color, outline: sel ? '2px solid #0f172a' : '1px solid rgba(0,0,0,0.12)', outlineOffset: sel ? '1px' : '0' }}
    />
  );
}

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
  const [openColorFor, setOpenColorFor] = useState<string | null>(null);
  const [colorsOpen, setColorsOpen] = useState(false);

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
    // تحديث فوري + كاش محلي
    setDietColors(prev => {
      const next = { ...prev };
      if (color) next[diet] = color; else delete next[diet];
      try { localStorage.setItem(DIET_COLORS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    // حفظ دائم في قاعدة البيانات
    (async () => {
      try {
        if (color) {
          await supabase.from('lunch_dinner_diet_colors').upsert({ diet_type: diet, color }, { onConflict: 'diet_type' });
        } else {
          await supabase.from('lunch_dinner_diet_colors').delete().eq('diet_type', diet);
        }
      } catch { /* الكاش المحلي يحفظ الحالة لو فشل الاتصال */ }
    })();
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
    // كاش محلي فوري
    try {
      const saved = localStorage.getItem(HEADER_KEY);
      if (saved) setHeaderUrl(saved);
      const colors = localStorage.getItem(DIET_COLORS_KEY);
      if (colors) setDietColors(JSON.parse(colors) as Record<string, string>);
    } catch {}
    // المصدر الرئيسي: قاعدة البيانات (لو الجدول موجود)
    (async () => {
      const { data, error } = await supabase.from('lunch_dinner_diet_colors').select('diet_type, color');
      if (!error && data) {
        const map: Record<string, string> = {};
        for (const row of data as { diet_type: string; color: string }[]) map[row.diet_type] = row.color;
        setDietColors(map);
        try { localStorage.setItem(DIET_COLORS_KEY, JSON.stringify(map)); } catch {}
      }
    })();
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

        {/* ألوان الأنظمة الغذائية — قسم قابل للطيّ */}
        {dietTypes.length > 0 && (
          <div className="card overflow-hidden max-w-xl">
            <button
              type="button"
              onClick={() => setColorsOpen(v => !v)}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">
                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343" />
                </svg>
                ألوان الأنظمة الغذائية
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">{colorsOpen ? 'تُحفظ تلقائياً' : `${dietTypes.length} نظام`}</span>
                <svg className={`w-4 h-4 text-slate-400 transition-transform ${colorsOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </span>
            </button>

            {colorsOpen && (
              <div className="px-4 pb-3 border-t border-slate-100 divide-y divide-slate-100">
                {dietTypes.map(diet => {
                  const selected = dietColors[diet];
                  const open = openColorFor === diet;
                  return (
                    <div key={diet} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="flex items-center gap-2.5 font-medium text-sm text-slate-700 min-w-0">
                        <span className="w-3 h-3 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: selected || '#e5e7eb' }} />
                        <span className="truncate" title={diet}>{diet}</span>
                      </span>
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => setOpenColorFor(open ? null : diet)}
                          className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-600 transition-colors"
                        >
                          <span
                            className="w-4 h-4 rounded shrink-0"
                            style={selected
                              ? { background: selected, boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }
                              : { border: '1.5px dashed #cbd5e1' }}
                          />
                          <span>{selected ? 'اللون' : 'بدون لون'}</span>
                          <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                        {open && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenColorFor(null)} />
                            <div className="absolute z-20 left-0 mt-2 p-3 bg-white rounded-2xl shadow-xl border border-slate-100" style={{ width: 'max-content' }}>
                              <div className="text-[10px] font-semibold text-slate-400 mb-1">ألوان قياسية</div>
                              <div className="flex gap-1 mb-3">
                                {STANDARD_COLORS.map(c => (
                                  <ColorSwatch key={c} color={c} selected={selected} onPick={(col) => { setDietColor(diet, col); setOpenColorFor(null); }} />
                                ))}
                              </div>
                              <div className="text-[10px] font-semibold text-slate-400 mb-1">تدرّجات</div>
                              <div className="flex gap-1">
                                {RAMP_COLUMNS.map((col, ci) => (
                                  <div key={ci} className="flex flex-col gap-1">
                                    {col.map(c => (
                                      <ColorSwatch key={c} color={c} selected={selected} onPick={(picked) => { setDietColor(diet, picked); setOpenColorFor(null); }} />
                                    ))}
                                  </div>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => { setDietColor(diet, null); setOpenColorFor(null); }}
                                className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                بدون لون
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
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
