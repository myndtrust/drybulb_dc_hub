/**
 * Offline TMY3 ingestion — run with `npx tsx scripts/ingest-tmy3.ts [flags]`.
 *
 * Crawls climate.onebuilding.org for US `_TMY3.zip` files, unzips each EPW,
 * parses + derives the 12 monthly values via lib/pue, and uploads one compact
 * JSON per station (keyed by USAF) plus an aggregate index.json to Supabase
 * Storage. NEVER runs at request time.
 *
 * Flags:
 *   --states=AZ,CA   limit to these state codes (dry runs)
 *   --limit=N        stop after N stations
 *   --dry            parse only; write samples to ./tmp, no upload
 *   --force          re-upload even if the object already exists
 *   --bucket=tmy3    Supabase Storage bucket (default: tmy3)
 *
 * Env (from .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { createClient } from "@supabase/supabase-js";
import { parseEPW, deriveMonthly } from "../lib/pue/parse-weather";
import { isFeaturedMarket } from "../lib/pue/featured-markets";
import type { StationWeather, TmyStation } from "../lib/pue/types";

const USA_BASE =
  "https://climate.onebuilding.org/WMO_Region_4_North_and_Central_America/USA_United_States_of_America/";

// ── CLI ──
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const STATES = args.states ? String(args.states).toUpperCase().split(",") : null;
const LIMIT = args.limit ? parseInt(String(args.limit), 10) : Infinity;
const DRY = !!args.dry;
const FORCE = !!args.force;
const BUCKET = String(args.bucket ?? "tmy3");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Hrefs in an Apache/onebuilding directory listing. */
function hrefs(html: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

function buildRecord(epwText: string, zipName: string): StationWeather | null {
  const { meta, hourly } = parseEPW(epwText);
  if (!meta || hourly.tdb.length < 8000) return null;
  const usaf = meta.usaf || zipName.match(/\.(\d{6})_TMY3/)?.[1] || "";
  if (!usaf) return null;

  // Round to keep files small.
  const tdb = hourly.tdb.map((v) => round(v, 1));
  const rh = hourly.rh.map((v) => Math.round(v));
  const p = hourly.p.map((v) => Math.round(v));
  const monthlyRaw = deriveMonthly({ tdb, rh, p });
  const r2 = (rec: Record<string, number>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, round(v, 2)]));

  return {
    usaf,
    name: meta.name,
    state: meta.state,
    lat: round(meta.lat, 3),
    lon: round(meta.lon, 3),
    elevationM: Math.round(meta.elevationM),
    dcMarket: isFeaturedMarket(meta.name, meta.state) || undefined,
    source: "TMY3 (EPW, climate.onebuilding.org)",
    monthly: {
      T2M: r2(monthlyRaw.T2M),
      T2MWET: r2(monthlyRaw.T2MWET),
      T2MDEW: r2(monthlyRaw.T2MDEW),
      RH2M: r2(monthlyRaw.RH2M),
    },
    hourly: { tdb, rh, p },
  };
}

async function main() {
  process.loadEnvFile?.(".env.local");
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!DRY && (!SUPABASE_URL || !SERVICE_KEY)) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (or use --dry).");
  }
  const supabase = DRY ? null : createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false } });

  // Existing objects (resumable).
  const existing = new Set<string>();
  if (supabase && !FORCE) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000, offset });
      if (error || !data?.length) break;
      data.forEach((o) => existing.add(o.name));
      if (data.length < 1000) break;
    }
    console.log(`Resuming: ${existing.size} files already in bucket "${BUCKET}".`);
  }

  // State directories.
  const usaIndex = await fetchText(USA_BASE);
  // State links look like href="AK_Alaska/index.html" → capture "AK_Alaska".
  let stateDirs = hrefs(usaIndex, /href="([A-Z]{2}_[^"/]+)\/index\.html"/g);
  if (STATES) stateDirs = stateDirs.filter((d) => STATES.includes(d.slice(0, 2)));
  if (DRY) mkdirSync("tmp", { recursive: true });

  const index: TmyStation[] = [];
  let done = 0;
  let failed = 0;

  for (const dir of stateDirs) {
    if (done >= LIMIT) break;
    const dirUrl = USA_BASE + dir + "/";
    let stateIndex: string;
    try {
      stateIndex = await fetchText(dirUrl);
    } catch (e) {
      console.warn(`! state index ${dir}: ${(e as Error).message}`);
      continue;
    }
    const zips = hrefs(stateIndex, /href="([^"]+_TMY3\.zip)"/g);

    for (const zipName of zips) {
      if (done >= LIMIT) break;
      try {
        const bytes = await fetchBytes(dirUrl + zipName);
        const files = unzipSync(bytes);
        const epwKey = Object.keys(files).find((k) => k.toLowerCase().endsWith(".epw"));
        if (!epwKey) {
          console.warn(`! no epw in ${zipName}`);
          continue;
        }
        const rec = buildRecord(strFromU8(files[epwKey]), zipName);
        if (!rec) {
          console.warn(`! parse failed ${zipName}`);
          continue;
        }
        const objName = `${rec.usaf}.json`;
        index.push({
          usaf: rec.usaf,
          name: rec.name,
          state: rec.state,
          lat: rec.lat,
          lon: rec.lon,
          elevationM: rec.elevationM,
          dcMarket: rec.dcMarket,
        });

        if (DRY) {
          if (done < 3) writeFileSync(`tmp/${objName}`, JSON.stringify(rec));
        } else if (existing.has(objName) && !FORCE) {
          // skip upload, still counted in index
        } else {
          const { error } = await supabase!.storage
            .from(BUCKET)
            .upload(objName, Buffer.from(JSON.stringify(rec)), {
              contentType: "application/json",
              upsert: true,
            });
          if (error) throw error;
        }
        done++;
        if (done % 25 === 0) console.log(`  …${done} stations (${rec.state} ${rec.name})`);
        await sleep(700 + Math.random() * 900); // be polite
      } catch (e) {
        failed++;
        console.warn(`! ${zipName}: ${(e as Error).message}`);
      }
    }
  }

  // Index.
  index.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  if (DRY) {
    writeFileSync("tmp/index.json", JSON.stringify(index, null, 0));
    console.log(`\nDRY RUN complete: ${done} stations parsed, ${failed} failed. Samples in ./tmp/`);
  } else {
    await supabase!.storage.from(BUCKET).upload("index.json", Buffer.from(JSON.stringify(index)), {
      contentType: "application/json",
      upsert: true,
    });
    console.log(`\nDone: ${done} stations uploaded, ${failed} failed. index.json has ${index.length} entries.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
