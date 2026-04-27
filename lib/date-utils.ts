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
