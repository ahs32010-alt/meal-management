'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import type { AppUser } from '@/lib/permissions';

export function useCurrentUser() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        if (!cancelled) { setUser(null); setLoading(false); }
        return;
      }
      const { data } = await supabase
        .from('app_users')
        .select('*')
        .eq('id', auth.user.id)
        .maybeSingle();
      if (!cancelled) {
        setUser(data as AppUser | null);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { user, loading };
}
