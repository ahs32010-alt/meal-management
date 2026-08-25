/**
 * عميل واجهة بوت تليقرام — أرقّ طبقة ممكنة فوق HTTP.
 *
 * لا يعرف شيئاً عن النظام ولا عن المساعد: يرسل ويستقبل فقط. وكل ما يخص
 * صياغة الرسائل في `format.ts`، وكل ما يخص المنطق في `handle.ts`.
 */

const API_BASE = 'https://api.telegram.org/bot';

export function botToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token || null;
}

export function isConfigured(): boolean {
  return botToken() !== null;
}

export function requireToken(): string {
  const token = botToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN غير مضبوط على الخادم');
  return token;
}

export class TelegramError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(`telegram ${method} failed (${code}): ${message}`);
    this.name = 'TelegramError';
  }
}

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API_BASE}${requireToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; result?: T; description?: string; error_code?: number }
    | null;

  if (!json?.ok) {
    throw new TelegramError(method, json?.error_code ?? res.status, json?.description ?? 'unknown');
  }
  return json.result as T;
}

// ── الأنواع التي نستعملها فعلاً من تحديثات تليقرام ─────────────────────────

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  caption?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type InlineKeyboard = InlineButton[][];

// ── الإرسال ────────────────────────────────────────────────────────────────

export interface SendOptions {
  keyboard?: InlineKeyboard;
  /** الرد على رسالة بعينها — مفيد في المجموعات. */
  replyTo?: number;
  disablePreview?: boolean;
}

export async function sendMessage(
  chatId: number,
  html: string,
  options: SendOptions = {},
): Promise<TgMessage> {
  return call<TgMessage>('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: options.disablePreview ?? true },
    reply_markup: options.keyboard ? { inline_keyboard: options.keyboard } : undefined,
    reply_parameters: options.replyTo ? { message_id: options.replyTo, allow_sending_without_reply: true } : undefined,
  });
}

/** «يكتب الآن…» — يبقى ٥ ثوانٍ، فنعيده دورياً أثناء الجولات الطويلة. */
export async function sendTyping(chatId: number): Promise<void> {
  await call('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => undefined);
}

export async function editMessageText(
  chatId: number,
  messageId: number,
  html: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard ? { inline_keyboard: keyboard } : { inline_keyboard: [] },
  });
}

/** إزالة الأزرار من رسالة سابقة — حتى لا يُضغط الزر مرتين. */
export async function clearKeyboard(chatId: number, messageId: number): Promise<void> {
  await call('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  }).catch(() => undefined);
}

/** تليقرام يترك الزر «يلفّ» حتى نجيب — والإجابة إلزامية ولو فارغة. */
export async function answerCallback(
  callbackId: string,
  text?: string,
  alert = false,
): Promise<void> {
  await call('answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text?.slice(0, 200),
    show_alert: alert,
  }).catch(() => undefined);
}

// ── إدارة الويب‑هوك ────────────────────────────────────────────────────────

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
}

export async function setWebhook(url: string, secret: string): Promise<void> {
  await call('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
}

export async function deleteWebhook(): Promise<void> {
  await call('deleteWebhook', { drop_pending_updates: true });
}

export async function getWebhookInfo(): Promise<WebhookInfo> {
  return call<WebhookInfo>('getWebhookInfo', {});
}

export async function getMe(): Promise<TgUser> {
  return call<TgUser>('getMe', {});
}

/** قائمة الأوامر التي تظهر في زر «/» داخل تليقرام. */
export async function setMyCommands(
  commands: Array<{ command: string; description: string }>,
): Promise<void> {
  await call('setMyCommands', { commands, scope: { type: 'default' } });
}
