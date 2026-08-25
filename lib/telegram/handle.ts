/**
 * منطق البوت — الطبقة الوحيدة التي تعرف تليقرام والنظام معاً.
 *
 * ── ما الذي يضيفه هذا الملف على المساعد الموجود؟ ───────────────────────────
 * لا شيء من الذكاء. المحرّك نفسه: نفس المزوّد، ونفس الأدوات، ونفس بناء الخطة
 * وتنفيذها. ما يضيفه ثلاثة أشياء لا يحتاجها المتصفح:
 *   ① هوية — لا كوكيز في تليقرام، فالمحادثة تُربط بحساب عبر كود من الإعدادات.
 *   ② ذاكرة — المتصفح يحمل حواره ويعيده؛ تليقرام لا يفعل فنحفظه نحن.
 *   ③ تأكيد — بدل بطاقة فيها زر، أزرار سطرية تحمل معرّفاً لخطة محفوظة.
 *
 * ── ما الذي لا يتغيّر؟ ─────────────────────────────────────────────────────
 * الصلاحيات. البوت يتكلم بصوت صاحب الحساب المربوط لا أكثر: من لا يعدّل
 * المستفيدين من صفحتهم لا يعدّلهم من تليقرام، ومن كانت تعديلاته تمرّ على
 * موافقة الأدمن يُوجَّه للموقع بدل الالتفاف حولها. والخطة عند التأكيد **يُعاد
 * اشتقاقها** من نصّ أمرها ويُطابَق توقيعها — لا نثق بحمولة زرٍّ مضى عليها وقت.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { can, PAGES, type AppUser, type PageKey } from '@/lib/permissions';
import { checkWriteAccess } from '@/lib/assistant/access';
import { resolveProvider } from '@/lib/assistant/ai/provider';
import { runTurn } from '@/lib/assistant/plan';
import { executePlan, executeUndo } from '@/lib/assistant/execute';
import { decodeUndo } from '@/lib/assistant/undo';
import { todayISO } from '@/lib/date-utils';
import { rateLimit } from '@/lib/rate-limit';
import * as tg from './api';
import { escapeHtml, mdToHtml, renderPlan, splitMessage } from './format';
import * as store from './store';

const MAX_QUESTION_LENGTH = 2000;

/** رابط الموقع — يُستعمل في أزرار «افتح الصفحة». */
function appUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : null;
}

// ── إرسال ──────────────────────────────────────────────────────────────────

async function reply(chatId: number, html: string, keyboard?: tg.InlineKeyboard): Promise<void> {
  const parts = splitMessage(html);
  for (let i = 0; i < parts.length; i++) {
    // الأزرار على الجزء الأخير فقط — هي ذيل الرسالة لا وسطها.
    const last = i === parts.length - 1;
    await tg.sendMessage(chatId, parts[i], { keyboard: last ? keyboard : undefined });
  }
}

/**
 * يُبقي «يكتب الآن…» ظاهرة طوال الجولة.
 * مؤشّر تليقرام يعيش خمس ثوانٍ، وجولة أدوات قد تأخذ نصف دقيقة — بلا تجديد
 * يظنّ المستخدم أن البوت مات فيعيد السؤال.
 */
function keepTyping(chatId: number): () => void {
  void tg.sendTyping(chatId);
  const handle = setInterval(() => void tg.sendTyping(chatId), 4000);
  return () => clearInterval(handle);
}

// ── نصوص ثابتة ─────────────────────────────────────────────────────────────

const HELP = [
  '<b>🤖 مساعد نظام الوجبات</b>',
  '',
  'اكتب سؤالك أو أمرك بالعربية الطبيعية، وأنا أجاوبك من بيانات النظام مباشرة.',
  '',
  '<b>أمثلة على الأسئلة:</b>',
  '• كم عدد المستفيدين النشطين؟',
  '• وش منيو الغداء بكرة؟',
  '• اعطني ملخص أمر التشغيل لليوم',
  '• مين المستفيدين اللي عندهم حساسية سمك؟',
  '• كم صنف عندنا في الفطور؟',
  '',
  '<b>أمثلة على الأوامر:</b>',
  '• أضف مستفيد اسمه فهد في غرفة ٢٠٤',
  '• احذف السمك من وجبات محمد',
  '• غيّر غداء الأحد إلى كبسة دجاج',
  '<i>كل أمر يغيّر بيانات يعرض عليك معاينة وزرّي تأكيد وإلغاء أولاً.</i>',
  '',
  '<b>الأوامر الجاهزة:</b>',
  '/new — ابدأ حواراً جديداً (ينسى ما قبله)',
  '/whoami — بأي حساب أتكلم وما صلاحياته',
  '/unlink — فكّ ربط هذه المحادثة',
  '/help — هذه الرسالة',
].join('\n');

function linkPrompt(): string {
  const url = appUrl();
  const where = url
    ? `<a href="${url}/settings">صفحة الإعدادات ← تبويب تليقرام</a>`
    : 'صفحة الإعدادات ← تبويب تليقرام';
  return [
    '<b>👋 أهلاً بك في مساعد نظام الوجبات</b>',
    '',
    'هذه المحادثة غير مربوطة بحساب بعد، ولا أقدر أعرض بيانات النظام لأحد لا أعرفه.',
    '',
    `<b>للربط:</b> افتح ${where}، اضغط «إنشاء كود ربط»، وأرسل الكود هنا.`,
    '',
    '<i>الكود صالح ١٥ دقيقة ويُستعمل مرة واحدة.</i>',
  ].join('\n');
}

function permissionsSummary(user: AppUser): string {
  if (user.is_admin) return 'أدمن — صلاحية كاملة على كل الصفحات.';
  const allowed = PAGES.filter((p) => can(user, p.key, 'view')).map((p) => p.label);
  return allowed.length ? allowed.join('، ') : 'بلا صلاحيات عرض.';
}

// ── معالجة الرسائل النصية ──────────────────────────────────────────────────

interface Ctx {
  supabase: SupabaseClient;
  chatId: number;
  from: tg.TgUser | undefined;
}

async function handleLinkAttempt(ctx: Ctx, code: string): Promise<void> {
  const name = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ');
  const result = await store.redeemLinkCode(ctx.supabase, code, {
    id: ctx.chatId,
    username: ctx.from?.username ?? null,
    name: name || null,
  });

  if (!result.ok) {
    await reply(ctx.chatId, `❌ ${escapeHtml(result.error)}`);
    return;
  }

  const bound = await store.userForChat(ctx.supabase, ctx.chatId);
  const who = bound?.user.full_name || bound?.user.email || 'حسابك';
  await reply(
    ctx.chatId,
    [
      `✅ تم الربط بحساب <b>${escapeHtml(who)}</b>.`,
      '',
      'اسألني الحين عن أي شيء في النظام. اكتب /help للأمثلة.',
    ].join('\n'),
  );
}

/** الرسائل المسموحة قبل الربط: الترحيب، ومحاولة إدخال كود. */
async function handleUnlinked(ctx: Ctx, text: string): Promise<void> {
  const startCode = /^\/start(?:@\S+)?\s+(\S+)$/.exec(text);
  if (startCode) {
    await handleLinkAttempt(ctx, startCode[1]);
    return;
  }

  const linkCmd = /^\/link(?:@\S+)?\s+(\S+)$/.exec(text);
  if (linkCmd) {
    await handleLinkAttempt(ctx, linkCmd[1]);
    return;
  }

  // كود مجرّد بلا أمر — الشكل الأغلب: ينسخه من الشاشة ويلصقه.
  if (/^[A-Za-z0-9]{6,12}$/.test(text.trim())) {
    await handleLinkAttempt(ctx, text.trim());
    return;
  }

  await reply(ctx.chatId, linkPrompt());
}

async function handleCommand(
  ctx: Ctx,
  user: AppUser,
  command: string,
  arg: string,
): Promise<boolean> {
  switch (command) {
    case '/start':
      await reply(
        ctx.chatId,
        `<b>👋 أهلاً ${escapeHtml(user.full_name || user.email)}</b>\n\n${HELP}`,
      );
      return true;

    case '/help':
      await reply(ctx.chatId, HELP);
      return true;

    case '/new':
    case '/reset':
      await store.clearSession(ctx.supabase, ctx.chatId);
      await reply(ctx.chatId, '🧹 بدأنا حواراً جديداً. اسأل عن أي شيء.');
      return true;

    case '/whoami': {
      const url = appUrl();
      await reply(
        ctx.chatId,
        [
          '<b>👤 الحساب المربوط بهذه المحادثة</b>',
          `الاسم: ${escapeHtml(user.full_name || '—')}`,
          `البريد: ${escapeHtml(user.email)}`,
          `الصلاحيات: ${escapeHtml(permissionsSummary(user))}`,
          url ? `\n<a href="${url}/settings">إدارة الربط من الموقع</a>` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
      return true;
    }

    case '/unlink':
      await store.unlink(ctx.supabase, ctx.chatId);
      await reply(
        ctx.chatId,
        '🔓 فُكّ الربط وحُذف حوار هذه المحادثة. أرسل كوداً جديداً وقت ما تبي ترجع.',
      );
      return true;

    case '/link':
      await reply(
        ctx.chatId,
        arg
          ? 'هذه المحادثة مربوطة أصلاً. أرسل /unlink أولاً لو تبي تربطها بحساب ثانٍ.'
          : 'هذه المحادثة مربوطة أصلاً. /whoami يعرض بأي حساب.',
      );
      return true;

    default:
      return false;
  }
}

/** سؤال أو أمر عادي — يمرّ على النموذج. */
async function handleQuestion(ctx: Ctx, user: AppUser, text: string): Promise<void> {
  if (!can(user, 'assistant', 'view')) {
    await reply(ctx.chatId, '❌ حسابك ما عنده صلاحية استخدام المساعد الذكي.');
    return;
  }

  if (text.length > MAX_QUESTION_LENGTH) {
    await reply(ctx.chatId, `❌ النص طويل جداً (الحد ${MAX_QUESTION_LENGTH} حرف).`);
    return;
  }

  const limit = rateLimit({ key: `telegram:${ctx.chatId}`, limit: 20, windowMs: 60_000 });
  if (!limit.allowed) {
    await reply(ctx.chatId, '⏳ رسائل كثيرة بسرعة. انتظر دقيقة وأعد المحاولة.');
    return;
  }

  const resolution = await resolveProvider(undefined);
  if (!resolution.ok) {
    await reply(ctx.chatId, `⚙️ ${escapeHtml(resolution.error)}`);
    return;
  }
  const provider = resolution.provider;

  const session = await store.loadSession(ctx.supabase, ctx.chatId);
  // شكل الرسائل خاص بكل مزوّد ولا يُترجَم — تبدّل المزوّد يعني حواراً جديداً.
  const history = session.historyProvider === provider.id ? session.history : [];

  const stopTyping = keepTyping(ctx.chatId);
  try {
    const result = await provider.run({
      supabase: ctx.supabase,
      history,
      question: text,
      userName: user.full_name || user.email || 'مستخدم',
      today: todayISO(),
    });

    await store.saveSession(
      ctx.supabase,
      ctx.chatId,
      [...(Array.isArray(history) ? history : []), ...(result.messages as unknown[])],
      provider.id,
    );

    const body = result.text?.trim() ? mdToHtml(result.text.trim()) : '';

    // ── خطة تنتظر تأكيداً ────────────────────────────────────────────────
    if (result.plan) {
      const write = checkWriteAccess(user, result.plan.plan.permission);
      if (!write.ok) {
        await reply(ctx.chatId, `🔒 ${escapeHtml(write.error)}`);
        return;
      }

      const id = await store.putPending(ctx.supabase, ctx.chatId, 'plan', {
        question: result.plan.commandText,
        signature: result.plan.plan.signature,
        title: result.plan.plan.title,
        summary: result.plan.plan.summary,
      });

      if (!id) {
        await reply(ctx.chatId, '❌ تعذّر تجهيز المعاينة. حاول مرة أخرى.');
        return;
      }

      const card = renderPlan(result.plan.plan);
      await reply(ctx.chatId, body ? `${body}\n\n${card}` : card, [
        [
          { text: '✅ تأكيد التنفيذ', callback_data: `ok:${id}` },
          { text: '✖️ إلغاء', callback_data: `no:${id}` },
        ],
      ]);
      return;
    }

    // ── تنقّل: في تليقرام لا صفحات — نعطيه الرابط ────────────────────────
    if (result.navigate) {
      const allowed =
        result.navigate.permission === null ||
        can(user, result.navigate.permission as PageKey, 'view');

      if (!allowed) {
        await reply(
          ctx.chatId,
          `🔒 ما عندك صلاحية عرض صفحة ${escapeHtml(result.navigate.label)}.`,
        );
        return;
      }

      const base = appUrl();
      await reply(
        ctx.chatId,
        body || `صفحة ${escapeHtml(result.navigate.label)}:`,
        base
          ? [[{ text: `🔗 افتح ${result.navigate.label}`, url: `${base}${result.navigate.href}` }]]
          : undefined,
      );
      return;
    }

    await reply(ctx.chatId, body || '🤔 ما وصلتني إجابة. أعد صياغة سؤالك.');
  } finally {
    stopTyping();
  }
}

// ── الأزرار ────────────────────────────────────────────────────────────────

async function confirmPlan(ctx: Ctx, user: AppUser, id: string): Promise<string> {
  const taken = await store.takePending<store.PlanPayload>(ctx.supabase, ctx.chatId, id, 'plan');
  if (!taken.ok) {
    await reply(ctx.chatId, `⚠️ ${escapeHtml(taken.error)}`);
    return 'انتهت صلاحية الطلب';
  }

  const { question, signature } = taken.payload;

  // لا نثق بخطة محفوظة: نبنيها من جديد من نصّ أمرها على بيانات هذه اللحظة.
  const turn = await runTurn(ctx.supabase, { text: question });
  if (turn.kind !== 'plan') {
    await reply(
      ctx.chatId,
      `⚠️ ${escapeHtml(turn.kind === 'problem' ? turn.problem.summary : 'ما عاد هذا الأمر قابلاً للتنفيذ.')}`,
    );
    return 'تعذّر التنفيذ';
  }

  // توقيع مختلف ⇐ تغيّرت البيانات بعد المعاينة. ننفّذ ما عاينه لا ما صار.
  if (turn.plan.signature !== signature) {
    await reply(
      ctx.chatId,
      '⚠️ تغيّرت البيانات منذ المعاينة. أعد إرسال أمرك لمراجعة خطة جديدة.',
    );
    return 'تغيّرت البيانات';
  }

  const write = checkWriteAccess(user, turn.plan.permission);
  if (!write.ok) {
    await reply(ctx.chatId, `🔒 ${escapeHtml(write.error)}`);
    return 'غير مسموح';
  }

  const outcome = await executePlan(ctx.supabase, turn.plan, {
    userId: user.id,
    page: '/telegram',
  });

  if (!outcome.ok) {
    await reply(ctx.chatId, `❌ ${escapeHtml(outcome.error ?? 'تعذّر التنفيذ')}`);
    return 'فشل التنفيذ';
  }

  let keyboard: tg.InlineKeyboard | undefined;
  if (outcome.undoToken) {
    const undoId = await store.putPending(ctx.supabase, ctx.chatId, 'undo', {
      token: outcome.undoToken,
      label: `${turn.plan.title} — ${turn.plan.summary}`,
    });
    if (undoId) keyboard = [[{ text: '↩️ تراجع', callback_data: `un:${undoId}` }]];
  }

  await reply(
    ctx.chatId,
    [
      `✅ <b>تم التنفيذ</b> — ${escapeHtml(turn.plan.title)}`,
      escapeHtml(turn.plan.summary),
      '',
      `<i>${outcome.applied} عملية.</i>`,
    ].join('\n'),
    keyboard,
  );
  return 'تم التنفيذ';
}

async function undoAction(ctx: Ctx, user: AppUser, id: string): Promise<string> {
  const taken = await store.takePending<store.UndoPayload>(ctx.supabase, ctx.chatId, id, 'undo');
  if (!taken.ok) {
    await reply(ctx.chatId, `⚠️ ${escapeHtml(taken.error)}`);
    return 'غير متاح';
  }

  const payload = decodeUndo(taken.payload.token);
  if (!payload) {
    await reply(ctx.chatId, '⚠️ رمز التراجع غير صالح أو انتهت صلاحيته (ساعة واحدة).');
    return 'انتهت الصلاحية';
  }

  const write = checkWriteAccess(user, payload.permission);
  if (!write.ok) {
    await reply(ctx.chatId, `🔒 ${escapeHtml(write.error)}`);
    return 'غير مسموح';
  }

  const outcome = await executeUndo(ctx.supabase, payload.ops, payload.label, {
    userId: user.id,
    page: '/telegram',
  });

  if (!outcome.ok) {
    await reply(ctx.chatId, `❌ ${escapeHtml(outcome.error ?? 'تعذّر التراجع')}`);
    return 'فشل التراجع';
  }

  await reply(ctx.chatId, `↩️ <b>تم التراجع</b> — ${escapeHtml(payload.label)}`);
  return 'تم التراجع';
}

async function handleCallback(
  supabase: SupabaseClient,
  query: tg.TgCallbackQuery,
): Promise<void> {
  const chatId = query.message?.chat.id;
  if (!chatId || !query.data) {
    await tg.answerCallback(query.id);
    return;
  }

  const ctx: Ctx = { supabase, chatId, from: query.from };
  const [action, id] = query.data.split(':', 2);

  const bound = await store.userForChat(supabase, chatId);
  if (!bound) {
    await tg.answerCallback(query.id, 'المحادثة غير مربوطة بحساب', true);
    return;
  }

  // الأزرار تُزال أولاً — ضغطة ثانية أثناء التنفيذ لا تجد ما تضغطه.
  if (query.message) await tg.clearKeyboard(chatId, query.message.message_id);

  try {
    if (action === 'ok') {
      const note = await confirmPlan(ctx, bound.user, id);
      await tg.answerCallback(query.id, note);
      return;
    }
    if (action === 'no') {
      await store.dropPending(supabase, chatId, id);
      await reply(chatId, '✖️ أُلغي الأمر. ما تغيّر شيء.');
      await tg.answerCallback(query.id, 'أُلغي');
      return;
    }
    if (action === 'un') {
      const note = await undoAction(ctx, bound.user, id);
      await tg.answerCallback(query.id, note);
      return;
    }
    await tg.answerCallback(query.id);
  } catch (err) {
    console.error('[telegram] callback failed:', err);
    await tg.answerCallback(query.id, 'تعذّر تنفيذ الطلب');
    await reply(chatId, '❌ تعذّر تنفيذ الطلب. حاول مرة أخرى.');
  }
}

// ── المدخل ─────────────────────────────────────────────────────────────────

export async function handleUpdate(update: tg.TgUpdate): Promise<void> {
  const supabase = store.adminClient();

  const chatId =
    update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? null;

  // تليقرام يعيد إرسال التحديث لو تأخّر ردّنا — أول من يحجزه ينفّذه.
  const claimed = await store.claimUpdate(supabase, update.update_id, chatId);
  if (!claimed) return;

  void store.maybeGc(supabase);

  if (update.callback_query) {
    await handleCallback(supabase, update.callback_query);
    return;
  }

  const message = update.message;
  const text = message?.text?.trim();
  if (!message || !text) {
    if (chatId) {
      await reply(chatId, 'أرسل لي سؤالك نصاً — ما أتعامل مع الصور والملفات بعد.');
    }
    return;
  }

  const ctx: Ctx = { supabase, chatId: message.chat.id, from: message.from };

  const bound = await store.userForChat(supabase, ctx.chatId);
  if (!bound) {
    await handleUnlinked(ctx, text);
    return;
  }

  void store.touchLink(supabase, ctx.chatId);

  // الأمر قد يجي بلاحقة اسم البوت في المجموعات: /help@my_bot
  const cmdMatch = /^(\/[a-z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/i.exec(text);
  if (cmdMatch) {
    const handled = await handleCommand(
      ctx,
      bound.user,
      cmdMatch[1].toLowerCase(),
      (cmdMatch[2] ?? '').trim(),
    );
    if (handled) return;
  }

  await handleQuestion(ctx, bound.user, text);
}

/** يُستدعى من مسار الويب‑هوك بعد التحقق من السرّ. */
export async function safeHandleUpdate(update: tg.TgUpdate): Promise<void> {
  try {
    await handleUpdate(update);
  } catch (err) {
    console.error('[telegram] update failed:', err);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      await tg
        .sendMessage(chatId, '❌ صار خطأ عندي أثناء معالجة طلبك. حاول مرة أخرى.')
        .catch(() => undefined);
    }
  }
}
