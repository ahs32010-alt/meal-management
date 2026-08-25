/**
 * اختبارات ذاكرة البوت.
 *
 * ما يهمّ هنا ليس أن الاستعلامات تعمل، بل أن ما يجب أن يحدث **مرة واحدة**
 * يحدث مرة واحدة: كود الربط، وضغطة التأكيد، والتحديث المعاد من تليقرام. كلها
 * أبواب لو انفتحت مرتين لصار ضرر حقيقي — حساب مسروق أو أمر منفَّذ مضاعفاً.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  claimUpdate,
  clearSession,
  dropPending,
  issueLinkCode,
  loadSession,
  putPending,
  redeemLinkCode,
  saveSession,
  takePending,
  userForChat,
  type PlanPayload,
} from '@/lib/telegram/store';

import { makeClient, TEST_USER, type Row } from './telegram-support';

let db: Record<string, Row[]>;
let client: SupabaseClient;

beforeEach(() => {
  db = { app_users: [{ ...TEST_USER }] };
  client = makeClient(db);
});

// ── منع التكرار ────────────────────────────────────────────────────────────

describe('claimUpdate', () => {
  it('يمنح التحديث لأول طالب فقط', async () => {
    expect(await claimUpdate(client, 500, 7)).toBe(true);
    expect(await claimUpdate(client, 500, 7)).toBe(false);
  });

  it('التحديثات المختلفة كلٌّ يُحجز على حدة', async () => {
    expect(await claimUpdate(client, 1, 7)).toBe(true);
    expect(await claimUpdate(client, 2, 7)).toBe(true);
  });
});

// ── أكواد الربط ────────────────────────────────────────────────────────────

describe('issueLinkCode', () => {
  it('ينتج كوداً بأحرف مقروءة بلا لبس بين 0/O و1/I', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  });

  it('الكود الجديد يلغي القديم غير المستهلك — كود حيّ واحد لكل مستخدم', async () => {
    const first = await issueLinkCode(client, 'u1');
    await issueLinkCode(client, 'u1');
    const live = db.telegram_link_codes.filter((r) => r.used_at == null);
    expect(live).toHaveLength(1);
    expect(live[0].code).not.toBe(first.code);
  });
});

describe('redeemLinkCode', () => {
  it('يربط المحادثة بصاحب الكود', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    const result = await redeemLinkCode(client, code, { id: 99, username: 'ahmad' });
    expect(result).toEqual({ ok: true, userId: 'u1' });

    const bound = await userForChat(client, 99);
    expect(bound?.user.id).toBe('u1');
  });

  it('يقبل الكود بأحرف صغيرة ومع مسافات — يُنسخ من الشاشة لا يُكتب بدقة', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    const result = await redeemLinkCode(client, `  ${code.toLowerCase()} `, { id: 99 });
    expect(result.ok).toBe(true);
  });

  it('لا يُستهلك مرتين — الكود المسرَّب بعد استعماله لا يفتح شيئاً', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    expect((await redeemLinkCode(client, code, { id: 99 })).ok).toBe(true);

    const second = await redeemLinkCode(client, code, { id: 1000 });
    expect(second.ok).toBe(false);
    expect(await userForChat(client, 1000)).toBeNull();
  });

  it('يرفض الكود المنتهي', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    db.telegram_link_codes[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const result = await redeemLinkCode(client, code, { id: 99 });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('انتهت صلاحية');
  });

  it('يرفض الكود المجهول', async () => {
    const result = await redeemLinkCode(client, 'ZZZZZZZZ', { id: 99 });
    expect(result.ok).toBe(false);
  });

  it('يرفض ما ليس كوداً أصلاً بلا لمس القاعدة', async () => {
    expect((await redeemLinkCode(client, 'مرحبا', { id: 99 })).ok).toBe(false);
    expect((await redeemLinkCode(client, 'x', { id: 99 })).ok).toBe(false);
  });

  it('المحادثة المعاد ربطها لا ترث حوار صاحبها السابق', async () => {
    const first = await issueLinkCode(client, 'u1');
    await redeemLinkCode(client, first.code, { id: 99 });
    await saveSession(client, 99, [{ role: 'user', content: 'سرّ' }], 'claude');

    db.app_users.push({ ...TEST_USER, id: 'u2', email: 'other@example.com' });
    const second = await issueLinkCode(client, 'u2');
    await redeemLinkCode(client, second.code, { id: 99 });

    expect((await loadSession(client, 99)).history).toEqual([]);
    expect((await userForChat(client, 99))?.user.id).toBe('u2');
  });
});

// ── الجلسة ─────────────────────────────────────────────────────────────────

describe('sessions', () => {
  it('يحفظ الحوار ويعيده موسوماً بمزوّده', async () => {
    await saveSession(client, 7, [{ role: 'user', content: 'كم مستفيد؟' }], 'gemini');
    const session = await loadSession(client, 7);
    expect(session.history).toHaveLength(1);
    expect(session.historyProvider).toBe('gemini');
  });

  it('يبدأ من الصفر لمحادثة جديدة', async () => {
    expect(await loadSession(client, 404)).toEqual({ history: [], historyProvider: null });
  });

  it('ينسى حواراً نام أكثر من ساعتين', async () => {
    await saveSession(client, 7, [{ role: 'user', content: 'قديم' }], 'claude');
    db.telegram_sessions[0].updated_at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect((await loadSession(client, 7)).history).toEqual([]);
  });

  it('يقصّ من الأقدم فيبقى أول دور للمستخدم — الأحدث لا يُقطع فينكسر زوج الأداة', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `م${i}`,
    }));
    await saveSession(client, 7, many, 'claude');
    const saved = (await loadSession(client, 7)).history as Array<{ role: string; content: string }>;

    expect(saved.length).toBeLessThanOrEqual(40);
    expect(saved[0].role).toBe('user');
    // الذيل محفوظ: آخر رسالة هي آخر ما قيل فعلاً
    expect(saved[saved.length - 1].content).toBe('م59');
  });

  it('clearSession يمحو الحوار', async () => {
    await saveSession(client, 7, [{ role: 'user', content: 'x' }], 'claude');
    await clearSession(client, 7);
    expect((await loadSession(client, 7)).history).toEqual([]);
  });
});

// ── الخطط المعلّقة ─────────────────────────────────────────────────────────

const PLAN: PlanPayload = {
  question: 'احذف السمك من وجبات محمد',
  signature: 'sig-1',
  title: 'حذف صنف',
  summary: 'حذف السمك',
};

describe('pending actions', () => {
  it('يرجّع معرّفاً قصيراً يتّسع في زر تليقرام (٦٤ بايت)', async () => {
    const id = await putPending(client, 7, 'plan', PLAN);
    expect(id).toBeTruthy();
    expect(`ok:${id}`.length).toBeLessThanOrEqual(64);
  });

  it('يُستهلك مرة واحدة — ضغطتان على «تأكيد» لا تنفّذان الأمر مرتين', async () => {
    const id = (await putPending(client, 7, 'plan', PLAN))!;

    const first = await takePending<PlanPayload>(client, 7, id, 'plan');
    expect(first).toMatchObject({ ok: true });
    if (first.ok) expect(first.payload.signature).toBe('sig-1');

    expect((await takePending(client, 7, id, 'plan')).ok).toBe(false);
  });

  it('محادثة أخرى لا تستهلك خطة غيرها ولو عرفت معرّفها', async () => {
    const id = (await putPending(client, 7, 'plan', PLAN))!;
    expect((await takePending(client, 8, id, 'plan')).ok).toBe(false);
    // وتبقى متاحة لصاحبها
    expect((await takePending(client, 7, id, 'plan')).ok).toBe(true);
  });

  it('لا يخلط زرّ التراجع بزرّ التأكيد', async () => {
    const id = (await putPending(client, 7, 'plan', PLAN))!;
    expect((await takePending(client, 7, id, 'undo')).ok).toBe(false);
  });

  it('يرفض خطة انتهت مهلتها', async () => {
    const id = (await putPending(client, 7, 'plan', PLAN))!;
    db.telegram_pending[0].expires_at = new Date(Date.now() - 1000).toISOString();
    const taken = await takePending(client, 7, id, 'plan');
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error).toContain('انتهت مهلة');
  });

  it('الإلغاء يحرق الخطة فلا تُنفَّذ بعده', async () => {
    const id = (await putPending(client, 7, 'plan', PLAN))!;
    await dropPending(client, 7, id);
    expect((await takePending(client, 7, id, 'plan')).ok).toBe(false);
  });
});

// ── الهوية ─────────────────────────────────────────────────────────────────

describe('userForChat', () => {
  it('محادثة غير مربوطة لا تحمل هوية', async () => {
    expect(await userForChat(client, 12345)).toBeNull();
  });

  it('ربطٌ لمستخدم محذوف لا يعطي هوية', async () => {
    const { code } = await issueLinkCode(client, 'u1');
    await redeemLinkCode(client, code, { id: 99 });
    db.app_users = [];
    expect(await userForChat(client, 99)).toBeNull();
  });
});
