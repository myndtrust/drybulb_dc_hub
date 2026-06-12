// ─────────────────────────────────────────────────────────────────────────────
// Psychrometrics — ASHRAE Handbook of Fundamentals (2017), Chapter 1.
//
// SI units throughout: temperature °C, pressure Pa, humidity ratio kg/kg (dry
// air), enthalpy kJ/kg (dry air). These are the engineering-grade formulations
// used by the energy model and the psychrometric chart — they replace the
// Magnus/Stull approximations used only for the visual mockup.
//
// References:
//   ASHRAE Fundamentals 2017, Ch.1 — eqns (5),(6) saturation pressure;
//   (20)/(22) humidity ratio; (32)/(33) wet-bulb relation; (28) enthalpy.
// ─────────────────────────────────────────────────────────────────────────────

/** Standard sea-level atmospheric pressure (Pa). */
export const P_STD = 101325;

/** Ratio of molecular masses of water vapor to dry air (ASHRAE eq. 20 constant). */
const MW_RATIO = 0.621945;

/**
 * Atmospheric pressure as a function of site elevation (ASHRAE Fundamentals
 * 2017, Ch.1, eq. 3). Valid −500 to 11 000 m.
 * @param elevationM site elevation in metres
 * @returns pressure in Pa
 */
export function pressureFromElevation(elevationM: number): number {
  return 101325 * Math.pow(1 - 2.25577e-5 * elevationM, 5.2559);
}

/**
 * Saturation vapor pressure over water/ice (ASHRAE Fundamentals 2017, Ch.1,
 * eqns 5 & 6 — Hyland–Wexler). Valid −100 °C to +200 °C.
 * @param tC temperature in °C
 * @returns saturation pressure in Pa
 */
export function satPressurePa(tC: number): number {
  const T = tC + 273.15; // absolute temperature, K

  if (tC < 0) {
    // Over ice — ASHRAE eq. (5)
    const C1 = -5.6745359e3;
    const C2 = 6.3925247;
    const C3 = -9.677843e-3;
    const C4 = 6.2215701e-7;
    const C5 = 2.0747825e-9;
    const C6 = -9.484024e-13;
    const C7 = 4.1635019;
    const ln =
      C1 / T + C2 + C3 * T + C4 * T * T + C5 * T * T * T + C6 * T * T * T * T + C7 * Math.log(T);
    return Math.exp(ln);
  }

  // Over liquid water — ASHRAE eq. (6)
  const C8 = -5.8002206e3;
  const C9 = 1.3914993;
  const C10 = -4.8640239e-2;
  const C11 = 4.1764768e-5;
  const C12 = -1.4452093e-8;
  const C13 = 6.5459673;
  const ln = C8 / T + C9 + C10 * T + C11 * T * T + C12 * T * T * T + C13 * Math.log(T);
  return Math.exp(ln);
}

/**
 * Humidity ratio from a vapor partial pressure (ASHRAE eq. 22).
 * @param pwPa vapor partial pressure (Pa)
 * @param pPa total atmospheric pressure (Pa)
 * @returns humidity ratio in kg/kg dry air
 */
export function humidityRatioFromPw(pwPa: number, pPa: number = P_STD): number {
  return (MW_RATIO * pwPa) / (pPa - pwPa);
}

/**
 * Saturation humidity ratio at a given temperature (ASHRAE eq. 23).
 * @param tC temperature in °C
 * @param pPa total atmospheric pressure (Pa)
 */
export function satHumidityRatio(tC: number, pPa: number = P_STD): number {
  return humidityRatioFromPw(satPressurePa(tC), pPa);
}

/**
 * Humidity ratio from dry-bulb temperature and relative humidity.
 * @param tdbC dry-bulb temperature (°C)
 * @param rhPct relative humidity (0–100 %)
 * @param pPa total atmospheric pressure (Pa)
 * @returns humidity ratio in kg/kg dry air
 */
export function humidityRatio(tdbC: number, rhPct: number, pPa: number = P_STD): number {
  const pw = (Math.max(0, Math.min(100, rhPct)) / 100) * satPressurePa(tdbC);
  return humidityRatioFromPw(pw, pPa);
}

/**
 * Moist-air specific enthalpy (ASHRAE eq. 28).
 * @param tdbC dry-bulb temperature (°C)
 * @param w humidity ratio (kg/kg dry air)
 * @returns enthalpy in kJ/kg dry air
 */
export function enthalpy(tdbC: number, w: number): number {
  return 1.006 * tdbC + w * (2501 + 1.86 * tdbC);
}

/**
 * Humidity ratio implied by a dry-bulb / wet-bulb pair (ASHRAE eq. 33, over
 * water — wet-bulb at or above 0 °C). Used internally by the wet-bulb solver.
 */
function wFromWetBulb(tdbC: number, twbC: number, pPa: number): number {
  const wsStar = satHumidityRatio(twbC, pPa); // saturation W at the wet-bulb temp
  return (
    ((2501 - 2.326 * twbC) * wsStar - 1.006 * (tdbC - twbC)) /
    (2501 + 1.86 * tdbC - 4.186 * twbC)
  );
}

/**
 * Thermodynamic wet-bulb temperature, solved iteratively (bisection) from the
 * ASHRAE wet-bulb relation so the implied humidity ratio matches the actual one.
 * @param tdbC dry-bulb temperature (°C)
 * @param rhPct relative humidity (0–100 %)
 * @param pPa total atmospheric pressure (Pa)
 * @returns wet-bulb temperature (°C)
 */
export function wetBulb(tdbC: number, rhPct: number, pPa: number = P_STD): number {
  const wTarget = humidityRatio(tdbC, rhPct, pPa);

  // Wet-bulb is bounded by the dew point (below) and dry-bulb (above).
  let lo = dewPoint(tdbC, rhPct, pPa);
  let hi = tdbC;
  if (!isFinite(lo) || lo > hi) lo = -100;

  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const wMid = wFromWetBulb(tdbC, mid, pPa);
    // wFromWetBulb increases with wet-bulb temperature.
    if (wMid > wTarget) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/**
 * Dew-point temperature, by inverting the saturation-pressure curve so that
 * Pws(td) equals the actual vapor partial pressure (bisection).
 * @param tdbC dry-bulb temperature (°C)
 * @param rhPct relative humidity (0–100 %)
 * @param pPa total atmospheric pressure (Pa)
 * @returns dew-point temperature (°C)
 */
export function dewPoint(tdbC: number, rhPct: number, pPa: number = P_STD): number {
  const rh = Math.max(0.01, Math.min(100, rhPct));
  const pw = (rh / 100) * satPressurePa(tdbC);

  let lo = -100;
  let hi = tdbC;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (satPressurePa(mid) > pw) hi = mid;
    else lo = mid;
    if (hi - lo < 1e-4) break;
  }
  return (lo + hi) / 2;
}

/**
 * Relative humidity (%) from dry-bulb temperature and humidity ratio — the
 * inverse used when reading a point off the chart.
 * @param tdbC dry-bulb temperature (°C)
 * @param w humidity ratio (kg/kg dry air)
 * @param pPa total atmospheric pressure (Pa)
 */
export function relativeHumidity(tdbC: number, w: number, pPa: number = P_STD): number {
  const pw = (pPa * w) / (MW_RATIO + w);
  return Math.max(0, Math.min(100, (pw / satPressurePa(tdbC)) * 100));
}

/** Convenience: humidity ratio in g/kg (chart axis units). */
export const humidityRatioGPerKg = (tdbC: number, rhPct: number, pPa: number = P_STD): number =>
  humidityRatio(tdbC, rhPct, pPa) * 1000;
