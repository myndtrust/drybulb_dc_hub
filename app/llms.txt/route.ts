import { articles } from "@/.velite";
import { siteConfig } from "@/lib/metadata";

// Serves /llms.txt — a curated, plain-markdown index of the site for LLMs and
// AI agents (the emerging llms.txt convention). Built from the article
// collection at build time. https://llmstxt.org/
export const dynamic = "force-static";

export function GET() {
  const published = [...articles]
    .filter((a) => !a.draft)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const lines = [
    `# ${siteConfig.name}`,
    "",
    `> ${siteConfig.description}`,
    "",
    "Drybulb is an independent technical-authority resource on AI-factory and data-center engineering, written by a licensed Professional Engineer (PE) and Doctor of Design with 18+ years across the data-center infrastructure stack. All content is public-domain knowledge and first-principles engineering — free to read, reference, and cite.",
    "",
    "## Writing",
    ...published.map((a) => `- [${a.title}](${siteConfig.url}${a.url}): ${a.description}`),
    "",
    "## Tools",
    `- [PUE Calculator](${siteConfig.url}/tools): Estimate a data center's Power Usage Effectiveness from TMY3 typical-year hourly weather, with an ASHRAE psychrometric chart and an ASHRAE liquid-cooling (W/S class) free-cooling energy model.`,
    "",
    "## Advisory",
    `- [Advisory Services](${siteConfig.url}/consulting): Independent technical due diligence, owner's engineering and design peer review, PUE/sustainability assessment, and expert-witness work for AI factories and mission-critical data centers.`,
    "",
    "## About",
    `- [About](${siteConfig.url}/about): Mission, scope (power, cooling, networking, reliability, sustainability), and editorial standards.`,
    `- [Contact](${siteConfig.url}/contact): Get in touch.`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
