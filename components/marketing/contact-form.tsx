"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ENGAGEMENT_OPTIONS } from "@/lib/engagements";

const fieldClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-ring focus-visible:ring-offset-2";

const labelClass = "block text-sm font-medium mb-1.5";

type Status = "idle" | "submitting" | "success" | "error";

export function ContactForm({ defaultEngagement = "general" }: { defaultEngagement?: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setError(null);

    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Something went wrong. Please try again.");
      }
      setStatus("success");
      form.reset();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return (
      <div className="rounded-lg border border-border/60 bg-muted/40 px-6 py-8">
        <p className="font-semibold mb-1">Thanks — your message is on its way.</p>
        <p className="text-sm text-muted-foreground">
          I read every inquiry personally and will get back to you, usually within a
          couple of business days.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Honeypot — hidden from humans, catches naive bots. */}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="name" className={labelClass}>
            Name <span className="text-muted-foreground">*</span>
          </label>
          <input id="name" name="name" type="text" required className={fieldClass} />
        </div>
        <div>
          <label htmlFor="email" className={labelClass}>
            Email <span className="text-muted-foreground">*</span>
          </label>
          <input id="email" name="email" type="email" required className={fieldClass} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="company" className={labelClass}>
            Company / organization
          </label>
          <input id="company" name="company" type="text" className={fieldClass} />
        </div>
        <div>
          <label htmlFor="engagement" className={labelClass}>
            What's this about?
          </label>
          <select
            id="engagement"
            name="engagement"
            defaultValue={defaultEngagement}
            className={fieldClass}
          >
            {ENGAGEMENT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="message" className={labelClass}>
          Message <span className="text-muted-foreground">*</span>
        </label>
        <textarea
          id="message"
          name="message"
          required
          rows={6}
          placeholder="The asset or decision, the engineering question, and the timeline."
          className={fieldClass}
        />
      </div>

      {status === "error" && error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Button type="submit" size="lg" disabled={status === "submitting"}>
        {status === "submitting" ? "Sending…" : "Send message"}
      </Button>
    </form>
  );
}
