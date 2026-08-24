/* eslint-disable no-restricted-globals */
/**
 * Service Worker — يجعل التطبيق يفتح ويعمل بلا إنترنت.
 *
 * تقسيم المسؤوليات مقصود:
 *   • هذا الملف يتكفّل بـ**قشرة التطبيق**: صفحات HTML، حِزم JavaScript،
 *     الخطوط، الأيقونات، الصور. هذي أشياء لا يقدر كود الصفحة يخزّنها لأنها
 *     تُطلب قبل أن يعمل أي كود.
 *   • بيانات Supabase (‎/rest/v1‎) **ليست** من شغله — تخزّنها lib/offline/
 *     data-cache.ts في سياق الصفحة، لأن `fetchAllRows` يقرأ على دفعات بترويسة
 *     `Range` والرابط واحد في كل الدفعات؛ الـSW يفهرس بالرابط فيخلطها.
 *
 * ما لا يُخزَّن أبداً: طلبات المصادقة (‎/auth/v1‎) — تخزين رد مصادقة قديم
 * يفتح باب إعادة استعمال جلسة منتهية.
 */

/**
 * مضيف التطوير (`next dev`).
 *
 * في نسخة الإنتاج تحمل ملفات ‎/_next/static/‎ بصمة المحتوى في أسمائها، أما في
 * التطوير فالاسم ثابت (`app/.../page.js`) ويُعاد بناء الملف في مكانه. فلو
 * خزّنّاها بـ`cacheFirst` ثبّتنا نسخة JavaScript قديمة إلى الأبد: تصل صفحة
 * HTML جديدة من السيرفر مع حِزمة قديمة من المخزون، والنتيجة خطأ hydration
 * وتعديلات لا تظهر مهما أعاد المطوّر التحميل. على localhost نتنحّى عنها.
 */
const IS_DEV_HOST =
  self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

const VERSION = 'v2';
const SHELL_CACHE = `kha-shell-${VERSION}`;
const ASSET_CACHE = `kha-assets-${VERSION}`;
/**
 * ردود مسارات ‎/api‎ الداخلية. منفصلة لأنها تحوي بيانات مستفيدين، فتُمسح مع
 * مخزون البيانات عند تسجيل الخروج — لا مع قشرة التطبيق.
 */
const API_CACHE = `kha-api-${VERSION}`;
const OURS = [SHELL_CACHE, ASSET_CACHE, API_CACHE];

/** صفحة الطوارئ: تظهر لو طُلبت صفحة ما زارها المستخدم قط وهو متصل. */
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/logo.png', '/icon-192.png'];

/** مهلة الشبكة للصفحات — بعدها نخدم النسخة المحفوظة بدل تعليق المستخدم. */
const NAV_TIMEOUT_MS = 6000;
/** سقف صفحات HTML المحفوظة — أكبر من عدد صفحات النظام بهامش. */
const MAX_SHELL_ENTRIES = 60;

/**
 * رد إعادة توجيه لا يصلح للتخزين: إرجاعه لطلب تنقّل يرمي
 * "Response served by service worker has redirected". وأيضاً ردّ تحويل إلى
 * ‎/login‎ يعني أننا خزّنّا صفحة الدخول مكان الصفحة المطلوبة.
 */
/**
 * مسار مطلق داخل نطاق التطبيق. الـSW يحلّ النسبي مقابل نطاقه ضمناً، لكن
 * التصريح يجعل مفتاح التخزين ومفتاح البحث متطابقين بيقين — وهما في ملفين
 * مختلفين من الملف (التنصيب والتنقّل).
 */
function shellUrl(pathname) {
  return new URL(pathname, self.location.origin).toString();
}

function isCacheableResponse(response) {
  return Boolean(response) && response.status === 200 && response.type !== 'opaqueredirect' && !response.redirected;
}

// ─── التنصيب والتفعيل ───────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // لا نستخدم `cache.addAll`: لو انتهت الجلسة حوّل الوسيط الطلب إلى
      // ‎/login‎ ورجع 200، فيخزّن addAll صفحة الدخول مكان صفحة الطوارئ ويصير
      // كل انقطاع «سجّل دخولك». نفحص كل رد بأنفسنا.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            // `reload` يتجاوز مخزون HTTP فنضمن نسخة طازجة وقت التنصيب.
            const absolute = shellUrl(url);
            const response = await fetch(new Request(absolute, { cache: 'reload' }));
            if (isCacheableResponse(response)) await cache.put(absolute, response);
          } catch {
            // ملف تعذّر لا يفشّل التنصيب كله.
          }
        }),
      );
    })(),
  );
  // لا `skipWaiting()` هنا عمداً: لو استولى إصدار جديد على تبويب مفتوح، طلبت
  // الصفحة القديمة حِزماً حذفناها للتوّ فانكسرت. ننتظر، والصفحة تعرض زر تحديث.
  // إلا في التطوير: الحِزم هناك لا تُخزَّن أصلاً فلا شيء ينكسر، والانتظار يعني
  // بقاء المطوّر عالقاً مع إصدار قديم إلى أن يغلق كل تبويباته.
  if (IS_DEV_HOST) self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('kha-') && !OURS.includes(name) && !name.startsWith('kha-data-'))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (type === 'PURGE_SHELL') {
    event.waitUntil(Promise.all([SHELL_CACHE, ASSET_CACHE].map((name) => caches.delete(name))));
  }
});

// ─── مساعدات ────────────────────────────────────────────────────────────────

function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  return request.destination === 'document' || accept.includes('text/html');
}

async function trimCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    // Cache Storage يحفظ بترتيب الإدراج — الأقدم أولاً.
    await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
  } catch {
    /* التشذيب تحسين */
  }
}

async function fetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** ملف ثابت ببصمة في اسمه لا يتغيّر محتواه أبداً — المخزون أولاً بلا تردّد. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/** المخزون فوراً + تحديث صامت في الخلفية — للأصول التي قد تتغيّر بنفس الاسم. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (hit) return hit;
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error('offline and not cached');
}

/** الصفحات: الشبكة أولاً (المحتوى يتغيّر)، والمخزون شبكة نجاة. */
async function navigationStrategy(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone()).then(() => trimCache(SHELL_CACHE, MAX_SHELL_ENTRIES)).catch(() => {});
    }
    return response;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const fallback = await cache.match(shellUrl(OFFLINE_URL));
    if (fallback) return fallback;
    return new Response('<!doctype html><meta charset="utf-8"><p>لا يوجد اتصال.', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * مفتاح موحَّد لحمولة RSC.
 *
 * نكست يضيف `?_rsc=<بصمة>` تتغيّر مع حالة الراوتر، فالتخزين بالرابط الخام لا
 * يُصاب أبداً. والمطابقة بتجاهل الاستعلام (`ignoreSearch`) أسوأ: تُرجع مستند
 * HTML المخزَّن لنفس المسار رداً على طلب RSC. فنطبّع المفتاح على المسار وحده
 * مع علامة تميّزه عن المستند.
 */
function rscCacheKey(url) {
  const key = new URL(url.origin + url.pathname);
  key.searchParams.set('__kha_rsc', '1');
  return new Request(key.toString(), { method: 'GET' });
}

async function rscStrategy(request, url) {
  const cache = await caches.open(SHELL_CACHE);
  const key = rscCacheKey(url);
  try {
    const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
    if (isCacheableResponse(response)) cache.put(key, response.clone()).catch(() => {});
    return response;
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    // خطأ شبكة صريح — عنده يسقط راوتر Next إلى تنقّل كامل بالصفحة، وذاك
    // المسار يجد مستنده المحفوظ. ردٌّ بحالة 503 كان يُقرأ كحمولة تالفة.
    return Response.error();
  }
}

/**
 * مسارات ‎/api‎ الداخلية (GET فقط — غيرها لا يصل هنا أصلاً): الشبكة أولاً ثم
 * المخزون.
 *
 * التخزين هنا ليس ترفاً: صفحة ستيكرات الفطور وطباعة أمر التشغيل والتقارير
 * كلها تقرأ من `‎/api/orders/<id>/report‎`. بلا مخزونها، «اطبع ستيكرات اليوم
 * والنت مقطوع» — وهو أهم ما يحتاجه المطبخ — لا يعمل.
 *
 * وعند فشل كل شيء نرجّع JSON بشكل الأخطاء الذي تتوقّعه الواجهات (`json.error`)
 * فتظهر رسالة عربية مفهومة بدل انهيار صامت.
 */
async function apiStrategy(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    return new Response(
      JSON.stringify({ error: 'لا يوجد اتصال بالإنترنت — تعذّر تنفيذ الطلب. أعد المحاولة عند رجوع الاتصال.' }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

// ─── الموجّه ────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const sameOrigin = url.origin === self.location.origin;

  // ① المصادقة وبيانات PostgREST — لا نلمسها إطلاقاً.
  if (url.pathname.startsWith('/auth/v1/') || url.pathname.startsWith('/rest/v1/')) return;

  // ② نبضة فحص الاتصال — لازم تصل الشبكة فعلاً وإلا فقدت معناها.
  if (sameOrigin && url.pathname === '/api/ping') return;

  // ③ ملفات Supabase العامة (الشعارات، الصور الشخصية).
  if (url.pathname.startsWith('/storage/v1/object/public/')) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    return;
  }
  if (!sameOrigin) {
    // ④ خطوط Google — بدونها يفقد التطبيق خطّه العربي بالكامل أوفلاين.
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
    }
    return;
  }

  // ⑤ مسارات API الداخلية.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(apiStrategy(request));
    return;
  }

  // ⑥ حِزم Next الثابتة — أسماؤها تحمل بصمة المحتوى فلا تتغيّر أبداً.
  //    ما عدا التطوير: الأسماء هناك ثابتة والمحتوى يتغيّر تحتها (انظر
  //    IS_DEV_HOST أعلاه)، فنترك الطلب للمتصفح بلا تخزين.
  if (url.pathname.startsWith('/_next/static/')) {
    if (IS_DEV_HOST) return;
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  // ⑦ حمولة RSC للتنقّل داخل التطبيق.
  if (url.searchParams.has('_rsc') || request.headers.get('rsc') === '1') {
    event.respondWith(rscStrategy(request, url));
    return;
  }

  // ⑧ صفحات HTML.
  if (isHtmlRequest(request)) {
    event.respondWith(navigationStrategy(request));
    return;
  }

  // ⑨ باقي الأصول: صور، أيقونات، manifest.
  event.respondWith(
    staleWhileRevalidate(request, ASSET_CACHE).catch(() => new Response('', { status: 503 })),
  );
});
