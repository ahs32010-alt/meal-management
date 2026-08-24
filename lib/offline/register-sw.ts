'use client';

/**
 * تسجيل الـservice worker وتجهيز الصفحات للعمل بلا إنترنت.
 *
 * ── سياسة التحديث ───────────────────────────────────────────────────────────
 * لا نفعّل الإصدار الجديد فوراً على تبويب مفتوح: صفحة Next محمّلة تطلب حِزماً
 * ببصمات قديمة، والإصدار الجديد يحذف مخزونها فتنكسر أمام المستخدم. نتركه
 * منتظراً ونعرض له زر «تحديث» يختار وقته.
 */

import { PAGES, can, type AppUser } from '@/lib/permissions';

const SW_URL = '/sw.js';

export type UpdateListener = (updateAvailable: boolean) => void;

let registration: ServiceWorkerRegistration | null = null;
let updateReady = false;
const updateListeners = new Set<UpdateListener>();

function announceUpdate(ready: boolean) {
  updateReady = ready;
  for (const listener of updateListeners) listener(ready);
}

export function onUpdateAvailable(listener: UpdateListener): () => void {
  updateListeners.add(listener);
  listener(updateReady);
  return () => {
    updateListeners.delete(listener);
  };
}

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator;
}

let registering: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isSupported()) return Promise.resolve(null);
  if (registering) return registering;

  registering = (async () => {
    try {
      const reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
      registration = reg;

      if (reg.waiting && navigator.serviceWorker.controller) announceUpdate(true);

      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          // `controller` موجود ⇒ هذا ليس أول تنصيب بل إصدار أحدث ينتظر.
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate(true);
          }
        });
      });

      return reg;
    } catch {
      // متصفح بلا دعم أو سياق غير آمن — التطبيق يشتغل أونلاين كالمعتاد.
      return null;
    }
  })();

  return registering;
}

/** يفعّل الإصدار المنتظر ثم يعيد تحميل الصفحة مرة واحدة. */
export async function applyUpdate(): Promise<void> {
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration());
  if (!reg?.waiting) {
    window.location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** يمسح مخزون قشرة التطبيق (لا يمسّ بيانات المستفيدين). */
export async function purgeShellCache(): Promise<void> {
  const reg = registration ?? (await navigator.serviceWorker?.getRegistration());
  reg?.active?.postMessage({ type: 'PURGE_SHELL' });
}

// ─── التجهيز المسبق ─────────────────────────────────────────────────────────

export interface WarmResult {
  requested: number;
  cached: number;
}

/**
 * يسحب صفحات النظام التي يملك المستخدم صلاحية عرضها، فتُخزَّن قشرتها ويقدر
 * يفتحها لاحقاً بلا نت — حتى لو ما زارها اليوم.
 *
 * نسحب شيئين لكل صفحة، وكلاهما لازم:
 *   • مستند HTML — لإعادة التحميل الكاملة وهو مقطوع (فتح التطبيق من جديد).
 *   • حمولة RSC — للتنقّل داخل التطبيق بلا إعادة تحميل.
 * حِزم JavaScript تُخزَّن تلقائياً لأن أسماءها تحمل بصمة والـSW يخزّنها مرة
 * واحدة إلى الأبد.
 *
 * البيانات نفسها ليست من شغل هذه الدالة: كل صفحة تقرأ استعلاماتها الخاصة،
 * وتلك تُخزَّن أول ما تُفتح الصفحة فعلياً (راجع lib/offline/data-cache.ts).
 */
export async function warmPages(user: AppUser | null): Promise<WarmResult> {
  if (!isSupported() || typeof navigator === 'undefined' || navigator.onLine === false) {
    return { requested: 0, cached: 0 };
  }

  const hrefs = ['/', '/offline', ...PAGES.filter((p) => can(user, p.key, 'view')).map((p) => p.href)];
  const unique = Array.from(new Set(hrefs));

  let cached = 0;
  // بالتسلسل لا بالتوازي: التجهيز خلفي، وما يستاهل أن يزاحم طلبات المستخدم.
  for (const href of unique) {
    try {
      const doc = await fetch(href, {
        credentials: 'include',
        headers: { Accept: 'text/html' },
      });
      if (doc.ok) cached++;
      // الحمولة التي يطلبها راوتر Next عند التنقّل الداخلي.
      await fetch(`${href}${href.includes('?') ? '&' : '?'}_rsc=warm`, {
        credentials: 'include',
        headers: { RSC: '1' },
      }).catch(() => {});
    } catch {
      // صفحة تعذّرت لا توقف الباقي.
    }
  }

  return { requested: unique.length, cached };
}
