/**
 * Only allow same-origin relative paths as a post-sign-in destination, so a
 * `next` param can't be turned into an open redirect (e.g. `@evil.com`,
 * `//evil.com`, `https://evil.com`, `/\evil.com`). Shared by the OAuth callback
 * and the /signin page.
 */
export function safeNext(value: string | null | undefined, fallback = "/dashboard/tools/pue-calculator"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback; // must be a relative path
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback; // protocol-relative
  if (value.includes(":") || value.includes("@") || value.includes("\\")) return fallback;
  return value;
}
