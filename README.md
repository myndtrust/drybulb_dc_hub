# drybulb.com — Personal Authority Website

Built with Next.js 15 App Router · TypeScript · Tailwind CSS · shadcn/ui · Velite (MDX)

---

## Local development

```bash
npm install
npm run dev      # runs Velite watch + Next.js dev server
```

Open [http://localhost:3000](http://localhost:3000).

---

## Adding an article

1. Create `content/articles/your-slug.mdx`
2. Add required frontmatter:

```mdx
---
title: "Your Article Title"
description: "One-sentence description for SEO and cards."
publishedAt: "2026-06-01"
slug: "your-slug"
tags: ["data-center", "cooling"]
draft: false
---

Your content here...
```

3. Add the slug to the `KNOWN_SLUGS` array in `app/(marketing)/writing/[slug]/page.tsx` (temporary — will be automatic once Velite output is fully wired)
4. `npm run dev` — Velite rebuilds automatically on file change

---

## Project structure

```
app/
  (marketing)/          # Public content — statically generated (SSG), SEO-first
    page.tsx            # / — home
    about/              # /about
    writing/            # /writing + /writing/[slug]
    consulting/         # /consulting
    contact/            # /contact
  (app)/                # Future authenticated area — client-side SPA feel
    layout.tsx          # "use client" boundary + Zustand wired
    dashboard/          # /dashboard — protected route stub
  api/
    og/                 # Dynamic OG image generation
  sitemap.ts
  robots.ts
  feed.xml/             # RSS feed
content/
  articles/             # MDX articles (Velite)
components/
  marketing/            # Header, footer, etc.
  app/                  # App-area nav
  shared/               # JsonLd, etc.
  ui/                   # shadcn/ui primitives (auto-generated)
lib/
  store.ts              # Zustand store
  metadata.ts           # Metadata helpers + siteConfig
  utils.ts              # cn() helper
middleware.ts           # Auth stub (TODO: wire Phase 2 auth here)
velite.config.ts        # MDX + frontmatter schema
```

---

## Deploying to Vercel

1. Push to GitHub
2. Import repo in Vercel
3. Set environment variables from `.env.example`
4. Deploy — Vercel auto-detects Next.js

Self-hosting / Cloudflare Pages: works with `output: "export"` for fully static, or as a Node server. See Next.js deployment docs.

---

## Phase 2 auth recommendations

Choose **one**:

| Option | Best for | Notes |
|---|---|---|
| **Auth.js (NextAuth v5)** | Full ownership, any OAuth provider | Most flexible, self-hosted sessions |
| **Clerk** | Fastest setup, polished UI | Drop-in components, generous free tier |
| **Supabase** | Auth + Postgres + storage together | Best if you need a database too |

Default DB recommendation: **Postgres** via Neon (serverless, Vercel-native) or Supabase.

Wire auth into `middleware.ts` — the TODO stubs are already there.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in values. See `.env.example` for Phase 2 auth options.
