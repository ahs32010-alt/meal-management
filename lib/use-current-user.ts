'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { AppUser } from '@/lib/permissions';

const CACHE_KEY = 'kha:user';
const CACHE_TTL_MS = 60_000; // 1 minute

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

export function useCurrentUser() {
  const cached = readCache();
  const [user, setUser] = useState<AppUser | null>(cached?.user ?? null);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    let cancelled = false;
    const cur = readCache();
    if (cur) {
      // Already have a fresh cached value — skip the network round-trip.
      if (!user) setUser(cur.user);
      setLoading(false);
      return;
    }
    fetchUser().then((u) => {
      if (cancelled) return;
      writeCache({ user: u, ts: Date.now() });
      setUser(u);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user]);

  return { user, loading };
}

export function clearCurrentUserCache() {
  memoryCache = null;
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
  }
}
