Research graph-based Building Information Modeling (BIM) and node-graph visualization patterns, then turn the findings into concrete recommendations for the Drybulb AI Factory build-graph UI.

## Input

$ARGUMENTS — optional focus (e.g. "edge routing", "IFC spatial hierarchy", "React Flow performance at 1000 nodes"). If empty, do a broad sweep.

## Process

1. **Read the current design** so research builds on it, not over it:
   - [docs/ai-factory/graph-model.md](docs/ai-factory/graph-model.md) (graph model + visual/DAG layer)
   - [data/reference-architectures.json](data/reference-architectures.json) and [data/equipment-catalog.json](data/equipment-catalog.json) (the entities cards bind to)
   - the mockup `drafts/ai-factory-dag.html` (current visual direction)

2. **Research (web), capturing sourced links** across these threads — skip any already well-covered unless `$ARGUMENTS` asks to go deeper:
   - **Node-graph editors / sub-flows**: React Flow / xyflow grouping (`parentId`, `extent:'parent'`, drag-to-attach), selection grouping, performance/virtualization at scale; alternatives (Rete.js, nice-dag, Microsoft react-dag-editor, yEd). Layout engines: **dagre**, **ELK** (layered/orthogonal), and when to auto-layout vs free-form snap.
   - **Single-line / one-line diagram conventions** (electrical): how power distribution is drawn (feeders, buses, switchgear, redundancy A/B), and how to read a DC power one-line; orthogonal "elbow" edge routing.
   - **BIM spatial hierarchy**: IFC `IfcSite → IfcBuilding → IfcBuildingStorey → IfcSpace`; how containment/zoning maps to nested containers; OpenUSD scene-graph nesting (for the future Omniverse/DSX export).
   - **DC design / digital-twin tools** for grouping + visual idioms: Cadence Reality DC (ex-6SigmaDCX, Elements library), Schneider EcoStruxure IT Design, ETAP↔Omniverse one-line, NVIDIA Omniverse/Air, Vertiv/nVent layout guides. Note how each groups rooms / rows / hot-aisle containment / busway / cooling loops.

3. **Synthesize** into actionable guidance for our build graph:
   - Recommended **container hierarchy** + which groupings are spatial (room/row/POD) vs logical (power block / cooling loop / fabric).
   - **Edge model** (power/cooling/network) + routing approach (orthogonal elbows; bus rails for busway).
   - **Library decision** (default: React Flow) with the specific features we'll use and any perf caveats.
   - **Bulk-edit / initialization** UX patterns (multi-select, container-level defaults, "initialize from RA").
   - A short list of **mockup/implementation changes** to make next.

4. **Write the findings** into `docs/ai-factory/research-graph-bim.md` (create or update): dated, with sourced markdown links, a "Recommendations" section, and a "Apply to Drybulb" section referencing concrete files. Update the "Visual / DAG authoring layer" section of [docs/ai-factory/graph-model.md](docs/ai-factory/graph-model.md) if the design shifts.

5. **Report** the top 3–5 recommendations and any open decisions for the user. Do not change app/runtime code or add dependencies unless the user explicitly asks — this skill is research + design only.
