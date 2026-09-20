/**
 * فحص حيّ على قاعدة البيانات الحقيقية — لا يعمل إلا بطلب صريح.
 *
 * الاختبارات الأخرى تشتغل على قاعدة في الذاكرة، وهي تثبت أن المنطق سليم لكنها
 * لا تثبت أن **الترحيل يطابق الشيفرة**: اسم عمود مختلف، أو قيد ناقص، أو سياسة
 * RLS تمنع مفتاح الخدمة — كل ذلك يمر من الاختبارات المزيّفة وينكشف في أول
 * رسالة حقيقية. هذا الملف يقطع الشك: يكتب صفوفاً حقيقية ثم يمحوها.
 *
 * التشغيل:  TELEGRAM_LIVE_TEST=1 npx vitest run tests/telegram-live.test.ts
 *
 * يُتخطّى تلقائياً بدون العَلَم، فلا يكسر `npm test` ولا CI. ويعمل على
 * محادثة وهمية (chat_id سالب بعيد) وينظّف نفسه في كل الأحوال.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimUpdate,
  clearSession,
  issueLinkCode,
  loadSession,
  putPending,
  redeemLinkCode,
  saveSession,
  takePending,
  unlink,
  userForChat,
  type PlanPayload,
} from '@/lib/telegram/store';

// ── البيئة ─────────────────────────────────────────────────────────────────

function envFromFile(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync('.env.local')) return out;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at > 0) out[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
  }
  return out;
}

const env = { ...envFromFile(), ...process.env };
const enabled =
  process.env.TELEGRAM_LIVE_TEST === '1' &&
  Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

/** محادثة لا وجود لها في تليقرام — لا تصطدم بأي ربط حقيقي. */
const CHAT = -999000999;

let supabase: SupabaseClient;
let userId: string;
const updateIds: number[] = [];

async function scrub() {
  if (!supabase) return;
  await unlink(supabase, CHAT);
  await supabase.from('telegram_link_codes').delete().eq('used_by_chat_id', CHAT);
  if (userId) await supabase.from('telegram_link_codes').delete().eq('user_id', userId);
  for (const id of updateIds) await supabase.from('telegram_updates').delete().eq('update_id', id);
}

describe.skipIf(!enabled)('فحص حيّ على Supabase', () => {
  beforeAll(async () => {
    supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data } = await supabase.from('app_users').select('id').limit(1);
    userId = (data as Array<{ id: string }> | null)?.[0]?.id ?? '';
    expect(userId, 'لازم يكون في مستخدم واحد على الأقل في app_users').toBeTruthy();

    await scrub();
  });

  afterAll(scrub);

  it('الجداول الخمسة موجودة ومفتاح الخدمة يصلها رغم RLS', async () => {
    for (const table of [
      'telegram_links', 'telegram_link_codes',
      'telegram_sessions', 'telegram_pending', 'telegram_updates',
    ]) {
      const { error } = await supabase.from(table).select('*').limit(1);
      expect(error, `${table}: ${error?.message}`).toBeNull();
    }
  });

  it('حجز التحديث يعتمد على قيد المفتاح الحقيقي لا على فحصٍ في الشيفرة', async () => {
    const id = Date.now();
    updateIds.push(id);
    expect(await claimUpdate(supabase, id, CHAT)).toBe(true);
    expect(await claimUpdate(supabase, id, CHAT)).toBe(false);
  });

  it('دورة الربط كاملة: كود ← استهلاك ← هوية ← فكّ ربط', async () => {
    const { code } = await issueLinkCode(supabase, userId);
    expect(code).toHaveLength(8);

    const redeemed = await redeemLinkCode(supabase, code, {
      id: CHAT,
      username: 'live_test',
      name: 'فحص حيّ',
    });
    expect(redeemed).toMatchObject({ ok: true, userId });

    const bound = await userForChat(supabase, CHAT);
    expect(bound?.user.id).toBe(userId);
    // الصلاحيات تُقرأ فعلاً من app_users — عليها يقوم كل الفحص
    expect(bound?.user).toHaveProperty('permissions');

    // مرة ثانية على نفس الكود: مرفوض
    expect((await redeemLinkCode(supabase, code, { id: CHAT })).ok).toBe(false);

    await unlink(supabase, CHAT);
    expect(await userForChat(supabase, CHAT)).toBeNull();
  });

  it('الجلسة تُحفظ وتُقرأ كما هي — jsonb يحفظ شكل الرسائل', async () => {
    const history = [
      { role: 'user', content: 'كم عدد المستفيدين؟' },
      { role: 'assistant', content: [{ type: 'text', text: 'عندنا ٤٢' }] },
    ];
    await saveSession(supabase, CHAT, history, 'claude');

    const session = await loadSession(supabase, CHAT);
    expect(session.historyProvider).toBe('claude');
    expect(session.history).toEqual(history);

    await clearSession(supabase, CHAT);
    expect((await loadSession(supabase, CHAT)).history).toEqual([]);
  });

  it('الخطة المعلّقة تُستهلك مرة واحدة على قاعدة حقيقية', async () => {
    const payload: PlanPayload = {
      question: 'فحص حيّ',
      signature: 'live-sig',
      title: 'عنوان',
      summary: 'ملخّص',
    };

    const id = await putPending(supabase, CHAT, 'plan', payload);
    expect(id).toBeTruthy();

    const first = await takePending<PlanPayload>(supabase, CHAT, id!, 'plan');
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.payload.signature).toBe('live-sig');

    expect((await takePending(supabase, CHAT, id!, 'plan')).ok).toBe(false);
  });

  it('قيد kind في الترحيل يرفض نوعاً مجهولاً', async () => {
    const { error } = await supabase.from('telegram_pending').insert({
      id: 'live-bad-kind',
      chat_id: CHAT,
      kind: 'nonsense',
      payload: {},
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(error).not.toBeNull();
  });

  it('دالة التنظيف telegram_gc موجودة وتعمل', async () => {
    const { error } = await supabase.rpc('telegram_gc');
    expect(error).toBeNull();
  });
});
