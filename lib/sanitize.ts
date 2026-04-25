const MAX_DISPLAY_LENGTH = 200;

export function sanitizeText(input: unknown, max: number = MAX_DISPLAY_LENGTH): string {
  if (input == null) return '';
  const s = String(input);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Strip ASCII control chars (0x00-0x1F) and DEL (0x7F)
    if (code < 0x20 || code === 0x7f) {
      out += ' ';
    } else {
      out += s[i];
    }
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function sanitizeOptional(input: unknown, max?: number): string | null {
  const v = sanitizeText(input, max);
  return v === '' ? null : v;
}
