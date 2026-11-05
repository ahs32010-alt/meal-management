'use client';

/**
 * إعدادات ستيكرات الغداء/العشاء المشتركة بين التبويبين («ثابتة» و«حسب الوجبة»):
 * صورة الهيدر + ألوان الأنظمة الغذائية (تُختار داخل كل نظام في صفحة الأنظمة). الحالة تُرفع لمكوّن الصفحة مرّة واحدة
 * عبر `useLdStickerSettings` — فما يتكرّر التحميل ولا تختلف الألوان بين تبويب وتبويب.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import {
  TIER_LABELS, moveDiet, moveDietTo, NO_DIET, tierKey, type StickerTier,
  WITHIN_DIET_SORT_LABELS, type WithinDietSort,
  colorsBackground,
} from './ld-diet-order';
import { fetchDietLabels } from './ld-fetch';
import ColorPicker from '@/components/shared/ColorPicker';

export const HEADER_KEY = 'ldStickerHeaderUrl';
export const DIET_COLORS_KEY = 'ldDietColorsV2'; // V2: ألوان من الأنظمة الغذائية (القديم كان مربوطاً بالنص اليدوي)
export const DIET_ORDER_KEY = 'ldDietOrder';
export const HIDDEN_COLORS_KEY = 'ldHiddenColors';
export const WITHIN_SORT_KEY = 'ldWithinDietSort';

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
  /** لون كل نظام كما يظهر على الستيكر (اسم النظام أو «نظام - نظام» ← ألوانه مفصولة بفاصلة) — من الأنظمة الغذائية */
  dietColors: Record<string, string>;
  /** ترتيب الأنظمة الغذائية — مشترك لكل المستخدمين (sticker_settings) */
  dietOrder: string[];
  setDietOrder: (order: string[]) => void;
  /** إظهار قسم «ترتيب الأنظمة الغذائية» في صفحة الستيكرات (يُضبط من الإعدادات) */
  showDietOrder: boolean;
  setShowDietOrder: (v: boolean) => void;
  /** false = جدول sticker_settings غير موجود بعد — الترتيب محلي على هذا الجهاز */
  sharedSettings: boolean;
  /** ألوان مخفية من المعاينة والتصدير (مفتاح اللون بحروف صغيرة، '' = الأبيض) */
  hiddenColors: string[];
  toggleHiddenColor: (key: string) => void;
  showAllColors: () => void;
  /** الترتيب داخل كل نظام غذائي (الافتراضي / الكود / الفيلا) — محفوظ على هذا الجهاز */
  withinSort: WithinDietSort;
  setWithinSort: (v: WithinDietSort) => void;
}

export function useLdStickerSettings(): LdSettings {
  const [headerUrl, setHeaderUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dietColors, setDietColors] = useState<Record<string, string>>({});
  const [dietOrder, setDietOrderState] = useState<string[]>([]);
  const [hiddenColors, setHiddenColorsState] = useState<string[]>([]);
  const [showDietOrder, setShowDietOrderState] = useState(true);
  const [sharedSettings, setSharedSettings] = useState(true);
  const [withinSort, setWithinSortState] = useState<WithinDietSort>('default');

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
      const within = localStorage.getItem(WITHIN_SORT_KEY);
      if (within === 'code' || within === 'villa') setWithinSortState(within);
    } catch {}
    // الترتيب وإظهاره: مشتركان في sticker_settings (لو الترقية اتشغّلت)
    (async () => {
      const { data, error } = await supabase
        .from('sticker_settings').select('diet_order, show_diet_order').eq('id', 1).maybeSingle();
      if (error) { setSharedSettings(false); return; }
      const row = data as { diet_order: string[] | null; show_diet_order: boolean } | null;
      if (row) {
        setShowDietOrderState(row.show_diet_order !== false);
        // أول مرة: ترتيب محفوظ في هذا المتصفح والقاعدة فاضية → ننقله للقاعدة
        const local = (() => { try { return JSON.parse(localStorage.getItem(DIET_ORDER_KEY) ?? '[]') as string[]; } catch { return []; } })();
        if ((row.diet_order ?? []).length === 0 && local.length > 0) {
          void supabase.from('sticker_settings').upsert({ id: 1, diet_order: local, updated_at: new Date().toISOString() });
        } else {
          setDietOrderState(row.diet_order ?? []);
        }
      }
    })();
    // ألوان الأنظمة: من الأنظمة الغذائية نفسها (diet_systems.color). من عنده أكثر
    // من نظام ملوّن ← ستيكره أشرطة بألوان أنظمته بنفس ترتيب أسمائها.
    (async () => {
      const [sysRes, labels] = await Promise.all([
        supabase.from('diet_systems').select('name, color'),
        fetchDietLabels(),
      ]);
      if (sysRes.error || !sysRes.data) return;
      const colorOf = new Map<string, string>();
      for (const r of sysRes.data as { name: string; color: string | null }[]) {
        const c = r.color?.trim();
        if (c) colorOf.set(r.name.trim(), c);
      }
      const map: Record<string, string> = {};
      const add = (label: string) => {
        if (!label || map[label] !== undefined) return;
        const cs = label.split(' - ').map(n => colorOf.get(n.trim())).filter(Boolean) as string[];
        if (cs.length) map[label] = cs.join(',');
      };
      colorOf.forEach((_, name) => add(name));
      labels.forEach(add);
      setDietColors(map);
      try { localStorage.setItem(DIET_COLORS_KEY, JSON.stringify(map)); } catch {}
    })();
  }, []);

  const setDietOrder = useCallback((order: string[]) => {
    setDietOrderState(order);
    try { localStorage.setItem(DIET_ORDER_KEY, JSON.stringify(order)); } catch {}
    void supabase.from('sticker_settings')
      .upsert({ id: 1, diet_order: order, updated_at: new Date().toISOString() });
  }, []);

  const setShowDietOrder = useCallback((v: boolean) => {
    setShowDietOrderState(v);
    void supabase.from('sticker_settings')
      .upsert({ id: 1, show_diet_order: v, updated_at: new Date().toISOString() });
  }, []);

  const setWithinSort = useCallback((v: WithinDietSort) => {
    setWithinSortState(v);
    try { localStorage.setItem(WITHIN_SORT_KEY, v); } catch {}
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
    headerUrl, uploading, uploadHeader, removeHeader, dietColors, dietOrder, setDietOrder,
    hiddenColors, toggleHiddenColor, showAllColors,
    showDietOrder, setShowDietOrder, sharedSettings,
    withinSort, setWithinSort,
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

// ── غلاف قسم قابل للطيّ ────────────────────────────────────────────────────────
function Collapsible({ title, icon, hint, defaultOpen = false, children }: {
  title: string; icon: React.ReactNode; hint: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    // بلا overflow-hidden: كان يقصّ قائمة اختيار اللون لآخر الأنظمة في القسم.
    // زوايا الزر تورث استدارة البطاقة بدلاً منه حتى لا تبرز خلفية الـhover.
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition-colors ${
          open ? 'rounded-t-[inherit]' : 'rounded-[inherit]'
        }`}
      >
        <span className="flex items-center gap-2 font-bold text-slate-800 text-sm">{icon}{title}</span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{open ? 'تُحفظ تلقائياً' : hint}</span>
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {open && <div className="px-4 pb-3 border-t border-slate-100">{children}</div>}
    </div>
  );
}

// ── ترتيب الأنظمة الغذائية ────────────────────────────────────────────────────
/**
 * ترتيب الستيكرات كما تُعرض وتُصدَّر: ٣ أقسام ثابتة (الأنظمة ← Ⓡ ← وجبات مخصصة)،
 * وداخل كل قسم تُرتَّب الأنظمة بالسحب من ⋮⋮ أو بالأزرار. القسم يحدّده المستفيد
 * (خيار Ⓡ / الوجبات المخصصة) لا النظام، فالنقل بين الأقسام غير ممكن من هنا.
 * مشترك لكل المستخدمين.
 */
export function DietOrderPanel({ groups, settings, defaultOpen }: {
  /** الأنظمة في كل قسم بالترتيب الفعلي — من tierDietGroups */
  groups: { diet: string; count: number }[][];
  settings: LdSettings;
  defaultOpen?: boolean;
}) {
  const { dietColors, dietOrder, setDietOrder, sharedSettings, withinSort, setWithinSort } = settings;
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);

  const total = groups.reduce((n, g) => n + g.length, 0);
  if (total === 0) return null;
  const iconBtn = 'p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 disabled:pointer-events-none';

  return (
    <Collapsible
      title="ترتيب الأنظمة الغذائية"
      hint={groups.map((g, t) => `${TIER_LABELS[t]} ${g.length}`).join(' · ')}
      defaultOpen={defaultOpen}
      icon={
        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
        </svg>
      }
    >
      <div className="flex items-center justify-between gap-2 py-2">
        <p className="text-[11px] text-slate-500">
          نفس ترتيب الستيكرات بالضبط. رتّب الأنظمة داخل كل قسم بالسحب من <b>⋮⋮</b> أو بالأزرار، ومن ليس له نظام في آخر قسمه.
          {!sharedSettings && <span className="text-amber-600"> (محفوظ على هذا الجهاز فقط — شغّل supabase/sticker-settings-migration.sql ليصير مشتركاً)</span>}
        </p>
        {dietOrder.length > 0 && (
          <button type="button" onClick={() => setDietOrder([])}
            className="text-[11px] text-slate-400 hover:text-slate-700 underline whitespace-nowrap">
            الترتيب الافتراضي
          </button>
        )}
      </div>
      {/* الترتيب داخل كل نظام — الأنظمة نفسها تبقى بترتيبها أعلاه */}
      <div className="flex items-center gap-2 flex-wrap pb-2">
        <span className="text-xs font-semibold text-slate-600">داخل كل نظام رتّب حسب:</span>
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100">
          {(Object.keys(WITHIN_DIET_SORT_LABELS) as WithinDietSort[]).map(v => (
            <button key={v} type="button" onClick={() => setWithinSort(v)} aria-pressed={withinSort === v}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors ${
                withinSort === v ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
              {WITHIN_DIET_SORT_LABELS[v]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {groups.map((group, t) => {
          const tier = t as StickerTier;
          const keys = group.map(g => tierKey(tier, g.diet));
          const move = (key: string, delta: -1 | 1) => setDietOrder(moveDiet(keys, dietOrder, key, delta));
          const moveTo = (key: string, idx: number) => setDietOrder(moveDietTo(keys, dietOrder, key, idx));
          const sectionCount = group.reduce((n, g) => n + g.count, 0);
          return (
            <div key={t}>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-t-lg bg-emerald-50 border border-emerald-100 border-b-0">
                <span className="text-xs font-extrabold text-emerald-700">{t + 1}.</span>
                <span className="text-xs font-extrabold text-emerald-800">{TIER_LABELS[t]}</span>
                <span className="text-[11px] text-emerald-600">({sectionCount} ستيكر)</span>
              </div>
              {group.length === 0 ? (
                <div className="px-3 py-2 text-[11px] text-slate-400 border border-slate-100 rounded-b-lg">لا يوجد أحد في هذا القسم.</div>
              ) : (
                <div className="divide-y divide-slate-100 border border-slate-100 rounded-b-lg">
                  {group.map(({ diet, count }, idx) => {
                    const key = tierKey(tier, diet);
                    const color = dietColors[diet];
                    // السحب داخل نفس القسم فقط
                    const canDrop = dragging !== null && keys.includes(dragging) && dragging !== key;
                    return (
                      <div
                        key={key}
                        draggable
                        onDragStart={e => { setDragging(key); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); }}
                        onDragEnd={() => { setDragging(null); setDropAt(null); }}
                        onDragOver={e => { if (canDrop) { e.preventDefault(); setDropAt(key); } }}
                        onDrop={e => { e.preventDefault(); if (canDrop) moveTo(dragging!, idx); setDragging(null); setDropAt(null); }}
                        className={`flex items-center gap-2 px-2 py-1.5 transition-colors ${dragging === key ? 'opacity-40' : ''} ${
                          dropAt === key && canDrop ? 'bg-emerald-50 ring-2 ring-inset ring-emerald-300' : ''}`}
                      >
                        <span className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 select-none px-0.5 text-lg leading-none" title="اسحب لتغيير الترتيب">⋮⋮</span>
                        <span className="w-6 text-center text-xs font-bold text-slate-400 shrink-0">{idx + 1}</span>
                        <span className="flex items-center gap-2 font-medium text-sm flex-1 min-w-0 text-slate-700">
                          <span className="w-3 h-3 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: colorsBackground(color) }} />
                          <span className="truncate" title={diet}>{diet}</span>
                          <span className="text-[11px] text-slate-400 font-normal shrink-0">({count})</span>
                        </span>
                        <span className="flex items-center shrink-0">
                          <button type="button" onClick={() => moveTo(key, 0)} disabled={idx === 0} title="لأول القسم" aria-label={`نقل ${diet} لأول القسم`} className={iconBtn}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 11l7-7 7 7M5 19l7-7 7 7" /></svg>
                          </button>
                          <button type="button" onClick={() => move(key, -1)} disabled={idx === 0} title="خطوة لأعلى" aria-label={`تحريك ${diet} لأعلى`} className={iconBtn}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" /></svg>
                          </button>
                          <button type="button" onClick={() => move(key, 1)} disabled={idx === group.length - 1} title="خطوة لأسفل" aria-label={`تحريك ${diet} لأسفل`} className={iconBtn}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                          </button>
                          <button type="button" onClick={() => moveTo(key, group.length - 1)} disabled={idx === group.length - 1} title="لآخر القسم" aria-label={`نقل ${diet} لآخر القسم`} className={iconBtn}>
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 13l-7 7-7-7M19 5l-7 7-7-7" /></svg>
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Collapsible>
  );
}

// ── منتقي لون ستيكر النظام (يُستخدم داخل نافذة النظام الغذائي) ───────────────
/** زر لون + نافذة صغيرة: منتقي حرّ أو ألوان جاهزة، و«بدون لون» = أبيض */
export function StickerColorField({ value, onChange }: {
  value: string | null;
  onChange: (color: string | null) => void;
}) {
  // موضع النافذة ثابت على الشاشة ومحصور داخلها — فما تطلع برّا الصفحة مهما كان مكان الزر
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [colorTab, setColorTab] = useState<'custom' | 'preset'>('preset');
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const selected = value ?? undefined;
  const close = () => setPos(null);
  const pick = (hex: string) => { onChange(hex); close(); };

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const pw = popRef.current?.offsetWidth ?? 300;
    const ph = popRef.current?.offsetHeight ?? 320;
    const m = 8;
    const left = Math.min(Math.max(m, b.right - pw), window.innerWidth - pw - m);
    const below = b.bottom + m;
    const top = below + ph <= window.innerHeight - m ? below : Math.max(m, b.top - ph - m);
    setPos({ top, left });
  }, []);

  // بعد أول رسم نعرف مقاس النافذة الفعلي فنعيد الحساب، ونتابع التمرير وتغيير المقاس
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, colorTab, place]);

  return (
    <div className="inline-flex items-center gap-2">
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? close() : place())}
        className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-sm font-medium text-slate-600 transition-colors"
      >
        <span className="w-5 h-5 rounded shrink-0"
          style={value ? { background: value, boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' } : { border: '1.5px dashed #cbd5e1' }} />
        <span>{value ? value.toUpperCase() : 'بدون لون (أبيض)'}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={close} />
          <div ref={popRef} className="fixed z-[61] p-3 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-y-auto"
            style={{ top: pos.top, left: pos.left, width: 'max-content', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)' }}>
            <div className="flex border-b border-slate-200 mb-3" role="tablist">
              {(['preset', 'custom'] as const).map(t => (
                <button key={t} type="button" role="tab" aria-selected={colorTab === t}
                  onClick={() => setColorTab(t)}
                  className={`flex-1 pb-2 text-sm font-bold border-b-[3px] -mb-px transition-colors ${
                    colorTab === t ? 'border-violet-500 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {t === 'custom' ? 'لون ثابت' : 'ألوان جاهزة'}
                </button>
              ))}
            </div>
            {colorTab === 'custom' ? (
              <ColorPicker value={selected} onChange={hex => onChange(hex)} />
            ) : (
              <>
                <div className="text-[10px] font-semibold text-slate-400 mb-1">ألوان قياسية</div>
                <div className="flex gap-1 mb-3">
                  {STANDARD_COLORS.map(c => (
                    <ColorSwatch key={c} color={c} selected={selected} onPick={pick} />
                  ))}
                </div>
                <div className="text-[10px] font-semibold text-slate-400 mb-1">تدرّجات</div>
                <div className="flex gap-1">
                  {RAMP_COLUMNS.map((col, ci) => (
                    <div key={ci} className="flex flex-col gap-1">
                      {col.map(c => (
                        <ColorSwatch key={c} color={c} selected={selected} onPick={pick} />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => { onChange(null); close(); }}
              className="mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors"
            >
              بدون لون
            </button>
          </div>
        </>
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
              style={{ background: colorsBackground(c.key), boxShadow: '0 0 0 1px rgba(0,0,0,0.12)' }}
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
      <span className="w-3 h-3 rounded-full ring-1 ring-black/10 shrink-0" style={{ background: colorsBackground(color) }} />
      <span className="text-sm font-bold text-slate-700">{diet || 'بدون نظام غذائي'}</span>
      <span className="text-xs text-slate-400">({count} ستيكر)</span>
    </div>
  );
}

// ── عنوان مرتبة الفرز (العادي / الكاربوهيدرات / أخرى / وجبات مخصصة) ───────────
export function TierSectionHeader({ index, label, count }: { index: number; label: string; count: number }) {
  return (
    <div className="w-full flex items-center gap-2 mt-4 first:mt-0 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100">
      <span className="text-sm font-extrabold text-emerald-700">{index}.</span>
      <span className="text-sm font-extrabold text-emerald-800">{label}</span>
      <span className="text-xs text-emerald-600">({count} ستيكر)</span>
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

// ── طريقة تصدير الـPDF: ملف واحد أو ملف لكل ستيكر (داخل zip) ──────────────────
export function PdfModeControl({ value, onChange }: {
  value: 'single' | 'separate';
  onChange: (v: 'single' | 'separate') => void;
}) {
  const opts = [
    { value: 'single' as const, label: 'ملف واحد' },
    { value: 'separate' as const, label: 'ملف لكل ستيكر' },
  ];
  return (
    <div>
      <label className="label text-xs">طريقة PDF</label>
      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100">
        {opts.map(o => (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${
              value === o.value ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
