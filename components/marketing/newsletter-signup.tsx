"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Status = "idle" | "submitting" | "success" | "error";

type Umami = { track: (event: string, data?: Record<string, unknown>) => void };

export function NewsletterSignup() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }
      const umami = (window as unknown as { umami?: Umami }).umami;
      umami?.track("newsletter-signup");
      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div className="w-full max-w-md">
      <p className="text-sm font-semibold text-foreground mb-1">
        The data center engineering brief
      </p>
      <p className="text-sm text-muted-foreground mb-3">
        Occasional, technical, no fluff. New articles and what I&apos;m seeing in
        AI-factory infrastructure.
      </p>

      {status === "success" ? (
        <p className="text-sm text-foreground">
          Thanks — you&apos;re on the list. Check your inbox to confirm.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
          {/* Honeypot */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="nl-website">Website</label>
            <input id="nl-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
          <input
            name="email"
            type="email"
            required
            placeholder="you@company.com"
            aria-label="Email address"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          <Button type="submit" disabled={status === "submitting"} className="shrink-0">
            {status === "submitting" ? "…" : "Subscribe"}
          </Button>
        </form>
      )}

      {status === "error" && error && (
        <p className="text-sm text-destructive mt-2">{error}</p>
      )}
    </div>
  );
}
