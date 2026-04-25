import { describe, expect, it } from 'vitest';
import { rateLimit, clientIdFromRequest } from '@/lib/rate-limit';

describe('rateLimit', () => {
  it('allows up to limit calls and blocks the next', () => {
    const key = `test:${Date.now()}:${Math.random()}`;
    const opts = { key, limit: 3, windowMs: 60_000 };

    expect(rateLimit(opts).allowed).toBe(true);
    expect(rateLimit(opts).allowed).toBe(true);
    expect(rateLimit(opts).allowed).toBe(true);
    const blocked = rateLimit(opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('resets after window expires', () => {
    const key = `test:expire:${Date.now()}:${Math.random()}`;
    const r1 = rateLimit({ key, limit: 1, windowMs: 1 });
    expect(r1.allowed).toBe(true);
    // Wait synchronously a tick — windowMs of 1 ensures it resets quickly enough
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const r2 = rateLimit({ key, limit: 1, windowMs: 1 });
        expect(r2.allowed).toBe(true);
        resolve();
      }, 5);
    });
  });

  it('decrements remaining count', () => {
    const key = `test:remain:${Date.now()}:${Math.random()}`;
    const r1 = rateLimit({ key, limit: 5, windowMs: 60_000 });
    const r2 = rateLimit({ key, limit: 5, windowMs: 60_000 });
    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
  });
});

describe('clientIdFromRequest', () => {
  it('reads x-forwarded-for', () => {
    const req = new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } });
    expect(clientIdFromRequest(req)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const req = new Request('http://x', { headers: { 'x-real-ip': '9.9.9.9' } });
    expect(clientIdFromRequest(req)).toBe('9.9.9.9');
  });

  it('returns the fallback otherwise', () => {
    const req = new Request('http://x');
    expect(clientIdFromRequest(req, 'fb')).toBe('fb');
  });
});
