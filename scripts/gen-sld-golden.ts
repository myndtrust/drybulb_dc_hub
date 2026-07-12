// Regenerate the single-line seed golden snapshot used by lib/factory/sld.test.ts.
// Run: npx tsx scripts/gen-sld-golden.ts
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seed, validate } from "../lib/factory/sld";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "lib", "factory", "sld.seed.golden.json");
const g = seed();
writeFileSync(out, JSON.stringify(g, null, 2) + "\n");
const v = validate(g);
console.log("validate", JSON.stringify(v));
console.log("nodes", g.nodes.length, "buses", g.busbars.length, "edges", g.edges.length);
