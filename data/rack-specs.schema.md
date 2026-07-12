# rack-specs.json schema

Source of truth for AI-rack interface specs consumed by the single-line
(`lib/factory/sld.ts applyRackSpec`) and the cost model. Edit the JSON, then run:

```
python scripts/rack_specs.py validate
python scripts/rack_specs.py build      # → lib/factory/rack-specs.gen.ts
```

Each entry in `racks[]`:

| field | meaning |
|-------|---------|
| `key` / `label` / `vendor` / `family` | identity (key is stable, used by the node's `aiRack`) |
| `accel_model` / `accel_per_rack` / `gpus_per_rack` | accelerator type + count per rack |
| **`power`** | rack power interface (see below) |
| **`cooling`** | air + water/DLC cooling interface |
| **`network`** | east-west / north-south network sizing ratios |
| `confidence` | `sourced` (vendor RA/datasheet) or `estimate` (engineering default) |
| `source` | key into the top-level `sources` map |

**power**: `rack_kw`, `peak_kw`, `voltage_v`, `phase` (`3ph-ac`\|`dc-busbar`),
`delivery` (`vertical-busbar`\|`whip-rpp`\|`busway-tap`), `feeds` (independent feeds,
2 = A/B), `redundancy` (`2N`\|`N+1`), `circuit_amps` (per feed), `circuit_size`
(conductor/feeder text), `connector`, `rack_pdu`.

**cooling**: `type` (`liquid-dlc`\|`hybrid`\|`air`), `liquid_fraction` (0–1),
`coolant`, `flow_lpm`, `supply_c`, `return_c`, `delta_c`, `manifold`, `air_cfm`,
`air_supply_c`.

**network**: `fabric_ew`, `racks_per_su`, `leaf_per_rack`, `spine_per_su`,
`storage_per_su`, `mgmt_per_su`, `fabric_ns`.

`validate` enforces: unique keys, required power/cooling/network fields,
`rack_kw>0`, `feeds>=1`, `circuit_amps>0`, `0<=liquid_fraction<=1`, valid `confidence`.
