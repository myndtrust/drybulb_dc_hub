// AUTO-GENERATED from data/rack-specs.json by scripts/rack_specs.py.
// Do NOT edit by hand — edit the JSON and run `python scripts/rack_specs.py build`.

export interface RackPower {
  rack_kw: number; peak_kw?: number; voltage_v: number;
  phase: "3ph-ac" | "dc-busbar"; delivery: "vertical-busbar" | "whip-rpp" | "busway-tap";
  feeds: number; redundancy: "N" | "N+1" | "2N" | "2N+1" | "4-to-make-3" | "3-to-make-2";
  circuit_amps: number; circuit_size: string;
  connector: string; rack_pdu: string;
}
export interface RackCooling {
  type: "liquid-dlc" | "hybrid" | "air"; liquid_fraction: number; coolant: string;
  flow_lpm: number; supply_c: number; return_c: number; delta_c: number;
  manifold: string; air_cfm: number; air_supply_c: number;
}
export interface RackNetwork {
  fabric_ew: string; racks_per_su: number; leaf_per_rack: number; spine_per_su: number;
  storage_per_su: number; mgmt_per_su: number; fabric_ns: string;
}
export interface RackSpec {
  key: string; label: string; vendor: string; family: string;
  accel_model: string; accel_per_rack: number; gpus_per_rack: number;
  power: RackPower; cooling: RackCooling; network: RackNetwork;
  confidence: "sourced" | "estimate"; source: string;
}

export const RACK_SPECS: RackSpec[] = [
  {
    "key": "h100",
    "label": "NVIDIA DGX/HGX H100 (air)",
    "vendor": "NVIDIA",
    "family": "Hopper",
    "accel_model": "H100 SXM5",
    "accel_per_rack": 32,
    "gpus_per_rack": 32,
    "power": {
      "rack_kw": 40,
      "peak_kw": 44,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "whip-rpp",
      "feeds": 3,
      "redundancy": "3-to-make-2",
      "circuit_amps": 60,
      "circuit_size": "3× 60 A · 415 V 3φ (N+1) rPDU",
      "connector": "IEC 60309 60 A 3φ → rPDU",
      "rack_pdu": "3× metered 3φ rPDU (A/B/C)"
    },
    "cooling": {
      "type": "air",
      "liquid_fraction": 0.0,
      "coolant": "n/a",
      "flow_lpm": 0,
      "supply_c": 24,
      "return_c": 35,
      "delta_c": 11,
      "manifold": "n/a (hot-aisle containment)",
      "air_cfm": 6000,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "InfiniBand NDR (Quantum-2)",
      "racks_per_su": 8,
      "leaf_per_rack": 2,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "Spectrum Ethernet (front-end/storage)"
    },
    "confidence": "sourced",
    "source": "nvidia_h100"
  },
  {
    "key": "gb200-nvl72",
    "label": "NVIDIA GB200 NVL72 (liquid)",
    "vendor": "NVIDIA",
    "family": "Blackwell",
    "accel_model": "GB200 (Blackwell)",
    "accel_per_rack": 72,
    "gpus_per_rack": 72,
    "power": {
      "rack_kw": 120,
      "peak_kw": 132,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "whip-rpp",
      "feeds": 6,
      "redundancy": "4-to-make-3",
      "circuit_amps": 60,
      "circuit_size": "6× 60 A power-shelf whips · 415 V 3φ → DC busbar (OCP ORv3 HPR)",
      "connector": "IEC 60309 415 V 60 A → power shelf",
      "rack_pdu": "6× 415 V 60 A power shelves + DC busbar"
    },
    "cooling": {
      "type": "liquid-dlc",
      "liquid_fraction": 0.9,
      "coolant": "PG25",
      "flow_lpm": 110,
      "supply_c": 45,
      "return_c": 60,
      "delta_c": 15,
      "manifold": "2× 1.5\" blind-mate QD (supply/return)",
      "air_cfm": 1500,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "InfiniBand NDR/XDR (Quantum-X800)",
      "racks_per_su": 8,
      "leaf_per_rack": 2,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "Spectrum-X Ethernet (front-end/storage)"
    },
    "confidence": "sourced",
    "source": "nvidia_gb200"
  },
  {
    "key": "gb300-nvl72",
    "label": "NVIDIA GB300 NVL72 (liquid)",
    "vendor": "NVIDIA",
    "family": "Blackwell Ultra",
    "accel_model": "GB300 (Blackwell Ultra / B300)",
    "accel_per_rack": 72,
    "gpus_per_rack": 72,
    "power": {
      "rack_kw": 137,
      "peak_kw": 155,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "whip-rpp",
      "feeds": 8,
      "redundancy": "4-to-make-3",
      "circuit_amps": 60,
      "circuit_size": "8× 60 A whips · 415 V 3φ → DC busbar (EDPP)",
      "connector": "60 A whip (IEC 60309) → power shelf / EDPP",
      "rack_pdu": "6–8× 415 V 60 A power shelves + DC busbar (EDPP)"
    },
    "cooling": {
      "type": "liquid-dlc",
      "liquid_fraction": 1.0,
      "coolant": "PG25",
      "flow_lpm": 130,
      "supply_c": 40,
      "return_c": 58,
      "delta_c": 18,
      "manifold": "2× 1.5\" blind-mate QD (supply/return)",
      "air_cfm": 800,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "InfiniBand XDR (Quantum-X800)",
      "racks_per_su": 8,
      "leaf_per_rack": 2,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "Spectrum-X Ethernet (front-end/storage)"
    },
    "confidence": "sourced",
    "source": "nvidia_gb300"
  },
  {
    "key": "vr200-nvl144",
    "label": "NVIDIA Vera Rubin VR200 NVL72 (liquid)",
    "vendor": "NVIDIA",
    "family": "Rubin",
    "accel_model": "Rubin (VR200)",
    "accel_per_rack": 144,
    "gpus_per_rack": 144,
    "power": {
      "rack_kw": 200,
      "peak_kw": 230,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "whip-rpp",
      "feeds": 8,
      "redundancy": "4-to-make-3",
      "circuit_amps": 100,
      "circuit_size": "8× 100 A whips · 415 V 3φ → DC busbar",
      "connector": "100 A whip (IEC 60309) → power shelf / busbar",
      "rack_pdu": "415 V 100 A power shelves + DC busbar (800 VDC arrives with Kyber/Rubin Ultra)"
    },
    "cooling": {
      "type": "liquid-dlc",
      "liquid_fraction": 1.0,
      "coolant": "PG25",
      "flow_lpm": 220,
      "supply_c": 45,
      "return_c": 62,
      "delta_c": 17,
      "manifold": "2× 2\" blind-mate QD (supply/return)",
      "air_cfm": 600,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "InfiniBand XDR / Spectrum-X (Quantum-X)",
      "racks_per_su": 8,
      "leaf_per_rack": 2,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "Spectrum-X Ethernet (front-end/storage)"
    },
    "confidence": "estimate",
    "source": "nvidia_rubin"
  },
  {
    "key": "amd-mi355x",
    "label": "AMD Instinct MI355X GIGAPOD (liquid)",
    "vendor": "AMD",
    "family": "CDNA 4",
    "accel_model": "Instinct MI355X",
    "accel_per_rack": 64,
    "gpus_per_rack": 64,
    "power": {
      "rack_kw": 120,
      "peak_kw": 132,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "busway-tap",
      "feeds": 6,
      "redundancy": "N+1",
      "circuit_amps": 60,
      "circuit_size": "6× 60 A · 415 V 3φ → busbar",
      "connector": "Busway tap-off / power shelf",
      "rack_pdu": "Rack power shelves"
    },
    "cooling": {
      "type": "liquid-dlc",
      "liquid_fraction": 0.9,
      "coolant": "PG25",
      "flow_lpm": 100,
      "supply_c": 40,
      "return_c": 55,
      "delta_c": 15,
      "manifold": "2× 1.5\" QD (supply/return)",
      "air_cfm": 1500,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "Ultra Ethernet / RoCE (Pollara)",
      "racks_per_su": 8,
      "leaf_per_rack": 2,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "Ethernet (front-end/storage)"
    },
    "confidence": "sourced",
    "source": "amd_mi355x"
  },
  {
    "key": "tpu-ironwood",
    "label": "Google TPU v7 Ironwood (liquid)",
    "vendor": "Google",
    "family": "TPU v7",
    "accel_model": "TPU v7 (Ironwood)",
    "accel_per_rack": 64,
    "gpus_per_rack": 64,
    "power": {
      "rack_kw": 90,
      "peak_kw": 105,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "busway-tap",
      "feeds": 4,
      "redundancy": "N+1",
      "circuit_amps": 60,
      "circuit_size": "4× 60 A · 415 V 3φ → busbar",
      "connector": "Busway tap-off",
      "rack_pdu": "Rack power shelves"
    },
    "cooling": {
      "type": "liquid-dlc",
      "liquid_fraction": 0.95,
      "coolant": "water",
      "flow_lpm": 100,
      "supply_c": 30,
      "return_c": 45,
      "delta_c": 15,
      "manifold": "2× 1.5\" QD (supply/return)",
      "air_cfm": 1000,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "Optical Circuit Switch (OCS) 3D torus",
      "racks_per_su": 16,
      "leaf_per_rack": 1,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "Jupiter Ethernet (front-end/storage)"
    },
    "confidence": "estimate",
    "source": "google_tpu"
  },
  {
    "key": "trainium2",
    "label": "AWS Trainium2 / Trn2-Ultra (air)",
    "vendor": "AWS",
    "family": "Trainium2",
    "accel_model": "Trainium2 (Trn2)",
    "accel_per_rack": 32,
    "gpus_per_rack": 32,
    "power": {
      "rack_kw": 27,
      "peak_kw": 32,
      "voltage_v": 415,
      "phase": "3ph-ac",
      "delivery": "busway-tap",
      "feeds": 3,
      "redundancy": "N+1",
      "circuit_amps": 60,
      "circuit_size": "3× 60 A · 415 V 3φ (N+1)",
      "connector": "Busway tap-off / rPDU",
      "rack_pdu": "Rack PDUs"
    },
    "cooling": {
      "type": "air",
      "liquid_fraction": 0.0,
      "coolant": "n/a",
      "flow_lpm": 0,
      "supply_c": 24,
      "return_c": 35,
      "delta_c": 11,
      "manifold": "n/a (rear-door / hot-aisle)",
      "air_cfm": 4500,
      "air_supply_c": 24
    },
    "network": {
      "fabric_ew": "NeuronLink / EFA (Elastic Fabric Adapter)",
      "racks_per_su": 8,
      "leaf_per_rack": 2,
      "spine_per_su": 4,
      "storage_per_su": 2,
      "mgmt_per_su": 2,
      "fabric_ns": "EFA Ethernet (front-end/storage)"
    },
    "confidence": "estimate",
    "source": "aws_trainium"
  }
];

export const RACK_SPEC_BY_KEY: Record<string, RackSpec> = Object.fromEntries(
  RACK_SPECS.map((r) => [r.key, r]),
);
