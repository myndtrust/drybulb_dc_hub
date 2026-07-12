# AI Factory — graph model & reference-architecture configurator

**Status:** design spec (Phase 0). Data is live (`data/reference-architectures.json`); the engine and UI
are later phases. This is the first concrete step toward integrating the Cost Model with **NVIDIA DSX**
(Omniverse digital twin) — see the team memory `dsx-north-star`.

## 1. Goal
Take a user from **concept → detailed BOM → (later) simulation-ready design** for an AI factory, driven
by NVIDIA reference architectures (DGX SuperPOD **GB300 NVL72** and **DGX B300**). The user states intent
(how many GPUs / MW / scalable units), picks a reference architecture, and the system sizes the full
stack — compute, networking, storage, power, cooling, facility — into a costed bill of materials.

## 2. Key design decision
The graph is a **generator of cost-model inputs**, not a second cost engine. Instantiating the graph
rolls up into an **itemized `LocationConfig`** (`capacityMW` = IT MW, `categoryMode = "itemized"`,
`componentCosts` seeded from the BOM). The existing `lib/cost/model.ts`, `data/equipment-catalog.json`,
and `lib/energy`/`lib/pue` then compute capex, weather-coupled energy, opex, and returns unchanged. This
keeps the new surface small and reuses all sourced pricing + the products pop-up.

## 3. The graph model
A typed, hierarchical graph. **Nodes** carry attributes; **edges** carry sizing ratios; **roll-ups** are
graph reductions.

### Node attributes
`{ id, type, qty, capexUSD, powerKW, heatKW, rackU, weightKg?, leadTimeWk?, confidence:"sourced"|"estimate",
sourceRef?, catalogKey? }` — `catalogKey` links a node to a component in `data/equipment-catalog.json`
so it inherits real unit pricing, products, and confidence.

### Node types
| Group | Nodes |
|---|---|
| Intent | `AIFactory` (root: target + RA + network/power/cooling scheme + site/city) |
| Compute | `ScalableUnit` → `ComputeSystem` (GB300 NVL72 rack \| DGX B300 node) → leaf `GPU` / `CPU` / `NIC` / `DPU` |
| Physical | `Rack` → `Row` → `Hall` → `FacilityShell` (slab/steel/envelope) |
| Network | `NetworkFabric{compute, storage, mgmt}` → `Switch` / `Optic` / `Cable` |
| Storage | `StorageTier` → `StorageAppliance` |
| Power | `PowerChain`: utility → transformer → MV switchgear → UPS/battery → busway/DC-busbar → power-shelf/PSU |
| Cooling | `CoolingPlant`: chiller/tower → CDU → manifold/QD → cold-plate; `CRAH` for the air fraction |
| Derived | `Labor`, `SoftCosts` |

### Edge types (carry ratios)
- `contains` — factory→SU→system→{GPU,CPU,NIC,DPU}; rack→system.
- `powers` — PowerChain→Rack: `kW × (1 + lossFactor) × redundancy(N | N+1 | 2N)`.
- `cools` — CoolingPlant→Rack: heat kW split by `liquid_fraction` (liquid loop) vs air (CRAH).
- `connects` — Fabric→system (rails/ports); leaf→spine.
- `occupies` — Rack→Row→Hall (U-height, footprint).
- `priced_by` — any node → catalog component key (unit cost + products + confidence).

### Roll-up reducers (graph → numbers)
- **Counts:** GPUs, systems, racks, switches by type, optics, cables.
- **Power:** IT kW = Σ system power; **facility kW = IT × PUE** (weather-coupled via `lib/pue`).
- **Thermal:** total heat kW; liquid vs air load split (drives CDU vs CRAH sizing).
- **Capex by category:** Σ node capex grouped by catalog category → feeds the existing `capexBreakdown`.
- **Opex:** energy (`lib/energy`) + maintenance %/yr + staff.
- **BOM:** flatten priced nodes → `{ component, vendor/model, qty, unit $, ext $, lead wk, confidence }`.
- **KPIs:** $/GPU, $/W, capex/MW, PUE, **FP4 PFLOPS/$** (and tokens/$ when a perf model is supplied).

### Mapping to the equipment catalog (the reuse seam)
GPU/host/in-rack → `gpus` category; switches/optics/DPU/cabling/storage/mgmt → `otherAI`;
power/cooling/shell/labor/soft → the facility categories. Every `bom_ratios[].catalogKey` resolves to a
catalog component (or is flagged `catalog_todo` for a Phase-1 addition).

## 4. Reference-architecture data (`data/reference-architectures.json`)
Each architecture is a **sized building block**:
- `system` — the smallest priced compute unit (GPUs/CPUs/power/cost/perf).
- `racking` — systems per rack, kW per rack.
- `scalable_unit` — the SU (systems / racks / GPUs).
- `bom_ratios[]` — every other component, expressed **per a denominator** (`gpu | system | rack | su |
  it_kw | it_mw`) so any target sizes deterministically.

**Seeded templates** (numbers from the NVIDIA RAs; ratios flagged `estimate` to refine from each RA's
wiring guide):

| Key | System | Rack | SU | Cooling / Fabric / Power |
|---|---|---|---|---|
| `gb300-nvl72` | NVL72 rack: 72 B300 GPU + 36 Grace, 18 trays, 120 kW, ≈$3.2M | 1/rack, 120 kW | 1 rack = 72 GPU | 100% liquid · IB(NVLink/Quantum-X800) · DC busbar |
| `dgx-b300-ib-dc` | DGX B300 node: 8 GPU, 2 Xeon, 8× ConnectX-8, 2× BlueField-3, 14 kW | 4/rack, 56 kW | 64 nodes = 512 GPU | hybrid (0.7 liquid) · Quantum-3 Q3400 IB · DC busbar |
| `dgx-b300-eth-ac` | DGX B300 node (as above) | 4/rack, 56 kW | 72 nodes = 576 GPU | hybrid · Spectrum-4 SN5600 Ethernet · AC |

### Sizing algorithm (reference impl in `scripts/reference_architectures.py size`)
Given a target → `n_systems` → `n_racks = ceil(n_systems / systems_per_rack)`,
`n_su = ceil(n_systems / su.systems)`, `n_gpus`, `it_kw = n_systems × power_kw`. Each BOM line qty =
`ratio.qty × count(ratio.per)`. Verified anchors: GB300 → 9,216 GPU = **128 racks @ 120 kW = 15.36 MW**;
B300 IB → 1 SU = **64 systems / 16 racks / 512 GPU / 0.896 MW**.

### Maintenance
Edit `data/reference-architectures.json`, then:
```
python scripts/reference_architectures.py validate      # schema + internal consistency
python scripts/reference_architectures.py size --arch gb300-nvl72 --gpus 9216
python scripts/reference_architectures.py build          # -> lib/factory/reference-architectures.gen.ts
```

## 5. User journey (how `/cost-model` will evolve)
1. **Concept** — pick a target (`# GPUs | # SU/racks | IT MW | FP4 PFLOPS`) + a reference architecture
   (GB300 NVL72 | DGX B300; IB vs Ethernet; AC vs DC busbar).
2. **Auto-size** — the graph instantiates SUs→racks→systems→GPUs and derives network/storage/power/cooling
   from the RA ratios; headline rollups (GPUs, IT MW, facility MW, racks, $/GPU, total capex).
3. **Detailed config** — hand off to today's itemized-BOM cost-model UI (`CategoryCapex`, products
   pop-up, charts); the user overrides qty/cost/products, PUE, power source, finance; the graph stays
   consistent (changing GPU count re-sizes downstream).
4. **BOM** — full bill of materials from the flattened graph, reusing catalog products + confidence.
5. **Export — DEFERRED** — simulation-ready JSON + OpenUSD layout (racks in rows/halls with power,
   thermal, and fabric-link metadata) for an Omniverse / DSX digital twin. A clear export seam, mapped to
   DSX signals (Max-Q / Flex / Exchange) in a later phase.

## 6. Visual / DAG authoring layer (the "Build Graph")
The authoring UI is a hierarchical DAG that reads like an **electrical single-line diagram**. Mockup:
`drafts/ai-factory-dag.html`.

- **Container (group) nodes** — nested, nameable, color-coded drop-zones forming the spatial + logical
  hierarchy: **Site → Building → Data Hall (Room) → Row → Hot-aisle Containment (POD) → Rack**, plus the
  logical groups **Power Block** (utility → substation → MV switchgear → UPS → busway "**power stripe**")
  and **Cooling Loop** (plant/chiller → CDU → manifold). Mirrors IFC spatial nesting and React Flow
  sub-flows.
- **Card nodes** — the cost-model entities, bound to `data/equipment-catalog.json`, **keeping every
  existing field** (qty, $/W · $/MW · $ total, power kW, confidence, products). Cards **snap into**
  containers (drag-to-attach).
- **Edges (single-line)** — power feeders (heavy, sky), cooling loops (teal), network fabric (violet),
  routed orthogonally; the busway is drawn as a bus rail feeding the PODs.
- **Bulk edit + initialization** — multi-select cards or a container to set **initialization conditions
  in bulk**; containers own group-level defaults; an **"Initialize from reference architecture"** action
  builds the whole graph and **pre-fills defaults** from `data/reference-architectures.json`.
- **Rollup chips** — GPUs, scalable units, racks, IT MW, facility MW, capex, $/GPU (same as the cost model).
- **Implementation (Phase 2)** — **React Flow / xyflow**: `group` container nodes via `parentId` +
  `extent:'parent'`; custom card node + custom power/cooling/network edges; optional **dagre/ELK**
  auto-layout. The graph still reduces to an itemized `LocationConfig`, so the cost engine is unchanged.
- **Mission continuity** — two research skills maintain this: `/research-graph-bim` (graph/BIM viz
  patterns) and `/research-ai-factory-systems` (reference-architecture data refresh).

## 6.1 ETAP-inspired single-line UX (the configurator)
The authoring UX is modeled on **ETAP**'s intelligent single-line / system-modeling tool
([system modeling](https://etap.com/solutions/system-modeling-visualization),
[intelligent SLD](https://etap.com/solutions/intelligent-single-line-diagram)). Mockup:
`drafts/ai-factory-dag.html`.

- **Composite networks + nesting + drill-down** — every container (Site/Building/Hall/Row/POD, Power
  block, Cooling loop, Network) is a **composite** you can collapse to a single symbol, expand, or
  **drill into** (focus + breadcrumb). Unlimited nesting.
- **AutoBuild from RA** — the reference architecture is the **first-class boundary condition**; AutoBuild
  instantiates the whole composite hierarchy + datablocks + defaults from it.
- **Datablocks** — each element/composite shows a compact block of inputs + results (qty, $/W, kW,
  confidence, rolled MW) — the same fields as the cost-model card.
- **Color themes + study overlays** — an overlay selector recolors the diagram by **System**,
  **Power loading %**, **$/W heatmap**, or **Confidence** (ETAP's load-flow-overlay idiom = our
  feasibility view).
- **Project explorer tree** + **synchronized views** — Single-line · Floor-plan · BOM · KPI dashboard.
- **Boundary-conditions inspector** (nothing selected) + **feasibility status bar** (power vs grid cap,
  capex vs budget, PUE/WUE vs target, footprint, redundancy/Tier, $/GPU) — green/amber/red, live.

## 6.2 Interlock with the cost-model page
The configurator and the cost-model page ([page.tsx](app/(app)/dashboard/tools/cost-model/page.tsx)) are
**two facets of one model** and will be **bidirectionally interlocked**: the **single-line configurator
sets hierarchy/structure**, the **cost-model cards set detailed definitions** (per-component overrides,
products, units). Both read/write the same itemized `LocationConfig` (§2). Each SLD **element ↔ catalog
component (`catalogKey`) ↔ cost-model card**; composites ↔ groupings/location; **datablock fields are the
card fields**. The configurator exposes an **"Open in cost model →"** affordance; runtime two-way sync is
a later phase.

## 7. Phasing
- **Phase 0 (this doc + data):** graph-model spec, `data/reference-architectures.json`, validate/build
  tooling. ✅
- **Phase 1:** `lib/factory/` engine — types + roll-up reducers that turn (RA + target) into an itemized
  `LocationConfig`; add the missing catalog components (`HGX/DGX B300`, `Quantum-3 Q3400`, `ConnectX-8`,
  `SN2201`).
- **Phase 2:** extend `/cost-model` with the concept band (RA picker + target + auto-size) above the
  existing itemized BOM.
- **Phase 3 (deferred):** Omniverse / DSX simulation-ready export.
