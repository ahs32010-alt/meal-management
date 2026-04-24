'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Overlay on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <Sidebar open={open} onClose={() => setOpen(false)} />

      <main className="md:mr-64 min-h-screen">
        {/* Hamburger bar */}
        <div className="md:hidden sticky top-0 z-20 bg-slate-900 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setOpen(true)}
            className="text-white p-1"
            aria-label="فتح القائمة"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-white font-bold text-sm">نظام إدارة الوجبات</span>
        </div>

        {children}
      </main>
    </div>
  );
}
