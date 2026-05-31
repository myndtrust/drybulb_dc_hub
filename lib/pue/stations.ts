import type { Station } from "./types";

/**
 * Curated list of US locations for PUE calculations.
 * Includes major data center markets and representative cities across all states.
 * Coordinates sourced from airport/city center positions.
 */
export const STATIONS: Station[] = [
  // ── Alaska ──
  { id: "AK-ANC", name: "Anchorage", state: "Alaska", stateCode: "AK", lat: 61.17, lon: -150.02 },
  { id: "AK-FAI", name: "Fairbanks", state: "Alaska", stateCode: "AK", lat: 64.82, lon: -147.86 },
  { id: "AK-JNU", name: "Juneau", state: "Alaska", stateCode: "AK", lat: 58.36, lon: -134.58 },

  // ── Alabama ──
  { id: "AL-BHM", name: "Birmingham", state: "Alabama", stateCode: "AL", lat: 33.56, lon: -86.75 },
  { id: "AL-HSV", name: "Huntsville", state: "Alabama", stateCode: "AL", lat: 34.64, lon: -86.78 },
  { id: "AL-MOB", name: "Mobile", state: "Alabama", stateCode: "AL", lat: 30.69, lon: -88.25 },

  // ── Arizona ──
  { id: "AZ-PHX", name: "Phoenix", state: "Arizona", stateCode: "AZ", lat: 33.43, lon: -112.01, dcMarket: true },
  { id: "AZ-TUS", name: "Tucson", state: "Arizona", stateCode: "AZ", lat: 32.12, lon: -110.94 },
  { id: "AZ-MSA", name: "Mesa", state: "Arizona", stateCode: "AZ", lat: 33.41, lon: -111.83, dcMarket: true },
  { id: "AZ-FLG", name: "Flagstaff", state: "Arizona", stateCode: "AZ", lat: 35.14, lon: -111.67 },

  // ── Arkansas ──
  { id: "AR-LIT", name: "Little Rock", state: "Arkansas", stateCode: "AR", lat: 34.73, lon: -92.22 },
  { id: "AR-FYV", name: "Fayetteville", state: "Arkansas", stateCode: "AR", lat: 36.01, lon: -94.17 },

  // ── California ──
  { id: "CA-SJC", name: "San Jose / Silicon Valley", state: "California", stateCode: "CA", lat: 37.36, lon: -121.93, dcMarket: true },
  { id: "CA-LAX", name: "Los Angeles", state: "California", stateCode: "CA", lat: 33.94, lon: -118.41, dcMarket: true },
  { id: "CA-SFO", name: "San Francisco", state: "California", stateCode: "CA", lat: 37.62, lon: -122.38 },
  { id: "CA-SAC", name: "Sacramento", state: "California", stateCode: "CA", lat: 38.70, lon: -121.59, dcMarket: true },
  { id: "CA-SAN", name: "San Diego", state: "California", stateCode: "CA", lat: 32.73, lon: -117.19 },
  { id: "CA-OAK", name: "Oakland", state: "California", stateCode: "CA", lat: 37.72, lon: -122.22 },
  { id: "CA-SMF", name: "Santa Clara", state: "California", stateCode: "CA", lat: 37.35, lon: -121.95, dcMarket: true },
  { id: "CA-FAT", name: "Fresno", state: "California", stateCode: "CA", lat: 36.78, lon: -119.72 },

  // ── Colorado ──
  { id: "CO-DEN", name: "Denver", state: "Colorado", stateCode: "CO", lat: 39.86, lon: -104.67, dcMarket: true },
  { id: "CO-COS", name: "Colorado Springs", state: "Colorado", stateCode: "CO", lat: 38.81, lon: -104.70 },

  // ── Connecticut ──
  { id: "CT-BDL", name: "Hartford", state: "Connecticut", stateCode: "CT", lat: 41.94, lon: -72.68 },
  { id: "CT-BDR", name: "Bridgeport", state: "Connecticut", stateCode: "CT", lat: 41.16, lon: -73.13 },

  // ── Delaware ──
  { id: "DE-ILG", name: "Wilmington", state: "Delaware", stateCode: "DE", lat: 39.68, lon: -75.61 },

  // ── Florida ──
  { id: "FL-MIA", name: "Miami", state: "Florida", stateCode: "FL", lat: 25.79, lon: -80.29, dcMarket: true },
  { id: "FL-JAX", name: "Jacksonville", state: "Florida", stateCode: "FL", lat: 30.49, lon: -81.69 },
  { id: "FL-TPA", name: "Tampa", state: "Florida", stateCode: "FL", lat: 27.98, lon: -82.53 },
  { id: "FL-MCO", name: "Orlando", state: "Florida", stateCode: "FL", lat: 28.43, lon: -81.31 },

  // ── Georgia ──
  { id: "GA-ATL", name: "Atlanta", state: "Georgia", stateCode: "GA", lat: 33.64, lon: -84.43, dcMarket: true },
  { id: "GA-SAV", name: "Savannah", state: "Georgia", stateCode: "GA", lat: 32.13, lon: -81.20 },

  // ── Hawaii ──
  { id: "HI-HNL", name: "Honolulu", state: "Hawaii", stateCode: "HI", lat: 21.32, lon: -157.92 },

  // ── Idaho ──
  { id: "ID-BOI", name: "Boise", state: "Idaho", stateCode: "ID", lat: 43.57, lon: -116.22 },

  // ── Illinois ──
  { id: "IL-ORD", name: "Chicago", state: "Illinois", stateCode: "IL", lat: 41.98, lon: -87.90, dcMarket: true },
  { id: "IL-SPI", name: "Springfield", state: "Illinois", stateCode: "IL", lat: 39.84, lon: -89.68 },

  // ── Indiana ──
  { id: "IN-IND", name: "Indianapolis", state: "Indiana", stateCode: "IN", lat: 39.72, lon: -86.29 },
  { id: "IN-FWA", name: "Fort Wayne", state: "Indiana", stateCode: "IN", lat: 40.98, lon: -85.19 },

  // ── Iowa ──
  { id: "IA-DSM", name: "Des Moines", state: "Iowa", stateCode: "IA", lat: 41.53, lon: -93.66, dcMarket: true },
  { id: "IA-CID", name: "Cedar Rapids", state: "Iowa", stateCode: "IA", lat: 41.88, lon: -91.71 },

  // ── Kansas ──
  { id: "KS-ICT", name: "Wichita", state: "Kansas", stateCode: "KS", lat: 37.65, lon: -97.43 },
  { id: "KS-MCI", name: "Kansas City", state: "Kansas", stateCode: "KS", lat: 39.30, lon: -94.71, dcMarket: true },

  // ── Kentucky ──
  { id: "KY-SDF", name: "Louisville", state: "Kentucky", stateCode: "KY", lat: 38.17, lon: -85.74 },
  { id: "KY-LEX", name: "Lexington", state: "Kentucky", stateCode: "KY", lat: 38.04, lon: -84.61 },

  // ── Louisiana ──
  { id: "LA-MSY", name: "New Orleans", state: "Louisiana", stateCode: "LA", lat: 29.99, lon: -90.26 },
  { id: "LA-BTR", name: "Baton Rouge", state: "Louisiana", stateCode: "LA", lat: 30.53, lon: -91.15 },

  // ── Maine ──
  { id: "ME-PWM", name: "Portland", state: "Maine", stateCode: "ME", lat: 43.65, lon: -70.31 },

  // ── Maryland ──
  { id: "MD-BWI", name: "Baltimore", state: "Maryland", stateCode: "MD", lat: 39.18, lon: -76.67 },

  // ── Massachusetts ──
  { id: "MA-BOS", name: "Boston", state: "Massachusetts", stateCode: "MA", lat: 42.36, lon: -71.01, dcMarket: true },

  // ── Michigan ──
  { id: "MI-DTW", name: "Detroit", state: "Michigan", stateCode: "MI", lat: 42.21, lon: -83.35 },
  { id: "MI-GRR", name: "Grand Rapids", state: "Michigan", stateCode: "MI", lat: 42.88, lon: -85.52 },

  // ── Minnesota ──
  { id: "MN-MSP", name: "Minneapolis", state: "Minnesota", stateCode: "MN", lat: 44.88, lon: -93.22, dcMarket: true },

  // ── Mississippi ──
  { id: "MS-JAN", name: "Jackson", state: "Mississippi", stateCode: "MS", lat: 32.31, lon: -90.08 },

  // ── Missouri ──
  { id: "MO-STL", name: "St. Louis", state: "Missouri", stateCode: "MO", lat: 38.75, lon: -90.37 },
  { id: "MO-MCI", name: "Kansas City", state: "Missouri", stateCode: "MO", lat: 39.30, lon: -94.71, dcMarket: true },

  // ── Montana ──
  { id: "MT-BIL", name: "Billings", state: "Montana", stateCode: "MT", lat: 45.81, lon: -108.54 },

  // ── Nebraska ──
  { id: "NE-OMA", name: "Omaha", state: "Nebraska", stateCode: "NE", lat: 41.30, lon: -95.89, dcMarket: true },
  { id: "NE-LNK", name: "Lincoln", state: "Nebraska", stateCode: "NE", lat: 40.85, lon: -96.76 },

  // ── Nevada ──
  { id: "NV-LAS", name: "Las Vegas", state: "Nevada", stateCode: "NV", lat: 36.08, lon: -115.15, dcMarket: true },
  { id: "NV-RNO", name: "Reno", state: "Nevada", stateCode: "NV", lat: 39.50, lon: -119.78, dcMarket: true },

  // ── New Hampshire ──
  { id: "NH-MHT", name: "Manchester", state: "New Hampshire", stateCode: "NH", lat: 42.93, lon: -71.44 },

  // ── New Jersey ──
  { id: "NJ-EWR", name: "Newark / N. New Jersey", state: "New Jersey", stateCode: "NJ", lat: 40.69, lon: -74.17, dcMarket: true },
  { id: "NJ-ACY", name: "Atlantic City", state: "New Jersey", stateCode: "NJ", lat: 39.46, lon: -74.58 },

  // ── New Mexico ──
  { id: "NM-ABQ", name: "Albuquerque", state: "New Mexico", stateCode: "NM", lat: 35.04, lon: -106.61 },

  // ── New York ──
  { id: "NY-JFK", name: "New York City", state: "New York", stateCode: "NY", lat: 40.64, lon: -73.78, dcMarket: true },
  { id: "NY-BUF", name: "Buffalo", state: "New York", stateCode: "NY", lat: 42.94, lon: -78.74 },
  { id: "NY-SYR", name: "Syracuse", state: "New York", stateCode: "NY", lat: 43.11, lon: -76.11 },

  // ── North Carolina ──
  { id: "NC-CLT", name: "Charlotte", state: "North Carolina", stateCode: "NC", lat: 35.21, lon: -80.94, dcMarket: true },
  { id: "NC-RDU", name: "Raleigh-Durham", state: "North Carolina", stateCode: "NC", lat: 35.88, lon: -78.79, dcMarket: true },

  // ── North Dakota ──
  { id: "ND-FAR", name: "Fargo", state: "North Dakota", stateCode: "ND", lat: 46.92, lon: -96.82 },

  // ── Ohio ──
  { id: "OH-CMH", name: "Columbus", state: "Ohio", stateCode: "OH", lat: 39.99, lon: -82.89, dcMarket: true },
  { id: "OH-CLE", name: "Cleveland", state: "Ohio", stateCode: "OH", lat: 41.41, lon: -81.85 },
  { id: "OH-CVG", name: "Cincinnati", state: "Ohio", stateCode: "OH", lat: 39.05, lon: -84.67 },

  // ── Oklahoma ──
  { id: "OK-OKC", name: "Oklahoma City", state: "Oklahoma", stateCode: "OK", lat: 35.39, lon: -97.60 },
  { id: "OK-TUL", name: "Tulsa", state: "Oklahoma", stateCode: "OK", lat: 36.20, lon: -95.89 },

  // ── Oregon ──
  { id: "OR-PDX", name: "Portland", state: "Oregon", stateCode: "OR", lat: 45.59, lon: -122.60, dcMarket: true },
  { id: "OR-HIL", name: "Hillsboro", state: "Oregon", stateCode: "OR", lat: 45.54, lon: -122.95, dcMarket: true },

  // ── Pennsylvania ──
  { id: "PA-PHL", name: "Philadelphia", state: "Pennsylvania", stateCode: "PA", lat: 39.87, lon: -75.23 },
  { id: "PA-PIT", name: "Pittsburgh", state: "Pennsylvania", stateCode: "PA", lat: 40.49, lon: -80.23 },

  // ── Rhode Island ──
  { id: "RI-PVD", name: "Providence", state: "Rhode Island", stateCode: "RI", lat: 41.72, lon: -71.43 },

  // ── South Carolina ──
  { id: "SC-CHS", name: "Charleston", state: "South Carolina", stateCode: "SC", lat: 32.90, lon: -80.04 },
  { id: "SC-GSP", name: "Greenville", state: "South Carolina", stateCode: "SC", lat: 34.90, lon: -82.22 },

  // ── South Dakota ──
  { id: "SD-FSD", name: "Sioux Falls", state: "South Dakota", stateCode: "SD", lat: 43.58, lon: -96.74 },

  // ── Tennessee ──
  { id: "TN-BNA", name: "Nashville", state: "Tennessee", stateCode: "TN", lat: 36.12, lon: -86.68 },
  { id: "TN-MEM", name: "Memphis", state: "Tennessee", stateCode: "TN", lat: 35.04, lon: -89.98 },
  { id: "TN-CHA", name: "Chattanooga", state: "Tennessee", stateCode: "TN", lat: 35.04, lon: -85.20 },

  // ── Texas ──
  { id: "TX-DFW", name: "Dallas-Fort Worth", state: "Texas", stateCode: "TX", lat: 32.90, lon: -97.04, dcMarket: true },
  { id: "TX-IAH", name: "Houston", state: "Texas", stateCode: "TX", lat: 29.98, lon: -95.34, dcMarket: true },
  { id: "TX-SAT", name: "San Antonio", state: "Texas", stateCode: "TX", lat: 29.53, lon: -98.47, dcMarket: true },
  { id: "TX-AUS", name: "Austin", state: "Texas", stateCode: "TX", lat: 30.19, lon: -97.67, dcMarket: true },
  { id: "TX-ELP", name: "El Paso", state: "Texas", stateCode: "TX", lat: 31.81, lon: -106.38 },

  // ── Utah ──
  { id: "UT-SLC", name: "Salt Lake City", state: "Utah", stateCode: "UT", lat: 40.79, lon: -111.98, dcMarket: true },

  // ── Vermont ──
  { id: "VT-BTV", name: "Burlington", state: "Vermont", stateCode: "VT", lat: 44.47, lon: -73.15 },

  // ── Virginia ──
  { id: "VA-IAD", name: "Ashburn / Loudoun County", state: "Virginia", stateCode: "VA", lat: 39.04, lon: -77.49, dcMarket: true },
  { id: "VA-RIC", name: "Richmond", state: "Virginia", stateCode: "VA", lat: 37.51, lon: -77.32, dcMarket: true },
  { id: "VA-ORF", name: "Norfolk / Virginia Beach", state: "Virginia", stateCode: "VA", lat: 36.89, lon: -76.20 },
  { id: "VA-MFR", name: "Manassas", state: "Virginia", stateCode: "VA", lat: 38.72, lon: -77.52, dcMarket: true },

  // ── Washington ──
  { id: "WA-SEA", name: "Seattle", state: "Washington", stateCode: "WA", lat: 47.45, lon: -122.31, dcMarket: true },
  { id: "WA-QCY", name: "Quincy", state: "Washington", stateCode: "WA", lat: 47.23, lon: -119.85, dcMarket: true },
  { id: "WA-GEG", name: "Spokane", state: "Washington", stateCode: "WA", lat: 47.62, lon: -117.53 },
  { id: "WA-MWH", name: "Moses Lake", state: "Washington", stateCode: "WA", lat: 47.21, lon: -119.32, dcMarket: true },

  // ── West Virginia ──
  { id: "WV-CRW", name: "Charleston", state: "West Virginia", stateCode: "WV", lat: 38.37, lon: -81.59 },

  // ── Wisconsin ──
  { id: "WI-MKE", name: "Milwaukee", state: "Wisconsin", stateCode: "WI", lat: 42.95, lon: -87.90 },
  { id: "WI-MSN", name: "Madison", state: "Wisconsin", stateCode: "WI", lat: 43.14, lon: -89.34 },

  // ── Wyoming ──
  { id: "WY-CYS", name: "Cheyenne", state: "Wyoming", stateCode: "WY", lat: 41.15, lon: -104.82, dcMarket: true },

  // ── US Territories ──
  { id: "PR-SJU", name: "San Juan", state: "Puerto Rico", stateCode: "PR", lat: 18.44, lon: -66.00 },
  { id: "GU-GUM", name: "Guam", state: "Guam", stateCode: "GU", lat: 13.48, lon: 144.80 },
];

/** Group stations by state for organized display */
export function getStationsByState(): Map<string, Station[]> {
  const map = new Map<string, Station[]>();
  for (const s of STATIONS) {
    const list = map.get(s.state) ?? [];
    list.push(s);
    map.set(s.state, list);
  }
  return map;
}

/** Filter stations by search query (name, state, or state code) */
export function filterStations(query: string): Station[] {
  const q = query.toLowerCase().trim();
  if (!q) return STATIONS;
  return STATIONS.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.state.toLowerCase().includes(q) ||
      s.stateCode.toLowerCase() === q
  );
}
