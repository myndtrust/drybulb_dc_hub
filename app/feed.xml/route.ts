import { NextResponse } from "next/server";
import { siteConfig } from "@/lib/metadata";

export const dynamic = "force-static";

// TODO: import articles from Velite once content is populated
// import { articles } from "@/.velite";

export async function GET() {
  const articles: Array<{ title: string; description: string; url: string; publishedAt: string }> = [
    {
      title: "An Engineering Overview of AI Factory Design",
      description:
        "A deep technical look at how AI factories differ from traditional data centers — from GPU rack density and networking fabrics to power chains and liquid cooling.",
      url: `${siteConfig.url}/writing/ai-factory-design`,
      publishedAt: new Date().toISOString(),
    },
  ];

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${siteConfig.name}</title>
    <link>${siteConfig.url}/writing</link>
    <description>${siteConfig.description}</description>
    <language>en-US</language>
    <atom:link href="${siteConfig.url}/feed.xml" rel="self" type="application/rss+xml" />
    ${articles
      .map(
        (a) => `<item>
      <title><![CDATA[${a.title}]]></title>
      <link>${a.url}</link>
      <description><![CDATA[${a.description}]]></description>
      <pubDate>${new Date(a.publishedAt).toUTCString()}</pubDate>
      <guid isPermaLink="true">${a.url}</guid>
    </item>`
      )
      .join("\n    ")}
  </channel>
</rss>`;

  return new NextResponse(rss, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
