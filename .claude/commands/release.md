Deploy drybulb.com to Heroku safely: pre-deploy gates, the known lockfile pitfall, post-deploy smoke of the live site, and a rollback path. Trigger: only when Eric explicitly asks to deploy/release. Never deploy on your own initiative.

## Input

$ARGUMENTS — optional: what is being released (feature/tag) and any smoke focus. If empty, release HEAD of main and smoke the three tools.

## Deployment facts

| Fact | Value |
|---|---|
| Platform | Heroku, stack `heroku-24`, nodejs buildpack (`app.json`), `Procfile`: `web: next start -p $PORT` |
| Engines | `package.json` engines pin node `22.x`, npm `10.x` — Heroku builds with npm 10 |
| Trigger | **Heroku CLI** (Eric's confirmed path, 2026-07-12): `git push heroku main` against the CLI-managed remote. If the remote/CLI is missing on this machine, set up with `heroku login` + `heroku git:remote -a <app>` first — do not substitute another deploy path. |
| Live host | https://www.drybulb.com (proxy 301s non-canonical hosts) |

## Process

1. **Pre-flight.** Working tree clean, on `main` (or the branch Eric named). Run `/verify-app`; do not proceed unless it reports PASS.
2. **Lockfile check (the recurring emnapi failure).** If `package-lock.json` changed since the last deploy, verify it was written by npm 10, not local npm 11: the lock must contain `node_modules/@emnapi/core` and `node_modules/@emnapi/runtime` entries (nested under `@tailwindcss/oxide-wasm32-wasi` too). If missing, regenerate:
   ```bash
   npx -y npm@10 install --package-lock-only --ignore-scripts
   ```
   then re-check and include the lockfile in the release commit. Symptom on Heroku if skipped: `npm ci` fails with "Missing: @emnapi/core@… from lock file".
3. **Tag.** Create an annotated tag `release-YYYYMMDD` (or Eric's name for it) at the release commit so rollback has a target.
4. **Ship.** Push `main` per the confirmed deploy path. Watch the Heroku build to completion (dashboard or CLI); a failed build means the dyno keeps running the previous release — diagnose, don't re-push blindly.
5. **Post-deploy smoke (live site).** Against https://www.drybulb.com: home renders; `/tools` lists the tools; `/dashboard/tools/pue-calculator` renders the calculator; `/dashboard/tools/cost-model` and `/dashboard/tools/single-line` show tool or members sign-in card; sign-in flow loads (no Supabase redirect errors). Any regression → step 6.
6. **Rollback.** `heroku releases:rollback` (dashboard equivalent) restores the previous slug immediately; then diff the bad release against the last good tag (`git diff <last-good-tag>..main`) to find the cause. `baseline-pre-fable` is the floor.

## Acceptance

Heroku build succeeded, live smoke green, tag pushed. Report: release tag, Heroku build result, smoke table, and the diff range this release shipped.

## Guardrails
- No deploy without Eric's explicit ask and `/verify-app` PASS.
- Never edit env vars/secrets as part of a routine release; config changes are their own conversation.
- If the build fails on `npm ci`, apply step 2 — do not "fix" by deleting the lockfile or bumping npm engines.
