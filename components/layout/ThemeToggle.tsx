'use client';

import { useEffect, useState } from 'react';

type Variant = 'sidebar' | 'sidebarIcon' | 'topbar' | 'compact';

interface Props {
  variant?: Variant;
  className?: string;
}

export default function ThemeToggle({ variant = 'sidebar', className = '' }: Props) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme') === 'dark';
    setDark(saved);
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  if (!mounted) {
    if (variant === 'compact') return <div className={`w-9 h-9 ${className}`} />;
    if (variant === 'sidebarIcon') return <div className={`w-8 h-8 ${className}`} />;
    return <div className={`h-9 ${className}`} />;
  }

  const sun = (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );

  const moon = (
    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  );

  if (variant === 'sidebarIcon') {
    return (
      <button
        onClick={toggle}
        title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
        aria-label="theme toggle"
        className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
          dark ? 'text-amber-300 hover:bg-slate-700' : 'text-sky-300 hover:bg-slate-700'
        } ${className}`}
      >
        {dark ? sun : moon}
      </button>
    );
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={toggle}
        title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
        aria-label="theme toggle"
        className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
          dark
            ? 'bg-slate-800 text-amber-300 hover:bg-slate-700'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        } ${className}`}
      >
        {dark ? sun : moon}
      </button>
    );
  }

  if (variant === 'topbar') {
    return (
      <button
        onClick={toggle}
        title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
        aria-label="theme toggle"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          dark
            ? 'bg-slate-800 text-amber-300 hover:bg-slate-700'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
        } ${className}`}
      >
        {dark ? sun : moon}
        <span>{dark ? 'فاتح' : 'داكن'}</span>
      </button>
    );
  }

  // sidebar variant — full-width pill that matches sidebar styling (dark-on-dark sidebar)
  return (
    <button
      onClick={toggle}
      title={dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      aria-label="theme toggle"
      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all w-full text-slate-300 hover:bg-slate-800 hover:text-white ${className}`}
    >
      <span className={dark ? 'text-amber-300' : 'text-sky-300'}>
        {dark ? sun : moon}
      </span>
      <span className="font-medium text-sm">
        {dark ? 'الوضع الفاتح' : 'الوضع الداكن'}
      </span>
      <span className={`mr-auto w-9 h-5 rounded-full transition-colors flex items-center px-0.5 ${dark ? 'bg-emerald-500' : 'bg-slate-600'}`}>
        <span className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${dark ? '-translate-x-4' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}
