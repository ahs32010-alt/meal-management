import { it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { buildOrderReport as neu } from '@/lib/order-report';
import { buildOrderReport as old } from '@/lib/__old-order-report';
it('bench', async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = '8216f642-df5e-4b94-9330-d14895c75943';
  const out: Record<string, string> = {};
  for (const [n, f] of [['old', old], ['new', neu], ['old2', old], ['new2', neu]] as const) {
    const t = Date.now(); const r = await f(sb, id);
    out[n] = JSON.stringify(r);
    console.log(n, Date.now() - t, 'ms');
  }
  console.log('identical output:', out.old === out.new, out.old2 === out.new2, out.new.length);
}, 300000);
