import { Metadata } from "next";

export const siteConfig = {
  name: "Drybulb",
  tagline: "AI Factory Engineering — By the Engineers Who Build Them",
  url: "https://www.drybulb.com",
  description:
    "Deep technical writing on AI factory engineering — power, cooling, networking, reliability, and sustainability — for the owners, investors, and engineering teams building AI infrastructure. Plus free tools.",
  twitterHandle: "@drybulb", // TODO: update
};

export function constructMetadata({
  title,
  description,
  image,
  canonicalPath,
  noIndex = false,
}: {
  title?: string;
  description?: string;
  image?: string;
  canonicalPath?: string;
  noIndex?: boolean;
} = {}): Metadata {
  const metaTitle = title
    ? `${title} | ${siteConfig.name}`
    : `${siteConfig.name} — ${siteConfig.tagline}`;
  const metaDescription = description ?? siteConfig.description;
  const metaImage = image ?? `/api/og?title=${encodeURIComponent(metaTitle)}`;
  const canonical = canonicalPath
    ? `${siteConfig.url}${canonicalPath}`
    : siteConfig.url;

  return {
    title: metaTitle,
    description: metaDescription,
    metadataBase: new URL(siteConfig.url),
    alternates: { canonical },
    openGraph: {
      title: metaTitle,
      description: metaDescription,
      url: canonical,
      siteName: siteConfig.name,
      images: [{ url: metaImage, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: metaTitle,
      description: metaDescription,
      images: [metaImage],
      creator: siteConfig.twitterHandle,
    },
    robots: noIndex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  };
}
