type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  key: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit({ limit, windowMs, key }: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

// Light-weight periodic cleanup so old keys don't leak memory in long-lived processes.
let cleanupHandle: ReturnType<typeof setInterval> | null = null;
function ensureCleanup() {
  if (cleanupHandle) return;
  cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of buckets) {
      if (v.resetAt < now) buckets.delete(k);
    }
  }, 60_000);
  if (typeof cleanupHandle === 'object' && cleanupHandle && 'unref' in cleanupHandle) {
    (cleanupHandle as { unref?: () => void }).unref?.();
  }
}
ensureCleanup();

export function clientIdFromRequest(req: Request, fallback: string = 'unknown'): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return fallback;
}
