'use client';

/**
 * لوحة «تصميم الستيكر»: تختار وش يظهر وحجم خط كل عنصر، وتشوف معاينة بالمقاس
 * الحقيقي (سم) محسوبة بنفس دالة تصدير Word (`resolvePageLayout`) — فاللي تشوفه
 * هو اللي يطلع في الملف.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CATEGORY_LABELS, DAY_LABELS } from '@/lib/types';
import { APP_FONT_STACK } from '@/lib/fonts';
import { GROUP_COLORS, CATEGORY_THEME } from './sticker-utils';
import {
  STICKER_FIELDS, DEFAULT_LAYOUT, PARA_SPACING, MIN_PT, MAX_PT,
  normalizeLayout, prepareSticker, resolvePageLayout, manualFromAuto,
  type StickerLayout, type StickerDetail, type StickerData, type PageLayout, type FieldMap,
} from './sticker-layout';

const GROUP_HEADER_BG: Record<number, string> = { 0: '1E293B', 1: '7C3AED', 2: 'F43F5E', 3: 'F59E0B', 4: '059669' };

// ── حفظ الإعداد على هذا الجهاز ──────────────────────────────────────────────
export function useStickerLayout(storageKey: string) {
  const [layout, setLayoutState] = useState<StickerLayout>(DEFAULT_LAYOUT);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setLayoutState(normalizeLayout(JSON.parse(raw)));
    } catch {}
  }, [storageKey]);
  const setLayout = (next: StickerLayout) => {
    setLayoutState(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
  };
  return [layout, setLayout] as const;
}

const round5 = (n: number) => Math.round(n * 2) / 2;
const clampPt = (n: number) => Math.min(MAX_PT, Math.max(MIN_PT, round5(n)));

// ── صفحة ستيكر واحدة بالمقاس الحقيقي — نسخة HTML من فقرات Word ────────────
function StickerPage({ s, page, layout, widthCm, heightCm, mealTypeAr, mealTypeEn, orderLine, onOverflow }: {
  s: StickerData; page: PageLayout; layout: StickerLayout; widthCm: number; heightCm: number;
  mealTypeAr: string; mealTypeEn: string; orderLine: string | null;
  onOverflow: (v: boolean) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const { show } = layout;
  const S = page.sizes;
  const pt = (n: number) => `${n}pt`;
  // twip → pt
  const gap = (k: keyof typeof PARA_SPACING) => ({
    marginTop: pt((PARA_SPACING[k][0] * page.spacingScale) / 20),
    marginBottom: pt((PARA_SPACING[k][1] * page.spacingScale) / 20),
  });
  const para = { lineHeight: 1.2, textAlign: 'center' as const, overflowWrap: 'anywhere' as const };

  useLayoutEffect(() => {
    const box = boxRef.current, content = contentRef.current;
    if (!box || !content) return;
    const check = () => onOverflow(content.offsetHeight > box.clientHeight + 1);
    check();
    let alive = true;
    void document.fonts?.ready.then(() => { if (alive) check(); });
    return () => { alive = false; };
  });

  const gc = GROUP_COLORS[s.groupIndex] ?? GROUP_COLORS[0];
  const ct = s.category ? CATEGORY_THEME[s.category] : null;
  const titleText = [
    `${mealTypeAr} ${mealTypeEn}`,
    ct ? `${ct.icon} ${CATEGORY_LABELS[s.category!]}` : '',
    s.groupIndex > 0 ? `★ ${gc.label}` : '',
  ].filter(Boolean).join(' ');
  const showVilla = show.villa && !!s.ben.villa;

  return (
    <div
      ref={boxRef}
      className="bg-white text-black shadow-md ring-1 ring-slate-300 flex flex-col justify-center overflow-hidden"
      style={{ width: `${widthCm}cm`, height: `${heightCm}cm`, padding: `${page.marginMm}mm`, fontFamily: APP_FONT_STACK }}
    >
      <div ref={contentRef}>
        {show.orderInfo && orderLine && (
          <div dir="rtl" style={{ ...para, ...gap('orderInfo'), fontSize: pt(S.orderInfo), color: '#64748B', background: '#F8FAFC' }}>{orderLine}</div>
        )}
        {show.title && (
          <div dir="rtl" style={{ ...para, ...gap('title'), fontSize: pt(S.title), fontWeight: 700, color: '#fff', background: `#${ct ? ct.hex : GROUP_HEADER_BG[s.groupIndex] ?? '1E293B'}` }}>{titleText}</div>
        )}
        {(show.code || showVilla) && (
          <div dir="rtl" style={{ ...para, ...gap('codeVilla'), fontWeight: 700, color: '#DC2626' }}>
            {show.code && <span style={{ fontSize: pt(S.code) }}>Code: {s.ben.code}</span>}
            {show.code && showVilla && <span style={{ fontSize: pt(S.villa) }}>{'   '}</span>}
            {showVilla && <span style={{ fontSize: pt(S.villa) }}>Villa: {s.ben.villa}</span>}
          </div>
        )}
        {show.nameAr && (
          <div dir="rtl" style={{ ...para, ...gap('nameAr'), fontSize: pt(S.nameAr), fontWeight: 700, color: '#0F172A' }}>{s.ben.name}</div>
        )}
        {show.nameEn && s.ben.english_name && (
          <div dir="ltr" style={{ ...para, ...gap('nameEn'), fontSize: pt(S.nameEn), fontWeight: 700, color: '#374151' }}>{s.ben.english_name}</div>
        )}
        {show.excluded && s.excludedNames && (
          <div dir="rtl" style={{ ...para, ...gap('excluded'), fontSize: pt(S.excluded), color: '#0F172A' }}>
            <b style={{ color: '#B91C1C' }}>مستبعد: </b>{s.excludedNames}
          </div>
        )}
        {show.alt && s.altNames && (
          <div dir="rtl" style={{ ...para, ...gap('alt'), fontSize: pt(S.alt), color: '#0F172A' }}>
            <b style={{ color: '#15803D' }}>بديل: </b>{s.altNames}
          </div>
        )}
        {show.noEn && s.excludedTranslit && (
          <div dir="ltr" style={{ ...para, ...gap('noEn'), textAlign: 'left', fontSize: pt(S.noEn), fontWeight: 700, color: '#DC2626', background: '#FFF1F2' }}>
            {' '}NO: {s.excludedTranslit}
          </div>
        )}
        {show.yesEn && s.altTranslit && (
          <div dir="ltr" style={{ ...para, ...gap('yesEn'), textAlign: 'left', fontSize: pt(S.yesEn), fontWeight: 700, color: '#1D4ED8', background: '#EFF6FF' }}>
            {' '}YES: {s.altTranslit}
          </div>
        )}
        {show.fixed && s.fixedItems && (
          <div dir="rtl" style={{ ...para, ...gap('fixed'), fontSize: pt(S.fixed), color: '#475569', borderTop: '1px dashed #CBD5E1' }}>
            <b>إضافات: </b>{s.fixedItems}
          </div>
        )}
      </div>
    </div>
  );
}

// ── اللوحة ───────────────────────────────────────────────────────────────────
export default function StickerLayoutPanel({
  layout, onChange, details, widthCm, heightCm, mealTypeAr, mealTypeEn, customDict,
  orderDate, weekNumber, dayOfWeek,
}: {
  layout: StickerLayout;
  onChange: (l: StickerLayout) => void;
  details: StickerDetail[];
  widthCm: number;
  heightCm: number;
  mealTypeAr: string;
  mealTypeEn: string;
  customDict: Record<string, string>;
  orderDate?: string;
  weekNumber?: number | null;
  dayOfWeek?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(1.5);
  const [overflow, setOverflow] = useState(false);

  const i = Math.min(idx, Math.max(0, details.length - 1));
  const detail = details[i];
  const data = useMemo(
    () => (detail ? prepareSticker(detail, detail.groupIndex, detail.category, customDict) : null),
    [detail, customDict],
  );
  const ctx = { hasOrderInfo: !!orderDate, mealTypeAr, mealTypeEn };
  const page = data ? resolvePageLayout(data, layout, widthCm, heightCm, ctx) : null;
  const orderLine = orderDate
    ? [
        `${orderDate.slice(8, 10)}/${orderDate.slice(5, 7)}/${orderDate.slice(0, 4)}`,
        mealTypeAr,
        weekNumber != null ? `أسبوع ${weekNumber}` : null,
        dayOfWeek != null ? DAY_LABELS[dayOfWeek] : null,
      ].filter(Boolean).join(' | ')
    : null;

  const manual = layout.mode === 'manual';
  const set = (patch: Partial<StickerLayout>) => onChange({ ...layout, ...patch });
  const setShow = (k: keyof FieldMap<boolean>, v: boolean) => set({ show: { ...layout.show, [k]: v } });
  const setSize = (k: keyof FieldMap<number>, v: number) => set({ sizes: { ...layout.sizes, [k]: clampPt(v) } });
  const scaleAll = (f: number) =>
    set({ sizes: Object.fromEntries(Object.entries(layout.sizes).map(([k, v]) => [k, clampPt(v * f)])) as FieldMap<number> });
  const goManual = () => set({ mode: 'manual', ...manualFromAuto(widthCm, heightCm) });
  const shownCount = STICKER_FIELDS.filter(f => layout.show[f.key]).length;

  return (
    <div className="mt-4 border border-slate-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition-colors ${open ? 'rounded-t-xl' : 'rounded-xl'}`}
      >
        <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">
          <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h7" />
          </svg>
          تصميم الستيكر — وش يظهر وحجم الخط
        </span>
        <span className="flex items-center gap-2 text-[11px] text-slate-400">
          {manual ? 'يدوي' : 'تلقائي'} · {shownCount} من {STICKER_FIELDS.length} ظاهر
          <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* ── التحكم ── */}
          <div className="space-y-3 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-600">حجم الخط:</span>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100">
                <button type="button" onClick={() => set({ mode: 'auto' })}
                  className={`px-3 py-1 rounded-md text-xs font-semibold ${!manual ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600'}`}>
                  تلقائي
                </button>
                <button type="button" onClick={() => { if (!manual) goManual(); }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold ${manual ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600'}`}>
                  يدوي (أنا أحدد)
                </button>
              </div>
              <button type="button" onClick={() => onChange(DEFAULT_LAYOUT)}
                className="text-[11px] text-slate-400 hover:text-slate-700 underline mr-auto">
                رجّع الافتراضي
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              {manual
                ? 'كل عنصر بالحجم اللي تحطه بالنقطة (pt) بالضبط مهما كان المقاس. لو النص ما دخل يبان تنبيه أحمر على المعاينة.'
                : 'الخط يتصغّر تلقائياً لين يدخل كل شي — في المقاسات الصغيرة يطلع صغير. أخفِ العناصر اللي ما تحتاجها فيكبر الباقي، أو حوّل لـ«يدوي».'}
            </p>

            {manual && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-600">الكل:</span>
                <button type="button" onClick={() => scaleAll(0.9)} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">A− صغّر</button>
                <button type="button" onClick={() => scaleAll(1.1)} className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold">A+ كبّر</button>
                <button type="button" onClick={goManual} className="px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100" title="يرجّع الأحجام لما يناسب المقاس الحالي">
                  أحجام مناسبة لـ{widthCm}×{heightCm}
                </button>
              </div>
            )}

            <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {STICKER_FIELDS.map(f => {
                const shown = layout.show[f.key];
                const effective = page ? Math.round(page.sizes[f.key] * 10) / 10 : null;
                return (
                  <div key={f.key} className={`flex items-center gap-2 px-2 py-1.5 ${shown ? '' : 'bg-slate-50'}`}>
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer select-none">
                      <input type="checkbox" checked={shown} onChange={e => setShow(f.key, e.target.checked)}
                        className="w-4 h-4 accent-emerald-600 cursor-pointer shrink-0" />
                      <span className={`text-sm truncate ${shown ? 'text-slate-700 font-medium' : 'text-slate-400 line-through'}`}>{f.label}</span>
                    </label>
                    {manual ? (
                      <span className="flex items-center gap-0.5 shrink-0">
                        <button type="button" disabled={!shown} onClick={() => setSize(f.key, layout.sizes[f.key] - 0.5)}
                          className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-sm font-bold disabled:opacity-30">−</button>
                        <input type="number" min={MIN_PT} max={MAX_PT} step={0.5} disabled={!shown}
                          value={layout.sizes[f.key]}
                          onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) setSize(f.key, v); }}
                          className="w-14 text-center text-sm border border-slate-200 rounded py-0.5 disabled:opacity-30" />
                        <button type="button" disabled={!shown} onClick={() => setSize(f.key, layout.sizes[f.key] + 0.5)}
                          className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-sm font-bold disabled:opacity-30">+</button>
                        <span className="text-[10px] text-slate-400 w-5">pt</span>
                      </span>
                    ) : (
                      shown && effective != null && <span className="text-[11px] text-slate-400 shrink-0">{effective}pt</span>
                    )}
                  </div>
                );
              })}
            </div>

            {manual && (
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <label className="label text-xs">الهامش (مم)</label>
                  <input type="number" min={0} max={15} step={0.5} value={layout.marginMm}
                    onChange={e => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) set({ marginMm: Math.min(15, Math.max(0, v)) }); }}
                    className="input-field w-20" />
                </div>
                <div>
                  <label className="label text-xs">المسافة بين الأسطر</label>
                  <input type="range" min={0} max={3} step={0.1} value={layout.spacing}
                    onChange={e => set({ spacing: parseFloat(e.target.value) })} className="w-32 accent-violet-600" />
                  <span className="text-xs text-slate-500 mr-1">×{layout.spacing.toFixed(1)}</span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
                  <input type="checkbox" checked={layout.shrinkToFit} onChange={e => set({ shrinkToFit: e.target.checked })}
                    className="w-4 h-4 accent-violet-600 cursor-pointer" />
                  <span className="text-xs text-slate-700">صغّر تلقائياً لو فاض النص</span>
                </label>
              </div>
            )}
          </div>

          {/* ── المعاينة ── */}
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-600">معاينة {widthCm}×{heightCm} سم</span>
              <div className="flex items-center gap-1">
                {[1, 1.5, 2].map(z => (
                  <button key={z} type="button" onClick={() => setZoom(z)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold ${zoom === z ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    ×{z}
                  </button>
                ))}
              </div>
            </div>
            {details.length > 1 && (
              <div className="flex items-center gap-2 mb-2 text-xs">
                <button type="button" onClick={() => setIdx(Math.max(0, i - 1))} disabled={i === 0}
                  className="px-2 py-1 rounded bg-slate-100 disabled:opacity-30">→ السابق</button>
                <span className="text-slate-500 flex-1 text-center truncate">{i + 1} / {details.length} — {detail?.beneficiary.name}</span>
                <button type="button" onClick={() => setIdx(Math.min(details.length - 1, i + 1))} disabled={i >= details.length - 1}
                  className="px-2 py-1 rounded bg-slate-100 disabled:opacity-30">التالي ←</button>
              </div>
            )}
            {data && page ? (
              <>
                <div className="overflow-auto rounded-lg bg-slate-100 p-4">
                  {/* حاوية بأبعاد المعاينة المكبّرة — transform ما يغيّر مساحة العنصر */}
                  <div className="mx-auto" style={{ width: `${widthCm * zoom}cm`, height: `${heightCm * zoom}cm` }}>
                    <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${widthCm}cm` }} dir="ltr">
                      <StickerPage s={data} page={page} layout={layout} widthCm={widthCm} heightCm={heightCm}
                        mealTypeAr={mealTypeAr} mealTypeEn={mealTypeEn} orderLine={orderLine} onOverflow={setOverflow} />
                    </div>
                  </div>
                </div>
                {overflow && (
                  <p className="mt-2 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    ⚠ النص أطول من الستيكر — بيطلع على أكثر من صفحة في Word. صغّر بعض الأحجام، أخفِ عناصر، أو فعّل «صغّر تلقائياً لو فاض».
                  </p>
                )}
                <p className="mt-2 text-[11px] text-slate-400">
                  المعاينة تقريبية للخط في Word (نفس الأحجام والهوامش). الإعداد محفوظ على هذا الجهاز ويُطبّق على التصدير.
                </p>
              </>
            ) : (
              <div className="text-xs text-slate-400 py-8 text-center">لا يوجد ستيكر للمعاينة</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
