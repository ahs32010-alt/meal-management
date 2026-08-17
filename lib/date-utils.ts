const LOCALE = 'en-GB';

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateFull(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(LOCALE, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatNow(): string {
  return new Date().toLocaleDateString(LOCALE, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(LOCALE, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** التوقيت المعتمد للمطبخ — الخادم يشتغل بـUTC فنثبّت المنطقة عشان ما ينزاح اليوم. */
export const APP_TIME_ZONE = 'Asia/Riyadh';

/**
 * تاريخ اليوم بصيغة YYYY-MM-DD حسب توقيت المطبخ (لا حسب توقيت الخادم).
 * يُستخدم للمقارنة مع daily_orders.date وهي مخزّنة كتاريخ بلا وقت.
 */
export function todayISO(now: Date = new Date()): string {
  // en-CA يعطي ISO مباشرة (YYYY-MM-DD)
  return now.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}
