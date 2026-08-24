'use client';

/**
 * حارس الشبكة لعميل Supabase في المتصفح.
 *
 * يُركَّب مرة واحدة في `lib/supabase-client.ts`، فيسري على كل الصفحات بلا
 * تعديل أي واجهة. مسؤوليتان:
 *
 *  ① **القراءة تعيش بلا نت.** كل `GET` على `/rest/v1/` يُجرَّب على الشبكة أولاً
 *    (فالطازج أولى)، وعند الفشل يُخدَم من مخزون الجهاز. فتفتح أوامر التشغيل
 *    والستيكرات والمنيو وتطبعها والنت مقطوع.
 *
 *  ② **الكتابة لا تضيع بصمت.** لا نضع التعديلات في طابور ولا ننفّذها لاحقاً —
 *    نمنعها ونقول للمستخدم بوضوح إنها **لم تُحفظ**، والنموذج يبقى مفتوحاً بما
 *    كتبه فما يفقد شيئاً. طابور صامت يعيد التنفيذ بعد ساعة على بيانات تغيّرت
 *    أخطر بكثير من رسالة صريحة.
 *
 * ── دقّة الرسالة ────────────────────────────────────────────────────────────
 * نفرّق بين حالتين، لأن الصدق هنا يساوي سلامة البيانات:
 *   • عرفنا أننا مقطوعون **قبل** الإرسال ⇒ نجزم: «لم يُحفظ».
 *   • انقطع الاتصال **أثناء** الإرسال ⇒ لا نجزم: «قد لا يكون حُفظ — تحقّق».
 *
 * ── لماذا رد اصطناعي بحالة 599 لا استثناء؟ ──────────────────────────────────
 * postgrest-js يحوّل الاستثناء إلى `"${err.name}: ${err.message}"` فتخرج رسالة
 * ملخبطة، ويعيد المحاولة ٣ مرات على الـGET فيبطئ الفشل. أما الرد غير الناجح
 * بجسم JSON فيُمرَّر حرفياً إلى `error`. و599 مقصودة: القابل للإعادة عند
 * postgrest هو 503 و520 فقط.
 */

import { confirmOffline, isCertainlyOffline, markDataFresh, markOffline, markOnline } from './status';
import { readCached, writeCached } from './data-cache';

/** كم ننتظر رداً قبل أن نعتبر الشبكة ميتة ونلجأ للمخزون. */
const READ_TIMEOUT_MS = 10_000;

export const OFFLINE_ERROR_CODE = 'KHA_OFFLINE';

export const OFFLINE_MESSAGES = {
  /** قراءة بلا نسخة محفوظة. */
  readNoCache:
    'لا يوجد اتصال، وما فيه نسخة محفوظة من هذه البيانات على الجهاز. افتح الصفحة مرة وأنت متصل ليُحفظ محتواها.',
  /** كتابة مُنعت قبل إرسالها — يقين. */
  writeBlocked: 'لا يوجد اتصال — لم يُحفظ التعديل. بياناتك المكتوبة باقية؛ أعد المحاولة عند رجوع الاتصال.',
  /** كتابة انقطعت في المنتصف — لا يقين. */
  writeUncertain:
    'انقطع الاتصال أثناء الحفظ — قد لا يكون التعديل قد حُفظ. تحقّق من البيانات بعد رجوع الاتصال قبل إعادة المحاولة.',
  /** عملية RPC مُنعت قبل إرسالها. */
  rpcBlocked: 'لا يوجد اتصال — تعذّر تنفيذ العملية. أعد المحاولة عند رجوع الاتصال.',
} as const;

type RequestKind = 'read' | 'write' | 'rpc' | 'passthrough';

function classify(url: string, method: string): RequestKind {
  if (!url.includes('/rest/v1/')) return 'passthrough';
  if (method === 'GET' || method === 'HEAD') return 'read';
  if (url.includes('/rest/v1/rpc/')) return 'rpc';
  return 'write';
}

/**
 * رد على شكل خطأ PostgREST — يصل إلى `error.message` في الواجهة كما هو.
 * الحالة 599 خارج قائمة إعادة المحاولة عمداً.
 */
function offlineErrorResponse(message: string): Response {
  return new Response(
    JSON.stringify({ message, details: '', hint: '', code: OFFLINE_ERROR_CODE }),
    { status: 599, statusText: 'Offline', headers: { 'Content-Type': 'application/json' } },
  );
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const raw = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  return (raw ?? 'GET').toUpperCase();
}

/** طلب بلا جسم يُستخدم مفتاحاً للمخزون فقط — لا يُرسل أبداً. */
function cacheProbe(input: RequestInfo | URL, init?: RequestInit): Request {
  const headers = new Headers(
    init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined),
  );
  return new Request(urlOf(input), { method: 'GET', headers });
}

/** خطأ شبكة حقيقي (انقطاع) لا خطأ إلغاء من المستدعي. */
function isNetworkFailure(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return false;
  return err instanceof TypeError || err instanceof Error;
}

/**
 * يلفّ `fetch` بحارس مهلة يحترم إشارة المستدعي أيضاً — بلا مهلة، الواي‑فاي
 * الميت (متصل بلا إنترنت) يعلّق الصفحة دقيقة كاملة قبل أن نلجأ للمخزون.
 */
async function fetchWithTimeout(
  baseFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const callerSignal = init?.signal;
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener('abort', onCallerAbort);

  try {
    return await baseFetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

export function createGuardedFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  // على الخادم (SSR لمكوّنات العميل) لا `caches` ولا `navigator` — نمرّ كما نحن.
  if (typeof window === 'undefined') return baseFetch;

  return async function guardedFetch(input, init) {
    const url = urlOf(input);
    const method = methodOf(input, init);
    const kind = classify(url, method);

    // ── ما لا نتدخّل فيه: المصادقة والتخزين وكل ما ليس PostgREST ────────────
    // المصادقة تحديداً حسّاسة: auth-js يتصرّف بذكاء مع فشل الشبكة ويحافظ على
    // الجلسة، وأي رد مزوّر منّا قد يُخرج المستخدم من حسابه وهو مقطوع.
    if (kind === 'passthrough') {
      return baseFetch(input, init);
    }

    // ── الكتابة ─────────────────────────────────────────────────────────────
    if (kind === 'write' || kind === 'rpc') {
      // نفحص قبل المنع بدل أن نظنّ: عطل عابر في طلب قراءة واحد كان يكفي لمنع
      // حفظٍ صحيح تماماً بعده. الفحص يكلّف ثانيتين في الحالة الملتبسة وحدها.
      if (await confirmOffline()) {
        return offlineErrorResponse(
          kind === 'rpc' ? OFFLINE_MESSAGES.rpcBlocked : OFFLINE_MESSAGES.writeBlocked,
        );
      }
      try {
        // بلا مهلة اصطناعية: قطع كتابةٍ جاريةٍ يخلق شكّاً لا داعي له في أنها
        // وصلت أم لا. نترك المتصفح يقرّر.
        const response = await baseFetch(input, init);
        markOnline();
        return response;
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        markOffline();
        return offlineErrorResponse(OFFLINE_MESSAGES.writeUncertain);
      }
    }

    // ── القراءة ─────────────────────────────────────────────────────────────
    const probe = cacheProbe(input, init);

    // نعرف أننا مقطوعون ⇒ لا نضيّع ١٠ ثوانٍ على محاولة فاشلة.
    if (isCertainlyOffline()) {
      const cached = await readCached(probe);
      return cached ? cached.response : offlineErrorResponse(OFFLINE_MESSAGES.readNoCache);
    }

    try {
      const response = await fetchWithTimeout(baseFetch, input, init, READ_TIMEOUT_MS);
      if (response.ok) {
        markDataFresh();
        // التخزين لا يؤخّر الرد — يمضي في الخلفية.
        void writeCached(probe, response);
      } else {
        // ردّ الخادم بخطأ ⇒ الشبكة حيّة. أخطاء الصلاحيات وغيرها تمرّ كما هي.
        markOnline();
      }
      return response;
    } catch (err) {
      // إلغاء من المستدعي (تفكيك المكوّن مثلاً) يُمرَّر كما هو — ليس انقطاعاً.
      if (init?.signal?.aborted) throw err;
      if (!isNetworkFailure(err)) throw err;

      markOffline();
      const cached = await readCached(probe);
      return cached ? cached.response : offlineErrorResponse(OFFLINE_MESSAGES.readNoCache);
    }
  };
}
