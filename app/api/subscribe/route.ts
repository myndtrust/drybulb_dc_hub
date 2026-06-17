import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Adds a subscriber to a Resend Audience (reuses the Resend account already set
// up for the contact form). Configure:
//   RESEND_API_KEY      — same key as the contact form
//   RESEND_AUDIENCE_ID  — create an Audience in Resend and copy its ID
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: NextRequest) {
  if (!(await checkRateLimit(`subscribe:${clientIp(request)}`))) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Honeypot: real users never fill this. Pretend success so bots get no signal.
  if (clean(payload.website, 200)) {
    return NextResponse.json({ ok: true });
  }

  const email = clean(payload.email, 200);
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const audienceId = process.env.RESEND_AUDIENCE_ID;
  if (!apiKey || !audienceId) {
    console.error("[subscribe] Not configured (RESEND_API_KEY / RESEND_AUDIENCE_ID).");
    return NextResponse.json(
      { error: "Newsletter signup isn't available right now. Please try again later." },
      { status: 503 },
    );
  }

  try {
    const res = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[subscribe] Resend error:", res.status, detail);
      return NextResponse.json(
        { error: "We couldn't sign you up. Please try again." },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[subscribe] Resend request failed:", err);
    return NextResponse.json(
      { error: "We couldn't sign you up. Please try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
