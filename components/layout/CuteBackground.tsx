'use client';

import { useEffect, useRef, useState } from 'react';

// طبقة خلفية فيها ايموجيات أكل تتحرك وتصقع في بعضها وترتد عن حواف الصفحة.
// محاكاة فيزيائية بسيطة بـ requestAnimationFrame — ما تستخدم state في الـloop
// عشان ما تسبب re-renders مكلفة.
const FOODS = ['🍎', '🍕', '🍰', '🥑', '🍓', '🥐', '🍔', '🥗', '🍩', '🍪', '🍇', '🍉', '🥕', '🍞', '🧁', '🍿', '🍣', '🥨', '🍋', '🥝', '🍒', '🌮', '🍙', '🥞'];

const COUNT = 50;

interface SpriteState {
  emoji: string;
  size: number;
  x: number;     // مركز الايموجي بالبكسل
  y: number;
  vx: number;    // السرعة بالبكسل/إطار
  vy: number;
  rot: number;
  vrot: number;
}

function makeRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildSprites(w: number, h: number, seed: number): SpriteState[] {
  const rand = makeRand(seed);
  const signed = () => rand() * 2 - 1;
  return Array.from({ length: COUNT }, () => ({
    emoji: FOODS[Math.floor(rand() * FOODS.length)],
    size: 36 + Math.floor(rand() * 36),
    x: rand() * w,
    y: rand() * h,
    vx: signed() * 0.55,
    vy: signed() * 0.55,
    rot: -30 + rand() * 60,
    vrot: signed() * 0.5,
  }));
}

export default function CuteBackground() {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const spritesRef = useRef<SpriteState[]>([]);
  const elsRef = useRef<(HTMLSpanElement | null)[]>([]);
  const sizeRef = useRef({ w: 0, h: 0 });

  // تأخير الـmount عشان نستخدم window بأمان (الـparent يضمن إنه client-only)
  useEffect(() => {
    sizeRef.current = { w: window.innerWidth, h: window.innerHeight };
    spritesRef.current = buildSprites(sizeRef.current.w, sizeRef.current.h, 42);
    elsRef.current = new Array(COUNT).fill(null);
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const onResize = () => {
      sizeRef.current = { w: window.innerWidth, h: window.innerHeight };
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    let running = true;
    const onVisibility = () => {
      // وقّف الانيميشن إذا التبويب مخفي عشان توفير CPU
      if (document.hidden) running = false;
      else { running = true; raf = requestAnimationFrame(tick); }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const tick = () => {
      if (!running) return;
      const sprites = spritesRef.current;
      const els = elsRef.current;
      const { w: W, h: H } = sizeRef.current;

      // تحديث الموقع + ارتداد عن الحواف
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        s.x += s.vx;
        s.y += s.vy;
        s.rot += s.vrot;
        const r = s.size / 2;
        if (s.x - r < 0)   { s.x = r;       s.vx = Math.abs(s.vx); s.vrot = -s.vrot * 0.9; }
        if (s.x + r > W)   { s.x = W - r;   s.vx = -Math.abs(s.vx); s.vrot = -s.vrot * 0.9; }
        if (s.y - r < 0)   { s.y = r;       s.vy = Math.abs(s.vy); s.vrot = -s.vrot * 0.9; }
        if (s.y + r > H)   { s.y = H - r;   s.vy = -Math.abs(s.vy); s.vrot = -s.vrot * 0.9; }
      }

      // تصادم زوجي — N²، 50×50 = 2500 فحص/إطار، خفيف.
      for (let i = 0; i < sprites.length; i++) {
        const a = sprites[i];
        for (let j = i + 1; j < sprites.length; j++) {
          const b = sprites[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distSq = dx * dx + dy * dy;
          const minDist = (a.size + b.size) * 0.36; // أصغر شوي من المجموع — التصادم بصرياً ألطف
          if (distSq < minDist * minDist && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;

            // فك التداخل
            const overlap = (minDist - dist) / 2;
            a.x -= nx * overlap;
            a.y -= ny * overlap;
            b.x += nx * overlap;
            b.y += ny * overlap;

            // تبادل المركّبة على المحور الطبيعي (تصادم مرن — كتلة متساوية)
            const av = a.vx * nx + a.vy * ny;
            const bv = b.vx * nx + b.vy * ny;
            const exchange = bv - av;
            a.vx += exchange * nx;
            a.vy += exchange * ny;
            b.vx -= exchange * nx;
            b.vy -= exchange * ny;

            // لمسة دلع: شوية دوران إضافي عند الاصطدام
            a.vrot += (Math.random() - 0.5) * 0.6;
            b.vrot += (Math.random() - 0.5) * 0.6;
          }
        }
      }

      // طبّق الحركة على DOM (translate3d لتسريع GPU)
      for (let i = 0; i < sprites.length; i++) {
        const s = sprites[i];
        const el = els[i];
        if (el) {
          el.style.transform = `translate3d(${s.x - s.size / 2}px, ${s.y - s.size / 2}px, 0) rotate(${s.rot}deg)`;
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mounted]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className="cute-bg fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {mounted && spritesRef.current.map((s, i) => (
        <span
          key={i}
          ref={el => { elsRef.current[i] = el; }}
          className="cute-bg-sprite"
          style={{
            fontSize: `${s.size}px`,
            top: 0,
            left: 0,
            transform: `translate3d(${s.x - s.size / 2}px, ${s.y - s.size / 2}px, 0) rotate(${s.rot}deg)`,
          }}
        >
          {s.emoji}
        </span>
      ))}
    </div>
  );
}
