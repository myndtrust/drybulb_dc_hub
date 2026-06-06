import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { articles, authors } from "@/.velite";
import { constructMetadata } from "@/lib/metadata";
import { MdxContent } from "@/components/shared/mdx-content";
import { JsonLd } from "@/components/shared/json-ld";
import { siteConfig } from "@/lib/metadata";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return articles
    .filter((a) => !a.draft)
    .map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = articles.find((a) => a.slug === slug);
  if (!article) return {};
  return constructMetadata({
    title: article.title,
    description: article.description,
    canonicalPath: article.url,
  });
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = articles.find((a) => a.slug === slug);
  if (!article) notFound();

  const author = authors.find((a) => a.slug === article.author);

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.description,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt ?? article.publishedAt,
    ...(author
      ? {
          author: {
            "@type": "Person",
            name: author.name,
            url: `${siteConfig.url}/authors/${author.slug}`,
          },
        }
      : {}),
    publisher: {
      "@type": "Organization",
      name: "Drybulb",
      url: siteConfig.url,
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${siteConfig.url}${article.url}`,
    },
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Blog", item: `${siteConfig.url}/writing` },
      { "@type": "ListItem", position: 2, name: article.title, item: `${siteConfig.url}${article.url}` },
    ],
  };

  return (
    <>
      <JsonLd data={articleJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <div className="container mx-auto max-w-3xl px-4 py-16">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-mono text-muted-foreground mb-10">
          <Link href="/writing" className="hover:text-foreground transition-colors">
            Blog
          </Link>
          <span>/</span>
          <span className="text-foreground/60 truncate">{article.title}</span>
        </nav>

        {/* Header */}
        <header className="mb-12">
          {article.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {article.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs font-mono text-muted-foreground border border-border/60 rounded px-2 py-0.5"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <h1 className="text-4xl font-bold tracking-tight leading-tight mb-4">
            {article.title}
          </h1>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            {author && (
              <>
                <Link
                  href={`/authors/${author.slug}`}
                  className="hover:text-foreground transition-colors"
                >
                  {author.name}
                </Link>
                <span>&middot;</span>
              </>
            )}
            <time dateTime={article.publishedAt}>
              {new Date(article.publishedAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
            {article.readingTime && (
              <>
                <span>&middot;</span>
                <span>{article.readingTime} min read</span>
              </>
            )}
          </div>
        </header>

        {/* Body */}
        <article className="prose prose-lg prose-neutral dark:prose-invert max-w-none">
          <MdxContent code={article.body} />
        </article>

        {/* Engagement CTA */}
        <aside className="mt-16 rounded-lg bg-muted/40 border border-border/60 px-8 py-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <p className="font-semibold mb-1">
              Facing this on a real project?
            </p>
            <p className="text-sm text-muted-foreground">
              I take on select advisory engagements — technical due diligence,
              owner&apos;s engineering, and design peer review — as a licensed PE.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link
              href="/consulting"
              data-umami-event="cta-consulting-article"
              data-umami-event-article={article.slug}
            >
              Work with me
            </Link>
          </Button>
        </aside>

        {/* Footer nav */}
        <div className="mt-12 pt-8 border-t border-border/60">
          <Link
            href="/writing"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            &larr; All articles
          </Link>
        </div>
      </div>
    </>
  );
}
