'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { AppUser } from '@/lib/permissions';

const CACHE_KEY = 'kha:user';
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

interface CachedEntry {
  user: AppUser | null;
  ts: number;
}

let inflight: Promise<AppUser | null> | null = null;
let memoryCache: CachedEntry | null = null;

function readCache(): CachedEntry | null {
  if (memoryCache && Date.now() - memoryCache.ts < CACHE_TTL_MS) return memoryCache;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedEntry;
    if (Date.now() - entry.ts < CACHE_TTL_MS) {
      memoryCache = entry;
      return entry;
    }
  } catch {
    // ignore
  }
  return null;
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
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    const { data } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', auth.user.id)
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

export function useCurrentUser() {
  const [user, setUser] = useState<AppUser | null>(() => readCache()?.user ?? null);
  const [loading, setLoading] = useState(() => !readCache());

  useEffect(() => {
    let cancelled = false;
    const cur = readCache();
    if (cur) {
      // Already have a fresh cached value — skip the network round-trip.
      if (!user) setUser(cur.user);
      setLoading(false);
    } else {
      fetchUser().then((u) => {
        if (cancelled) return;
        writeCache({ user: u, ts: Date.now() });
        setUser(u);
        setLoading(false);
      });
    }

    // Subscribe to refreshes triggered elsewhere (e.g. avatar upload).
    const listener: Listener = (u) => setUser(u);
    listeners.add(listener);
    return () => { cancelled = true; listeners.delete(listener); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
