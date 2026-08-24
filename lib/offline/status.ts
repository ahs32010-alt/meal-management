'use client';

/**
 * حالة الاتصال — مصدر واحد للحقيقة يقرأه البانر وحُرّاس الكتابة.
 *
 * `navigator.onLine` وحده لا يكفي: المتصفح يقول «متصل» لمجرد وجود واي‑فاي حتى
 * لو ما فيه إنترنت خلفه — وهذي بالضبط حالة مطبخ فيه راوتر شغّال ونت مقطوع.
 * فنجمع ثلاث إشارات:
 *   ١) أحداث online/offline من المتصفح — سريعة، و«offline» منها قاطع.
 *   ٢) نتيجة الطلبات الحقيقية — نجاح ⇒ متصل، فشل شبكي ⇒ غير متصل.
 *   ٣) نبضة فحص خفيفة **أثناء الانقطاع فقط**، لاكتشاف رجوع الاتصال بلا انتظار
 *      المستخدم. تتوقف فور الرجوع فما تستهلك شيئاً في الحالة الطبيعية.
 *
 * `lastSyncAt` يُحفظ في localStorage عمداً: بعد إعادة تحميل الصفحة وهي مقطوعة
 * نحتاج نقول للمستخدم «آخر مزامنة أمس ٤:٠٠م» — لا «لا نعرف».
 */

import { useSyncExternalStore } from 'react';

export interface NetworkStatus {
  /** هل نعتقد أن الاتصال متاح الآن؟ */
  online: boolean;
  /** آخر لحظة رجعت فيها بيانات طازجة من الخادم (ms) — null إن لم يحدث بعد. */
  lastSyncAt: number | null;
}

const LAST_SYNC_KEY = 'kha:last-sync';
const PROBE_INTERVAL_MS = 8_000;
/** مهلة الفحص السريع قبل منع كتابة — قصيرة عمداً، المستخدم ينتظرها. */
const CONFIRM_TIMEOUT_MS = 2_500;
const PROBE_PATH = '/api/ping';

function readStoredLastSync(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** لقطة ثابتة للـSSR — `useSyncExternalStore` يطلب مرجعاً لا يتغيّر. */
const SERVER_SNAPSHOT: NetworkStatus = { online: true, lastSyncAt: null };

let state: NetworkStatus = SERVER_SNAPSHOT;
let hydrated = false;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<NetworkStatus>) {
  const next = { ...state, ...patch };
  if (next.online === state.online && next.lastSyncAt === state.lastSyncAt) return;
  state = next;
  emit();
}

// ─── النبض أثناء الانقطاع ────────────────────────────────────────────────────

let probeTimer: ReturnType<typeof setInterval> | null = null;

/** فحص واحد جارٍ في كل لحظة — عدة نداءات متزامنة تتشارك نفس الطلب. */
let inflightProbe: Promise<boolean> | null = null;

/** يرجّع true إن وصلنا الخادم فعلاً. */
async function probe(timeoutMs?: number): Promise<boolean> {
  // لا فائدة من إزعاج الشبكة والمتصفح نفسه يقول لا يوجد اتصال.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  if (inflightProbe) return inflightProbe;

  inflightProbe = (async () => {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      // `cache: 'no-store'` + طابع زمني — نبغى إجابة الخادم الحقيقية لا نسخة.
      const res = await fetch(`${PROBE_PATH}?t=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (res.ok) {
        markOnline();
        return true;
      }
      return false;
    } catch {
      return false; // ما زال منقطعاً — النبضة القادمة تحاول.
    } finally {
      if (timer) clearTimeout(timer);
      inflightProbe = null;
    }
  })();

  return inflightProbe;
}

function startProbing() {
  if (probeTimer || typeof window === 'undefined') return;
  probeTimer = setInterval(() => {
    if (state.online) {
      stopProbing();
      return;
    }
    void probe(CONFIRM_TIMEOUT_MS);
  }, PROBE_INTERVAL_MS);
}

function stopProbing() {
  if (!probeTimer) return;
  clearInterval(probeTimer);
  probeTimer = null;
}

// ─── التبليغات التي تستدعيها طبقة الشبكة ────────────────────────────────────

/** الشبكة ردّت — نحن متصلون. */
export function markOnline() {
  stopProbing();
  setState({ online: true });
}

/** فشل شبكي حقيقي — نعتبر أنفسنا منقطعين ونبدأ نراقب الرجوع. */
export function markOffline() {
  setState({ online: false });
  startProbing();
}

/**
 * يتحقّق قبل منع كتابة. الفرق بينه وبين `isCertainlyOffline` أن هذا **يفحص**
 * بدل أن يظنّ: عطل عابر في طلب واحد كان يقلب حالتنا إلى «مقطوع»، فتُمنع بعده
 * كتاباتٌ صحيحة تماماً حتى تأتي النبضة التالية. لا نمنع على ظنّ.
 *
 * `navigator.onLine === false` وحده قاطع فلا نفحص معه — المتصفح لن يرسل شيئاً.
 */
export async function confirmOffline(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (state.online) return false;
  return !(await probe(CONFIRM_TIMEOUT_MS));
}

/** رجعت بيانات طازجة من الخادم — نحدّث ختم آخر مزامنة. */
export function markDataFresh(at: number = Date.now()) {
  stopProbing();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LAST_SYNC_KEY, String(at));
    } catch {
      // مساحة ممتلئة أو تخزين محجوب — الختم تحسين لا شرط.
    }
  }
  setState({ online: true, lastSyncAt: at });
}

export function getNetworkStatus(): NetworkStatus {
  return state;
}

/** هل نحن مقطوعون **بيقين**؟ يُستخدم لمنع الكتابة قبل إرسالها أصلاً. */
export function isCertainlyOffline(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return !state.online;
}

// ─── الربط مع أحداث المتصفح ─────────────────────────────────────────────────

let wired = false;

/** يُستدعى مرة واحدة من مكوّن العميل الجذري. آمن للاستدعاء المتكرر. */
export function initNetworkStatus() {
  if (wired || typeof window === 'undefined') return;
  wired = true;

  // أول لقطة حقيقية بعد الـhydration — قبلها كنا على لقطة الخادم الثابتة.
  hydrated = true;
  state = {
    online: navigator.onLine !== false,
    lastSyncAt: readStoredLastSync(),
  };
  emit();

  window.addEventListener('online', () => {
    // المتصفح يقول رجع — لكن ما نصدّق إلا بعد فحص فعلي، لأن «online» يعني
    // وجود واجهة شبكة لا وجود إنترنت.
    void probe(CONFIRM_TIMEOUT_MS);
  });
  window.addEventListener('offline', () => markOffline());

  if (!state.online) startProbing();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NetworkStatus {
  return state;
}

function getServerSnapshot(): NetworkStatus {
  return SERVER_SNAPSHOT;
}

export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** للاختبارات فقط — يرجّع الوحدة لحالتها الابتدائية. */
export function __resetNetworkStatusForTests() {
  stopProbing();
  state = SERVER_SNAPSHOT;
  hydrated = false;
  wired = false;
  listeners.clear();
}

export function __isHydrated() {
  return hydrated;
}
