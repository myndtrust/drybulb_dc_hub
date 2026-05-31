import { defineConfig, defineCollection, s } from "velite";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import remarkGfm from "remark-gfm";

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
      body: s.mdx(),
    })
    .transform((data) => ({
      ...data,
      url: `/writing/${data.slug}`,
    })),
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
  collections: { articles },
  mdx: {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [
      rehypeSlug,
      [rehypeAutolinkHeadings, { behavior: "wrap" }],
    ],
  },
});
