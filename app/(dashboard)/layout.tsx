'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import BottomNav from '@/components/layout/BottomNav';

const PAGE_TITLES: Record<string, string> = {
  '/':              'الرئيسية',
  '/beneficiaries': 'المستفيدون',
  '/meals':         'الأصناف',
  '/orders':        'أوامر التشغيل',
  '/reports':       'التقارير',
  '/stickers':      'الستيكرات',
  '/settings':      'الإعدادات',
};

function getTitle(pathname: string) {
  if (pathname === '/') return PAGE_TITLES['/'];
  const match = Object.keys(PAGE_TITLES).find(k => k !== '/' && pathname.startsWith(k));
  return match ? PAGE_TITLES[match] : 'نظام إدارة الوجبات';
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-desktop');
    if (saved !== null) setDesktopOpen(saved === 'true');
    // Clear retired "mobile mode" flag so it never re-applies
    document.documentElement.removeAttribute('data-mobile');
    localStorage.removeItem('mobile-mode');
  }, []);

  const toggleDesktop = () => {
    const next = !desktopOpen;
    setDesktopOpen(next);
    localStorage.setItem('sidebar-desktop', String(next));
  };

  const title = getTitle(pathname);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Overlay on mobile when sidebar drawer is open */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <Sidebar
        open={mobileOpen}
        desktopOpen={desktopOpen}
        onClose={() => setMobileOpen(false)}
        onToggleDesktop={toggleDesktop}
      />

      <main className={`min-h-screen transition-all duration-300 ${desktopOpen ? 'md:mr-64' : 'md:mr-0'}`}>
        {/* Mobile top bar — native app-style */}
        <div
          className="md:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 flex items-center gap-3"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0) + 10px)',
            paddingBottom: 10,
          }}
        >
          <div className="w-9 h-9 bg-emerald-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <h1 className="flex-1 font-bold text-slate-800 text-base truncate">{title}</h1>
        </div>

        {/* Desktop top bar — ظاهر فقط لما السايدبار مخفي */}
        {!desktopOpen && (
          <div className="hidden md:flex sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-2">
            <button
              onClick={toggleDesktop}
              className="flex items-center gap-2 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors text-sm font-medium"
              title="إظهار القائمة"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              القائمة
            </button>
          </div>
        )}

        {/* Content — extra bottom padding on mobile to clear the bottom nav */}
        <div className="pb-24 md:pb-0">
          {children}
        </div>
      </main>

      {/* Bottom nav bar — mobile only */}
      <BottomNav onMore={() => setMobileOpen(true)} />
    </div>
  );
}
