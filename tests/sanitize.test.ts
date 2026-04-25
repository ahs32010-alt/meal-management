import { describe, expect, it } from 'vitest';
import { sanitizeText, sanitizeOptional } from '@/lib/sanitize';

describe('sanitizeText', () => {
  it('returns empty string for null/undefined', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });

  it('trims whitespace', () => {
    expect(sanitizeText('  hello  ')).toBe('hello');
  });

  it('collapses runs of whitespace', () => {
    expect(sanitizeText('a    b\t\tc')).toBe('a b c');
  });

  it('strips ASCII control characters', () => {
    expect(sanitizeText('a\x00b\x07c')).toBe('a b c');
  });

  it('truncates to max length', () => {
    expect(sanitizeText('x'.repeat(500), 50)).toHaveLength(50);
  });

  it('preserves Arabic text', () => {
    expect(sanitizeText('  محمد   علي  ')).toBe('محمد علي');
  });
});

describe('sanitizeOptional', () => {
  it('returns null for empty input', () => {
    expect(sanitizeOptional(null)).toBeNull();
    expect(sanitizeOptional('')).toBeNull();
    expect(sanitizeOptional('   ')).toBeNull();
  });

  it('returns sanitized text otherwise', () => {
    expect(sanitizeOptional('  ok  ')).toBe('ok');
  });
});
