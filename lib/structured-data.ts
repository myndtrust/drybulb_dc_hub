// ─────────────────────────────────────────────────────────────────────────────
// Schema.org structured data (JSON-LD) helpers — emitted via <JsonLd>.
//
// Organization + WebSite are emitted site-wide (in the marketing layout); the
// founder Person is emitted on the author page and referenced by @id from the
// Organization and from each Article's author. Stable @id values let search and
// AI crawlers resolve one canonical entity graph across pages (strong E-E-A-T).
// ─────────────────────────────────────────────────────────────────────────────

import { siteConfig } from "./metadata";

export const ORG_ID = `${siteConfig.url}/#organization`;
export const WEBSITE_ID = `${siteConfig.url}/#website`;
export const FOUNDER_ID = `${siteConfig.url}/authors/founder#person`;

/** Public profiles for the brand. Empty entries are dropped from `sameAs`. */
function orgSameAs(): string[] {
  return [siteConfig.linkedin, siteConfig.x, siteConfig.github].filter(
    (u): u is string => Boolean(u),
  );
}

export function organizationSchema(): Record<string, unknown> {
  const sameAs = orgSameAs();
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    logo: `${siteConfig.url}/api/og?title=${encodeURIComponent(siteConfig.name)}`,
    founder: { "@id": FOUNDER_ID },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteSchema(): Record<string, unknown> {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    inLanguage: "en-US",
    publisher: { "@id": ORG_ID },
  };
}

/** Site-wide entity graph (Organization + WebSite) for the marketing layout. */
export function siteGraph(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(), websiteSchema()],
  };
}

export interface AuthorLike {
  name: string;
  slug: string;
  role?: string;
  bio?: string;
  expertise?: string[];
  links?: { twitter?: string; linkedin?: string; website?: string };
}

/** Person schema for an author. The founder carries explicit PE / D.Des credentials. */
export function personSchema(author: AuthorLike): Record<string, unknown> {
  const sameAs = [author.links?.linkedin, author.links?.twitter, author.links?.website].filter(
    (u): u is string => Boolean(u && u.length),
  );
  const isFounder = author.slug === "founder";
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${siteConfig.url}/authors/${author.slug}#person`,
    name: author.name,
    url: `${siteConfig.url}/authors/${author.slug}`,
    ...(author.role ? { jobTitle: author.role } : {}),
    ...(author.bio ? { description: author.bio } : {}),
    ...(author.expertise?.length ? { knowsAbout: author.expertise } : {}),
    ...(isFounder
      ? {
          hasCredential: [
            {
              "@type": "EducationalOccupationalCredential",
              credentialCategory: "license",
              name: "Professional Engineer (PE)",
            },
            {
              "@type": "EducationalOccupationalCredential",
              credentialCategory: "degree",
              name: "Doctor of Design (D.Des)",
            },
          ],
        }
      : {}),
    worksFor: { "@id": ORG_ID },
    ...(sameAs.length ? { sameAs } : {}),
  };
}
