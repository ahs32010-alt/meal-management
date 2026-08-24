/**
 * بيئة متصفح مصغّرة للاختبارات — الاختبارات تعمل في Node بلا `caches` ولا
 * `window`، وطبقة العمل بلا إنترنت مبنية عليهما. نزرع بدائل في الذاكرة تحاكي
 * دلالات Cache Storage الحقيقية: الفهرسة بالرابط، والأجسام تُستهلك مرة واحدة
 * فتُستنسخ عند التخزين وعند القراءة.
 */

class FakeCache {
  private entries = new Map<string, Response>();

  async put(request: Request | string, response: Response): Promise<void> {
    const url = typeof request === 'string' ? request : request.url;
    this.entries.set(url, response.clone());
  }

  async match(request: Request | string): Promise<Response | undefined> {
    const url = typeof request === 'string' ? request : request.url;
    const hit = this.entries.get(url);
    return hit ? hit.clone() : undefined;
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => new Request(url));
  }

  async delete(request: Request | string): Promise<boolean> {
    const url = typeof request === 'string' ? request : request.url;
    return this.entries.delete(url);
  }

  get size(): number {
    return this.entries.size;
  }
}

class FakeCacheStorage {
  private caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
}

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

export interface BrowserEnv {
  setOnline(online: boolean): void;
  restore(): void;
}

/** يزرع `window` و`caches` و`navigator.onLine` و`localStorage` في الـglobal. */
export function installBrowserEnv(): BrowserEnv {
  const g = globalThis as Record<string, unknown>;
  const original = {
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    caches: Object.getOwnPropertyDescriptor(globalThis, 'caches'),
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
    localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'),
  };

  const storage = new FakeStorage();
  const nav = { onLine: true };

  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'caches', {
    value: new FakeCacheStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  // `window` يشير إلى الـglobal نفسه — يكفي لأن الكود يفحص وجوده ويستعمل
  // window.localStorage فقط.
  Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });

  return {
    setOnline(online: boolean) {
      nav.onLine = online;
    },
    restore() {
      for (const [key, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete g[key];
      }
    },
  };
}

/** رد PostgREST ناجح مبسّط. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) },
    ...init,
  });
}
