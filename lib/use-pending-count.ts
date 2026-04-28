'use client';

// عداد طلبات الموافقة pending — للأدمن: كل الطلبات؛ لليوزر: طلباته فقط.
// realtime عشان العداد ينحدّث فوراً عند أي تغيير في pending_actions.

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useCurrentUser } from './use-current-user';

export function usePendingCount(): number {
  const { user } = useCurrentUser();
  const supabase = useMemo(() => createClient(), []);
  const channelId = useId();
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!user) { setCount(0); return; }
    let q = supabase
      .from('pending_actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (!user.is_admin) q = q.eq('user_id', user.id);
    const { count: c, error } = await q;
    if (error) {
      // الجدول ما موجود (الـmigration ما اتشغّل) → نخلي العداد صفر بدون كسر
      setCount(0);
      return;
    }
    setCount(c ?? 0);
  }, [supabase, user]);

  useEffect(() => { fetchCount(); }, [fetchCount]);

  const fetchRef = useRef(fetchCount);
  useEffect(() => { fetchRef.current = fetchCount; }, [fetchCount]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`pending-count-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_actions' }, () => fetchRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, user, channelId]);

  return count;
}
