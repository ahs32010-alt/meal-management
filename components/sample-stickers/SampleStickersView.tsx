'use client';

/**
 * صفحة «ستيكرات العينات» — ستيكر لكل صنف من أمر التشغيل (الرئيسية + السناكات،
 * بلا البدائل) فيه: العنوان (عينة SAMPLE)، الوجبة، الفئة (مستفيدين/مرافقين)،
 * اسم الصنف عربي وإنجليزي، وتاريخ الانتهاء (تاريخ الأمر + مدة الصلاحية).
 *
 * قراءة فقط — لا تكتب في أي جدول، ولا تمسّ صفحات الستيكرات الأخرى. تستخدم
 * نفس أدواتها: اختيار الأمر، المقاس، PDF (ملف واحد/ملف لكل ستيكر)، Word، طباعة.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { fetchAllRows } from '@/lib/fetch-all';
import { readSnapshot, writeSnapshot } from '@/lib/view-snapshot';
import { useCurrentUser } from '@/lib/use-current-user';
import { can } from '@/lib/permissions';
import type { DailyOrder, EntityType } from '@/lib/types';
import { ENTITY_BADGE_STYLES, ENTITY_TYPE_LABELS_PLURAL, MEAL_TYPE_LABELS } from '@/lib/types';
import { formatDateFull } from '@/lib/date-utils';
import OrderSelect from '@/components/shared/OrderSelect';
import { PdfModeControl, SizeFields } from '@/components/lunch-dinner-stickers/ld-settings';
import type { PdfMode } from '@/components/lunch-dinner-stickers/ld-pdf-export';
import SampleStickerCard from './SampleStickerCard';
import SampleDesignPanel, { useSampleDesign } from './SampleDesignPanel';
import { a4Fit, type SampleArrange } from './sample-export';
import {
  addDaysISO, buildSampleItems, expandStickers,
  type SampleItem, type SampleOrderItemRow,
} from './sample-stickers';

const CM_TO_PX = 96 / 2.54;

export default function SampleStickersView() {
  const { user, loading: userLoading } = useCurrentUser();
  const allowed = can(user, 'sample_stickers', 'view');

  const [orders, setOrders] = useState<DailyOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [orderId, setOrderId] = useState('');
  const [items, setItems] = useState<SampleItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState('');
  const [dict, setDict] = useState<Record<string, string>>({});

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [enOverride, setEnOverride] = useState<Record<string, string>>({});
  const [productionISO, setProductionISO] = useState('');
  const [expiryOverride, setExpiryOverride] = useState('');

  const [design, setDesign] = useSampleDesign();
  // الافتراضي مثل ستيكرات الفطور: جنب بعض على A4 — 6.3 سم يدخل منه ٣ بالعرض
  const [arrange, setArrange] = useState<SampleArrange>('grid');
  const [sizeWidth, setSizeWidth] = useState('6.3');
  const [sizeHeight, setSizeHeight] = useState('6.3');
  const [pdfMode, setPdfMode] = useState<PdfMode>('single');
  const [busy, setBusy] = useState<null | 'pdf' | 'word'>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const w = Math.min(Math.max(parseFloat(sizeWidth) || 10, 2), 30);
  const h = Math.min(Math.max(parseFloat(sizeHeight) || 10, 2), 30);

  // ── تحميل الأوامر + قاموس الترجمة ──────────────────────────────────────────
  useEffect(() => {
    if (!allowed) return;
    const snapKey = 'sampleStickers:orders';
    const cached = readSnapshot<DailyOrder[]>(snapKey);
    if (cached) { setOrders(cached); setLoadingOrders(false); }
    const fetchOrders = (withEntity: boolean) =>
      fetchAllRows((from, to) =>
        supabase.from('daily_orders')
          .select(`id, date, meal_type, week_number, day_of_week${withEntity ? ', entity_type' : ''}, created_at`)
          .order('date', { ascending: false }).order('id').range(from, to));
    (async () => {
      let res = await fetchOrders(true);
      if (res.error && /entity_type|column/i.test(res.error.message)) res = await fetchOrders(false);
      if (res.data) {
        setOrders(res.data as unknown as DailyOrder[]);
        writeSnapshot(snapKey, res.data);
      }
      setLoadingOrders(false);
    })();
    supabase.from('custom_transliterations').select('word, transliteration').then(({ data }) => {
      if (!data) return;
      const d: Record<string, string> = {};
      (data as { word: string; transliteration: string }[]).forEach(e => { d[e.word] = e.transliteration; });
      setDict(d);
    });
  }, [allowed]);

  const order = useMemo(() => orders.find(o => o.id === orderId) ?? null, [orders, orderId]);
  const entity: EntityType = order?.entity_type === 'companion' ? 'companion' : 'beneficiary';

  // ── أصناف الأمر ─────────────────────────────────────────────────────────────
  const loadItems = useCallback(async (id: string) => {
    setLoadingItems(true); setError(''); setItems([]);
    const read = (full: boolean) => supabase.from('order_items')
      .select(full
        ? 'id, meal_id, display_name, category, meals(id, name, english_name, is_snack, category)'
        : 'id, meal_id, display_name, meals(id, name, english_name, is_snack)')
      .eq('order_id', id);
    let res = await read(true);
    if (res.error && /category|column/i.test(res.error.message)) res = await read(false);
    if (res.error) { setError(res.error.message); setLoadingItems(false); return; }
    const built = buildSampleItems((res.data ?? []) as unknown as SampleOrderItemRow[], dict);
    setItems(built);
    setSelected(new Set(built.map(i => i.key)));
    setCopies({});
    setEnOverride({});
    setLoadingItems(false);
  }, [dict]);

  const onOrderChange = (id: string) => {
    setOrderId(id);
    setExpiryOverride('');
    if (!id) { setItems([]); setSelected(new Set()); setError(''); setProductionISO(''); return; }
    const o = orders.find(x => x.id === id);
    setProductionISO(o?.date?.slice(0, 10) ?? '');
    void loadItems(id);
  };

  // الإنجليزي بعد تعديل المستخدم
  const itemsView = useMemo(
    () => items.map(i => (enOverride[i.key] !== undefined ? { ...i, nameEn: enOverride[i.key] } : i)),
    [items, enOverride],
  );
  const mains = itemsView.filter(i => !i.isSnack);
  const snacks = itemsView.filter(i => i.isSnack);
  const stickers = useMemo(() => expandStickers(itemsView, selected, copies), [itemsView, selected, copies]);

  const expiryISO = expiryOverride || (productionISO ? addDaysISO(productionISO, design.expiryDays) : '');

  const toggle = (key: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const selectOnly = (list: SampleItem[]) => setSelected(new Set(list.map(i => i.key)));

  // ── عُقد الستيكرات للتصدير ──────────────────────────────────────────────────
  const nodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  // مرجع ثابت لكل ستيكر — حتى يبقى memo الكارت فعّالاً
  const refCache = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map());
  const stableRef = (uid: string) => {
    let r = refCache.current.get(uid);
    if (!r) {
      r = (el: HTMLDivElement | null) => {
        if (el) nodesRef.current.set(uid, el); else nodesRef.current.delete(uid);
      };
      refCache.current.set(uid, r);
    }
    return r;
  };

  const baseName = order
    ? `ستيكرات-العينات_${order.date.slice(0, 10)}_${MEAL_TYPE_LABELS[order.meal_type]}_${ENTITY_TYPE_LABELS_PLURAL[entity]}`
    : 'ستيكرات-العينات';

  const picked = () => stickers
    .map(s => ({ el: nodesRef.current.get(s.uid), name: s.item.nameAr + (s.copy > 1 ? ` (${s.copy})` : '') }))
    .filter((x): x is { el: HTMLDivElement; name: string } => !!x.el);

  const exportPdf = async () => {
    const list = picked();
    if (!list.length) return;
    setBusy('pdf'); setProgress({ done: 0, total: list.length });
    const onProg = (done: number, total: number) => setProgress({ done, total });
    try {
      let res: { captured: number; failed: number };
      if (arrange === 'grid') {
        const { exportSampleGridPdf } = await import('./sample-export');
        res = await exportSampleGridPdf(list.map(x => x.el), w, h, `${baseName}.pdf`, onProg);
      } else {
        const { exportLunchDinnerStickersPdf } = await import('@/components/lunch-dinner-stickers/ld-pdf-export');
        res = await exportLunchDinnerStickersPdf(
          list.map(x => x.el), w, h, onProg,
          `${baseName}.pdf`, { mode: pdfMode, names: list.map(x => x.name) },
        );
      }
      if (res.failed > 0) alert(`تم التصدير: ${res.captured} ستيكر. تعذّر التقاط ${res.failed}.`);
    } catch (e) {
      alert(`تعذّر تصدير PDF: ${e instanceof Error ? e.message : 'خطأ غير معروف'}`);
    } finally { setBusy(null); setProgress(null); }
  };

  const exportWord = async () => {
    const list = picked();
    if (!list.length) return;
    setBusy('word'); setProgress({ done: 0, total: list.length });
    try {
      const { exportSampleWord } = await import('./sample-export');
      const res = await exportSampleWord(list.map(x => x.el), w, h, arrange, `${baseName}.docx`,
        (done, total) => setProgress({ done, total }));
      if (res.failed > 0) alert(`تم التصدير: ${res.captured} ستيكر. تعذّر التقاط ${res.failed}.`);
    } catch (e) {
      alert(`تعذّر تصدير Word: ${e instanceof Error ? e.message : 'خطأ غير معروف'}`);
    } finally { setBusy(null); setProgress(null); }
  };

  // ── المعاينة داخل لوحة التصميم ─────────────────────────────────────────────
  const previewItem = stickers[0]?.item ?? itemsView[0] ?? {
    key: 'demo', mealId: '', nameAr: 'كبسة دجاج', nameEn: 'Chicken Kabsa', isSnack: false, category: 'hot' as const,
  };
  const previewScale = Math.min(1, 280 / (w * CM_TO_PX), 320 / (h * CM_TO_PX));
  const todayISO = new Date().toISOString().slice(0, 10);
  const preview = (
    <div style={{ width: w * CM_TO_PX * previewScale, height: h * CM_TO_PX * previewScale }} className="relative">
      <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top right', position: 'absolute', top: 0, right: 0 }}>
        <SampleStickerCard
          design={design} widthCm={w} heightCm={h}
          nameAr={previewItem.nameAr} nameEn={previewItem.nameEn}
          mealType={order?.meal_type ?? 'lunch'} entity={entity}
          productionISO={productionISO || todayISO}
          expiryISO={expiryISO || addDaysISO(todayISO, design.expiryDays)}
        />
      </div>
    </div>
  );

  if (userLoading) return <div className="p-10 text-center text-slate-400 text-sm">جاري التحميل...</div>;
  if (!allowed) {
    return (
      <div className="p-6">
        <div className="card p-10 text-center text-slate-500">ما عندك صلاحية «ستيكرات العينات» — راجع مدير النظام.</div>
      </div>
    );
  }

  const itemRow = (it: SampleItem) => {
    const on = selected.has(it.key);
    return (
      <div key={it.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ${on ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white'}`}>
        <input type="checkbox" checked={on} onChange={() => toggle(it.key)} className="w-4 h-4 accent-emerald-600 cursor-pointer shrink-0" />
        <button type="button" onClick={() => toggle(it.key)} className="flex-1 min-w-0 text-right">
          <div className="text-sm font-semibold text-slate-800 truncate">{it.nameAr}</div>
        </button>
        <input
          dir="ltr" value={it.nameEn} disabled={!on}
          onChange={e => setEnOverride(p => ({ ...p, [it.key]: e.target.value }))}
          title="الاسم الإنجليزي على الستيكر — تقدر تعدّله"
          className="w-40 text-xs border border-slate-200 rounded px-2 py-1 disabled:opacity-40 bg-white"
        />
        <label className="flex items-center gap-1 text-xs text-slate-500 shrink-0" title="عدد الستيكرات لهذا الصنف">
          ×
          <input type="number" min={1} max={50} disabled={!on} value={copies[it.key] ?? 1}
            onChange={e => setCopies(p => ({ ...p, [it.key]: Math.max(1, Math.min(50, Math.floor(Number(e.target.value)) || 1)) }))}
            className="w-12 text-center border border-slate-200 rounded py-1 disabled:opacity-40" />
        </label>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 space-y-5">
      {/* طباعة: صفحة لكل ستيكر بمقاسه بالضبط — القاعدة موجودة في هذه الصفحة فقط */}
      <style>{`
        @media print {
          #sample-print-root, #sample-print-root * { visibility: visible; }
          #sample-print-root .sample-sticker { border-style: ${design.border ? 'solid' : 'none'} !important; }
          ${arrange === 'grid' ? `
          @page { size: A4 portrait; margin: 8mm; }
          #sample-print-root { position: absolute; top: 0; right: 0; left: 0; display: flex !important; flex-wrap: wrap; gap: 2mm !important; justify-content: flex-start !important; }
          #sample-print-root .sample-sticker { break-inside: avoid; page-break-inside: avoid; }
          ` : `
          @page { size: ${w}cm ${h}cm; margin: 0; }
          #sample-print-root { position: absolute; top: 0; right: 0; left: 0; display: block !important; }
          #sample-print-root .sample-sticker { break-after: page; page-break-after: always; }
          #sample-print-root .sample-sticker:last-child { break-after: auto; page-break-after: auto; }
          `}
        }
      `}</style>

      <div className="no-print flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">ستيكرات العينات</h1>
          <p className="text-slate-500 text-sm mt-0.5">ستيكر عينة لكل صنف رئيسي وسناك في أمر التشغيل (بدون البدائل)</p>
        </div>
        {order && (
          <span className={`badge ${ENTITY_BADGE_STYLES[entity]}`}>{ENTITY_TYPE_LABELS_PLURAL[entity]}</span>
        )}
      </div>

      {/* اختيار الأمر */}
      <div className="card p-4 no-print">
        <OrderSelect orders={orders} value={orderId} loading={loadingOrders} onChange={onOrderChange} />
      </div>

      {error && <div className="no-print bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

      {/* اختيار الأصناف */}
      {orderId && (
        <div className="card p-4 no-print space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">الأصناف</h3>
              {order && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDateFull(order.date)} · {MEAL_TYPE_LABELS[order.meal_type]} · {ENTITY_TYPE_LABELS_PLURAL[entity]}
                  {' — '}مختار {selected.size} من {items.length} · {stickers.length} ستيكر
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button type="button" onClick={() => selectOnly(itemsView)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">الكل</button>
              <button type="button" onClick={() => selectOnly(mains)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">الرئيسية فقط</button>
              <button type="button" onClick={() => selectOnly(snacks)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">السناكات فقط</button>
              <button type="button" onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-red-50 hover:text-red-600 text-slate-500">إلغاء الكل</button>
            </div>
          </div>

          {loadingItems ? (
            <div className="py-8 text-center text-slate-400 text-sm">جاري تحميل الأصناف...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-sm">لا توجد أصناف في هذا الأمر.</div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-emerald-700">🍽️ الأصناف الرئيسية ({mains.length})</div>
                {mains.length ? mains.map(itemRow) : <div className="text-xs text-slate-400">لا يوجد</div>}
              </div>
              <div className="space-y-1.5">
                <div className="text-xs font-bold text-amber-600">🍪 السناكات ({snacks.length})</div>
                {snacks.length ? snacks.map(itemRow) : <div className="text-xs text-slate-400">لا يوجد</div>}
              </div>
            </div>
          )}

          {/* التواريخ */}
          <div className="flex items-end gap-3 flex-wrap border-t border-slate-100 pt-3">
            <div>
              <label className="label text-xs">تاريخ الإنتاج (تاريخ الأمر)</label>
              <input type="date" className="input-field w-44" value={productionISO}
                onChange={e => { setProductionISO(e.target.value); setExpiryOverride(''); }} />
            </div>
            <div>
              <label className="label text-xs">تاريخ الانتهاء {expiryOverride ? '(معدّل يدوياً)' : `(+${design.expiryDays} أيام)`}</label>
              <input type="date" className="input-field w-44" value={expiryISO}
                onChange={e => setExpiryOverride(e.target.value)} />
            </div>
            {expiryOverride && (
              <button type="button" onClick={() => setExpiryOverride('')}
                className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                ↺ رجوع للحساب التلقائي
              </button>
            )}
          </div>
        </div>
      )}

      {/* التصميم */}
      <SampleDesignPanel design={design} onChange={setDesign} preview={preview} />

      {/* المقاس + التصدير */}
      {orderId && (
        <div className="card p-4 no-print">
          <div className="flex items-end gap-3 flex-wrap mb-3">
            <div>
              <label className="label text-xs">طريقة الترتيب</label>
              <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100">
                {([
                  { value: 'grid', label: 'جنب بعض على A4' },
                  { value: 'perPage', label: 'صفحة لكل ستيكر' },
                ] as const).map(o => (
                  <button key={o.value} type="button" onClick={() => setArrange(o.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
                      arrange === o.value ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
                    }`}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            {arrange === 'grid' && (() => {
              const fit = a4Fit(w, h);
              return (
                <div className="text-xs text-slate-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  {fit.cols} بالعرض × {fit.rows} بالطول = <b>{fit.perPage}</b> ستيكر في الورقة
                  {stickers.length > 0 && <> · {Math.ceil(stickers.length / fit.perPage)} ورقة</>}
                </div>
              );
            })()}
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <SizeFields w={sizeWidth} h={sizeHeight} setW={setSizeWidth} setH={setSizeHeight} />
            {arrange === 'grid' && (
              <button type="button" onClick={() => { setSizeWidth('6.3'); setSizeHeight('6.3'); }}
                title="٣ بالعرض × ٤ بالطول على A4"
                className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100">
                6.3×6.3 (12 بالورقة)
              </button>
            )}
            {arrange === 'perPage' && <PdfModeControl value={pdfMode} onChange={setPdfMode} />}
            <button onClick={exportPdf} disabled={!!busy || !stickers.length} className="btn-primary text-sm disabled:opacity-50">
              {busy === 'pdf'
                ? (progress ? `جاري التصدير ${progress.done}/${progress.total}...` : 'جاري التصدير...')
                : arrange === 'perPage' && pdfMode === 'separate' ? `تصدير PDF (${stickers.length} ملف في zip)` : `تصدير PDF (${stickers.length} ستيكر)`}
            </button>
            <button onClick={exportWord} disabled={!!busy || !stickers.length} className="btn-secondary text-sm disabled:opacity-50">
              {busy === 'word' ? (progress ? `جاري التصدير ${progress.done}/${progress.total}...` : 'جاري التصدير...') : 'تصدير Word'}
            </button>
            <button onClick={() => window.print()} disabled={!!busy || !stickers.length} className="btn-secondary text-sm disabled:opacity-50">
              طباعة ({stickers.length})
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-3">
            💡 {arrange === 'grid'
              ? `الستيكرات جنب بعض على ورق A4 بمقاس ${sizeWidth || '—'}×${sizeHeight || '—'} سم لكل ستيكر — مثل ستيكرات الفطور.`
              : `كل ستيكر في صفحة منفصلة بمقاس ${sizeWidth || '—'}×${sizeHeight || '—'} سم بالضبط — لطابعة الملصقات.`}
            {' '}PDF وWord والطباعة طبق الأصل من المعاينة بالأسفل.
          </p>
        </div>
      )}

      {/* الستيكرات */}
      {orderId && !loadingItems && (
        stickers.length === 0 ? (
          items.length > 0 && <div className="no-print py-10 text-center text-slate-400 text-sm">اختر صنفاً واحداً على الأقل.</div>
        ) : (
          <div id="sample-print-root" className={`flex flex-wrap justify-center md:justify-start ${arrange === 'grid' ? 'gap-2' : 'gap-4'}`}>
            {stickers.map(s => (
              <SampleStickerCard
                key={s.uid}
                innerRef={stableRef(s.uid)}
                design={design} widthCm={w} heightCm={h}
                nameAr={s.item.nameAr} nameEn={s.item.nameEn}
                mealType={order?.meal_type ?? 'lunch'} entity={entity}
                productionISO={productionISO || todayISO} expiryISO={expiryISO || todayISO}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}
