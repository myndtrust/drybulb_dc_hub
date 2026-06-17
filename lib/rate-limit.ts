import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// IP rate limiting for the public POST endpoints (contact, subscribe). Backed by
// Upstash Redis so the limit is shared across Heroku dynos. Mirrors the Resend
// env-guard pattern: when UPSTASH_* is unset (local dev), the limiter is a no-op
// so nothing breaks — it just doesn't throttle.
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

const ratelimit =
  url && token
    ? new Ratelimit({
        redis: new Redis({ url, token }),
        limiter: Ratelimit.slidingWindow(5, "60 s"),
        prefix: "drybulb:rl",
        analytics: false,
      })
    : null;

/** Best-effort client IP from the proxy chain (Heroku sets x-forwarded-for). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  return xff.split(",")[0].trim() || "unknown";
}

/**
 * True if the request is within the limit (or limiting is unconfigured), false
 * if it should be rejected with 429. Fails open on limiter errors so a Redis
 * hiccup never blocks legitimate users.
 */
export async function checkRateLimit(key: string): Promise<boolean> {
  if (!ratelimit) return true;
  try {
    const { success } = await ratelimit.limit(key);
    return success;
  } catch {
    return true;
  }
}
