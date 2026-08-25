/**
 * حالة البوت في قاعدة البيانات.
 *
 * الويب يحمل حواره في المتصفح ويعيد إرساله مع كل طلب؛ تليقرام لا يفعل، فما
 * يحفظه هذا الملف هو ذاكرة البوت: من هو صاحب المحادثة، وما قيل قبل قليل، وأي
 * خطة تنتظر ضغطة زر.
 *
 * كل الوصول هنا بمفتاح الخدمة — لأن الطلب قادم من تليقرام لا من متصفح مسجَّل
 * دخوله، فلا كوكيز ولا جلسة. والصلاحيات لا تُفقد بذلك: تُفحص صراحةً في
 * `handle.ts` من صف `app_users` المربوط بالمحادثة.
 */

import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase-admin';
import type { AppUser } from '@/lib/permissions';

export function adminClient(): SupabaseClient {
  return createAdminClient();
}

// ── منع التكرار ────────────────────────────────────────────────────────────

/**
 * يحجز تحديثاً لهذه العملية. يرجّع false لو سبق حجزه.
 *
 * جولة النموذج قد تتجاوز مهلة تليقرام فيعيد إرسال نفس التحديث؛ بدون هذا
 * الحجز تُنفَّذ الرسالة مرتين ويُسأل النموذج مرتين بتكلفة مضاعفة.
 */
export async function claimUpdate(
  supabase: SupabaseClient,
  updateId: number,
  chatId: number | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('telegram_updates')
    .insert({ update_id: updateId, chat_id: chatId });

  if (!error) return true;
  // 23505 = تعارض مفتاح فريد ⇐ غيرنا حجزه. أي خطأ آخر لا يبرّر إسقاط الرسالة.
  if (error.code === '23505') return false;
  console.error('[telegram] claimUpdate failed:', error.message);
  return true;
}

// ── الربط ──────────────────────────────────────────────────────────────────

export interface Link {
  chat_id: number;
  user_id: string;
  telegram_username: string | null;
  telegram_name: string | null;
  linked_at: string;
  last_seen_at: string | null;
}

export async function findLink(
  supabase: SupabaseClient,
  chatId: number,
): Promise<Link | null> {
  const { data } = await supabase
    .from('telegram_links')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();
  return (data as Link | null) ?? null;
}

export async function listLinksForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<Link[]> {
  const { data } = await supabase
    .from('telegram_links')
    .select('*')
    .eq('user_id', userId)
    .order('linked_at', { ascending: false });
  return (data as Link[] | null) ?? [];
}

export async function touchLink(supabase: SupabaseClient, chatId: number): Promise<void> {
  await supabase
    .from('telegram_links')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('chat_id', chatId);
}

export async function unlink(
  supabase: SupabaseClient,
  chatId: number,
): Promise<void> {
  await supabase.from('telegram_links').delete().eq('chat_id', chatId);
  await supabase.from('telegram_sessions').delete().eq('chat_id', chatId);
  await supabase.from('telegram_pending').delete().eq('chat_id', chatId);
}

/** صف المستخدم المربوط بهذه المحادثة — أو null لو غير مربوطة. */
export async function userForChat(
  supabase: SupabaseClient,
  chatId: number,
): Promise<{ link: Link; user: AppUser } | null> {
  const link = await findLink(supabase, chatId);
  if (!link) return null;

  const { data } = await supabase
    .from('app_users')
    .select('id, email, full_name, is_admin, permissions, approval_required, avatar_url, created_at, updated_at')
    .eq('id', link.user_id)
    .maybeSingle();

  const user = data as AppUser | null;
  if (!user) return null;
  return { link, user };
}

// ── أكواد الربط ────────────────────────────────────────────────────────────

/** مدة صلاحية الكود — قصيرة عمداً: هو مفتاح حساب. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** بلا أحرف متشابهة (0/O، 1/I) — الكود يُقرأ من الشاشة ويُكتب باليد. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export interface LinkCode {
  code: string;
  expiresAt: string;
}

/**
 * كود ربط جديد لهذا المستخدم. الأكواد السابقة غير المستهلكة تُلغى — كود واحد
 * حيّ لكل مستخدم يعني أن كوداً مسرَّباً قديماً لا يبقى صالحاً.
 */
export async function issueLinkCode(
  supabase: SupabaseClient,
  userId: string,
): Promise<LinkCode> {
  await supabase.from('telegram_link_codes').delete().eq('user_id', userId).is('used_at', null);

  const code = makeCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const { error } = await supabase
    .from('telegram_link_codes')
    .insert({ code, user_id: userId, expires_at: expiresAt });

  if (error) throw new Error(error.message);
  return { code, expiresAt };
}

export type RedeemResult =
  | { ok: true; userId: string }
  | { ok: false; error: string };

/**
 * يستهلك كوداً ويربط المحادثة بصاحبه.
 *
 * الاستهلاك مشروط بـ`is('used_at', null)` داخل نفس التحديث — فلو وصل الكود
 * نفسه من محادثتين في اللحظة ذاتها، واحدة فقط ترجع صفاً وتفوز.
 */
export async function redeemLinkCode(
  supabase: SupabaseClient,
  rawCode: string,
  chat: { id: number; username?: string | null; name?: string | null },
): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(code)) return { ok: false, error: 'صيغة الكود غير صحيحة.' };

  const { data: row } = await supabase
    .from('telegram_link_codes')
    .select('code, user_id, expires_at, used_at')
    .eq('code', code)
    .maybeSingle();

  if (!row) return { ok: false, error: 'كود غير معروف. أنشئ كوداً جديداً من صفحة الإعدادات.' };
  const record = row as { code: string; user_id: string; expires_at: string; used_at: string | null };
  if (record.used_at) return { ok: false, error: 'هذا الكود مستهلك. أنشئ كوداً جديداً.' };
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'انتهت صلاحية الكود (١٥ دقيقة). أنشئ كوداً جديداً.' };
  }

  const { data: claimed } = await supabase
    .from('telegram_link_codes')
    .update({ used_at: new Date().toISOString(), used_by_chat_id: chat.id })
    .eq('code', code)
    .is('used_at', null)
    .select('user_id');

  if (!claimed?.length) return { ok: false, error: 'هذا الكود استُهلك للتو. أنشئ كوداً جديداً.' };

  const { error } = await supabase.from('telegram_links').upsert(
    {
      chat_id: chat.id,
      user_id: record.user_id,
      telegram_username: chat.username ?? null,
      telegram_name: chat.name ?? null,
      linked_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'chat_id' },
  );
  if (error) return { ok: false, error: 'تعذّر حفظ الربط. حاول مرة أخرى.' };

  // محادثة انتقلت لصاحب جديد لا ترث حوار من قبله.
  await supabase.from('telegram_sessions').delete().eq('chat_id', chat.id);
  return { ok: true, userId: record.user_id };
}

// ── جلسة الحوار ────────────────────────────────────────────────────────────

/** سقف حجم التاريخ المحفوظ — سقف تكلفةٍ قبل أن يكون سقف تخزين. */
const MAX_HISTORY_BYTES = 300_000;
const MAX_HISTORY_MESSAGES = 40;
/** حوار نام أكثر من ساعتين يُعتبر منتهياً — «كم صاروا؟» بعد يومين لا تعني شيئاً. */
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

export interface Session {
  history: unknown[];
  historyProvider: string | null;
}

export async function loadSession(
  supabase: SupabaseClient,
  chatId: number,
): Promise<Session> {
  const { data } = await supabase
    .from('telegram_sessions')
    .select('history, history_provider, updated_at')
    .eq('chat_id', chatId)
    .maybeSingle();

  const row = data as { history: unknown; history_provider: string | null; updated_at: string } | null;
  if (!row) return { history: [], historyProvider: null };

  if (Date.now() - new Date(row.updated_at).getTime() > SESSION_IDLE_MS) {
    return { history: [], historyProvider: null };
  }

  return {
    history: Array.isArray(row.history) ? (row.history as unknown[]) : [],
    historyProvider: row.history_provider,
  };
}

/**
 * يقصّ التاريخ ثم يحفظه.
 *
 * القصّ من الأقدم لا الأحدث: قطع الطرف الحديث يفصل نداء الأداة عن نتيجته
 * فيرفض المزوّد الحوار كله. ونُسقط ما قبل أول دور مستخدم للسبب نفسه.
 */
export async function saveSession(
  supabase: SupabaseClient,
  chatId: number,
  history: unknown,
  provider: string,
): Promise<void> {
  let trimmed = Array.isArray(history) ? (history as Array<{ role?: string }>) : [];
  trimmed = trimmed.slice(-MAX_HISTORY_MESSAGES);
  while (trimmed.length > 0 && JSON.stringify(trimmed).length > MAX_HISTORY_BYTES) {
    trimmed = trimmed.slice(2);
  }
  while (trimmed.length > 0 && trimmed[0]?.role !== 'user') trimmed = trimmed.slice(1);

  const { error } = await supabase.from('telegram_sessions').upsert(
    {
      chat_id: chatId,
      history: trimmed,
      history_provider: provider,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'chat_id' },
  );
  if (error) console.error('[telegram] saveSession failed:', error.message);
}

export async function clearSession(supabase: SupabaseClient, chatId: number): Promise<void> {
  await supabase.from('telegram_sessions').delete().eq('chat_id', chatId);
}

// ── الخطط المعلّقة وأزرار التراجع ───────────────────────────────────────────

/**
 * `callback_data` في تليقرام محدود بـ٦٤ بايت — لا يتّسع لنص أمر ولا لرمز
 * تراجع موقَّع. فنخزّن الحمولة هنا ونمرّر في الزر معرّفاً قصيراً فقط.
 */
export type PendingKind = 'plan' | 'undo';

export interface PlanPayload {
  /** نصّ الأمر القياسي — منه تُعاد الخطة اشتقاقاً عند التأكيد. */
  question: string;
  signature: string;
  title: string;
  summary: string;
}

export interface UndoPayload {
  token: string;
  label: string;
}

/** الخطة تُبنى من بيانات لحظتها؛ ساعة كافية لقرارٍ ومصيرها التوقيع بعدها. */
const PENDING_TTL_MS = 60 * 60 * 1000;

export async function putPending(
  supabase: SupabaseClient,
  chatId: number,
  kind: PendingKind,
  payload: PlanPayload | UndoPayload,
): Promise<string | null> {
  const id = randomBytes(9).toString('base64url'); // ١٢ محرفاً — يتّسع في الزر
  const { error } = await supabase.from('telegram_pending').insert({
    id,
    chat_id: chatId,
    kind,
    payload,
    expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
  });
  if (error) {
    console.error('[telegram] putPending failed:', error.message);
    return null;
  }
  return id;
}

export type TakeResult<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

/**
 * يستهلك حمولة معلّقة مرة واحدة.
 *
 * الاستهلاك شرطٌ في التحديث نفسه: ضغطتان متتاليتان على «تأكيد» لا تنفّذان
 * الخطة مرتين، لأن الثانية لا تجد صفاً غير مستهلك.
 */
export async function takePending<T>(
  supabase: SupabaseClient,
  chatId: number,
  id: string,
  kind: PendingKind,
): Promise<TakeResult<T>> {
  const { data } = await supabase
    .from('telegram_pending')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('chat_id', chatId)
    .eq('kind', kind)
    .is('consumed_at', null)
    .select('payload, expires_at');

  const row = (data as Array<{ payload: unknown; expires_at: string }> | null)?.[0];
  if (!row) return { ok: false, error: 'هذا الطلب استُهلك أو لم يعد متاحاً. أعد إرسال أمرك.' };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: 'انتهت مهلة هذا الطلب (ساعة). أعد إرسال أمرك.' };
  }
  return { ok: true, payload: row.payload as T };
}

export async function dropPending(
  supabase: SupabaseClient,
  chatId: number,
  id: string,
): Promise<void> {
  await supabase
    .from('telegram_pending')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('chat_id', chatId)
    .is('consumed_at', null);
}

/** تنظيف كسول — يُستدعى أحياناً، ولا يهم إن فشل. */
export async function maybeGc(supabase: SupabaseClient): Promise<void> {
  if (Math.random() > 0.02) return;
  const { error } = await supabase.rpc('telegram_gc');
  if (error) console.error('[telegram] gc failed:', error.message);
}
