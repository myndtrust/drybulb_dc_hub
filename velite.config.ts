import { defineConfig, defineCollection, s } from "velite";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import remarkGfm from "remark-gfm";

const authors = defineCollection({
  name: "Author",
  pattern: "authors/**/*.mdx",
  schema: s.object({
    name: s.string(),
    slug: s.slug("authors"),
    role: s.string().optional(),
    bio: s.string(),
    avatar: s.string().optional(),
    expertise: s.array(s.string()).default([]),
    links: s
      .object({
        twitter: s.string().optional(),
        linkedin: s.string().optional(),
        website: s.string().optional(),
      })
      .optional(),
    body: s.mdx(),
  }),
});

const articles = defineCollection({
  name: "Article",
  pattern: "articles/**/*.mdx",
  schema: s
    .object({
      title: s.string().max(99),
      description: s.string().max(300),
      publishedAt: s.isodate(),
      updatedAt: s.isodate().optional(),
      slug: s.slug("articles"),
      tags: s.array(s.string()).default([]),
      draft: s.boolean().default(false),
      readingTime: s.number().optional(),
      ogImage: s.string().optional(),
      author: s.string().default("founder"),
      body: s.mdx(),
    })
    .transform((data) => ({
      ...data,
      url: `/writing/${data.slug}`,
    })),
});

const tools = defineCollection({
  name: "Tool",
  pattern: "tools/**/*.mdx",
  schema: s.object({
    title: s.string(),
    slug: s.slug("tools"),
    summary: s.string(),
    status: s.enum(["live", "beta", "coming-soon"]).default("coming-soon"),
    appPath: s.string().optional(),
    body: s.mdx(),
  }),
});

export default defineConfig({
  root: "content",
  output: {
    data: ".velite",
    assets: "public/static",
    base: "/static/",
    name: "[name]-[hash:6].[ext]",
    clean: true,
  },
  collections: { authors, articles, tools },
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      rehypeSlug,
      [rehypeAutolinkHeadings, { behavior: "wrap" }],
    ],
  },
});
