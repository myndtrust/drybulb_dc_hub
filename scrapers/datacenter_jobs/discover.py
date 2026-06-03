"""Optional: discover new ATS board tokens via SerpAPI.

This is a convenience tool, not part of the core scrape. Given a topic (e.g.
"liquid cooling data center"), it runs Google searches scoped to the ATS hosting
domains and prints any company tokens it finds, so you can grow the roster in
``config.py`` without manually hunting careers pages.

Requires a ``SERPAPI_KEY`` in the environment (or a git-ignored ``.env.local``).
If the key or the ``requests`` dependency is missing, it degrades to a no-op with a
helpful log message — the main scrape never depends on it.
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger(__name__)

# Each ATS exposes tokens in a recognizable URL shape we can regex out of results.
_TOKEN_PATTERNS: dict[str, re.Pattern[str]] = {
    "greenhouse": re.compile(r"(?:boards|job-boards)\.greenhouse\.io/([A-Za-z0-9_-]+)"),
    "lever": re.compile(r"jobs\.lever\.co/([A-Za-z0-9_-]+)"),
    "workday": re.compile(r"https?://([A-Za-z0-9_-]+)\.(wd\d+)\.myworkdayjobs\.com/([A-Za-z0-9_-]+)"),
}

_QUERIES = [
    '"data center" site:boards.greenhouse.io',
    '"data center" site:jobs.lever.co',
    '"data center" site:myworkdayjobs.com',
]


def _load_key() -> str | None:
    """Load SERPAPI_KEY, honoring a local .env.local if python-dotenv is present."""
    try:
        from dotenv import load_dotenv

        load_dotenv(".env.local")
    except ImportError:
        pass
    return os.getenv("SERPAPI_KEY")


def discover(topic: str) -> dict[str, set[str]]:
    """Search the ATS hosting domains for ``topic`` and return found tokens by ATS.

    Best-effort: returns an empty mapping (and logs) if SerpAPI is unavailable.
    """
    key = _load_key()
    if not key:
        logger.warning(
            "SERPAPI_KEY not set; --discover is a no-op. Add it to .env.local to enable."
        )
        return {}

    try:
        import requests  # imported lazily; only needed for discovery
    except ImportError:
        logger.warning("`requests` not installed; cannot run --discover.")
        return {}

    found: dict[str, set[str]] = {ats: set() for ats in _TOKEN_PATTERNS}
    for base_query in _QUERIES:
        query = f"{topic} {base_query}".strip()
        try:
            resp = requests.get(
                "https://serpapi.com/search.json",
                params={"engine": "google", "q": query, "api_key": key, "num": 20},
                timeout=30,
            )
            resp.raise_for_status()
            payload = resp.json()
        except Exception as exc:  # network/parse issues are non-fatal here
            logger.warning("SerpAPI query failed for %r: %s", query, exc)
            continue

        links = [r.get("link", "") for r in payload.get("organic_results", [])]
        blob = "\n".join(links)
        for ats, pattern in _TOKEN_PATTERNS.items():
            for match in pattern.finditer(blob):
                found[ats].add(match.group(0))

    for ats, tokens in found.items():
        if tokens:
            logger.info("Discovered %s candidates:\n  %s", ats, "\n  ".join(sorted(tokens)))
    return found
