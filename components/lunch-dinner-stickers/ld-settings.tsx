'use client';

/**
 * إعدادات ستيكرات الغداء/العشاء المشتركة بين التبويبين («ثابتة» و«حسب الوجبة»):
 * صورة الهيدر + ألوان الأنظمة الغذائية. الحالة تُرفع لمكوّن الصفحة مرّة واحدة
 * عبر `useLdStickerSettings` — فما يتكرّر التحميل ولا تختلف الألوان بين تبويب وتبويب.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';

export const HEADER_KEY = 'ldStickerHeaderUrl';
export const DIET_COLORS_KEY = 'ldDietColors';

export const PRESETS = [
  { w: '10', h: '10' },
  { w: '10', h: '15' },
  { w: '8', h: '5' },
  { w: '6', h: '4' },
];

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
  const sel = selected?.toLowerCase() === color.toLowerCase();
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

// ── حالة الإعدادات المشتركة ─────────────────────────────────────────────────
export interface LdSettings {
  headerUrl: string | null;
  uploading: boolean;
  uploadHeader: (file: File) => Promise<void>;
  removeHeader: () => void;
  dietColors: Record<string, string>;
  setDietColor: (diet: string, color: string | null) => void;
}

export function useLdStickerSettings(): LdSettings {
  const [headerUrl, setHeaderUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dietColors, setDietColors] = useState<Record<string, string>>({});

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

  const setDietColor = useCallback((diet: string, color: string | null) => {
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
  }, []);

  const uploadHeader = useCallback(async (file: File) => {
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
  }, []);

  const removeHeader = useCallback(() => {
    setHeaderUrl(null);
    try { localStorage.removeItem(HEADER_KEY); } catch {}
  }, []);

  return { headerUrl, uploading, uploadHeader, removeHeader, dietColors, setDietColor };
}

// ── أزرار الهيدر (رفع/استبدال/إزالة) ────────────────────────────────────────
export function HeaderControls({ settings }: { settings: LdSettings }) {
  const { headerUrl, uploading, uploadHeader, removeHeader } = settings;
  return (
    <>
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
    </>
  );
}

// ── لوحة ألوان الأنظمة الغذائية (قابلة للطيّ) ───────────────────────────────
export function DietColorsPanel({ dietTypes, settings }: { dietTypes: string[]; settings: LdSettings }) {
  const { dietColors, setDietColor } = settings;
  const [open, setOpen] = useState(false);
  const [openColorFor, setOpenColorFor] = useState<string | null>(null);

  if (dietTypes.length === 0) return null;

  return (
    <div className="card overflow-hidden max-w-xl">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343" />
          </svg>
          ألوان الأنظمة الغذائية
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{open ? 'تُحفظ تلقائياً' : `${dietTypes.length} نظام`}</span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-slate-100 divide-y divide-slate-100">
          {dietTypes.map(diet => {
            const selected = dietColors[diet];
            const pickerOpen = openColorFor === diet;
            return (
              <div key={diet} className="flex items-center justify-between gap-3 py-1.5">
                <span className="flex items-start gap-2.5 font-medium text-sm text-slate-700 flex-1 min-w-0">
                  <span className="w-3 h-3 mt-1 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: selected || '#e5e7eb' }} />
                  <span className="break-words" title={diet}>{diet}</span>
                </span>
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setOpenColorFor(pickerOpen ? null : diet)}
                    className="flex items-center gap-1.5 pl-1.5 pr-2 py-1 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-medium text-slate-600 transition-colors"
                  >
                    <span
                      className="w-4 h-4 rounded shrink-0"
                      style={selected
                        ? { background: selected, boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }
                        : { border: '1.5px dashed #cbd5e1' }}
                    />
                    <span>{selected ? 'اللون' : 'بدون لون'}</span>
                    <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {pickerOpen && (
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
  );
}

// ── حقول المقاس + الاختصارات — مشتركة بين التبويبين ─────────────────────────
export function SizeFields({ w, h, setW, setH }: {
  w: string; h: string; setW: (v: string) => void; setH: (v: string) => void;
}) {
  return (
    <>
      <div>
        <label className="label text-xs">العرض (سم)</label>
        <input type="number" min={2} max={30} step="0.1" value={w}
          onChange={e => setW(e.target.value)} className="input-field w-24" placeholder="10" />
      </div>
      <div>
        <label className="label text-xs">الطول (سم)</label>
        <input type="number" min={2} max={30} step="0.1" value={h}
          onChange={e => setH(e.target.value)} className="input-field w-24" placeholder="10" />
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {PRESETS.map(p => (
          <button key={`${p.w}x${p.h}`} type="button"
            onClick={() => { setW(p.w); setH(p.h); }}
            className="px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
            {p.w}×{p.h}
          </button>
        ))}
      </div>
    </>
  );
}
