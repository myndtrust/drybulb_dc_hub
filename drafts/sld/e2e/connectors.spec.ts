import { test, expect, type Page, type Locator } from "@playwright/test";
import path from "node:path";
import url from "node:url";

// Load the mockup from disk (file://) — no web server needed.
const FILE = url.pathToFileURL(path.resolve(__dirname, "../../ai-factory-sld.html")).href;

test.beforeEach(async ({ page }) => {
  await page.goto(FILE);
  await page.waitForFunction(() => !!(window as any).__sld);
});

/** Edges as [fromName, toName] pairs, read from the page's graph hook. */
function edgePairs(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__sld.graph();
    const nm = (id: string) => {
      const n = g.nodes.find((x: any) => x.id === id) || g.busbars.find((b: any) => b.id === id);
      return n ? n.name : id;
    };
    return g.edges.map((e: any) => [nm(e.from), nm(e.to)] as [string, string]);
  });
}
const edgeCount = (page: Page) => page.evaluate(() => (window as any).__sld.graph().edges.length);
const nodeId = (page: Page, name: string) => page.evaluate((n) => (window as any).__sld.graph().nodes.find((x: any) => x.name === n).id, name);
const card = (page: Page, name: string) => page.locator(".n", { hasText: name });

/** Press-drag-release between two element centers (canvas-friendly). */
async function dragBetween(page: Page, from: Locator, to: Locator) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (!a || !b) throw new Error("missing element box");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 - 12, a.y + a.height / 2 - 8, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("ports render: sources output-only, loads input-only", async ({ page }) => {
  await expect(card(page, "Utility feed 115 kV").locator(".port.out")).toBeVisible();
  await expect(card(page, "Utility feed 115 kV").locator(".port.in")).toHaveCount(0);
  await expect(card(page, "GB300 rack 1").locator(".port.in")).toBeVisible();
  await expect(card(page, "GB300 rack 1").locator(".port.out")).toHaveCount(0);
  await expect(card(page, "Transformer 1").locator(".port.in")).toBeVisible();
  await expect(card(page, "Transformer 1").locator(".port.out")).toBeVisible();
});

test("create: drag an output port onto an input port adds a connector", async ({ page }) => {
  const before = await edgeCount(page);
  await dragBetween(page, card(page, "Transformer 1").locator(".port.out"), card(page, "UPS 2 (4N3)").locator(".port.in"));
  expect(await edgeCount(page)).toBe(before + 1);
  expect(await edgePairs(page)).toContainEqual(["Transformer 1", "UPS 2 (4N3)"]);
});

test("re-route: pull a connector's end-handle from one card to another", async ({ page }) => {
  const eid = await page.evaluate(() => {
    const g = (window as any).__sld.graph();
    const id = (n: string) => g.nodes.find((x: any) => x.name === n).id;
    const a = id("Transformer 1"), b = id("UPS 1 (4N3)");
    return g.edges.find((e: any) => e.from === a && e.to === b).id as string;
  });
  const before = await edgeCount(page);
  await dragBetween(page, page.locator(`.wh[data-wh="${eid}"][data-end="to"]`), card(page, "UPS 2 (4N3)").locator(".port.in"));
  expect(await edgeCount(page)).toBe(before);
  const pairs = await edgePairs(page);
  expect(pairs).toContainEqual(["Transformer 1", "UPS 2 (4N3)"]);
  expect(pairs).not.toContainEqual(["Transformer 1", "UPS 1 (4N3)"]);
});

test("delete: clicking a connector wire removes it", async ({ page }) => {
  const before = await edgeCount(page);
  // SWBD-A → RPP-A2 has a long horizontal mid-run, clear of any endpoint handle.
  const sw = (await card(page, "SWBD-A").boundingBox())!;
  const rp = (await card(page, "RPP-A2").boundingBox())!;
  await page.mouse.click(((sw.x + sw.width / 2) + (rp.x + rp.width / 2)) / 2, (sw.y + sw.height + rp.y) / 2);
  expect(await edgeCount(page)).toBe(before - 1);
  expect(await edgePairs(page)).not.toContainEqual(["SWBD-A", "RPP-A2"]);
});

test("undo: reverses the last connector edit", async ({ page }) => {
  const before = await edgeCount(page);
  await dragBetween(page, card(page, "Transformer 1").locator(".port.out"), card(page, "UPS 2 (4N3)").locator(".port.in"));
  expect(await edgeCount(page)).toBe(before + 1);
  await page.locator("#undo").click();
  expect(await edgeCount(page)).toBe(before);
});

// ── breakered distribution: switchboard / RPP ────────────────────────────────
test("breakered: switchboard and RPP render one output tap per breaker", async ({ page }) => {
  await expect(card(page, "SWBD-A").locator(".port.out.tap")).toHaveCount(8);
  await expect(card(page, "RPP-A1").locator(".port.out.tap")).toHaveCount(4);
});

test("wire from a specific breaker tap carries fromBreaker", async ({ page }) => {
  const swId = await nodeId(page, "SWBD-A");
  const before = await edgeCount(page);
  const tap = page.locator(`.port[data-port="${swId}"][data-breaker="b8"]`); // the spare feeder
  await dragBetween(page, tap, card(page, "GB300 rack 1").locator(".port.in"));
  expect(await edgeCount(page)).toBe(before + 1);
  const fromBreaker = await page.evaluate((id) => {
    const g = (window as any).__sld.graph();
    const rackId = g.nodes.find((n: any) => n.name === "GB300 rack 1").id;
    const e = g.edges.find((e: any) => e.from === id && e.to === rackId);
    return e ? e.fromBreaker : null;
  }, swId);
  expect(fromBreaker).toBe("b8");
});

// ── user-addable bus + topology library ──────────────────────────────────────
test("bus: add a busbar from the palette", async ({ page }) => {
  const before = await page.evaluate(() => (window as any).__sld.graph().busbars.length);
  await page.locator("[data-add-bus]").click();
  expect(await page.evaluate(() => (window as any).__sld.graph().busbars.length)).toBe(before + 1);
});

test("library: save a topology, change it, then load it back", async ({ page }) => {
  await page.locator("#topoName").fill("t1");
  await page.locator("#save").click();
  const saved = await edgeCount(page);
  // delete a wire (SWBD-A → RPP-A2 horizontal run)
  const sw = (await card(page, "SWBD-A").boundingBox())!;
  const rp = (await card(page, "RPP-A2").boundingBox())!;
  await page.mouse.click(((sw.x + sw.width / 2) + (rp.x + rp.width / 2)) / 2, (sw.y + sw.height + rp.y) / 2);
  expect(await edgeCount(page)).toBe(saved - 1);
  await page.locator("#load").selectOption("t1");
  expect(await edgeCount(page)).toBe(saved);
});
