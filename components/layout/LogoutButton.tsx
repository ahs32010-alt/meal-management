'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';

export default function LogoutButton() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    try { await supabase.removeAllChannels(); } catch {}
    try { await supabase.auth.signOut(); } catch {}
    router.push('/login');
  };

  return (
    <button
      onClick={handleLogout}
      title="تسجيل الخروج"
      aria-label="تسجيل الخروج"
      className="logout-fab fixed z-40 flex items-center gap-2 px-3 py-2 rounded-xl
                 bg-white/90 dark:bg-slate-800/90 backdrop-blur
                 border border-slate-200 dark:border-slate-700
                 text-slate-700 dark:text-slate-200
                 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600
                 dark:hover:bg-rose-500/15 dark:hover:border-rose-400/40 dark:hover:text-rose-300
                 shadow-lg transition-colors text-sm font-semibold"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
      </svg>
      <span>خروج</span>
    </button>
  );
}
