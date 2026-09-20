#!/usr/bin/env node
/**
 * أداة تشغيل بوت تليقرام من سطر الأوامر.
 *
 * كل ما يمكن أتمتته في تفعيل البوت مؤتمت هنا، ولم يبقَ على المستخدم إلا ما لا
 * يستطيع أحد أن ينوب عنه فيه: إنشاء البوت عند @BotFather. فما إن يلصق رمزه
 * حتى يتكفّل هذا الملف بالباقي — التحقق منه، وحفظه، وتشغيل الترحيل إن أمكن،
 * ثم توصيل البوت بالخادم.
 *
 *   node scripts/telegram.mjs status          ما المضبوط وما الناقص
 *   node scripts/telegram.mjs setup <token>   تحقّق من الرمز واحفظه واربط كل شيء
 *   node scripts/telegram.mjs migrate         شغّل ترحيل قاعدة البيانات
 *   node scripts/telegram.mjs dev             شغّل البوت محلياً بلا ويب‑هوك
 *   node scripts/telegram.mjs webhook <url>   سجّل الويب‑هوك على نطاق منشور
 *   node scripts/telegram.mjs webhook off     ألغِ التسجيل
 *
 * ── لماذا وضع `dev`؟ ───────────────────────────────────────────────────────
 * الويب‑هوك يحتاج عنواناً عاماً بشهادة HTTPS، وهذا لا يوجد على جهاز أحد. فبدل
 * أن ينتظر المستخدم نشراً كاملاً ليجرّب أول رسالة، يسحب هذا الوضع التحديثات
 * من تليقرام سحباً (long polling) ويمرّرها لمسار الويب‑هوك المحلي نفسه بنفس
 * السرّ. المسار لا يعرف الفرق، فما نجرّبه محلياً هو ما سيعمل منشوراً.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, '.env.local');
const MIGRATION = join(ROOT, 'supabase', 'telegram-migration.sql');

// ── ألوان وطباعة ───────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const info = (m) => console.log(`  ${C.dim}${m}${C.reset}`);
const head = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

// ── البيئة ─────────────────────────────────────────────────────────────────

/** يقرأ .env.local بلا اعتماد على حزمة خارجية. */
function readEnv() {
  const env = {};
  if (!existsSync(ENV_FILE)) return env;
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    const key = trimmed.slice(0, at).trim();
    let value = trimmed.slice(at + 1).trim();
    // القيم المقتبسة تُجرَّد — الرموز أحياناً تُلصق بين علامتي اقتباس
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return { ...env, ...pickProcessEnv() };
}

/** متغيّرات البيئة الحقيقية تغلب الملف — هكذا يعمل الأمر على Vercel أيضاً. */
function pickProcessEnv() {
  const out = {};
  for (const k of [
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DB_URL', 'DATABASE_URL',
  ]) {
    if (process.env[k]) out[k] = process.env[k];
  }
  return out;
}

/** يكتب مفتاحاً في .env.local دون المساس بالباقي. */
function setEnv(key, value) {
  let text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(text)) {
    text = text.replace(pattern, `${key}=${value}`);
  } else {
    if (text && !text.endsWith('\n')) text += '\n';
    text += `${key}=${value}\n`;
  }
  writeFileSync(ENV_FILE, text);
}

function randomSecret() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── تليقرام ────────────────────────────────────────────────────────────────

async function tg(token, method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new Error(json?.description ?? `${method} فشل (${res.status})`);
  }
  return json.result;
}

// ── قاعدة البيانات ─────────────────────────────────────────────────────────

const TABLES = [
  'telegram_links', 'telegram_link_codes',
  'telegram_sessions', 'telegram_pending', 'telegram_updates',
];

/** هل جداول البوت موجودة؟ يُفحص عبر PostgREST بمفتاح الخدمة. */
async function tablesExist(env) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const missing = [];
  for (const table of TABLES) {
    const res = await fetch(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${table}?select=count`,
      {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'count=exact',
        },
      },
    ).catch(() => null);
    if (!res || res.status === 404) missing.push(table);
  }
  return missing;
}

function projectRef(env) {
  const match = /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  return match?.[1] ?? null;
}

function sqlEditorUrl(env) {
  const ref = projectRef(env);
  return ref ? `https://supabase.com/dashboard/project/${ref}/sql/new` : null;
}

/**
 * يشغّل الترحيل.
 *
 * DDL لا يمرّ عبر PostgREST مهما كان المفتاح — يحتاج اتصال Postgres مباشراً.
 * فإن توفّر رابط الاتصال شغّلناه، وإلا طبعنا للمستخدم أقصر طريق يدوي.
 */
async function migrate(env) {
  const url = env.SUPABASE_DB_URL || env.DATABASE_URL;
  const sql = readFileSync(MIGRATION, 'utf8');

  if (!url) {
    const editor = sqlEditorUrl(env);
    warn('ما فيه رابط اتصال مباشر بقاعدة البيانات، والترحيل (DDL) ما يمر عبر مفتاح الخدمة.');
    console.log('\n  أمامك طريقان — أيّهما أسرع لك:\n');
    console.log(`  ${C.bold}①${C.reset} الصق الملف في محرّر SQL (٢٠ ثانية):`);
    if (editor) console.log(`     ${C.cyan}${editor}${C.reset}`);
    console.log(`     المحتوى في: ${C.cyan}supabase/telegram-migration.sql${C.reset}\n`);
    console.log(`  ${C.bold}②${C.reset} أو أعطِ الأداة رابط الاتصال مرة واحدة فتشغّله بنفسها:`);
    console.log(`     ${C.dim}Supabase ← Settings ← Database ← Connection string (URI)${C.reset}`);
    console.log(`     ${C.cyan}SUPABASE_DB_URL='postgresql://…' npm run telegram migrate${C.reset}`);
    return false;
  }

  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
    ok('شُغّل الترحيل — جداول البوت جاهزة.');
    return true;
  } finally {
    await client.end();
  }
}

// ── الأوامر ────────────────────────────────────────────────────────────────

async function status(env) {
  head('حالة بوت تليقرام');

  const token = env.TELEGRAM_BOT_TOKEN;
  let bot = null;

  if (!token) {
    bad('رمز البوت — ناقص (TELEGRAM_BOT_TOKEN)');
    info('احصل عليه من @BotFather بأمر /newbot، ثم: npm run telegram setup <الرمز>');
  } else {
    try {
      bot = await tg(token, 'getMe');
      ok(`رمز البوت — سليم (@${bot.username})`);
    } catch (err) {
      bad(`رمز البوت — مرفوض من تليقرام: ${err.message}`);
    }
  }

  if (env.TELEGRAM_WEBHOOK_SECRET?.length >= 16) ok('سرّ الويب‑هوك — مضبوط');
  else bad('سرّ الويب‑هوك — ناقص أو قصير (TELEGRAM_WEBHOOK_SECRET)');

  if (env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY) ok('عقل المساعد — مفتاح متوفّر');
  else bad('عقل المساعد — ينقص GEMINI_API_KEY أو ANTHROPIC_API_KEY');

  const missing = await tablesExist(env);
  if (missing === null) warn('جداول البوت — تعذّر الفحص (ينقص مفتاح Supabase)');
  else if (missing.length === 0) ok('جداول البوت — موجودة');
  else bad(`جداول البوت — ناقصة (${missing.length}/${TABLES.length}). شغّل: npm run telegram migrate`);

  if (bot) {
    const hook = await tg(token, 'getWebhookInfo').catch(() => null);
    if (hook?.url) {
      ok(`الويب‑هوك — مسجَّل على ${hook.url}`);
      if (hook.last_error_message) {
        warn(`آخر خطأ سجّله تليقرام: ${hook.last_error_message}`);
      }
      if (hook.pending_update_count) info(`تحديثات معلّقة: ${hook.pending_update_count}`);
    } else {
      warn('الويب‑هوك — غير مسجَّل (للتجربة المحلية استعمل: npm run telegram dev)');
    }
  }

  console.log();
}

async function setup(env, token) {
  if (!token) {
    bad('اكتب الرمز: npm run telegram setup <الرمز>');
    info('الرمز من @BotFather، شكله: 8123456789:AAH_xxxxxxxxxxxxxxxxxxxxx');
    process.exit(1);
  }

  head('تفعيل البوت');

  // ① الرمز — نتحقق منه قبل أن نحفظه، فلا نحفظ رمزاً ميتاً
  let bot;
  try {
    bot = await tg(token, 'getMe');
  } catch (err) {
    bad(`تليقرام رفض هذا الرمز: ${err.message}`);
    info('تأكد أنك نسخته كاملاً من @BotFather.');
    process.exit(1);
  }
  setEnv('TELEGRAM_BOT_TOKEN', token);
  ok(`الرمز سليم ومحفوظ — البوت @${bot.username}`);

  // ② السرّ — يُولَّد إن لم يكن موجوداً
  if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 16) {
    setEnv('TELEGRAM_WEBHOOK_SECRET', randomSecret());
    ok('وُلّد سرّ الويب‑هوك وحُفظ');
  } else {
    ok('سرّ الويب‑هوك موجود');
  }

  // ③ قائمة الأوامر داخل تليقرام
  await tg(token, 'setMyCommands', {
    commands: [
      { command: 'help', description: 'أمثلة وأوامر البوت' },
      { command: 'new', description: 'ابدأ حواراً جديداً' },
      { command: 'whoami', description: 'بأي حساب أتكلم' },
      { command: 'unlink', description: 'فكّ ربط هذه المحادثة' },
    ],
    scope: { type: 'default' },
  }).then(() => ok('سُجّلت قائمة الأوامر في تليقرام')).catch(() => warn('تعذّر تسجيل قائمة الأوامر (غير مهم)'));

  // ④ الجداول
  const missing = await tablesExist(env);
  if (missing && missing.length) {
    warn(`جداول البوت ناقصة (${missing.length})`);
    await migrate(env).catch((err) => bad(`فشل الترحيل: ${err.message}`));
  } else if (missing) {
    ok('جداول البوت موجودة');
  }

  // ⑤ الوصل بالخادم
  const appUrl = env.NEXT_PUBLIC_APP_URL ?? '';
  head('الخطوة الأخيرة');
  if (appUrl.startsWith('https://')) {
    console.log(`  نطاقك منشور — سجّل الويب‑هوك:`);
    console.log(`  ${C.cyan}npm run telegram webhook ${appUrl}${C.reset}\n`);
  } else {
    console.log(`  للتجربة على جهازك الآن (بلا نشر ولا ويب‑هوك):`);
    console.log(`  ${C.cyan}npm run dev${C.reset}          ${C.dim}في نافذة${C.reset}`);
    console.log(`  ${C.cyan}npm run telegram dev${C.reset}  ${C.dim}في نافذة ثانية${C.reset}\n`);
    console.log(`  ${C.dim}وعند النشر: npm run telegram webhook https://your-app.vercel.app${C.reset}\n`);
  }
  console.log(`  ثم افتح البوت ${C.cyan}https://t.me/${bot.username}${C.reset} وأرسل له كود الربط`);
  console.log(`  ${C.dim}(الإعدادات ← بوت تليقرام ← إنشاء كود ربط)${C.reset}\n`);
}

async function webhook(env, target) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) { bad('ينقص TELEGRAM_BOT_TOKEN — شغّل: npm run telegram setup <الرمز>'); process.exit(1); }

  if (target === 'off' || target === 'delete') {
    await tg(token, 'deleteWebhook', { drop_pending_updates: true });
    ok('أُلغي تسجيل الويب‑هوك');
    return;
  }

  const base = (target || env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base.startsWith('https://')) {
    bad('تليقرام يقبل HTTPS فقط — أعطِ نطاق النشر: npm run telegram webhook https://your-app.vercel.app');
    process.exit(1);
  }

  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) { bad('ينقص TELEGRAM_WEBHOOK_SECRET'); process.exit(1); }

  const url = `${base}/api/telegram/webhook`;
  await tg(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  ok(`سُجّل الويب‑هوك على ${url}`);
  warn('تأكد أن TELEGRAM_BOT_TOKEN وTELEGRAM_WEBHOOK_SECRET مضبوطان في بيئة النشر أيضاً،');
  info('وإلا رفض الخادم كل تحديث يصله.');
}

/**
 * وضع التطوير: نسحب التحديثات ونمرّرها للمسار المحلي.
 *
 * `getUpdates` و`setWebhook` لا يجتمعان عند تليقرام، فنلغي التسجيل أولاً.
 * والإزاحة (`offset`) تُقدَّم بعد كل دفعة وإلا أعاد إرسال ما سُلّم.
 */
async function dev(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!token) { bad('ينقص TELEGRAM_BOT_TOKEN — شغّل: npm run telegram setup <الرمز>'); process.exit(1); }
  if (!secret) { bad('ينقص TELEGRAM_WEBHOOK_SECRET'); process.exit(1); }

  const local = (env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const endpoint = `${local}/api/telegram/webhook`;

  const bot = await tg(token, 'getMe');
  await tg(token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => {});

  head(`البوت @${bot.username} يعمل محلياً`);
  info(`التحديثات تُمرَّر إلى ${endpoint}`);
  info('اترك هذه النافذة مفتوحة. للإيقاف: Ctrl+C');
  console.log();

  // نتأكد أن الخادم شغّال قبل أن نعد المستخدم بشيء
  const ping = await fetch(endpoint, { method: 'POST' }).catch(() => null);
  if (!ping) {
    bad(`ما فيه خادم على ${local} — شغّل npm run dev في نافذة ثانية.`);
    process.exit(1);
  }
  if (ping.status !== 403) {
    warn(`المسار ردّ ${ping.status} على طلب بلا سرّ — المتوقّع 403. راجع الإعداد.`);
  }

  let offset = 0;
  let failures = 0;

  for (;;) {
    let updates;
    try {
      updates = await tg(token, 'getUpdates', {
        offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      });
      failures = 0;
    } catch (err) {
      failures++;
      bad(`تعذّر السحب من تليقرام: ${err.message}`);
      // تراجع تصاعدي بسقف — انقطاع الشبكة لا يستحق حلقة محمومة
      await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * failures)));
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      const who = update.message?.from?.first_name ?? update.callback_query?.from?.first_name ?? '؟';
      const what = update.message?.text ?? `[زر ${update.callback_query?.data ?? ''}]`;
      console.log(`${C.dim}←${C.reset} ${who}: ${what}`);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-telegram-bot-api-secret-token': secret,
        },
        body: JSON.stringify(update),
      }).catch((err) => {
        bad(`تعذّر تسليم التحديث للخادم: ${err.message}`);
        return null;
      });

      if (res && !res.ok) bad(`الخادم ردّ ${res.status} على التحديث ${update.update_id}`);
    }
  }
}

// ── المدخل ─────────────────────────────────────────────────────────────────

const [, , command = 'status', ...rest] = process.argv;
const env = readEnv();

try {
  if (command === 'status') await status(env);
  else if (command === 'setup') await setup(env, rest[0]);
  else if (command === 'migrate') await migrate(env);
  else if (command === 'dev' || command === 'poll') await dev(env);
  else if (command === 'webhook') await webhook(env, rest[0]);
  else {
    console.log(`أوامر معروفة: status | setup <token> | migrate | dev | webhook <url|off>`);
    process.exit(1);
  }
} catch (err) {
  bad(err.message);
  process.exit(1);
}
