import type { NextConfig } from "next";

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
};

export default nextConfig;
