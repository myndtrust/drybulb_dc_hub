import type { NextRequest } from "next/server";

const NASA_POWER_BASE =
  "https://power.larc.nasa.gov/api/temporal/climatology/point";

const PARAMS = "T2M,T2MDEW,T2MWET,RH2M";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return Response.json(
      { error: "lat and lon query parameters are required" },
      { status: 400 }
    );
  }

  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);

  if (isNaN(latNum) || isNaN(lonNum)) {
    return Response.json(
      { error: "lat and lon must be valid numbers" },
      { status: 400 }
    );
  }

  if (latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
    return Response.json(
      { error: "lat must be [-90,90], lon must be [-180,180]" },
      { status: 400 }
    );
  }

  const url = `${NASA_POWER_BASE}?parameters=${PARAMS}&community=RE&longitude=${lonNum}&latitude=${latNum}&format=JSON`;

  try {
    const res = await fetch(url, {
      next: { revalidate: 86400 }, // cache for 24 hours
    });

    if (!res.ok) {
      return Response.json(
        { error: `NASA POWER API returned ${res.status}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    const params = data?.properties?.parameter;

    if (!params) {
      return Response.json(
        { error: "Unexpected response structure from NASA POWER" },
        { status: 502 }
      );
    }

    return Response.json({
      T2M: params.T2M,
      T2MWET: params.T2MWET,
      T2MDEW: params.T2MDEW,
      RH2M: params.RH2M,
      meta: {
        source: "NASA POWER — MERRA-2",
        period: "20-year climatology (2001–2020)",
        lat: latNum,
        lon: lonNum,
      },
    });
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch weather data" },
      { status: 502 }
    );
  }
}
