'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import MobileToggle from '@/components/layout/MobileToggle';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopOpen, setDesktopOpen] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('sidebar-desktop');
    if (saved !== null) setDesktopOpen(saved === 'true');
  }, []);

  const toggleDesktop = () => {
    const next = !desktopOpen;
    setDesktopOpen(next);
    localStorage.setItem('sidebar-desktop', String(next));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Overlay on mobile */}
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
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-20 bg-slate-900 px-4 py-3 flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="text-white p-1" aria-label="فتح القائمة">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-white font-bold text-sm flex-1">نظام إدارة الوجبات</span>
          <MobileToggle />
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

        {children}
      </main>
    </div>
  );
}
