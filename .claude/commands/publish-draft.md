Convert an HTML draft article from the `drafts/` folder into a published Drybulb blog post.

## Input

$ARGUMENTS — the filename (or partial name) of the HTML file in `drafts/` to publish

## Process

1. **Read the draft HTML** from `drafts/`. Parse the full content — title, subtitle/deck, sections, figures (SVGs), tables, callout boxes, blockquotes, references, and methodology/caveats.

2. **Read an existing published article** from `content/articles/` to confirm the current MDX pattern, frontmatter schema, and component usage (Callout variants: finding, verify, insight).

3. **Convert to MDX format** matching the Drybulb blog style:

   **Frontmatter** (all required fields):
   ```yaml
   title: "..." (max 99 chars)
   description: "..." (max 300 chars — write a compelling summary)
   publishedAt: "YYYY-MM-DD" (today's date)
   slug: "kebab-case-slug"
   tags: ["tag1", "tag2", ...] (3-6 relevant tags)
   draft: false
   readingTime: N (estimate from word count, ~250 wpm)
   author: "founder"
   ```

   **Body conversion rules:**
   - Open with a `<Callout variant="finding" title="Key takeaways">` summarizing 3-6 bullet points
   - Convert HTML headings to markdown `##` / `###`
   - Convert HTML paragraphs to markdown paragraphs
   - Convert `<strong>` to `**bold**`, `<em>` to `*italic*`
   - Convert HTML links to markdown `[text](url)`
   - Convert callout/box divs to `<Callout variant="finding|insight" title="...">` components
   - Convert blockquotes to markdown `>` blockquotes
   - Convert HTML tables to markdown tables with `|` syntax
   - Keep superscript references as `<sup>N</sup>` inline
   - Convert reference lists to numbered markdown lists with linked source names
   - Add methodology/caveats as closing italic text
   - Close with the standard Drybulb CTA: `*Drybulb publishes deep technical writing on AI factory and data center engineering. Questions or topics you'd like to see covered? [Get in touch](/contact).*`

   **SVG figures:**
   - Extract each `<figure><svg>...</svg></figure>` block
   - Save as standalone `.svg` files in `public/images/{slug}/`
   - Replace font-family references with system fonts (monospace → `ui-monospace,SFMono-Regular,Consolas,monospace`, serif → `Georgia,serif`)
   - Reference in MDX with `![alt text](/images/{slug}/filename.svg)` followed by an italic `<small>` figcaption line

4. **Write the files:**
   - SVG images to `public/images/{slug}/`
   - MDX article to `content/articles/{slug}.mdx`

5. **Build and verify:**
   - Run `npx velite build` — confirm no errors
   - Run `npx next build` — confirm the new route appears in the output
   - If dev server is running, check HTTP 200 on the article page and all SVG URLs

6. **Report** the published URL (`/writing/{slug}`) and a summary of what was converted.
