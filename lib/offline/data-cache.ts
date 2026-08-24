'use client';

/**
 * مخزون قراءات Supabase على الجهاز — يخدم الصفحات لما ينقطع النت.
 *
 * ── ليش هنا وليس في الـservice worker؟ ──────────────────────────────────────
 * لأن `fetchAllRows` يقرأ على دفعات بترويسة `Range: 0-999` ثم `1000-1999`،
 * و**الرابط نفسه في كل الدفعات**. الـservice worker يفهرس بالرابط، فكان
 * يخلط الدفعات ببعض ويرجّع صفحة مكان أخرى. هنا نبني المفتاح بأنفسنا فنضمّه
 * `Range` و`Prefer` (الأخيرة تغيّر شكل الرد: count=exact).
 *
 * ── ليش لا نخزّن كل شيء بلا حدّ؟ ────────────────────────────────────────────
 * حصّة المتصفح محدودة، وامتلاؤها يُفشل الكتابة كلها بلا إنذار. فنسقّف عدد
 * المدخلات ونتخلّص من الأقدم، ونتخطّى الردود الضخمة أصلاً.
 *
 * ── خصوصية ──────────────────────────────────────────────────────────────────
 * المخزون يحوي أسماء مستفيدين وبياناتهم. لذلك يُمسح عند تسجيل الخروج
 * (`purgeDataCache` تُستدعى من زر الخروج) — تابلت المطبخ مشترك.
 */

export const DATA_CACHE_NAME = 'kha-data-v1';

/** سقف المدخلات — أعلى من احتياج يوم عمل كامل بكثير، وأقل من حصّة المتصفح. */
const MAX_ENTRIES = 400;
/** رد أكبر من هذا لا يُخزَّن — نسخة احتياطية واحدة ما تستاهل ملء الحصّة. */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const CACHED_AT_HEADER = 'x-kha-cached-at';
/** تُضاف للردود المخدومة من المخزون — الواجهة تقرأها لتعرف أنها ليست طازجة. */
export const OFFLINE_HEADER = 'x-kha-offline';

function cachesAvailable(): boolean {
  return typeof caches !== 'undefined';
}

/**
 * مفتاح التخزين: الرابط + ما يغيّر شكل الرد من الترويسات.
 * نضيفهما كمعاملات استعلام لأن Cache Storage يفهرس بالرابط لا بالترويسات.
 */
export function buildCacheKey(request: Request): Request {
  const url = new URL(request.url);
  const range = request.headers.get('range');
  if (range) url.searchParams.set('__kha_range', range);
  const prefer = request.headers.get('prefer');
  if (prefer) url.searchParams.set('__kha_prefer', prefer);
  return new Request(url.toString(), { method: 'GET' });
}

/**
 * يبني رداً قابلاً للتخزين من رد الشبكة.
 *
 * نبني `Response` جديداً بدل تخزين الأصلي عمداً: رد CORS يخفي ترويساته إلا
 * المكشوفة، والنسخة المبنية يدوياً تحتفظ بما قرأناه — أهمّه `content-range`
 * الذي يقرأ منه supabase-js عدد الصفوف الكلي.
 */
async function toStorableResponse(response: Response, cachedAt: number): Promise<Response | null> {
  const body = await response.clone().arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) return null;

  const headers = new Headers();
  response.headers.forEach((value, key) => headers.set(key, value));
  headers.set(CACHED_AT_HEADER, String(cachedAt));

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * عمليات تخزين جارية. القراءة لا تنتظر التخزين (وإلا أخّرنا كل استعلام بنسخ
 * الجسم كاملاً)، لكن من يحتاج يقيناً — الاختبارات، وزر «تجهيز» — يقدر ينتظرها.
 */
const pendingWrites = new Set<Promise<void>>();

/** يخزّن رد قراءة ناجحاً. أي فشل هنا صامت — التخزين تحسين لا شرط للعمل. */
export function writeCached(request: Request, response: Response): Promise<void> {
  // النسخ يبدأ الآن لا بعد await: لو انتظرنا، قد يكون المستدعي استهلك الجسم
  // قبل أن نستنسخه فيرمي `clone()`.
  const task = (async () => {
    if (!cachesAvailable()) return;
    if (!response.ok) return;
    try {
      const storable = await toStorableResponse(response, Date.now());
      if (!storable) return;
      const cache = await caches.open(DATA_CACHE_NAME);
      await cache.put(buildCacheKey(request), storable);
      void trim(cache);
    } catch {
      // حصّة ممتلئة أو تخزين محجوب — نكمل بلا مخزون.
    }
  })();

  pendingWrites.add(task);
  void task.finally(() => pendingWrites.delete(task));
  return task;
}

/** ينتظر استقرار كل عمليات التخزين الجارية. */
export async function flushCacheWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    await Promise.all([...pendingWrites]);
  }
}

export interface CachedRead {
  response: Response;
  cachedAt: number | null;
}

/** يقرأ من المخزون. يرجّع null لو ما فيه نسخة. */
export async function readCached(request: Request): Promise<CachedRead | null> {
  if (!cachesAvailable()) return null;
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    // `ignoreVary` ضروري: توكن المصادقة يتجدّد كل ساعة، ولو احترمنا
    // `Vary: Authorization` ما أصاب المخزون أبداً بعد أول تجديد.
    const hit = await cache.match(buildCacheKey(request), { ignoreVary: true });
    if (!hit) return null;

    const stamp = Number(hit.headers.get(CACHED_AT_HEADER));
    const cachedAt = Number.isFinite(stamp) && stamp > 0 ? stamp : null;

    // نعلّم الرد حتى تعرف الطبقات الأعلى أنه من المخزون لا من الشبكة.
    const headers = new Headers();
    hit.headers.forEach((value, key) => headers.set(key, value));
    headers.set(OFFLINE_HEADER, '1');

    return {
      response: new Response(await hit.arrayBuffer(), {
        status: hit.status,
        statusText: hit.statusText,
        headers,
      }),
      cachedAt,
    };
  } catch {
    return null;
  }
}

/** يحذف الأقدم متى تجاوزنا السقف. الترتيب بختم `x-kha-cached-at`. */
async function trim(cache: Cache): Promise<void> {
  try {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;

    const stamped = await Promise.all(
      keys.map(async (key) => {
        const res = await cache.match(key, { ignoreVary: true });
        const stamp = Number(res?.headers.get(CACHED_AT_HEADER));
        return { key, at: Number.isFinite(stamp) ? stamp : 0 };
      }),
    );
    stamped.sort((a, b) => a.at - b.at);
    const excess = stamped.slice(0, stamped.length - MAX_ENTRIES);
    await Promise.all(excess.map((entry) => cache.delete(entry.key)));
  } catch {
    // التشذيب تحسين — فشله لا يمنع العمل.
  }
}

export interface DataCacheStats {
  entries: number;
  oldestAt: number | null;
  newestAt: number | null;
  bytes: number | null;
}

/** إحصاءات للعرض في الإعدادات — كم صفحة بيانات محفوظة ومتى. */
export async function dataCacheStats(): Promise<DataCacheStats> {
  const empty: DataCacheStats = { entries: 0, oldestAt: null, newestAt: null, bytes: null };
  if (!cachesAvailable()) return empty;
  try {
    const cache = await caches.open(DATA_CACHE_NAME);
    const keys = await cache.keys();
    if (keys.length === 0) return { ...empty, bytes: await estimateUsage() };

    let oldest = Infinity;
    let newest = 0;
    for (const key of keys) {
      const res = await cache.match(key, { ignoreVary: true });
      const stamp = Number(res?.headers.get(CACHED_AT_HEADER));
      if (!Number.isFinite(stamp) || stamp <= 0) continue;
      if (stamp < oldest) oldest = stamp;
      if (stamp > newest) newest = stamp;
    }

    return {
      entries: keys.length,
      oldestAt: Number.isFinite(oldest) ? oldest : null,
      newestAt: newest || null,
      bytes: await estimateUsage(),
    };
  } catch {
    return empty;
  }
}

async function estimateUsage(): Promise<number | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage } = await navigator.storage.estimate();
    return typeof usage === 'number' ? usage : null;
  } catch {
    return null;
  }
}

/**
 * بادئات المخازن التي تحوي بيانات مستفيدين: قراءات PostgREST (هذا الملف) وردود
 * مسارات ‎/api‎ التي يخزّنها الـservice worker. نمسح بالبادئة لا بالاسم الكامل
 * حتى لا يتسرّب مخزون إصدار قديم بعد ترقية رقم النسخة.
 */
const PRIVATE_CACHE_PREFIXES = ['kha-data-', 'kha-api-'];

/**
 * يمسح كل بيانات المستفيدين المخزّنة. يُستدعى عند تسجيل الخروج وعند طلب
 * المستخدم من الإعدادات. لا يمسّ مخزون ملفات التطبيق (JS/CSS/خطوط) — مسحه
 * يعطّل الفتح بلا إنترنت بلا أي فائدة أمنية.
 */
export async function purgeDataCache(): Promise<void> {
  if (!cachesAvailable()) return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => PRIVATE_CACHE_PREFIXES.some((prefix) => name.startsWith(prefix)))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // ignore
  }
}
