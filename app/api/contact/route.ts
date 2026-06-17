import { NextRequest, NextResponse } from "next/server";
import { ENGAGEMENT_LABELS } from "@/lib/engagements";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// Email delivery via the Resend REST API (no SDK dependency). Configure:
//   RESEND_API_KEY    — Resend API key
//   CONTACT_TO_EMAIL  — where inquiries are delivered (e.g. hello@drybulb.com)
//   CONTACT_FROM_EMAIL — a verified sending address on your Resend domain
const RESEND_ENDPOINT = "https://api.resend.com/emails";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Single-line fields (name/email/company/engagement) must not carry CR/LF, which
// could otherwise be folded into the email subject/headers.
function cleanLine(value: unknown, max: number): string {
  return clean(value, max).replace(/[\r\n]+/g, " ");
}

export async function POST(request: NextRequest) {
  if (!(await checkRateLimit(`contact:${clientIp(request)}`))) {
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

  const name = cleanLine(payload.name, 200);
  const email = cleanLine(payload.email, 200);
  const company = cleanLine(payload.company, 200);
  const message = clean(payload.message, 5000);
  const engagementKey = cleanLine(payload.engagement, 64) || "general";
  const engagement = ENGAGEMENT_LABELS[engagementKey] ?? ENGAGEMENT_LABELS.general;

  if (!name || !email || !message) {
    return NextResponse.json(
      { error: "Name, email, and a message are required." },
      { status: 400 },
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.CONTACT_TO_EMAIL;
  const from = process.env.CONTACT_FROM_EMAIL;
  if (!apiKey || !to || !from) {
    console.error("[contact] Email not configured (RESEND_API_KEY / CONTACT_TO_EMAIL / CONTACT_FROM_EMAIL).");
    return NextResponse.json(
      { error: "The contact form isn't configured yet. Please email hello@drybulb.com directly." },
      { status: 503 },
    );
  }

  const subject = `New inquiry — ${engagement}${company ? ` — ${company}` : ""}`;
  const text = [
    `Engagement: ${engagement}`,
    `Name: ${name}`,
    `Email: ${email}`,
    company ? `Company: ${company}` : null,
    "",
    message,
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, reply_to: email, subject, text }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[contact] Resend error:", res.status, detail);
      return NextResponse.json(
        { error: "We couldn't send your message. Please try again or email hello@drybulb.com." },
        { status: 502 },
      );
    }
  } catch (err) {
    console.error("[contact] Resend request failed:", err);
    return NextResponse.json(
      { error: "We couldn't send your message. Please try again or email hello@drybulb.com." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true });
}
