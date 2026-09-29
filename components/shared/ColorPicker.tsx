'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * منتقي لون حرّ: مربع التشبّع/الإضاءة + شريط الدرجة + خانة Hex + قطّارة.
 *
 * السحب يحدّث المعاينة داخل المنتقي فقط، والاعتماد (`onChange`) يحصل عند
 * إفلات المؤشر أو إدخال Hex صالح — فلا تُكتب القاعدة مع كل حركة فأرة.
 */

type HSV = { h: number; s: number; v: number };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: HSV): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function hexToHsv(hex: string): HSV | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsv(...rgb) : null;
}

/** سحب بمؤشر (فأرة/لمس) على عنصر — يعطي الموضع النسبي 0..1 */
function useDrag(
  ref: React.RefObject<HTMLDivElement>,
  onMove: (x: number, y: number) => void,
  onEnd: () => void,
) {
  const moveRef = useRef(onMove); moveRef.current = onMove;
  const endRef = useRef(onEnd); endRef.current = onEnd;
  return (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      moveRef.current(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      endRef.current();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
}

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export default function ColorPicker({ value, onChange }: {
  /** اللون الحالي (#RRGGBB) أو undefined = بلا لون */
  value?: string;
  onChange: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value ?? '') ?? { h: 0, s: 0, v: 1 });
  const [hexText, setHexText] = useState(() => (value ?? '#FFFFFF').toUpperCase());
  const hsvRef = useRef(hsv); hsvRef.current = hsv;
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  // لون خارجي تغيّر (من الألوان الجاهزة مثلاً) → نزامن المنتقي
  useEffect(() => {
    const next = value ? hexToHsv(value) : null;
    if (next && value!.toUpperCase() !== hsvToHex(hsvRef.current)) {
      setHsv(next);
      setHexText(value!.toUpperCase());
    }
  }, [value]);

  const current = hsvToHex(hsv);
  const commit = () => onChange(hsvToHex(hsvRef.current));

  const update = (next: HSV) => {
    setHsv(next);
    setHexText(hsvToHex(next));
  };

  const onSvDown = useDrag(svRef, (x, y) => update({ ...hsvRef.current, s: x, v: 1 - y }), commit);
  // الشريط اتجاهه LTR دائماً (أحمر يساراً) مثل كل منتقيات الألوان
  const onHueDown = useDrag(hueRef, x => update({ ...hsvRef.current, h: Math.min(359.9, x * 360) }), commit);

  const applyHex = (text: string) => {
    const t = text.startsWith('#') ? text : `#${text}`;
    const next = hexToHsv(t);
    if (!next) return false;
    setHsv(next);
    setHexText(rgbToHex(...hexToRgb(t)!));
    onChange(rgbToHex(...hexToRgb(t)!));
    return true;
  };

  const eyeDropper = typeof window !== 'undefined'
    ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
    : undefined;
  const pickFromScreen = async () => {
    if (!eyeDropper) return;
    try {
      const { sRGBHex } = await new eyeDropper().open();
      applyHex(sRGBHex);
    } catch { /* ألغاها المستخدم */ }
  };

  // لوحة الأسهم للمربع والشريط (إمكانية الوصول)
  const svKey = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 0.1 : 0.02;
    const h = hsvRef.current;
    const map: Record<string, HSV> = {
      ArrowLeft: { ...h, s: clamp01(h.s - d) }, ArrowRight: { ...h, s: clamp01(h.s + d) },
      ArrowUp: { ...h, v: clamp01(h.v + d) }, ArrowDown: { ...h, v: clamp01(h.v - d) },
    };
    if (map[e.key]) { e.preventDefault(); update(map[e.key]); }
  };
  const hueKey = (e: React.KeyboardEvent) => {
    const d = e.shiftKey ? 15 : 3;
    const h = hsvRef.current;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); update({ ...h, h: Math.max(0, h.h - d) }); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); update({ ...h, h: Math.min(359.9, h.h + d) }); }
  };

  const thumb = 'absolute w-5 h-5 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.3)] pointer-events-none -translate-x-1/2 -translate-y-1/2';

  return (
    <div className="flex flex-col gap-3 w-64" dir="ltr">
      {/* التشبّع (أفقي) × الإضاءة (رأسي) */}
      <div
        ref={svRef}
        role="slider"
        tabIndex={0}
        aria-label="التشبّع والإضاءة"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={current}
        onPointerDown={onSvDown}
        onKeyDown={svKey}
        onKeyUp={e => { if (e.key.startsWith('Arrow')) commit(); }}
        className="relative h-40 rounded-xl cursor-crosshair touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`,
        }}
      >
        <span className={thumb} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }} />
      </div>

      {/* الدرجة */}
      <div
        ref={hueRef}
        role="slider"
        tabIndex={0}
        aria-label="درجة اللون"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={onHueDown}
        onKeyDown={hueKey}
        onKeyUp={e => { if (e.key.startsWith('Arrow')) commit(); }}
        className="relative h-3.5 rounded-full cursor-pointer touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span className={thumb} style={{ left: `${(hsv.h / 360) * 100}%`, top: '50%', background: `hsl(${hsv.h}, 100%, 50%)` }} />
      </div>

      {/* القطّارة + Hex + المعاينة */}
      <div className="flex items-center gap-2">
        {eyeDropper && (
          <button
            type="button"
            onClick={pickFromScreen}
            title="اختر لوناً من الشاشة"
            aria-label="اختر لوناً من الشاشة"
            className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.5 3.5a2.1 2.1 0 013 3L16 9l-1 1-6.5 6.5L5 18l1.5-3.5L13 8l1-1 1.5-3.5zM14 7l3 3M5 18l-1.5 1.5" />
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0 flex items-center gap-2 h-11 px-3 rounded-xl border border-slate-200 focus-within:ring-2 focus-within:ring-violet-500">
          <input
            value={hexText}
            onChange={e => setHexText(e.target.value.toUpperCase())}
            onBlur={() => { if (!applyHex(hexText)) setHexText(current); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            spellCheck={false}
            aria-label="رمز اللون Hex"
            size={8}
            className="flex-1 min-w-0 w-full bg-transparent font-mono text-sm tracking-wide text-slate-700 focus:outline-none"
          />
          <span className="w-7 h-7 rounded-full shrink-0 ring-1 ring-black/10" style={{ background: current }} />
        </div>
      </div>
    </div>
  );
}
