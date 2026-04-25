import { createAdminClient } from '@/lib/supabase-admin';
import type { ActivityAction, ActivityEntityType } from '@/lib/activity-log';

interface LogServerInput {
  user_id: string | null;
  user_email?: string | null;
  user_name?: string | null;
  action: ActivityAction;
  entity_type: ActivityEntityType;
  entity_id?: string | null;
  entity_name?: string | null;
  details?: Record<string, unknown> | null;
}

export async function logActivityServer(input: LogServerInput): Promise<void> {
  try {
    const admin = createAdminClient();

    let userEmail = input.user_email ?? null;
    let userName = input.user_name ?? null;
    if (input.user_id && (!userEmail || !userName)) {
      const { data: row } = await admin
        .from('app_users')
        .select('email, full_name')
        .eq('id', input.user_id)
        .maybeSingle();
      if (row) {
        userEmail = userEmail ?? row.email;
        userName = userName ?? row.full_name ?? row.email;
      }
    }

    await admin.from('activity_log').insert({
      user_id: input.user_id,
      user_email: userEmail,
      user_name: userName ?? userEmail,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      entity_name: input.entity_name ?? null,
      details: input.details ?? null,
    });
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('activity log (server) failed:', err);
    }
  }
}
