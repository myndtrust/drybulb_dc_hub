// Engagement types shared across the contact form (client), the contact page
// (server), and the contact API route. Kept in a plain module — not the client
// component — so server components can import the data directly. (Importing a
// data export from a "use client" module yields a client-reference proxy, not
// the value, which breaks array methods like .some().)
export const ENGAGEMENT_OPTIONS = [
  { value: "general", label: "General inquiry" },
  { value: "due-diligence", label: "Technical due diligence (investor / lender)" },
  { value: "owners-engineer", label: "Owner's engineer / design peer review" },
  { value: "sustainability", label: "PUE / sustainability assessment" },
  { value: "expert-witness", label: "Expert witness / litigation support" },
] as const;

export const ENGAGEMENT_LABELS: Record<string, string> = Object.fromEntries(
  ENGAGEMENT_OPTIONS.map((o) => [o.value, o.label]),
);
