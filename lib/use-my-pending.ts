'use client';

// Hook موحَّد لجلب طلبات الموافقة pending الخاصة بالمستخدم الحالي،
// مفلترة بنوع كيان معيّن. realtime — يتحدّث فوراً عند تغيير أي طلب.
//
// الاستخدام:
//   const { hasUpdate, hasDelete, getCreates, hasAnyPending } = useMyPending('meal');
//   if (hasDelete(meal.id)) { /* اعرض شطب أحمر */ }

import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { createClient } from '@/lib/supabase-client';
import { useCurrentUser } from './use-current-user';
import type { PendingAction, PendingEntityType } from './pending-actions';

export interface MyPendingState {
  ready: boolean;
  // طلبات pending للمستخدم الحالي على نوع الكيان المطلوب
  items: PendingAction[];
  // هل في طلب تعديل pending لهذا الـid؟
  hasUpdate: (entityId: string) => boolean;
  // هل في طلب حذف pending لهذا الـid؟
  hasDelete: (entityId: string) => boolean;
  // طلب الإنشاء (الأشباح) — كيانات ما زالت ما تُنشأ بعد
  getCreates: () => PendingAction[];
  // أي pending action على هذا الـid (update/delete)
  getForId: (entityId: string) => PendingAction | undefined;
}

export function useMyPending(entityType: PendingEntityType): MyPendingState {
  const { user } = useCurrentUser();
  const supabase = useMemo(() => createClient(), []);
  const channelId = useId();
  const [items, setItems] = useState<PendingAction[]>([]);
  const [ready, setReady] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) { setItems([]); setReady(true); return; }
    const { data, error } = await supabase
      .from('pending_actions')
      .select('*')
      .eq('status', 'pending')
      .eq('user_id', user.id)
      .eq('entity_type', entityType)
      .order('created_at', { ascending: false });
    if (!error) setItems((data ?? []) as PendingAction[]);
    setReady(true);
  }, [supabase, user, entityType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchRef = useRef(fetchData);
  useEffect(() => { fetchRef.current = fetchData; }, [fetchData]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`my-pending-${entityType}-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_actions' }, () => fetchRef.current())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, user, entityType, channelId]);

  const updates = useMemo(() => new Set(items.filter(i => i.action === 'update' && i.entity_id).map(i => i.entity_id!)), [items]);
  const deletes = useMemo(() => new Set(items.filter(i => i.action === 'delete' && i.entity_id).map(i => i.entity_id!)), [items]);
  const byId = useMemo(() => {
    const m = new Map<string, PendingAction>();
    for (const i of items) {
      if (i.entity_id) m.set(i.entity_id, i);
    }
    return m;
  }, [items]);

  return {
    ready,
    items,
    hasUpdate: (id) => updates.has(id),
    hasDelete: (id) => deletes.has(id),
    getCreates: () => items.filter(i => i.action === 'create'),
    getForId: (id) => byId.get(id),
  };
}
