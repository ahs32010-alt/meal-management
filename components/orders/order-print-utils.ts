import type { Meal } from '@/lib/types';

/**
 * أدوات مشتركة بين تصدير أمر التشغيل الواحد (OrderPrintView) وتصدير البكج
 * (BulkOrderPrintView) — كانت منسوخة في الملفين فتتباعد مع كل تعديل.
 */

interface CustomDetail {
  excludedItems: { meal: Meal; alternative: Meal | null }[];
  fixedItems: { meal: Meal; quantity: number }[];
}

/** سطر «تخصيصات المستفيدين» في التصدير: المستبعد | البدائل والأصناف الإضافية */
export function customizationCells(detail: CustomDetail): { excluded: string; extras: string } {
  const excluded = detail.excludedItems.map(x => x.meal.name).join(' | ');
  const parts: string[] = [];
  detail.excludedItems.forEach(x => { if (x.alternative) parts.push(x.alternative.name); });
  // الكمية بنفس صيغة صفحة التقرير (صنف ×٢) حتى لا يُقرأ الرقم جزءاً من الاسم
  detail.fixedItems.forEach(f => { parts.push(f.quantity > 1 ? `${f.meal.name} ×${f.quantity}` : f.meal.name); });
  return { excluded, extras: parts.join(' | ') };
}

/** عنوان قسم التخصيصات حسب فئة الأمر — أمر المرافقين لا يُعنون «المستفيدين» */
export function customSectionTitle(entityType?: string | null): string {
  return entityType === 'companion' ? 'تخصيصات المرافقين' : 'تخصيصات المستفيدين';
}

/** مجموع عمود — نفس «المجموع» المعروض أسفل كل جدول في صفحة التقرير */
export function sumBy<T>(items: T[], key: keyof T): number {
  return items.reduce((s, x) => s + (Number(x[key]) || 0), 0);
}

/**
 * يجلب تقارير عدة أوامر بتوازٍ محدود، ويعيد المحاولة عند 429.
 *
 * كان البكج يطلق كل الطلبات دفعة واحدة، وواجهة التقرير محدودة بـ١٢٠ طلباً في
 * الدقيقة — فتصدير «الكل» لأكثر من ذلك كان يُسقط أوامر من الملف بصمت (يظهر
 * فقط «فشل تحميل N»). الآن ننتظر المهلة التي يحدّدها الخادم ونكمل.
 */
export async function fetchOrderReports<T>(
  ids: string[],
  opts: {
    fetchImpl?: (url: string) => Promise<Response>;
    concurrency?: number;
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
    onProgress?: (done: number) => void;
    isCancelled?: () => boolean;
  } = {},
): Promise<{ results: (T | null)[]; errors: number }> {
  const {
    fetchImpl = (url: string) => fetch(url),
    concurrency = 4,
    maxRetries = 3,
    sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
    onProgress,
    isCancelled = () => false,
  } = opts;

  const results: (T | null)[] = new Array(ids.length).fill(null);
  let errors = 0;
  let done = 0;
  let next = 0;

  const loadOne = async (id: string): Promise<T | null> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`/api/orders/${id}/report`);
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 || attempt >= maxRetries) return null;
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(Math.min(60, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 5) * 1000);
      if (isCancelled()) return null;
    }
  };

  const worker = async () => {
    while (next < ids.length && !isCancelled()) {
      const i = next++;
      let r: T | null = null;
      try { r = await loadOne(ids[i]); } catch { r = null; }
      if (isCancelled()) return;
      if (r === null) errors++;
      results[i] = r;
      done++;
      onProgress?.(done);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return { results, errors };
}
