'use client';

/**
 * «تصميم الستيكر» لصفحة العينات — العناصر الظاهرة، أحجام الخط، النصوص،
 * اللون، ومدة الصلاحية. محفوظ على هذا الجهاز (مثل تصميم ستيكرات الفطور).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  DEFAULT_DESIGN, MAX_PX, MIN_PX, SAMPLE_FIELDS, normalizeDesign,
  type SampleDesign, type SampleField,
} from './sample-stickers';

const STORAGE_KEY = 'sampleStickerDesign';

export function useSampleDesign(): [SampleDesign, (next: SampleDesign) => void] {
  const [design, setDesign] = useState<SampleDesign>(DEFAULT_DESIGN);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setDesign(normalizeDesign(JSON.parse(raw)));
    } catch { /* تخزين غير متاح — نكمل بالافتراضي */ }
  }, []);
  const update = useCallback((next: SampleDesign) => {
    setDesign(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);
  return [design, update];
}

const ACCENTS = ['#B91C1C', '#C2410C', '#047857', '#1D4ED8', '#6D28D9', '#0F172A'];

export default function SampleDesignPanel({ design, onChange, preview }: {
  design: SampleDesign;
  onChange: (next: SampleDesign) => void;
  /** معاينة حيّة للستيكر بالمقاس الحالي */
  preview: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const set = <K extends keyof SampleDesign>(key: K, value: SampleDesign[K]) => onChange({ ...design, [key]: value });
  const setShow = (f: SampleField, v: boolean) => set('show', { ...design.show, [f]: v });
  const setSize = (f: SampleField, v: number) =>
    set('sizes', { ...design.sizes, [f]: Math.min(MAX_PX, Math.max(MIN_PX, Math.round(v * 2) / 2)) });

  return (
    <div className="card no-print">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition-colors ${open ? 'rounded-t-[inherit]' : 'rounded-[inherit]'}`}
      >
        <span className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center">🎨</span>
          <span className="text-right">
            <span className="block font-bold text-slate-800 text-sm">تصميم الستيكر</span>
            <span className="block text-xs text-slate-500">العناصر، أحجام الخط، العنوان، اللون، ومدة الصلاحية — يُحفظ على هذا الجهاز</span>
          </span>
        </span>
        <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-slate-100 p-4 grid gap-5 lg:grid-cols-[1fr_auto]">
          <div className="space-y-4 min-w-0">
            {/* النصوص */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label text-xs">العنوان عربي</label>
                <input className="input-field" value={design.titleAr} onChange={e => set('titleAr', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">العنوان إنجليزي</label>
                <input className="input-field" dir="ltr" value={design.titleEn} onChange={e => set('titleEn', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">ملاحظة الحفظ عربي</label>
                <input className="input-field" value={design.noteAr} onChange={e => set('noteAr', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">ملاحظة الحفظ إنجليزي</label>
                <input className="input-field" dir="ltr" value={design.noteEn} onChange={e => set('noteEn', e.target.value)} />
              </div>
            </div>

            {/* الصلاحية + اللون + الشكل */}
            <div className="flex items-end gap-4 flex-wrap">
              <div>
                <label className="label text-xs">مدة الصلاحية (أيام)</label>
                <input type="number" min={0} max={60} className="input-field w-24" value={design.expiryDays}
                  onChange={e => set('expiryDays', Math.max(0, Math.min(60, Math.round(Number(e.target.value) || 0))))} />
              </div>
              <div>
                <label className="label text-xs">لون التمييز</label>
                <div className="flex items-center gap-1.5">
                  {ACCENTS.map(c => (
                    <button key={c} type="button" onClick={() => set('accent', c)} title={c}
                      className={`w-7 h-7 rounded-full border-2 ${design.accent.toLowerCase() === c.toLowerCase() ? 'border-slate-800 scale-110' : 'border-white shadow'}`}
                      style={{ background: c }} />
                  ))}
                  <input type="color" value={design.accent} onChange={e => set('accent', e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-slate-200" title="لون مخصص" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={design.titleFilled}
                  onChange={e => set('titleFilled', e.target.checked)} />
                شريط العنوان معبّأ باللون
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={design.border}
                  onChange={e => set('border', e.target.checked)} />
                إطار حول الستيكر
              </label>
            </div>

            {/* العناصر وأحجامها */}
            <div>
              <div className="text-xs font-semibold text-slate-500 mb-2">العناصر الظاهرة وحجم الخط (لستيكر 10×10 — يتناسب تلقائياً مع المقاس)</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {SAMPLE_FIELDS.map(f => (
                  <div key={f.key} className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${design.show[f.key] ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                    <input type="checkbox" className="w-4 h-4 accent-emerald-600 cursor-pointer" checked={design.show[f.key]}
                      onChange={e => setShow(f.key, e.target.checked)} />
                    <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{f.label}</span>
                    <button type="button" disabled={!design.show[f.key]} onClick={() => setSize(f.key, design.sizes[f.key] - 1)}
                      className="w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 font-bold">−</button>
                    <input type="number" min={MIN_PX} max={MAX_PX} step={0.5} disabled={!design.show[f.key]}
                      value={design.sizes[f.key]} onChange={e => setSize(f.key, Number(e.target.value) || f.defaultPx)}
                      className="w-14 text-center text-sm border border-slate-200 rounded py-0.5 disabled:opacity-40" />
                    <button type="button" disabled={!design.show[f.key]} onClick={() => setSize(f.key, design.sizes[f.key] + 1)}
                      className="w-6 h-6 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 font-bold">+</button>
                  </div>
                ))}
              </div>
            </div>

            <button type="button" onClick={() => onChange(DEFAULT_DESIGN)}
              className="text-xs text-slate-500 hover:text-red-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-red-50">
              ↺ استرجاع التصميم الافتراضي
            </button>
          </div>

          {/* المعاينة */}
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs font-semibold text-slate-500">معاينة حيّة</div>
            {preview}
          </div>
        </div>
      )}
    </div>
  );
}
