import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * اختبار الـservice worker نفسه، بتحميل الملف الحقيقي في بيئة وهمية وتشغيل
 * معالجاته — لا بمحاكاة منطقه من جديد. أهم ما نحرسه هنا:
 *
 *  • ألّا يعترض الـSW طلبات `/rest/v1/` أبداً. هو يفهرس بالرابط، ودفعات
 *    `fetchAllRows` تشترك في رابط واحد وتختلف بترويسة `Range` — فاعتراضه
 *    يعني خلط دفعة بأخرى، أي أعداد وجبات خاطئة. التخزين هناك مسؤولية
 *    lib/offline/data-cache.ts.
 *  • ألّا يخزّن رداً محوَّلاً — انتهاء الجلسة يحوّل أي صفحة إلى `/login`،
 *    وتخزينها يعني أن كل انقطاع لاحق يعرض شاشة تسجيل الدخول.
 */

interface FakeCacheEntry {
  url: string;
  response: Response;
}

class FakeCache {
  entries = new Map<string, Response>();
  async put(request: Request | string, response: Response) {
    this.entries.set(typeof request === 'string' ? new URL(request, 'https://app.test').toString() : request.url,
      response.clone());
  }
  async match(request: Request | string, options?: { ignoreSearch?: boolean }) {
    const url = typeof request === 'string' ? new URL(request, 'https://app.test').toString() : request.url;
    const direct = this.entries.get(url);
    if (direct) return direct.clone();
    if (options?.ignoreSearch) {
      const bare = url.split('?')[0];
      for (const [key, value] of this.entries) {
        if (key.split('?')[0] === bare) return value.clone();
      }
    }
    return undefined;
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
  async delete(request: Request | string) {
    return this.entries.delete(typeof request === 'string' ? request : request.url);
  }
  list(): FakeCacheEntry[] {
    return [...this.entries].map(([url, response]) => ({ url, response }));
  }
}

class FakeCacheStorage {
  store = new Map<string, FakeCache>();
  async open(name: string) {
    let cache = this.store.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.store.set(name, cache);
    }
    return cache;
  }
  async keys() {
    return [...this.store.keys()];
  }
  async delete(name: string) {
    return this.store.delete(name);
  }
}

type Handler = (event: unknown) => void;

interface Harness {
  handlers: Map<string, Handler[]>;
  caches: FakeCacheStorage;
  netFetch: ReturnType<typeof vi.fn>;
  skipWaiting: ReturnType<typeof vi.fn>;
  dispatchFetch(request: Request): Promise<Response | null>;
  install(): Promise<void>;
}

function loadServiceWorker(origin = 'https://app.test'): Harness {
  const source = readFileSync(path.resolve(__dirname, '../public/sw.js'), 'utf8');
  const handlers = new Map<string, Handler[]>();
  const cacheStorage = new FakeCacheStorage();
  const netFetch = vi.fn();

  const { hostname } = new URL(origin);
  const self = {
    location: { origin, hostname },
    addEventListener(type: string, handler: Handler) {
      const list = handlers.get(type) ?? [];
      list.push(handler);
      handlers.set(type, list);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function('self', 'caches', 'fetch', source);
  factory(self, cacheStorage, netFetch);

  return {
    handlers,
    caches: cacheStorage,
    netFetch,
    skipWaiting: self.skipWaiting,
    async dispatchFetch(request: Request) {
      let captured: Promise<Response> | null = null;
      const event = {
        request,
        respondWith(promise: Promise<Response>) {
          captured = promise;
        },
        waitUntil() {},
      };
      for (const handler of handlers.get('fetch') ?? []) handler(event);
      return captured ? await captured : null;
    },
    async install() {
      const waits: Promise<unknown>[] = [];
      const event = {
        waitUntil(promise: Promise<unknown>) {
          waits.push(promise);
        },
      };
      for (const handler of handlers.get('install') ?? []) handler(event);
      await Promise.all(waits);
    },
  };
}

const APP = 'https://app.test';
const SUPA = 'https://proj.supabase.co';

let sw: Harness;

beforeEach(() => {
  sw = loadServiceWorker();
});

describe('service worker — ما لا يعترضه', () => {
  it('لا يلمس /rest/v1/ إطلاقاً — دفعات Range تشترك في رابط واحد', async () => {
    const res = await sw.dispatchFetch(new Request(`${SUPA}/rest/v1/exclusions?select=*`));
    // null = ما استدعى respondWith، أي تركه للشبكة كما هو.
    expect(res).toBeNull();
  });

  it('لا يلمس /auth/v1/ — تخزين رد مصادقة يفتح باب جلسة منتهية', async () => {
    expect(await sw.dispatchFetch(new Request(`${SUPA}/auth/v1/user`))).toBeNull();
  });

  it('لا يلمس نبضة الفحص — تخزينها يجعلها تكذب', async () => {
    expect(await sw.dispatchFetch(new Request(`${APP}/api/ping?t=1`))).toBeNull();
  });

  it('يتجاهل كل ما ليس GET', async () => {
    expect(await sw.dispatchFetch(new Request(`${APP}/anything`, { method: 'POST' }))).toBeNull();
  });
});

/**
 * مخزون القشرة باسمه الفعلي — يُلتقط بالبادئة لا بالإصدار، فرفع رقم الإصدار
 * في sw.js لا يكسر الاختبار (وهو يُرفع كلما لزم إسقاط مخزون قديم).
 */
async function openShellCache() {
  const name = (await sw.caches.keys()).find((k) => k.startsWith('kha-shell-'));
  expect(name, 'ما وُجد مخزون قشرة — تأكد أن التنصيب فتحه').toBeDefined();
  return sw.caches.open(name!);
}

describe('service worker — التخزين المسبق', () => {
  it('يرفض تخزين رد محوَّل إلى /login مكان صفحة الطوارئ', async () => {
    // محاكاة انتهاء الجلسة: الوسيط يحوّل /offline إلى /login.
    const redirected = new Response('<p>سجّل الدخول', { status: 200 });
    Object.defineProperty(redirected, 'redirected', { value: true });
    sw.netFetch.mockResolvedValue(redirected);

    await sw.install();

    const shell = await openShellCache();
    expect(shell.list()).toHaveLength(0);
  });

  it('يخزّن الردود السليمة وقت التنصيب', async () => {
    sw.netFetch.mockResolvedValue(new Response('<p>لا يوجد اتصال', { status: 200 }));
    await sw.install();

    const shell = await openShellCache();
    const urls = shell.list().map((e) => e.url);
    expect(urls.some((u) => u.endsWith('/offline'))).toBe(true);
  });
});

describe('service worker — الصفحات بلا نت', () => {
  const page = () =>
    new Request(`${APP}/stickers`, { headers: { Accept: 'text/html' } });

  it('يخزّن الصفحة وهو متصل ثم يخدمها بعد الانقطاع', async () => {
    sw.netFetch.mockResolvedValue(new Response('<h1>ستيكرات</h1>', { status: 200 }));
    await sw.dispatchFetch(page());

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const offline = await sw.dispatchFetch(page());

    expect(offline?.status).toBe(200);
    expect(await offline!.text()).toContain('ستيكرات');
  });

  it('يسقط إلى صفحة الطوارئ لصفحة لم تُزر قط', async () => {
    sw.netFetch.mockResolvedValue(new Response('<p>طوارئ', { status: 200 }));
    await sw.install();

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const res = await sw.dispatchFetch(new Request(`${APP}/costs`, { headers: { Accept: 'text/html' } }));

    expect(res?.status).toBe(200);
    expect(await res!.text()).toContain('طوارئ');
  });

  it('يرد بصفحة عربية مفهومة حتى لو لم تُخزَّن صفحة الطوارئ', async () => {
    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const res = await sw.dispatchFetch(new Request(`${APP}/menu`, { headers: { Accept: 'text/html' } }));

    expect(res?.status).toBe(503);
    expect(await res!.text()).toContain('لا يوجد اتصال');
  });
});

describe('service worker — مسارات API الداخلية', () => {
  it('يخزّن تقرير أمر التشغيل فتعمل الستيكرات والطباعة بلا نت', async () => {
    // هذا المسار هو مصدر بيانات صفحة ستيكرات الفطور وطباعة أمر التشغيل
    // والتقارير — بلا تخزينه ينهار أهم استخدام أوفلاين في المطبخ.
    const url = `${APP}/api/orders/abc-123/report`;
    sw.netFetch.mockResolvedValue(
      new Response(JSON.stringify({ rows: [{ name: 'أحمد' }] }), { status: 200 }),
    );
    await sw.dispatchFetch(new Request(url));

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const offline = await sw.dispatchFetch(new Request(url));

    expect(offline?.status).toBe(200);
    expect(await offline!.json()).toEqual({ rows: [{ name: 'أحمد' }] });
  });

  it('يفصل تقارير الأوامر بعضها عن بعض', async () => {
    sw.netFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'one' }), { status: 200 }));
    await sw.dispatchFetch(new Request(`${APP}/api/orders/one/report`));

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const other = await sw.dispatchFetch(new Request(`${APP}/api/orders/two/report`));
    const body = (await other!.json()) as { error?: string };
    expect(body.error).toContain('لا يوجد اتصال');
  });

  it('يرجّع خطأ JSON بالشكل الذي تقرأه الواجهات', async () => {
    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const res = await sw.dispatchFetch(new Request(`${APP}/api/cities`));

    expect(res?.status).toBe(503);
    const body = (await res!.json()) as { error: string };
    // الواجهات تقرأ json.error — أي شكل آخر يظهر «undefined» للمستخدم.
    expect(body.error).toContain('لا يوجد اتصال');
  });
});

describe('service worker — الأصول', () => {
  it('حِزم Next تُخدَم من المخزون بلا لمس الشبكة مرة ثانية', async () => {
    const url = `${APP}/_next/static/chunks/main-abc123.js`;
    sw.netFetch.mockResolvedValue(new Response('console.log(1)', { status: 200 }));
    await sw.dispatchFetch(new Request(url));
    expect(sw.netFetch).toHaveBeenCalledTimes(1);

    sw.netFetch.mockClear();
    const second = await sw.dispatchFetch(new Request(url));
    expect(sw.netFetch).not.toHaveBeenCalled();
    expect(await second!.text()).toBe('console.log(1)');
  });

  it('يخزّن خطوط Google — بدونها يفقد التطبيق خطّه العربي أوفلاين', async () => {
    const url = 'https://fonts.gstatic.com/s/cairo/v28/x.woff2';
    sw.netFetch.mockResolvedValue(new Response('font', { status: 200 }));
    await sw.dispatchFetch(new Request(url));

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const cached = await sw.dispatchFetch(new Request(url));
    expect(await cached!.text()).toBe('font');
  });

  it('لا يعترض نطاقات خارجية أخرى', async () => {
    expect(await sw.dispatchFetch(new Request('https://example.com/x.js'))).toBeNull();
  });
});

describe('service worker — حمولة RSC', () => {
  it('يطبّع مفتاح `_rsc` المتغيّر فيصيب المخزون رغم اختلاف البصمة', async () => {
    sw.netFetch.mockResolvedValue(new Response('RSC-PAYLOAD', { status: 200 }));
    await sw.dispatchFetch(new Request(`${APP}/orders?_rsc=aaa111`, { headers: { RSC: '1' } }));

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    // بصمة مختلفة تماماً — التخزين بالرابط الخام كان يفشل هنا دائماً.
    const res = await sw.dispatchFetch(new Request(`${APP}/orders?_rsc=zzz999`, { headers: { RSC: '1' } }));

    expect(await res!.text()).toBe('RSC-PAYLOAD');
  });

  it('لا يخلط مستند HTML بحمولة RSC لنفس المسار', async () => {
    sw.netFetch.mockResolvedValue(new Response('<h1>مستند</h1>', { status: 200 }));
    await sw.dispatchFetch(new Request(`${APP}/orders`, { headers: { Accept: 'text/html' } }));

    sw.netFetch.mockRejectedValue(new TypeError('offline'));
    const rsc = await sw.dispatchFetch(new Request(`${APP}/orders?_rsc=aaa`, { headers: { RSC: '1' } }));

    // خطأ شبكة صريح ⇒ راوتر Next يسقط إلى تنقّل كامل يجد المستند المخزَّن.
    // لو أرجعنا المستند هنا لانهار الراوتر على حمولة تالفة.
    expect(rsc?.type).toBe('error');
  });
});

/**
 * حِزم `next dev` أسماؤها ثابتة (`app/.../page.js`) والمحتوى يُعاد بناؤه تحتها.
 * تخزينها بـcacheFirst يثبّت JavaScript قديماً إلى الأبد: HTML جديد من السيرفر
 * + حِزمة قديمة من المخزون = خطأ hydration، وتعديل المطوّر لا يظهر أبداً مهما
 * أعاد التحميل. هذي الاختبارات تمنع رجوع تلك الحالة.
 */
describe('service worker — وضع التطوير (localhost)', () => {
  it('لا يعترض حِزم Next على localhost — وإلا ثبّت نسخة قديمة إلى الأبد', async () => {
    const dev = loadServiceWorker('http://localhost:3000');
    const res = await dev.dispatchFetch(
      new Request('http://localhost:3000/_next/static/chunks/app/page.js'),
    );
    expect(res).toBeNull();          // مُرِّر للمتصفح: لا respondWith ولا تخزين
    expect(dev.netFetch).not.toHaveBeenCalled();
    expect(dev.caches.store.size).toBe(0);
  });

  it('يعترضها على مضيف الإنتاج — الأسماء هناك تحمل بصمة المحتوى', async () => {
    sw.netFetch.mockResolvedValue(new Response('console.log(1)', { status: 200 }));
    const res = await sw.dispatchFetch(new Request(`${APP}/_next/static/chunks/main-abc123.js`));
    expect(res).not.toBeNull();
    expect(sw.netFetch).toHaveBeenCalledTimes(1);
  });

  it('يستولي فوراً على localhost — لا ينتظر إغلاق كل التبويبات', async () => {
    const dev = loadServiceWorker('http://localhost:3000');
    dev.netFetch.mockResolvedValue(new Response('<p>لا يوجد اتصال', { status: 200 }));
    await dev.install();
    expect(dev.skipWaiting).toHaveBeenCalled();
  });

  it('ينتظر على مضيف الإنتاج — الاستيلاء يكسر تبويباً مفتوحاً', async () => {
    sw.netFetch.mockResolvedValue(new Response('<p>لا يوجد اتصال', { status: 200 }));
    await sw.install();
    expect(sw.skipWaiting).not.toHaveBeenCalled();
  });
});
