'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCurrentUser } from '@/lib/use-current-user';
import { can, type PageKey } from '@/lib/permissions';

interface TabItem {
  href: string;
  label: string;
  page: PageKey;
  icon: React.ReactNode;
}

const TABS: TabItem[] = [
  {
    href: '/',
    label: 'الرئيسية',
    page: 'dashboard',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    href: '/orders',
    label: 'الأوامر',
    page: 'orders',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: '/beneficiaries',
    label: 'المستفيدون',
    page: 'beneficiaries',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/meals',
    label: 'الأصناف',
    page: 'meals',
    icon: (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
  },
];

export default function BottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();
  const { user: currentUser } = useCurrentUser();

  const visibleTabs = TABS.filter(t => can(currentUser, t.page, 'view'));

  // "More" highlights when on a page that's not in the bottom tabs
  const onMorePage = !visibleTabs.some(t => t.href === '/' ? pathname === '/' : pathname.startsWith(t.href));

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 shadow-[0_-2px_10px_rgba(0,0,0,0.04)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
      <div className="flex items-stretch justify-around">
        {visibleTabs.map(tab => {
          const isActive = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                isActive ? 'text-emerald-600' : 'text-slate-400 active:text-slate-600'
              }`}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {isActive && <span className="absolute top-0 w-8 h-0.5 bg-emerald-500 rounded-b-full" />}
              <span className={`transition-transform ${isActive ? 'scale-110' : ''}`}>{tab.icon}</span>
              <span className="text-[10px] font-semibold">{tab.label}</span>
            </Link>
          );
        })}
        <button
          onClick={onMore}
          className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
            onMorePage ? 'text-emerald-600' : 'text-slate-400 active:text-slate-600'
          }`}
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          {onMorePage && <span className="absolute top-0 w-8 h-0.5 bg-emerald-500 rounded-b-full" />}
          <svg className={`w-6 h-6 transition-transform ${onMorePage ? 'scale-110' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-[10px] font-semibold">المزيد</span>
        </button>
      </div>
    </nav>
  );
}
