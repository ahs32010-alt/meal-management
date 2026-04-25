'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useCurrentUser } from '@/lib/use-current-user';
import { can, type PageKey } from '@/lib/permissions';
import ThemeToggle from '@/components/layout/ThemeToggle';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

const navItems: { href: string; label: string; page: PageKey; icon: React.ReactNode }[] = [
  {
    href: '/',
    label: 'لوحة التحكم',
    page: 'dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/beneficiaries',
    label: 'المستفيدون',
    page: 'beneficiaries',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/meals',
    label: 'الأصناف',
    page: 'meals',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
  {
    href: '/orders',
    label: 'أوامر التشغيل',
    page: 'orders',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: '/reports',
    label: 'التقارير',
    page: 'reports',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: '/stickers',
    label: 'الستيكرات',
    page: 'stickers',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: 'الإعدادات',
    page: 'settings',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

interface SidebarProps {
  open?: boolean;
  desktopOpen?: boolean;
  onClose?: () => void;
  onToggleDesktop?: () => void;
}

export default function Sidebar({ open = true, desktopOpen = true, onClose, onToggleDesktop }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { user: currentUser, loading: userLoading } = useCurrentUser();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // While loading, show nothing (avoid flashing restricted links). Admins see everything.
  const visibleItems = userLoading
    ? []
    : navItems.filter(item => can(currentUser, item.page, 'view'));

  useEffect(() => { onClose?.(); }, [pathname]);

  const handleLogout = async () => {
    setConfirmOpen(false);
    try { await supabase.removeAllChannels(); } catch {}
    try { await supabase.auth.signOut(); } catch {}
    router.push('/login');
  };

  const desktopClass = desktopOpen ? 'md:translate-x-0' : 'md:translate-x-full';

  return (
    <aside className={`w-64 bg-slate-900 fixed right-0 top-0 h-screen flex flex-col z-40 shadow-xl transition-transform duration-300
      ${desktopClass} ${open ? 'translate-x-0' : 'translate-x-full'}`}>
      {/* Logo */}
      <div className="px-4 py-4 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          {onClose && (
            <button onClick={onClose} className="md:hidden text-slate-400 hover:text-white ml-auto order-last" title="إغلاق">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-black flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="مركز خطوة أمل" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-sm leading-tight truncate">مركز خطوة أمل</h1>
          </div>

          {/* Theme toggle (icon) */}
          <ThemeToggle variant="sidebarIcon" />

          {/* Desktop hide button */}
          <button
            onClick={onToggleDesktop}
            className="hidden md:flex text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-slate-700"
            title="إخفاء القائمة"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-150 group ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-white'}>
                {item.icon}
              </span>
              <span className="font-medium text-sm">{item.label}</span>
              {isActive && (
                <div className="mr-auto w-1.5 h-1.5 bg-emerald-300 rounded-full" />
              )}
            </Link>
          );
        })}

        {/* Logout — placed below Settings with extra spacing + a subtle divider */}
        {!userLoading && (
          <div className="pt-6 mt-4 border-t border-slate-700/50">
            <button
              onClick={() => setConfirmOpen(true)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-xl w-full text-slate-300 hover:bg-rose-500/15 hover:text-rose-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="font-medium text-sm">تسجيل الخروج</span>
            </button>
          </div>
        )}
      </nav>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="تأكيد تسجيل الخروج"
        message="هل أنت متأكد من رغبتك في تسجيل الخروج؟"
        confirmLabel="خروج"
        icon={
          <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        }
        onConfirm={handleLogout}
        onCancel={() => setConfirmOpen(false)}
      />
    </aside>
  );
}
