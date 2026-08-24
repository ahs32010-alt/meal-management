import { APP_TIME_ZONE } from '@/lib/date-utils';

/**
 * صياغة «آخر مزامنة» بما يفيد موظف المطبخ فعلاً: قربها من الآن هو المهم، لا
 * التاريخ الكامل. نلتزم بتوقيت المطبخ (Asia/Riyadh) وأرقام en-GB مثل بقية
 * النظام حتى لا تختلف الساعة بين البانر وبقية الشاشات.
 */
export function formatLastSync(ts: number | null, now: number = Date.now()): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return 'لم تتم مزامنة بعد';

  const diffMs = now - ts;
  if (diffMs < 0) return 'الآن';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'الآن';
  if (minutes === 1) return 'قبل دقيقة';
  if (minutes === 2) return 'قبل دقيقتين';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;

  const time = new Date(ts).toLocaleTimeString('en-GB', {
    timeZone: APP_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });

  const dayOf = (value: number) =>
    new Date(value).toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });

  const today = dayOf(now);
  const stamped = dayOf(ts);
  if (stamped === today) return `اليوم ${time}`;

  const yesterday = dayOf(now - 86_400_000);
  if (stamped === yesterday) return `أمس ${time}`;

  const date = new Date(ts).toLocaleDateString('en-GB', {
    timeZone: APP_TIME_ZONE,
    day: 'numeric',
    month: 'short',
  });
  return `${date} ${time}`;
}

/** حجم بالبايت إلى نص مقروء — يُعرض في لوحة الإعدادات. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} بايت`;
  const units = ['كيلوبايت', 'ميغابايت', 'غيغابايت'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
