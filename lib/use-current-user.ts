'use client';

// المستخدم الحالي مع صلاحياته. التحديث:
//   1) على mount: نعرض cache فوري لتفادي الـflicker، ثم نجلب من DB دائماً
//      (stale-while-revalidate). أي refresh للصفحة يجيب أحدث صلاحيات.
//   2) realtime: نشترك في صف الـapp_users الخاص بالمستخدم — لو الأدمن عدّل
//      الصلاحيات، تتحدّث فوراً عند المستخدم بدون refresh.

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { AppUser } from '@/lib/permissions';

const CACHE_KEY = 'kha:user';

interface CachedEntry {
  user: AppUser | null;
  ts: number;
}

let inflight: Promise<AppUser | null> | null = null;
let memoryCache: CachedEntry | null = null;

function readCache(): CachedEntry | null {
  if (memoryCache) return memoryCache;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    memoryCache = entry;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(entry: CachedEntry) {
  memoryCache = entry;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore
  }
}

async function fetchUser(): Promise<AppUser | null> {
  if (inflight) return inflight;
  inflight = (async () => {
    const supabase = createClient();
    // نستخدم getSession() بدل getUser() — getSession يقرأ من localStorage
    // محلياً بلا قفل ولا طلب شبكة، فيتفادى التصادم لما عدة hooks ينادون معاً.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    return (data as AppUser | null) ?? null;
  })();
  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

type Listener = (u: AppUser | null) => void;
const listeners = new Set<Listener>();

function notify(u: AppUser | null) {
  for (const l of listeners) l(u);
}

// Singleton realtime subscription — كل instances الـhook يشاركون قناة واحدة
// عالمية بدل ما كل instance يفتح قناة جديدة بنفس الاسم (يسبب: cannot add
// postgres_changes callbacks after subscribe).
type RealtimeChannel = ReturnType<ReturnType<typeof createClient>['channel']>;
let globalChannel: RealtimeChannel | null = null;
let globalChannelUserId: string | null = null;

function ensureRealtimeSubscription(userId: string) {
  if (globalChannelUserId === userId && globalChannel) return;
  const supabase = createClient();
  // نظّف القناة القديمة لو كانت لمستخدم آخر (تبديل حسابات في نفس التبويب)
  if (globalChannel) {
    try { supabase.removeChannel(globalChannel); } catch { /* ignore */ }
    globalChannel = null;
  }
  globalChannelUserId = userId;
  globalChannel = supabase
    .channel(`app-user-global-${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'app_users', filter: `id=eq.${userId}` },
      () => {
        fetchUser().then(u => {
          writeCache({ user: u, ts: Date.now() });
          notify(u);
        });
      }
    )
    .subscribe();
}

export function useCurrentUser() {
  // SSR-safe initial state — لا نقرأ sessionStorage في render عشان ما يصير
  // hydration mismatch.
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // 1) عرض الـcache (فوري) لتفادي الـflicker
    const cached = readCache();
    if (cached) {
      setUser(cached.user);
      setLoading(false);
    }

    // 2) دائماً نجلب من DB لنحدّث الصلاحيات فوراً عند الـrefresh.
    //    نضمن وجود subscription عالمية بعد ما نعرف الـuserId.
    fetchUser().then(u => {
      if (cancelled) return;
      writeCache({ user: u, ts: Date.now() });
      setUser(u);
      setLoading(false);
      notify(u);
      if (u?.id) ensureRealtimeSubscription(u.id);
    });

    // كل instance يسجّل listener — Singleton الـsubscription يستدعي notify،
    // والـnotify يبلّغ كل الـinstances.
    const listener: Listener = (u) => setUser(u);
    listeners.add(listener);

    return () => {
      cancelled = true;
      listeners.delete(listener);
    };
  }, []);

  const refresh = useCallback(async () => {
    clearCurrentUserCache();
    const u = await fetchUser();
    writeCache({ user: u, ts: Date.now() });
    notify(u);
    return u;
  }, []);

  return { user, loading, refresh };
}

export function clearCurrentUserCache() {
  memoryCache = null;
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  }
}

export async function refreshCurrentUser(): Promise<AppUser | null> {
  clearCurrentUserCache();
  const u = await fetchUser();
  writeCache({ user: u, ts: Date.now() });
  notify(u);
  return u;
}
