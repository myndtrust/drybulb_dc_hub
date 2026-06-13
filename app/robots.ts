import { MetadataRoute } from "next";
import { siteConfig } from "@/lib/metadata";

// AI assistant / answer-engine crawlers we explicitly welcome (the site's
// mission is to be a public, citable engineering reference).
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "CCBot",
  "cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  const disallow = ["/dashboard", "/api/"];
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      { userAgent: AI_AGENTS, allow: "/", disallow },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
