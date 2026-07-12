# Hyperscale data center electrical topologies (reference)

Reference notes behind the power single-line (`drafts/ai-factory-sld.html`) and its engine
(`drafts/sld/engine.js`). Captures the distribution chain, the equipment objects we model
(**switchboard** and **RPP**), and the redundancy schemes — with live sources. Cross-links:
[sld-ux-plan.md](./sld-ux-plan.md), [graph-model.md](./graph-model.md).

## The distribution chain (utility → rack)
The canonical hyperscale chain, top to bottom:

```
Utility substation (MV)  ∥  On-site generation (gensets / BESS)
        └────────────► Paralleling switchgear / ATS
                              └► MV bus (e.g. 13.8 kV)
                                   └► Unit-substation transformer (MV→LV, e.g. 480 V)
                                        └► UPS (static double-conversion, +static bypass)  ── 4-to-make-3 layer
                                             └► LV main switchboard / switchgear (main + feeder breakers)
                                                  └► Busway  OR  PDU (transformer + panel)
                                                       └► RPP (remote power panel) ── row/zone
                                                            └► Rack PDU (rPDU) → power shelves → server
```

- **Switchgear vs switchboard:** *switchgear* = metal-clad, draw-out breakers, higher interrupting
  rating, used at the service entrance/MV and large LV mains. *Switchboard* = group/fixed-mounted
  breakers (a main + feeder breakers), the workhorse LV distribution board. We model a generic
  **Switchboard** object with a configurable **breaker bank**.
- **PDU vs RPP:** a **PDU** generally includes an isolation/step-down **transformer** plus panelboards;
  an **RPP (Remote Power Panel)** is a **transformer-less** downstream panel (≈ a 2×2 ft footprint, up
  to ~4 panelboards) placed **at the row/zone**, fed from a floor PDU or switchboard, distributing
  **branch circuits to a cluster of racks** via whips. In 2N it is deployed in **A/B pairs**. With
  **busway**, a PDU + RPP manage/monitor the busway and tap-off units drop to each rack.[^semi][^lz][^vertiv][^uspwr][^bpp][^apc]

## Redundancy schemes (and where they apply)
| Scheme | Meaning | Typical use |
|--------|---------|-------------|
| **N** | exactly enough capacity | non-critical / dev |
| **N+1** | one spare unit | generation & cooling supply (Tier III) |
| **2N** | fully duplicated A/B | UPS + **distribution** (PDU/RPP/rack), Tier IV |
| **2N+1** | duplicated + spare | highest availability |
| **Distributed redundant (4-to-make-3 / 3-to-make-2)** | M blocks, any M−1 carry load | hyperscale UPS layer — better utilization/CapEx |
| **Catcher / N+2C ("isolated parallel")** | reserve UPS catches a failed block | hyperscale, ~2N availability at lower cost |

Tier III = **concurrently maintainable** (generally N+1 supply/generation, 2N UPS + distribution);
Tier IV = **fault tolerant**. Hyperscalers favour **distributed-redundant 4-to-make-3** (each UPS
~75% loaded, higher efficiency, lower $/MW) and/or a **catcher** reserve — with **2N distribution**
maintained down at the PDU/RPP/rack so each rack still has independent **A/B** cords.[^core][^dgtl][^soco][^semi]

## How the mockup models it (NVIDIA DGX SuperPOD basis)
The seed single-line reflects the **NVIDIA reference architecture**, which is **distributed-redundant
4-to-make-3** at the UPS layer (not full 2N), with **2N distribution** to the rack:

- **Sources:** Utility ∥ On-site generation → Paralleling switchgear → **MV bus (13.8 kV)**.
- **4-to-make-3 UPS layer:** four **Transformer → UPS** blocks feed a shared **LV distributed-redundant
  bus** (any three of four carry the load).
- **2N distribution:** two **Switchboards (SWBD-A / SWBD-B)** off the LV bus, each a breakered object
  (main + feeder breakers). Feeders drop to **RPP-A1/A2** and **RPP-B1/B2** (row panels) and to the
  mechanical/network loads.
- **Rack:** each **GB300 NVL72 rack** is **dual-corded** — one branch breaker from an A-side RPP and
  one from a B-side RPP.
- **Manifold** is passive (no power draw) → excluded from the power view (it appears in the cooling /
  consolidated views).

### Switchboard & RPP objects (engine model)
Both are `kind:"eq"`, `breakered:true`. A breakered card carries `{ mainAmp, voltage, breakers:[{ id,
label, amp, poles, status }] }` where `status ∈ closed | open | spare`. Each **feeder breaker is its own
output tap** on the bottom bus; a downstream connector starts at that tap (`edge.fromBreaker`). Rules:
a feeder breaker feeds **at most one** circuit; `fromBreaker` must reference an existing breaker
(enforced by `canConnect`/`validate`). Breakers are user-editable (add/remove/relabel/re-rate/restatus)
and wiring from a tap is a normal connector edit (create / re-route / delete, all undoable + tested).

## Sources
[^semi]: SemiAnalysis — *Datacenter Anatomy Part 1: Electrical Systems*. https://newsletter.semianalysis.com/p/datacenter-anatomy-part-1-electrical
[^lz]: LayerZero Power Systems — *Remote Power Panels (RPPs)*. https://www.layerzero.com/products/mission-critical-distribution/erpp/
[^vertiv]: Vertiv — *New Remote Power Panel and Busway System*. https://www.vertiv.com/en-emea/about/news-and-insights/news-releases/2021/vertiv-introduces-a-new-remote-power-panel-and-a-busway-system-to-standardise-simplify-and-scale-data-centre-operations/
[^uspwr]: United Power — *Remote Power Panels (RPP) for Data Centers*. https://uspwr.com/products/rpp-remote-power-panels/
[^bpp]: BPP Mfg — *Remote Power Panels (RPP)*. https://www.bppmfg.com/products-solutions/remote-power-panels-rpp/
[^apc]: Schneider Electric / APC — *Electrical Distribution Equipment in Data Center Environments*. https://www.lorisweb.com/CMGT235/DIS21/VAVR-8W4MEX_R1_EN.pdf
[^core]: CoreSite — *What is Data Center Redundancy? N, N+1, 2N, 2N+1*. https://www.coresite.com/blog/data-center-redundancy-n-1-vs-2n-1
[^dgtl]: Dgtl Infra — *Data Center Redundancy: N, N+1, 2N, and 2N+1 Explained*. https://dgtlinfra.com/data-center-redundancy/
[^soco]: Socomec — *Data Center Redundancy Definition & Reliability Best Practices*. https://www.socomec.us/en-us/solutions/business/data-centers/data-center-redundancy-definition-reliability-best-practices

*Notes are an engineering synthesis of the cited public sources for the configurator; verify exact
ratings/redundancy against the governing NVIDIA RA and project basis of design.*
