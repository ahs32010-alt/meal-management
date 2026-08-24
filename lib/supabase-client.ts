import { createBrowserClient } from '@supabase/ssr'
import { createGuardedFetch } from '@/lib/offline/fetch'

/**
 * عميل المتصفح. كل طلباته تمرّ عبر `createGuardedFetch`:
 * القراءات تُخزَّن وتُخدَم من الجهاز عند انقطاع النت، والكتابات تُمنع برسالة
 * صريحة بدل أن تضيع بصمت. راجع lib/offline/fetch.ts.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: createGuardedFetch() } }
  )
}

export const supabase = createClient()
