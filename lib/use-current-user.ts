'use client';

// المستخدم الحالي مع صلاحياته. التحديث:
//   1) على mount: نعرض cache فوري لتفادي الـflicker، ثم نجلب من DB دائماً
//      (stale-while-revalidate). أي refresh للصفحة يجيب أحدث صلاحيات.
//   2) realtime: نشترك في صف الـapp_users الخاص بالمستخدم — لو الأدمن عدّل
//      الصلاحيات، تتحدّث فوراً عند المستخدم بدون refresh.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase-client';
import type { AppUser } from '@/lib/permissions';

const CACHE_KEY = 'kha:user';

interface CachedEntry {
  user: AppUser | null;
  ts: number;
}

let inflight: Promise<AppUser | null> | null = null;
let memoryCache: CachedEntry | null = null;

/**
 * آخر جلب فعلي من DB **في هذا التحميل للصفحة** (ذاكرة فقط — يُصفَّر مع أي
 * refresh فيبقى «الـrefresh يجيب أحدث صلاحيات» صحيحاً). الـhook مستخدم في
 * عشرات المكوّنات، فبدون هذا كان كل تنقّل بين الصفحات يطلق استعلام app_users
 * جديداً. التغييرات أثناء الجلسة تصل عبر realtime على أي حال.
 */
const FRESH_MS = 60_000;
let lastFetchedAt = 0;

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

/**
 * نفس المحتوى ⇒ نفس المرجع. كل hook يعتمد على `[user]` (عداد الموافقات،
 * useMyPending، OfflineProvider...) كان يعيد الجلب ويهدم قناة realtime ويبنيها
 * مع كل جلب جديد لأن الكائن جديد ولو لم يتغيّر فيه شيء.
 */
function stableUser(u: AppUser | null): AppUser | null {
  const prev = memoryCache?.user ?? null;
  if (prev && u && JSON.stringify(prev) === JSON.stringify(u)) return prev;
  return u;
}

function writeCache(entry: CachedEntry) {
  entry = { ...entry, user: stableUser(entry.user) };
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
    // نستخدم getSession() بدل getUser() — getSession يقرأ من localStorage
    // محلياً بلا قفل ولا طلب شبكة، فيتفادى التصادم لما عدة hooks ينادون معاً.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;
    const { data } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle();
    lastFetchedAt = Date.now();
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
type RealtimeChannel = ReturnType<typeof supabase.channel>;
let globalChannel: RealtimeChannel | null = null;
let globalChannelUserId: string | null = null;

function ensureRealtimeSubscription(userId: string) {
  if (globalChannelUserId === userId && globalChannel) return;
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
          notify(memoryCache?.user ?? u);
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

    // 2) نجلب من DB لنحدّث الصلاحيات فوراً عند الـrefresh — إلا لو جلبنا
    //    للتوّ في هذا التحميل والقناة الحيّة شغّالة (هي تبلّغنا بأي تغيير).
    //    نضمن وجود subscription عالمية بعد ما نعرف الـuserId.
    if (cached && globalChannel && Date.now() - lastFetchedAt < FRESH_MS) {
      const listener: Listener = (u) => setUser(u);
      listeners.add(listener);
      return () => {
        cancelled = true;
        listeners.delete(listener);
      };
    }

    fetchUser().then(u => {
      if (cancelled) return;
      writeCache({ user: u, ts: Date.now() });
      const stable = memoryCache?.user ?? u;
      setUser(stable);
      setLoading(false);
      notify(stable);
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
  lastFetchedAt = 0;
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
