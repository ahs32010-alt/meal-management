'use client';

import { useEffect, useState } from 'react';

export default function MobileToggle({ className = '' }: { className?: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('mobile-mode') === 'true';
    setOn(saved);
    document.documentElement.setAttribute('data-mobile', String(saved));
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    localStorage.setItem('mobile-mode', String(next));
    document.documentElement.setAttribute('data-mobile', String(next));
  };

  return (
    <button
      onClick={toggle}
      title={on ? 'إيقاف وضع الجوال' : 'تفعيل وضع الجوال'}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
        on
          ? 'bg-emerald-500 text-white shadow-sm'
          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
      } ${className}`}
    >
      <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
      <span>{on ? 'وضع الجوال' : 'وضع الجوال'}</span>
      <span className={`w-7 h-4 rounded-full transition-colors flex items-center px-0.5 ${on ? 'bg-emerald-300' : 'bg-slate-500'}`}>
        <span className={`w-3 h-3 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-3' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}
