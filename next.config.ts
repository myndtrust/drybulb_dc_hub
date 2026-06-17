import type { NextConfig } from "next";

// Content-Security-Policy (Report-Only for now): observe violations in the
// browser console / report stream, tighten the allowlists to the real origins,
// then switch the header name to "Content-Security-Policy" to enforce.
//
// 'unsafe-eval' is currently required because MDX is rendered at runtime via
// `new Function` (components/shared/mdx-content.tsx); drop it once MDX is
// precompiled or a nonce strategy is in place.
const cspReportOnly = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cloud.umami.is",
  "connect-src 'self' https://*.supabase.co https://power.larc.nasa.gov https://storage.googleapis.com https://cloud.umami.is https://*.umami.dev",
  "worker-src 'self' blob:",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  // All marketing/content routes are statically generated (SSG) at build time.
  // The app runs as a standard Node server on Heroku — no Vercel-only features.
  //
  // next/image optimization runs on the dyno using sharp (bundled by Next.js).
  // On small Heroku dynos, if image optimization is too expensive at runtime,
  // switch to a custom loader (e.g. Cloudflare Image Resizing) or set
  // images.unoptimized = true to serve originals and let the CDN handle it.
  images: {
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
