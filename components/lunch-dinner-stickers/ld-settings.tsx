'use client';

/**
 * إعدادات ستيكرات الغداء/العشاء المشتركة بين التبويبين («ثابتة» و«حسب الوجبة»):
 * صورة الهيدر + ألوان الأنظمة الغذائية. الحالة تُرفع لمكوّن الصفحة مرّة واحدة
 * عبر `useLdStickerSettings` — فما يتكرّر التحميل ولا تختلف الألوان بين تبويب وتبويب.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import { effectiveDietOrder, moveDiet, moveDietTo, NO_DIET } from './ld-diet-order';

export const HEADER_KEY = 'ldStickerHeaderUrl';
export const DIET_COLORS_KEY = 'ldDietColors';
export const DIET_ORDER_KEY = 'ldDietOrder';
export const HIDDEN_COLORS_KEY = 'ldHiddenColors';

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
  /** ترتيب الأنظمة الغذائية المحفوظ (محلياً على هذا الجهاز) */
  dietOrder: string[];
  setDietOrder: (order: string[]) => void;
  /** ألوان مخفية من المعاينة والتصدير (مفتاح اللون بحروف صغيرة، '' = الأبيض) */
  hiddenColors: string[];
  toggleHiddenColor: (key: string) => void;
  showAllColors: () => void;
}

export function useLdStickerSettings(): LdSettings {
  const [headerUrl, setHeaderUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dietColors, setDietColors] = useState<Record<string, string>>({});
  const [dietOrder, setDietOrderState] = useState<string[]>([]);
  const [hiddenColors, setHiddenColorsState] = useState<string[]>([]);

  useEffect(() => {
    // كاش محلي فوري
    try {
      const saved = localStorage.getItem(HEADER_KEY);
      if (saved) setHeaderUrl(saved);
      const colors = localStorage.getItem(DIET_COLORS_KEY);
      if (colors) setDietColors(JSON.parse(colors) as Record<string, string>);
      const order = localStorage.getItem(DIET_ORDER_KEY);
      if (order) setDietOrderState(JSON.parse(order) as string[]);
      const hidden = localStorage.getItem(HIDDEN_COLORS_KEY);
      if (hidden) setHiddenColorsState(JSON.parse(hidden) as string[]);
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

  const setDietOrder = useCallback((order: string[]) => {
    setDietOrderState(order);
    try { localStorage.setItem(DIET_ORDER_KEY, JSON.stringify(order)); } catch {}
  }, []);

  const saveHidden = (next: string[]) => {
    try { localStorage.setItem(HIDDEN_COLORS_KEY, JSON.stringify(next)); } catch {}
    return next;
  };
  const toggleHiddenColor = useCallback((key: string) => {
    setHiddenColorsState(prev => saveHidden(prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  }, []);
  const showAllColors = useCallback(() => setHiddenColorsState(saveHidden([])), []);

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

  return {
    headerUrl, uploading, uploadHeader, removeHeader, dietColors, setDietColor, dietOrder, setDietOrder,
    hiddenColors, toggleHiddenColor, showAllColors,
  };
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

// ── لوحة ألوان وترتيب الأنظمة الغذائية (قابلة للطيّ) ────────────────────────
/**
 * الترتيب بالسحب والإفلات (من المقبض ⋮⋮) أو بأزرار سريعة: ⤒ للأعلى، ↑ ↓ خطوة،
 * ⤓ للأسفل. بجانب كل نظام عدد ستيكراته، وزر عين لإخفاء لونه.
 */
export function DietColorsPanel({ dietTypes, settings, counts }: {
  dietTypes: string[];
  settings: LdSettings;
  /** عدد الستيكرات لكل نظام (قبل إخفاء الألوان) */
  counts?: Map<string, number>;
}) {
  const { dietColors, setDietColor, dietOrder, setDietOrder, hiddenColors, toggleHiddenColor } = settings;
  const ordered = effectiveDietOrder(dietTypes, dietOrder);
  const move = (diet: string, delta: -1 | 1) => setDietOrder(moveDiet(dietTypes, dietOrder, diet, delta));
  const moveTo = (diet: string, idx: number) => setDietOrder(moveDietTo(dietTypes, dietOrder, diet, idx));
  const [open, setOpen] = useState(false);
  const [openColorFor, setOpenColorFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  if (dietTypes.length === 0) return null;

  const iconBtn = 'p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:pointer-events-none';

  return (
    <div className="card overflow-hidden max-w-2xl">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">
          <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343" />
          </svg>
          ألوان وترتيب الأنظمة الغذائية
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{open ? 'تُحفظ تلقائياً' : `${dietTypes.length} نظام`}</span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 border-t border-slate-100">
          <div className="flex items-center justify-between gap-2 py-2">
            <p className="text-[11px] text-slate-500">
              اسحب النظام من <b>⋮⋮</b> لمكانه، أو استخدم الأزرار. الستيكرات تظهر وتُصدَّر بهذا الترتيب، ومن ليس له نظام في الآخر.
            </p>
            {dietOrder.length > 0 && (
              <button type="button" onClick={() => setDietOrder([])}
                className="text-[11px] text-slate-400 hover:text-slate-700 underline whitespace-nowrap">
                ترتيب أبجدي
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
          {ordered.map((diet, idx) => {
            const selected = dietColors[diet];
            const pickerOpen = openColorFor === diet;
            const colorKey = selected ? selected.toLowerCase() : NO_DIET;
            const hidden = hiddenColors.includes(colorKey);
            const count = counts?.get(diet);
            return (
              <div
                key={diet}
                draggable
                onDragStart={e => { setDragging(diet); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', diet); }}
                onDragEnd={() => { setDragging(null); setDropAt(null); }}
                onDragOver={e => { if (dragging) { e.preventDefault(); setDropAt(idx); } }}
                onDrop={e => { e.preventDefault(); if (dragging) moveTo(dragging, idx); setDragging(null); setDropAt(null); }}
                className={`flex items-center gap-2 px-2 py-1.5 transition-colors ${
                  dragging === diet ? 'opacity-40' : ''
                } ${dropAt === idx && dragging && dragging !== diet ? 'bg-indigo-50 ring-2 ring-inset ring-indigo-300' : ''} ${hidden ? 'bg-slate-50' : ''}`}
              >
                <span className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none px-0.5 text-lg leading-none" title="اسحب لتغيير الترتيب">⋮⋮</span>
                <span className="w-6 text-center text-xs font-bold text-slate-400 shrink-0">{idx + 1}</span>
                <span className={`flex items-center gap-2 font-medium text-sm flex-1 min-w-0 ${hidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  <span className="w-3.5 h-3.5 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: selected || '#ffffff' }} />
                  <span className="truncate" title={diet}>{diet}</span>
                  {count !== undefined && <span className="text-[11px] text-slate-400 font-normal shrink-0">({count})</span>}
                </span>
                <span className="flex items-center shrink-0">
                  <button type="button" onClick={() => moveTo(diet, 0)} disabled={idx === 0} title="للأعلى" aria-label={`نقل ${diet} للأعلى`} className={iconBtn}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 11l7-7 7 7M5 19l7-7 7 7" /></svg>
                  </button>
                  <button type="button" onClick={() => move(diet, -1)} disabled={idx === 0} title="خطوة لأعلى" aria-label={`تحريك ${diet} لأعلى`} className={iconBtn}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                  </button>
                  <button type="button" onClick={() => move(diet, 1)} disabled={idx === ordered.length - 1} title="خطوة لأسفل" aria-label={`تحريك ${diet} لأسفل`} className={iconBtn}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  <button type="button" onClick={() => moveTo(diet, ordered.length - 1)} disabled={idx === ordered.length - 1} title="للأسفل" aria-label={`نقل ${diet} للأسفل`} className={iconBtn}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 13l-7 7-7-7M19 5l-7 7-7-7" /></svg>
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => toggleHiddenColor(colorKey)}
                  title={hidden ? 'إظهار هذا اللون' : 'إخفاء هذا اللون من المعاينة والتصدير'}
                  aria-pressed={hidden}
                  className={`p-1 rounded shrink-0 ${hidden ? 'text-rose-500 hover:bg-rose-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}
                >
                  {hidden ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  )}
                </button>
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
        </div>
      )}
    </div>
  );
}

// ── إخفاء لون معيّن ──────────────────────────────────────────────────────────
/**
 * شرائح الألوان المستخدمة بعدد ستيكراتها — الضغط على لون يخفي ستيكراته من
 * المعاينة والتصدير (PDF/Word)، والضغط ثانية يرجّعها.
 */
export function HiddenColorsControl({ colors, settings }: {
  colors: { key: string; count: number; diets: string[] }[];
  settings: LdSettings;
}) {
  const { hiddenColors, toggleHiddenColor, showAllColors } = settings;
  if (colors.length < 2 && hiddenColors.length === 0) return null;
  const hiddenCount = colors.filter(c => hiddenColors.includes(c.key)).reduce((s, c) => s + c.count, 0);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs font-semibold text-slate-500 ml-1">إخفاء لون:</span>
      {colors.map(c => {
        const hidden = hiddenColors.includes(c.key);
        const label = c.key === NO_DIET ? 'الأبيض' : c.diets.join('، ');
        return (
          <button
            key={c.key || 'white'}
            type="button"
            onClick={() => toggleHiddenColor(c.key)}
            aria-pressed={hidden}
            title={hidden ? `إظهار: ${label}` : `إخفاء: ${label}`}
            className={`flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
              hidden ? 'border-rose-200 bg-rose-50 text-rose-600 line-through' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            <span
              className={`w-4 h-4 rounded shrink-0 ${hidden ? 'opacity-40' : ''}`}
              style={{ background: c.key || '#ffffff', boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' }}
            />
            <span className="max-w-[120px] truncate">{label}</span>
            <span className="font-normal opacity-70">({c.count})</span>
          </button>
        );
      })}
      {hiddenColors.length > 0 && (
        <button type="button" onClick={showAllColors} className="text-xs text-rose-600 hover:underline mr-1">
          إظهار الكل ({hiddenCount} مخفي)
        </button>
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

// ── فلتر الستيكرات حسب اللون ──────────────────────────────────────────────────
// الكل / البيضاء فقط / الملوّنة فقط — القائمة المفلترة هي نفسها ما يُصدَّر PDF وWord.
export type ColorFilter = 'all' | 'white' | 'colored';

const COLOR_FILTER_OPTIONS: { value: ColorFilter; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'white', label: 'البيضاء فقط' },
  { value: 'colored', label: 'الملوّنة فقط' },
];

export function matchesColorFilter(filter: ColorFilter, colored: boolean): boolean {
  return filter === 'all' || (filter === 'colored') === colored;
}

// لاحقة لاسم الملف المصدَّر حتى لا يختلط ملف الملوّنة بملف البيضاء
export function colorFilterSuffix(filter: ColorFilter): string {
  return filter === 'white' ? '-البيضاء' : filter === 'colored' ? '-الملونة' : '';
}

export function ColorFilterControl({ value, onChange, counts }: {
  value: ColorFilter;
  onChange: (v: ColorFilter) => void;
  counts: { white: number; colored: number };
}) {
  const countOf = (v: ColorFilter) => (v === 'all' ? counts.white + counts.colored : counts[v]);
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100">
      {COLOR_FILTER_OPTIONS.map(opt => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
              active
                ? opt.value === 'colored' ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-emerald-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            {opt.label} ({countOf(opt.value)})
          </button>
        );
      })}
    </div>
  );
}

// ── فلتر «وجبات غداء وعشاء مخصصة» ──────────────────────────────────────────
// علامة على المستفيد للفرز فقط — لا تُطبع على الستيكر. المفلتَر هو نفسه المُصدَّر.
export type CustomLdFilter = 'all' | 'only' | 'exclude';

export function matchesCustomLdFilter(filter: CustomLdFilter, isCustom: boolean): boolean {
  return filter === 'all' || (filter === 'only') === isCustom;
}

export function customLdFilterSuffix(filter: CustomLdFilter): string {
  return filter === 'only' ? '-المخصصة' : filter === 'exclude' ? '-بدون-المخصصة' : '';
}

export function CustomLdFilterControl({ value, onChange, counts }: {
  value: CustomLdFilter;
  onChange: (v: CustomLdFilter) => void;
  counts: { custom: number; other: number };
}) {
  // لا أحد معلَّم → لا داعي للفلتر (إلا لو كان مفعّلاً، حتى يقدر يرجع للكل)
  if (counts.custom === 0 && value === 'all') return null;
  const opts: { v: CustomLdFilter; label: string; n: number }[] = [
    { v: 'all', label: 'الكل', n: counts.custom + counts.other },
    { v: 'only', label: 'المخصصة فقط', n: counts.custom },
    { v: 'exclude', label: 'بدون المخصصة', n: counts.other },
  ];
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-violet-50 border border-violet-100" title="وجبات غداء وعشاء مخصصة">
      <span className="text-xs font-semibold text-violet-700 px-1.5">المخصصة:</span>
      {opts.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
            value === o.v ? 'bg-violet-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-800'
          }`}
        >
          {o.label} ({o.n})
        </button>
      ))}
    </div>
  );
}

/** شارة «مخصصة» فوق الستيكر في المعاينة — خارج عقدة الستيكر فلا تدخل PDF ولا Word */
export function CustomLdBadge() {
  return (
    <span className="no-print absolute -top-2 -right-2 z-10 px-2 py-0.5 rounded-full bg-violet-600 text-white text-[10px] font-bold shadow"
      title="وجبات غداء وعشاء مخصصة — للتمييز فقط، لا تظهر على الستيكر">
      مخصصة
    </span>
  );
}

// ── عنوان مجموعة النظام الغذائي في المعاينة (لا يدخل في التصدير) ──────────────
export function DietGroupHeader({ diet, color, count, index }: {
  diet: string; color?: string; count: number; index: number;
}) {
  return (
    <div className="w-full flex items-center gap-2 pt-3 pb-1 border-b border-slate-200 first:pt-0">
      <span className="w-5 text-center text-xs font-bold text-slate-400">{index}</span>
      <span className="w-3 h-3 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: color || '#ffffff' }} />
      <span className="text-sm font-bold text-slate-700">{diet || 'بدون نظام غذائي'}</span>
      <span className="text-xs text-slate-400">({count} ستيكر)</span>
    </div>
  );
}

export function SortByDietToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 accent-emerald-600 cursor-pointer" />
      <span className="text-sm text-slate-700 font-medium">ترتيب حسب النظام الغذائي</span>
    </label>
  );
}
