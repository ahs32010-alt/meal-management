'use client';

import { useMemo } from 'react';

// طبقة خلفية ثابتة فيها ايموجيات أكل تطفو ببطء. تظهر فقط لما ثيم الدلع مفعَّل.
// تنرسم خلف كل المحتوى (z-0 + pointer-events-none) عشان ما تعطل التفاعل.
const FOODS = ['🍎', '🍕', '🍰', '🥑', '🍓', '🥐', '🍔', '🥗', '🍩', '🍪', '🍇', '🍉', '🥕', '🍞', '🧁', '🍿', '🍣', '🥨', '🍋', '🥝', '🍒', '🌮', '🍙', '🥞'];

interface Sprite {
  emoji: string;
  top: string;
  left: string;
  size: number;
  delay: number;
  duration: number;
  rotate: number;
}

function buildSprites(count: number, seed: number): Sprite[] {
  // PRNG بسيطة عشان توزيع ثابت بين رندرات (تفادي hydration mismatch لو دعت الحاجة)
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  return Array.from({ length: count }, () => ({
    emoji: FOODS[Math.floor(rand() * FOODS.length)],
    top: `${Math.floor(rand() * 100)}%`,
    left: `${Math.floor(rand() * 100)}%`,
    size: 22 + Math.floor(rand() * 26),
    delay: rand() * 8,
    duration: 9 + rand() * 9,
    rotate: -25 + rand() * 50,
  }));
}

export default function CuteBackground() {
  const sprites = useMemo(() => buildSprites(34, 42), []);

  return (
    <div
      aria-hidden
      className="cute-bg fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 0 }}
    >
      {sprites.map((s, i) => (
        <span
          key={i}
          className="cute-bg-sprite"
          style={{
            top: s.top,
            left: s.left,
            fontSize: `${s.size}px`,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.duration}s`,
            ['--r' as string]: `${s.rotate}deg`,
          }}
        >
          {s.emoji}
        </span>
      ))}
    </div>
  );
}
