"""HTML cleanup helpers shared by the clients/pipeline.

Two jobs:

* :func:`sanitize_html` — turn an ATS's raw description markup into a small, *safe*
  subset of HTML (headings, lists, paragraphs, emphasis, links only) suitable for
  rendering on the site with ``dangerouslySetInnerHTML``. All scripts, styles,
  event handlers, inline styles, classes, images, and iframes are removed, so the
  frontend can render it directly without a client-side sanitizer.
* :func:`text_snippet` — a plain-text preview (first N chars) for the board list.

Sanitizing at scrape time (once) keeps the runtime site simple and avoids shipping a
sanitizer to the browser.
"""

from __future__ import annotations

import html as html_lib

from bs4 import BeautifulSoup

# Formatting tags we keep. Everything else is unwrapped (kept text, dropped tag).
_ALLOWED_TAGS = {
    "p", "br", "ul", "ol", "li",
    "h2", "h3", "h4",
    "strong", "b", "em", "i", "u",
    "a", "blockquote",
}

# Tags removed entirely, contents and all (never useful / unsafe in a job body).
_DROP_WITH_CONTENT = ["script", "style", "noscript", "iframe", "img", "svg", "button", "form", "input"]


def sanitize_html(raw: str) -> str:
    """Return a safe, formatting-only HTML subset of ``raw``.

    Greenhouse delivers its body HTML-*escaped*, so we unescape first; this is
    harmless for sources (Lever, Workday) that already send real HTML.
    """
    if not raw:
        return ""

    soup = BeautifulSoup(html_lib.unescape(raw), "html.parser")

    for tag in soup(_DROP_WITH_CONTENT):
        tag.decompose()

    for tag in soup.find_all(True):
        name = tag.name.lower()
        # Normalize heading levels into our small allowed range.
        if name == "h1":
            tag.name = name = "h2"
        elif name in ("h5", "h6"):
            tag.name = name = "h4"

        if name not in _ALLOWED_TAGS:
            tag.unwrap()  # keep children/text, discard the wrapper (div/span/etc.)
            continue

        if name == "a":
            href = tag.get("href", "")
            tag.attrs = {}
            if href.startswith(("http://", "https://")):
                tag["href"] = href
                tag["target"] = "_blank"
                tag["rel"] = "noopener noreferrer"
        else:
            tag.attrs = {}  # strip class/style/on*/etc. from every kept tag

    return str(soup).strip()


def text_snippet(raw: str, limit: int = 300) -> str:
    """Plain-text preview: strip tags, collapse whitespace, truncate to ``limit``."""
    if not raw:
        return ""
    text = BeautifulSoup(html_lib.unescape(raw), "html.parser").get_text(separator=" ")
    return " ".join(text.split())[:limit]
