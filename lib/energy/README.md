# `lib/energy` — hourly energy time-series schema

The unifying abstraction is an **hourly vector**: `number[]` of length `HOURS` (8,760).
A site's total energy model composes several vectors:

| vector | meaning |
| --- | --- |
| `itMW[h]` | IT power demand, summed across differentiated service channels |
| `pue[h]` | weather-driven hourly PUE for the chosen city (flat fallback when none) |
| `facilityMW[h]` | `itMW[h] × pue[h]` — the **per-city energy-requirement vector** |
| `price[h]` | delivered energy price ($/kWh): flat, time-of-use, or gas-derived |

`buildEnergyModel()` ([model.ts](./model.ts)) assembles these from differentiated
`ServiceChannel`s (each with a capacity share, an hourly utilization profile, and a
$/MW/yr revenue rate), a `CoolingConfig`, the city's `HourlyWeather`, and `PricingParams`.
Weather → hourly PUE runs through the **real PUE cooling engine**
(`lib/pue/hourly.calculateHourlyPUE`, reusing the COP primitives in `lib/pue/cooling`).

Consumers today: the Data Center Cost Model (`lib/cost`). The PUE tool supplies the city
index + weather (`lib/pue/tmy3`) and the shared `LocationSelect`.

## Roadmap — further vectors to compose

The schema is designed so total-energy work slots in as additional hourly vectors fed to
`buildEnergyModel` (or a successor), without disturbing existing tools:

- **Real grid price series** — replace the synthetic flat/TOU `price[h]` with ISO/LMP
  day-ahead or real-time hourly prices per market.
- **Marginal-carbon series** — a `gCO2/kWh[h]` vector to report operational emissions and
  carbon-aware scheduling alongside cost.
- **Storage / BESS dispatch** — optimize a battery against `price[h]` (and `carbon[h]`) to
  shave peaks and arbitrage, modifying the net `facilityMW[h]` drawn from the grid.
- **Demand response / curtailment** — shift or shed flexible service channels in response
  to price or grid signals.
- **On-site generation + renewables** — solar/wind generation vectors netted against load.
- **Multi-site portfolios** — compose several sites' vectors for a fleet-level total energy
  and LCOE view.

Each addition is "just another 8,760-length vector," keeping the model transparent and
first-principles.
