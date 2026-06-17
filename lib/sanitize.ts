import sanitizeHtml from "sanitize-html";

// Defense-in-depth for the jobs feed: even though the scraper sanitizes at
// ingest (scrapers/datacenter_jobs/clean.py), we re-sanitize at render so the
// site never fully trusts the external feed. Allowlist mirrors clean.py:
// formatting-only tags, links restricted to http/https and forced to open
// safely. Everything else (scripts, styles, handlers, iframes, img) is removed.
const JOB_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "ul", "ol", "li",
    "h2", "h3", "h4",
    "strong", "b", "em", "i", "u",
    "blockquote", "a",
  ],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https"],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: "a",
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        target: "_blank",
        rel: "noopener noreferrer",
      },
    }),
  },
};

/** Return a safe, formatting-only HTML subset suitable for dangerouslySetInnerHTML. */
export function sanitizeJobHtml(html: string): string {
  if (!html) return "";
  return sanitizeHtml(html, JOB_HTML_OPTIONS);
}
