Research NVIDIA AI-factory reference architectures and data-center systems, then refresh the Drybulb reference-architecture data and equipment catalog with sourced, current numbers.

## Input

$ARGUMENTS — optional focus (e.g. "Vera Rubin NVL144", "DSX Flex grid services", "B300 storage sizing", "power one-line for DC busbar"). If empty, refresh all seeded architectures.

## Process

1. **Read current state** so you update rather than duplicate:
   - [data/reference-architectures.json](data/reference-architectures.json) (RA templates + `bom_ratios`)
   - [data/equipment-catalog.json](data/equipment-catalog.json) (components/products the RA lines map to via `catalogKey`; note `catalog_todo` flags)
   - [docs/ai-factory/graph-model.md](docs/ai-factory/graph-model.md) (how the data is consumed)
   - the team memory `dsx-north-star` for the long-term DSX target.

2. **Research (web), capturing sourced links** — prefer primary NVIDIA docs:
   - **Reference architectures**: DGX SuperPOD GB300 NVL72 (https://docs.nvidia.com/pdf/dgx-spod-gb300-ra.pdf), DGX B300 scalable infrastructure (Quantum-3 IB / Spectrum-X Ethernet; AC vs DC busbar), and newer platforms (Vera Rubin NVL72/NVL144) as they publish. Pull per-system spec, systems/rack, kW/rack, SU size, max config.
   - **Building blocks**: compute (GPUs/CPUs/NICs/DPUs per system, power), compute/storage/mgmt **fabrics** (switch models, rails, leaf/spine counts per SU, optics/cables), **storage** (capacity/throughput per GPU, certified partners), **power** (UPS/redundancy, busway/DC-busbar, power shelves), **cooling** (liquid fraction, CDU sizing, CRAH).
   - **DSX**: Max-Q (tokens/watt), Flex (grid services), Exchange (compute/power/cooling signals) — for the future export mapping.

3. **Update the data** (source of truth; keep the existing schema):
   - Edit `data/reference-architectures.json`: correct/extend `system`, `racking`, `scalable_unit`, and `bom_ratios` with cited numbers; set `confidence` honestly (`sourced` vs `estimate`) and add `source` URLs.
   - If a `catalogKey` line is flagged `catalog_todo` (e.g. DGX B300, Quantum-3 Q3400, ConnectX-8, SN2201), add the component/products to `data/equipment-catalog.json` and run its build (`python scripts/equipment_catalog.py validate|build`).

4. **Validate + regenerate**:
   - `python scripts/reference_architectures.py validate` (must pass: GPU/power/SU consistency)
   - `python scripts/reference_architectures.py size --arch <key> --gpus <N>` to sanity-check anchors against the RA
   - `python scripts/reference_architectures.py build` → `lib/factory/reference-architectures.gen.ts`; then `npx tsc --noEmit`.

5. **Report** a short changelog (what changed, with sources), any remaining `catalog_todo`, and open questions. Do not touch app/runtime code beyond the catalog/RA data + their generated `.gen.ts`. Commit only if the user asks.
