// ─────────────────────────────────────────────────────────────────────────────
// Rackline — white-space DCIM document model.
//
// One project holds an equipment library, the electrical basis, an optional
// scaled background drawing, and any number of scenarios. Each scenario is a
// complete, independent design (layout, rack contents, PDU striping, cable
// pathways, cooling basis and room-level single line) so alternatives can be
// compared side by side.
//
// Plan coordinates are metres. A rack's front faces local −y and its rear +y;
// `rot` turns the rack clockwise in degrees.
// ─────────────────────────────────────────────────────────────────────────────

export const RACKLINE_SCHEMA_VERSION = 1;

export type Units = "ft" | "m";
export type Vec = [number, number];

export type DeviceCat = "compute" | "network" | "storage" | "server" | "passive";
export type CableType = "fabric" | "storage" | "mgmt" | "bmc";
export type Feed = "A" | "B";
export type RackRole = "compute" | "network" | "storage";
export type TrayKind = "fiber" | "ladder" | "power" | "busway";
export type CoolerKind = "crah" | "inrow" | "cdu" | "rdhxcdu";
export type Redundancy = "N" | "N+1" | "N+2" | "2N";
export type PduKey = "415-32" | "415-60" | "415-100" | "415-125" | "480-60" | "480-100" | "480-125";
export type ElecType =
  | "utility" | "switch" | "xfmr" | "gen" | "ats" | "swbd"
  | "ups" | "rpp" | "busway" | "mech" | "load";

/** An equipment-library entry. Values are planning assumptions, not datasheet truth. */
export interface LibItem {
  id: string;
  name: string;
  cat: DeviceCat;
  /** Height in rack units. */
  u: number;
  /** Design power per device (kW): the active power profile's rating when it has Max-Q / Max-P. */
  kw: number;
  /** Power-profile ratings (kW) of a rack-scale system; `kw` is set to one of them. */
  kwMaxQ?: number;
  kwMaxP?: number;
  /** Number of PSUs (0 for passive gear). */
  psu: number;
  /** Rating of one PSU (W). */
  psuW: number;
  /** Fraction of heat rejected to liquid (0–1). */
  liq: number;
  /** Network ports per device, by cable type. */
  ports: Partial<Record<CableType, number>>;
  /** Network gear: ports it offers to the cables it terminates (e.g. 64 on a 64-port switch). */
  swPorts?: number;
  /** Where the numbers come from, and which ones are estimates. */
  note?: string;
  /**
   * Each "PSU" is a balanced three-phase input (a rack-scale power shelf fed by
   * a 3φ whip, e.g. an NVL72), loading all three phases of its PDU / circuit
   * line to line, instead of one line-to-neutral PSU per phase.
   */
  phase3?: boolean;
}

/** Where one PSU lands: feed, PDU index within the feed, phase index (0–2). */
export interface PsuMap {
  f: Feed;
  p: number;
  ph: number;
}

export interface Device {
  id: string;
  lib: string;
  /** Bottom U position (1-based). */
  u: number;
  /** One entry per PSU; empty means "not striped yet". */
  map: PsuMap[];
  /** Network gear: the network system it belongs to (NetSystem id)… */
  net?: string;
  /** …and its tier. Leaves take the endpoint cables; spines take the leaves' uplinks. */
  tier?: NetTier;
}

export type NetTier = "leaf" | "spine";

/**
 * One separate network (compute fabric, storage / converged, in-band management,
 * out-of-band…). It carries some of the endpoint cable types and is served by
 * its own switches, so its cables, racks and topology are kept apart.
 */
export interface NetSystem {
  id: string;
  name: string;
  /** Colour on the topology and in schedules. */
  color: string;
  /** Endpoint port types it carries. A type belongs to the first system listing it. */
  cables: CableType[];
  /** Network racks whose leaves take its endpoint cables. Empty = racks holding its leaf switches, else every network rack. */
  racks: string[];
  /**
   * How an endpoint rack attaches: "nearest" leaf rack (top / end of row), or
   * "spread" its ports over every leaf rack in proportion to their leaves
   * (rail-optimised fabrics, where each rack reaches every leaf). Default nearest.
   */
  attach?: "nearest" | "spread";
  /** Leaf-to-spine uplinks per endpoint cable (1 = non-blocking, 0.33 = 3:1 oversubscribed). Used only when the system has spine switches. */
  uplink: number;
}

export interface Rack {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  /** Rack height in U. */
  u: number;
  role: RackRole;
  rdhx: boolean;
  pdu: PduKey;
  /** Number of A+B PDU pairs. */
  pduPairs: number;
  /** Electrical node ids feeding the A and B PDUs. */
  feedA: string | null;
  feedB: string | null;
  devs: Device[];
}

/** Hot aisle containment zone. A rack whose rear opens into it is contained. */
export interface Hac {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Length along the aisle. */
  w: number;
  /** Aisle width. */
  d: number;
  rot: number;
}

export interface Tray {
  id: string;
  name: string;
  kind: TrayKind;
  wmm: number;
  dmm: number;
  /** Elevation above finished floor (m). */
  elev: number;
  pts: Vec[];
}

export interface Cooler {
  id: string;
  name: string;
  kind: CoolerKind;
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
  /** Net capacity (kW). */
  cap: number;
}

export interface ElecNode {
  id: string;
  type: ElecType;
  name: string;
  /** Diagram position (px). */
  x: number;
  y: number;
  /** Secondary / operating voltage (V). */
  v?: number;
  /** Transformer primary voltage (V). */
  vp?: number;
  /** Utility available fault (MVA); 0 = infinite bus. */
  scc?: number;
  amps?: number;
  kva?: number;
  /** Transformer impedance (%Z). */
  z?: number;
  /** UPS efficiency (0–1). */
  eff?: number;
  /** Fixed load (kW) on load / mechanical nodes. */
  kw?: number;
  /** Mechanical node takes its load from the cooling calculation. */
  auto?: boolean;
  /** Where the diagram draws the list of racks this node feeds, relative to the node (px); absent = just below it. */
  rackDx?: number;
  rackDy?: number;
}

export interface ElecLink {
  id: string;
  from: string;
  to: string;
}

/** Room-level single line: utility through distribution to the rack feeds. */
export interface Electrical {
  nodes: ElecNode[];
  links: ElecLink[];
}

export interface CoolingBasis {
  /** IT air ΔT (°F). */
  dtF: number;
  /** Supply-air multiplier for uncontained racks. */
  bypass: number;
  crahKW: number;
  crahCFM: number;
  crahFanKW: number;
  red: Redundancy;
  rdhxKW: number;
  rdhxDtF: number;
  cduKW: number;
  cduRed: Redundancy;
  fwDtF: number;
  /** Technology cooling system flow (L/min per kW). */
  tcsLpm: number;
  dlcRej: "drycooler" | "chiller";
  chKWton: number;
  margin: number;
  /** Dry cooler fan power (kW per kW rejected). */
  dryKWkW: number;
  /** CDU pump power (kW per kW liquid). */
  cduPump: number;
  /** Design ambient (°F). */
  ambF: number;
  upsEff: number;
}

export interface CableRules {
  /** Vertical + in-rack length added at each end (m). */
  perEnd: number;
  slack: number;
  /** Tray-to-tray junction snap distance (m). */
  tol: number;
  /** Max rack-to-tray offset for a rack to attach (m). */
  maxDrop: number;
  fillMax: number;
}

export interface Scenario {
  id: string;
  name: string;
  notes: string;
  /** Multiplier on library kW for design load. */
  loadFactor: number;
  racks: Rack[];
  hacs: Hac[];
  trays: Tray[];
  coolers: Cooler[];
  electrical: Electrical;
  cool: CoolingBasis;
  cable: CableRules;
  /** Network systems; absent = the defaults (one per cable type). */
  nets?: NetSystem[];
  /** How the layout was set up, when a generator built it (for "Edit setup"). */
  setup?: ScenarioSetup;
}

/** The answers a generator was given, and a fingerprint of what it built. */
export interface ScenarioSetup {
  kind: "nvl72" | "block";
  /** The generator's options (Nvl72PodOptions or GenOptions). */
  options: Record<string, unknown>;
  /** Fingerprint of the generated layout and single line; differs once the user edits them. */
  built: string;
  /** ISO time it was built. */
  at: string;
}

export interface ElecBasis {
  vLL: number;
  vLN: number;
  /** PSU power factor. */
  pf: number;
  /** Continuous-load derate. */
  derate: number;
}

/** A scaled background drawing. The file itself lives in storage, not the doc. */
export interface Background {
  kind: "image" | "dxf";
  name: string;
  /** Storage object path of what is drawn (owner-scoped). Absent = kept for this session only. */
  path?: string;
  /** Storage object path of the original upload (a PDF re-renders other pages from it). */
  src?: string;
  /** Page shown, for a PDF source. */
  page?: number;
  pages?: number;
  /** Pixel size of an image background. */
  w?: number;
  h?: number;
  /** Metres per pixel (image) or per drawing unit (DXF). */
  scale: number;
  x: number;
  y: number;
  rot: number;
  opacity: number;
  /** Render scale a PDF page was rasterised at. */
  renderScale?: number;
  /** PDF sheet scale key (see PDF_SCALES). */
  pdfScale?: string;
}

export interface RacklineProject {
  schemaVersion: number;
  name: string;
  units: Units;
  lib: LibItem[];
  elec: ElecBasis;
  bg: Background | null;
  scenarios: Scenario[];
  active: string;
}

// ── Analysis results (computed, never persisted) ─────────────────────────────

export interface StripeResult {
  /** Phase current limit after derate (A). */
  lim: number;
  /** [feed][pdu][phase] current (A), normal operation. */
  norm: Record<Feed, number[][]>;
  /** Same, with the other feed lost. */
  fail: Record<Feed, number[][]>;
  maxN: number;
  maxF: number;
  /** Worst feed-loss phase current ÷ limit. */
  util: number;
  imb: number;
  /** kW one PDU carries at the derate. */
  capKW: number;
  warns: string[];
  pdu: { name: string; amps: number };
  n: number;
}

export interface RackResult {
  r: Rack;
  it: number;
  liq: number;
  air: number;
  door: number;
  room: number;
  contained: boolean;
  u: number;
  nodes: number;
  st: StripeResult;
  warn: string[];
  cfm: number;
  gpm: number;
}

export interface ElecResult {
  n: ElecNode;
  /** kVA normal, A-feed lost, B-feed lost. */
  nl: number;
  a: number;
  b: number;
  design: number;
  cap: number | null;
  util: number;
  /** Secondary symmetrical fault current (kA), transformers only. */
  isc?: number;
  racks: { x: RackResult; f: Feed }[];
}

export interface CableGroup {
  from: Rack;
  to: Rack;
  /** Network system (NetSystem id). */
  net: string;
  /** Endpoint to leaf, or leaf to spine. */
  link: "access" | "uplink";
  type: CableType;
  count: number;
  len: number;
  std: number;
  via: "in-rack" | "tray" | "direct";
}

export interface TraySeg {
  t: Tray;
  i: number;
  a: Vec;
  b: Vec;
  area: number;
  fill: number;
}

export interface CableResult {
  groups: CableGroup[];
  total: number;
  count: number;
  segs: TraySeg[];
  noPath: number;
}

export interface Check {
  sev: "bad" | "warn";
  msg: string;
}

export interface Analysis {
  s: Scenario;
  racks: RackResult[];
  it: number;
  liq: number;
  air: number;
  door: number;
  room: number;
  nodes: number;
  roomCFM: number;
  crahN: number;
  crahTot: number;
  crahPlaced: number;
  rdhxN: number;
  rdhxGPM: number;
  cduN: number;
  cduTot: number;
  fwGPM: number;
  tcsLPM: number;
  tons: number;
  dryKW: number;
  mechKW: number;
  lossKW: number;
  pue: number;
  /** Planning footprint (m²). */
  area: number;
  maxRack: number;
  pduWorst: number;
  elec: Record<string, ElecResult>;
  cab: CableResult;
  warns: Check[];
}
