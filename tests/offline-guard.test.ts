import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserEnv, jsonResponse, type BrowserEnv } from './offline-support';

const REST = 'https://proj.supabase.co/rest/v1';

let env: BrowserEnv;
let createGuardedFetch: typeof import('@/lib/offline/fetch')['createGuardedFetch'];
let OFFLINE_MESSAGES: typeof import('@/lib/offline/fetch')['OFFLINE_MESSAGES'];
let OFFLINE_ERROR_CODE: string;
let statusMod: typeof import('@/lib/offline/status');
let cacheMod: typeof import('@/lib/offline/data-cache');

beforeEach(async () => {
  env = installBrowserEnv();
  // إعادة تحميل الوحدات بعد زرع البيئة — فيها حالة على مستوى الوحدة.
  vi.resetModules();
  const fetchMod = await import('@/lib/offline/fetch');
  createGuardedFetch = fetchMod.createGuardedFetch;
  OFFLINE_MESSAGES = fetchMod.OFFLINE_MESSAGES;
  OFFLINE_ERROR_CODE = fetchMod.OFFLINE_ERROR_CODE;
  statusMod = await import('@/lib/offline/status');
  cacheMod = await import('@/lib/offline/data-cache');
});

afterEach(() => {
  env.restore();
});

async function errorBody(res: Response) {
  return (await res.json()) as { message: string; code: string };
}

describe('حارس الشبكة — الكتابة لا تضيع بصمت', () => {
  it('يمنع الكتابة قبل إرسالها وهو يعلم أنه مقطوع، ويجزم أنها لم تُحفظ', async () => {
    env.setOnline(false);
    const base = vi.fn();
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    const res = await guarded(`${REST}/beneficiaries`, {
      method: 'POST',
      body: JSON.stringify({ name: 'أحمد' }),
    });

    // الأهم: ما لمسنا الشبكة أصلاً — فاليقين بأن شيئاً لم يُحفظ يقين حقيقي.
    expect(base).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    const body = await errorBody(res);
    expect(body.code).toBe(OFFLINE_ERROR_CODE);
    expect(body.message).toBe(OFFLINE_MESSAGES.writeBlocked);
  });

  it('لا يجزم حين ينقطع الاتصال أثناء الإرسال', async () => {
    const base = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    const res = await guarded(`${REST}/meals?id=eq.1`, { method: 'PATCH', body: '{}' });

    expect(base).toHaveBeenCalledOnce();
    const body = await errorBody(res);
    expect(body.message).toBe(OFFLINE_MESSAGES.writeUncertain);
    // الرسالة الغامضة مقصودة: الطلب خرج فعلاً وقد يكون وصل.
    expect(body.message).not.toBe(OFFLINE_MESSAGES.writeBlocked);
  });

  it('لا يمنع الكتابة على ظنّ: يفحص أولاً، وينفّذ لو رجعت النبضة', async () => {
    // عطل عابر في قراءة واحدة كان يقلب الحالة إلى «مقطوع». بلا فحص، أول حفظ
    // بعده يُمنع رغم أن الشبكة سليمة تماماً.
    statusMod.markOffline();
    expect(statusMod.getNetworkStatus().online).toBe(false);

    // النبضة تستخدم `fetch` العام عمداً لا الملفوف — وإلا دارت على نفسها.
    const globalFetch = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const restore = globalThis.fetch;
    globalThis.fetch = globalFetch as unknown as typeof fetch;

    const base = vi.fn().mockResolvedValue(jsonResponse({ id: 'saved' }, { status: 201 }));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    const res = await guarded(`${REST}/meals`, { method: 'POST', body: '{}' });

    expect(globalFetch).toHaveBeenCalledOnce(); // فُحص فعلاً قبل القرار
    expect(res.status).toBe(201);
    expect(statusMod.getNetworkStatus().online).toBe(true);
    globalThis.fetch = restore;
  });

  it('لكن `navigator.onLine=false` قاطع — يمنع بلا فحص ولا انتظار', async () => {
    env.setOnline(false);
    statusMod.markOffline();
    const base = vi.fn();
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    const res = await guarded(`${REST}/meals`, { method: 'POST', body: '{}' });

    // ولا حتى نبضة فحص: المتصفح لن يرسل شيئاً أصلاً.
    expect(base).not.toHaveBeenCalled();
    expect((await errorBody(res)).message).toBe(OFFLINE_MESSAGES.writeBlocked);
  });

  it('يفرّق بين تعديل جدول وتنفيذ RPC في نص الرسالة', async () => {
    env.setOnline(false);
    const guarded = createGuardedFetch(vi.fn() as unknown as typeof fetch);

    const res = await guarded(`${REST}/rpc/replace_order_items`, { method: 'POST', body: '{}' });
    expect((await errorBody(res)).message).toBe(OFFLINE_MESSAGES.rpcBlocked);
  });

  it('لا يعيد postgrest المحاولة على حالتنا — 599 خارج [503, 520]', async () => {
    env.setOnline(false);
    const guarded = createGuardedFetch(vi.fn() as unknown as typeof fetch);
    const res = await guarded(`${REST}/meals`, { method: 'DELETE' });
    expect(res.status).toBe(599);
    expect([503, 520]).not.toContain(res.status);
  });
});

describe('حارس الشبكة — القراءة تعيش بلا نت', () => {
  it('يخزّن قراءة ناجحة ثم يخدمها بعد الانقطاع', async () => {
    const rows = [{ id: '1', name: 'أرز' }];
    const base = vi.fn().mockResolvedValue(jsonResponse(rows));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);
    const url = `${REST}/meals?select=id,name`;

    const fresh = await guarded(url);
    expect(await fresh.json()).toEqual(rows);

    await cacheMod.flushCacheWrites();
    env.setOnline(false);
    base.mockClear();

    const cached = await guarded(url);
    expect(base).not.toHaveBeenCalled();
    expect(await cached.json()).toEqual(rows);
    expect(cached.headers.get(cacheMod.OFFLINE_HEADER)).toBe('1');
  });

  it('يقول بوضوح حين لا توجد نسخة محفوظة بدل أن يفشل بصمت', async () => {
    env.setOnline(false);
    const guarded = createGuardedFetch(vi.fn() as unknown as typeof fetch);

    const res = await guarded(`${REST}/never_visited?select=*`);
    expect(res.status).toBe(599);
    expect((await errorBody(res)).message).toBe(OFFLINE_MESSAGES.readNoCache);
  });

  it('يلجأ للمخزون حين تنقطع الشبكة أثناء القراءة', async () => {
    const rows = [{ id: '7' }];
    const base = vi.fn().mockResolvedValueOnce(jsonResponse(rows));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);
    const url = `${REST}/daily_orders?date=eq.2026-08-19`;

    await cacheMod.flushCacheWrites();
    base.mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await guarded(url);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual(rows);
  });

  it('يحفظ `content-range` فيبقى العدّ الكلي صحيحاً أوفلاين', async () => {
    const base = vi.fn().mockResolvedValue(
      jsonResponse([{ id: '1' }], { headers: { 'content-range': '0-0/482' } }),
    );
    const guarded = createGuardedFetch(base as unknown as typeof fetch);
    const url = `${REST}/beneficiaries?select=id`;

    await guarded(url, { headers: { Prefer: 'count=exact' } });
    await cacheMod.flushCacheWrites();
    env.setOnline(false);

    const cached = await guarded(url, { headers: { Prefer: 'count=exact' } });
    // منه يقرأ supabase-js عدد الصفوف — بدونه يصير العدّ صفراً أوفلاين.
    expect(cached.headers.get('content-range')).toBe('0-0/482');
  });

  it('لا يخزّن رد خطأ من الخادم ولا يعتبره انقطاعاً', async () => {
    const base = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'permission denied' }), { status: 403 }),
    );
    const guarded = createGuardedFetch(base as unknown as typeof fetch);
    const url = `${REST}/app_users?select=*`;

    const denied = await guarded(url);
    await cacheMod.flushCacheWrites();
    expect(denied.status).toBe(403);
    expect(statusMod.getNetworkStatus().online).toBe(true);

    env.setOnline(false);
    const after = await guarded(url);
    // لو خزّنّا الـ403 لظهر «ممنوع» أوفلاين بدل «لا توجد نسخة».
    expect((await errorBody(after)).message).toBe(OFFLINE_MESSAGES.readNoCache);
  });
});

describe('حارس الشبكة — مفتاح المخزون يحترم دفعات fetchAllRows', () => {
  it('لا يخلط دفعتين لهما نفس الرابط وترويستا Range مختلفتان', async () => {
    const pageOne = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const pageTwo = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i }));

    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const range = new Headers(init?.headers).get('Range');
      return jsonResponse(range === '0-999' ? pageOne : pageTwo);
    });
    const guarded = createGuardedFetch(base as unknown as typeof fetch);
    const url = `${REST}/exclusions?select=*&order=id`;

    await guarded(url, { headers: { Range: '0-999', 'Range-Unit': 'items' } });
    await guarded(url, { headers: { Range: '1000-1999', 'Range-Unit': 'items' } });
    await cacheMod.flushCacheWrites();

    env.setOnline(false);

    const first = await guarded(url, { headers: { Range: '0-999', 'Range-Unit': 'items' } });
    const second = await guarded(url, { headers: { Range: '1000-1999', 'Range-Unit': 'items' } });

    // هذا بالضبط ما كان يعطّله الـservice worker: الرابط واحد والمحتوى مختلف.
    expect((await first.json()) as unknown[]).toHaveLength(1000);
    expect((await second.json()) as unknown[]).toHaveLength(200);
  });

  it('buildCacheKey يفصل بين Range و Prefer', () => {
    const url = `${REST}/x?select=*`;
    const a = cacheMod.buildCacheKey(new Request(url, { headers: { Range: '0-999' } }));
    const b = cacheMod.buildCacheKey(new Request(url, { headers: { Range: '1000-1999' } }));
    const c = cacheMod.buildCacheKey(new Request(url, { headers: { Prefer: 'count=exact' } }));
    expect(a.url).not.toBe(b.url);
    expect(a.url).not.toBe(c.url);
  });
});

describe('حارس الشبكة — ما لا يلمسه', () => {
  it('يمرّر طلبات المصادقة كما هي حتى وهو مقطوع', async () => {
    env.setOnline(false);
    const base = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    // تزوير رد مصادقة قد يُخرج المستخدم من حسابه — نتركها لـauth-js.
    await expect(
      guarded('https://proj.supabase.co/auth/v1/token?grant_type=refresh_token', { method: 'POST' }),
    ).rejects.toThrow();
    expect(base).toHaveBeenCalledOnce();
  });

  it('يمرّر ما ليس PostgREST بلا تدخّل', async () => {
    env.setOnline(false);
    const base = vi.fn().mockResolvedValue(new Response('ok'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    const res = await guarded('https://proj.supabase.co/storage/v1/object/public/logo.png');
    expect(base).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
  });

  it('يمرّر إلغاء المستدعي كما هو ولا يعتبره انقطاعاً', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const base = vi.fn().mockRejectedValue(abort);
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    const controller = new AbortController();
    controller.abort();

    await expect(guarded(`${REST}/meals`, { signal: controller.signal })).rejects.toThrow();
    // تفكيك مكوّن ليس انقطاع شبكة — ما نغيّر حالة الاتصال بسببه.
    expect(statusMod.getNetworkStatus().online).toBe(true);
  });
});

describe('حالة الاتصال', () => {
  it('قراءة ناجحة تحدّث ختم آخر مزامنة', async () => {
    const base = vi.fn().mockResolvedValue(jsonResponse([]));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    expect(statusMod.getNetworkStatus().lastSyncAt).toBeNull();
    await guarded(`${REST}/meals`);
    expect(statusMod.getNetworkStatus().lastSyncAt).toBeGreaterThan(0);
  });

  it('فشل شبكي يقلب الحالة إلى غير متصل', async () => {
    const base = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const guarded = createGuardedFetch(base as unknown as typeof fetch);

    await guarded(`${REST}/meals`);
    expect(statusMod.getNetworkStatus().online).toBe(false);
  });

  it('navigator.onLine=false وحده كافٍ لاعتبارنا مقطوعين', () => {
    env.setOnline(false);
    expect(statusMod.isCertainlyOffline()).toBe(true);
  });
});
