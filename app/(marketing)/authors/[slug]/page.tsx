import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { authors, articles } from "@/.velite";
import { constructMetadata } from "@/lib/metadata";
import { JsonLd } from "@/components/shared/json-ld";
import { personSchema } from "@/lib/structured-data";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return authors.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const author = authors.find((a) => a.slug === slug);
  if (!author) return {};
  return constructMetadata({
    title: author.name,
    description: `Articles by ${author.name} on Drybulb — ${author.bio.slice(0, 140)}`,
    canonicalPath: `/authors/${author.slug}`,
  });
}

export default async function AuthorPage({ params }: Props) {
  const { slug } = await params;
  const author = authors.find((a) => a.slug === slug);
  if (!author) notFound();

  const authorArticles = articles
    .filter((a) => !a.draft && a.author === author.slug)
    .sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

  return (
    <div className="container mx-auto max-w-3xl px-4 py-16">
      <JsonLd data={personSchema(author)} />
      {/* Author header */}
      <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">
        Contributor
      </p>
      <h1 className="text-4xl font-bold tracking-tight leading-tight mb-2">
        {author.name}
      </h1>
      {author.role && (
        <p className="text-sm font-mono text-muted-foreground mb-6">
          {author.role}
        </p>
      )}
      <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-2xl">
        {author.bio}
      </p>

      {/* Expertise */}
      {author.expertise.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-12">
          {author.expertise.map((area) => (
            <Badge key={area} variant="outline" className="text-xs font-mono">
              {area}
            </Badge>
          ))}
        </div>
      )}

      {/* Articles by this author */}
      <section>
        <h2 className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-8">
          Articles
        </h2>
        {authorArticles.length > 0 ? (
          <div className="divide-y divide-border/60">
            {authorArticles.map((article) => (
              <Link
                key={article.slug}
                href={article.url}
                className="group block py-6 first:pt-0"
              >
                <h3 className="text-lg font-semibold mb-1 group-hover:text-foreground/80 transition-colors">
                  {article.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-2">
                  {article.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                  <time dateTime={article.publishedAt}>
                    {new Date(article.publishedAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
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
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No articles published yet.
          </p>
        )}
      </section>
    </div>
  );
}
