// In-memory rate limiter for registration/auth endpoints
// Resets on server restart (acceptable for this use case)

interface RateEntry {
  count: number;
  firstAttempt: number;
}

const store = new Map<string, RateEntry>();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.firstAttempt > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 10 * 60 * 1000).unref();

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return '127.0.0.1';
}

/**
 * Check if an IP is rate-limited.
 * Returns { limited: false } if OK, or { limited: true, retryAfterSec } if blocked.
 */
export function checkRateLimit(
  ip: string,
  prefix: string = 'register'
): { limited: boolean; retryAfterSec?: number } {
  const key = `${prefix}:${ip}`;
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now - entry.firstAttempt > WINDOW_MS) {
    store.set(key, { count: 1, firstAttempt: now });
    return { limited: false };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil(
      (entry.firstAttempt + WINDOW_MS - now) / 1000
    );
    return { limited: true, retryAfterSec };
  }

  entry.count++;
  return { limited: false };
}
