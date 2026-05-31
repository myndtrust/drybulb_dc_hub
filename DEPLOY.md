# Deploying Drybulb

## Prerequisites

- [Heroku CLI](https://devcenter.heroku.com/articles/heroku-cli) installed
- [GitHub CLI](https://cli.github.com/) (optional, for repo creation)
- Node 22.x locally (match the `engines` field in package.json)

---

## 1. Heroku CLI deployment

```bash
# Authenticate
heroku login

# Create the app (pick a unique name or let Heroku generate one)
heroku create drybulb --region us

# Set config vars
heroku config:set NEXT_PUBLIC_SITE_URL=https://drybulb.com
heroku config:set NODE_ENV=production

# (Phase 2) Add Postgres when needed
# heroku addons:create heroku-postgresql:essential-0
# This auto-sets DATABASE_URL

# Deploy
git push heroku main

# Open in browser
heroku open

# Tail logs
heroku logs --tail
```

---

## 2. GitHub auto-deploy (recommended for ongoing work)

### Push to GitHub first

```bash
# If gh CLI is available:
gh repo create drybulb --private --source=. --push

# Otherwise manually:
git remote add origin git@github.com:YOUR_USERNAME/drybulb.git
git push -u origin main
```

### Connect Heroku to GitHub

1. Open the [Heroku Dashboard](https://dashboard.heroku.com) and select your app.
2. Go to the **Deploy** tab.
3. Under **Deployment method**, click **GitHub** and connect your GitHub account.
4. Search for the `drybulb` repo and click **Connect**.
5. Under **Automatic deploys**, select the `main` branch and click **Enable Automatic Deploys**.
6. Optionally check **Wait for CI to pass before deploy** if you add CI later.

Every push to `main` will now trigger a Heroku build and deploy automatically.

---

## 3. CDN: Cloudflare in front of Heroku

Putting Cloudflare in front gives you edge caching for the statically generated pages (home, about, writing, consulting, contact) — critical for SEO and load speed.

### Setup

1. **Add your domain to Cloudflare.** Sign up at [cloudflare.com](https://cloudflare.com), add `drybulb.com`, and point your nameservers to Cloudflare's (your registrar will have instructions).

2. **Add a custom domain on Heroku:**
   ```bash
   heroku domains:add drybulb.com
   heroku domains:add www.drybulb.com
   ```
   Note the DNS target Heroku gives you (e.g. `random-name.herokudns.com`).

3. **Configure DNS in Cloudflare:**
   - Add a **CNAME** record: `@` → the Heroku DNS target, **Proxied** (orange cloud on).
   - Add a **CNAME** record: `www` → the Heroku DNS target, **Proxied**.

4. **SSL:** In Cloudflare SSL/TLS settings, set encryption mode to **Full (strict)**. Heroku provides TLS on custom domains via ACM (Automated Certificate Management) — enable it:
   ```bash
   heroku certs:auto:enable
   ```

5. **Cache rules (optional but recommended):** Create a Cloudflare Page Rule or Cache Rule:
   - Match `drybulb.com/*` — Cache Level: Standard, Edge TTL: 1 day.
   - Exclude `/dashboard*` and `/api/*` from caching (these will be dynamic in Phase 2).

### Verify

```bash
curl -I https://drybulb.com
# Look for: cf-cache-status: HIT (after first request warms the cache)
```

---

## 4. Troubleshooting

### PORT binding error

Heroku assigns `$PORT` dynamically. The `Procfile` passes it to Next.js:
```
web: next start -p $PORT
```
If you see `Error R10 (Boot timeout)`, the app isn't binding to `$PORT`. Verify the Procfile exists and has the correct content.

### Node version mismatch

Heroku reads `engines.node` from package.json. This project pins `"node": "22.x"`. If the build fails on a version issue:
```bash
heroku config:set NODE_MODULES_CACHE=false
git commit --allow-empty -m "clear cache"
git push heroku main
```

### Build runs out of memory on small dynos

The `velite && next build` step compiles MDX and builds the Next.js app. On a `basic` dyno (512 MB):
- If the build OOMs, temporarily scale up during deploy:
  ```bash
  heroku ps:resize web=standard-1x   # 1 GB RAM
  git push heroku main
  heroku ps:resize web=basic          # scale back down after deploy
  ```
- Or set the Node heap size:
  ```bash
  heroku config:set NODE_OPTIONS="--max-old-space-size=512"
  ```

### Checking logs

```bash
heroku logs --tail          # live stream
heroku logs -n 200          # last 200 lines
heroku logs --source app    # app logs only (no router/heroku system logs)
```

### Velite content not updating

Velite compiles at build time. If you change an MDX file, you need a new deploy — content changes don't take effect at runtime. Push to `main` and let auto-deploy handle it.
