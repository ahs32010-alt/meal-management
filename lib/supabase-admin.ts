import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { serverEnv, requireServiceRoleKey } from '@/lib/env';

export function createAdminClient() {
  const env = serverEnv();
  const serviceKey = requireServiceRoleKey();
  return createSupabaseClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
