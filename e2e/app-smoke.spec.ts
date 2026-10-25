import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// App smoke layer — proves each tool page mounts in the running app without a
// client-side crash. Premium tools (cost-model, single-line) render either the
// tool itself (Supabase unconfigured, e.g. CI) or the members sign-in card
// (Supabase configured, signed out) — both show the tool title; a blank page
// or an uncaught exception fails.

/** Fail the test on any uncaught client exception raised while visiting. */
function watchForClientErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("home page renders", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  expect(errors).toEqual([]);
});

test("marketing /tools lists the four tools", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: /PUE Calculator/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Cost Model/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Single.line/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Rackline DCIM/i })).toBeVisible();
  expect(errors).toEqual([]);
});

test("PUE calculator (free) renders the full tool", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/dashboard/tools/pue-calculator");
  await expect(
    page.getByRole("heading", { level: 1, name: "PUE Calculator" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("Cost Model page mounts (tool or members sign-in card)", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/dashboard/tools/cost-model");
  await expect(
    page.getByRole("heading", { level: 1, name: "Data Center Cost Model" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("Single-line page mounts (tool or members sign-in card)", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/dashboard/tools/single-line");
  // Gate card title: "AI Factory Single-line"; editor header: "AI Factory — Single-line".
  await expect(
    page.getByText(/AI Factory\s*(—\s*)?Single-line/).first(),
  ).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("Rackline page mounts (tool or members sign-in card)", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/dashboard/tools/rackline");
  // Gate card and workbench header both carry the tool title as the h1.
  await expect(page.getByRole("heading", { level: 1, name: "Rackline DCIM" })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test("Rackline invite page handles an unknown link without crashing", async ({ page }) => {
  const errors = watchForClientErrors(page);
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByText(/Project invite/)).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

// Regression: a stored session that can no longer be refreshed (Supabase project
// paused/deleted/offline) used to hang the premium gate forever — `getSession()`
// blocks on a retrying token refresh instead of rejecting, so the ready flag never
// flipped and the tool spun with no message and no way forward.
//
// Reproducing it needs BOTH halves: a session cookie named for the *configured*
// project ref (otherwise the client finds nothing to recover and returns instantly,
// which is why an arbitrary cookie name silently passes), and a dead auth backend.
const SUPABASE_URL = (() => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    return env.match(/^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
})();
const PROJECT_REF = SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\./)?.[1];

test("premium gate settles when the auth backend is unreachable", async ({ page, context }) => {
  test.skip(!PROJECT_REF, "Supabase not configured — the gate renders through anyway");
  const expired = {
    access_token: "stale.jwt.value",
    refresh_token: "stale-refresh",
    expires_at: Math.floor(Date.now() / 1000) - 3600,
    expires_in: -3600,
    token_type: "bearer",
    user: { id: "00000000-0000-0000-0000-000000000000", email: "stale@example.com" },
  };
  await context.addCookies([
    {
      name: `sb-${PROJECT_REF}-auth-token`,
      value: "base64-" + Buffer.from(JSON.stringify(expired)).toString("base64"),
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.route(/supabase\.[a-z]+\/auth\/v1\/.*/, (route) => route.abort("failed"));

  await page.goto("/dashboard/tools/single-line");
  // The gate must reach a decision — spinner gone — well inside its own timeout.
  await expect(page.locator("div.animate-spin")).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.getByText(/AI Factory\s*(—\s*)?Single-line|Sign-in unavailable/).first(),
  ).toBeVisible();
});
