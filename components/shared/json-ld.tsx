// Escape the characters that could break out of the <script> element (e.g. a
// "</script>" inside a string) so inline JSON-LD can't be used for injection.
// (ld+json is not executed as JS, so only <, >, & need escaping.)
function safeJsonLd(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(
    /[<>&]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }}
    />
  );
}
