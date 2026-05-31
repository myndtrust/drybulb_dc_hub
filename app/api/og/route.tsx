import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const title = searchParams.get("title") ?? "Drybulb";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          width: "100%",
          height: "100%",
          backgroundColor: "#0a0a0a",
          padding: "60px",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: "14px",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: "20px",
          }}
        >
          drybulb.com
        </div>
        <div
          style={{
            fontSize: title.length > 60 ? "36px" : "48px",
            fontWeight: "700",
            color: "#f9fafb",
            lineHeight: 1.2,
            maxWidth: "900px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            marginTop: "24px",
            fontSize: "16px",
            color: "#9ca3af",
          }}
        >
          AI Factory Engineering — By the Engineers Who Build Them
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
