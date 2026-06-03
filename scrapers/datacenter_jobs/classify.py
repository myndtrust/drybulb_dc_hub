"""Domain-specific classification helpers.

Two pure functions turn raw ATS text into the controlled vocabularies the schema
demands:

* :func:`categorize_title` routes a job title into one of the five role categories.
* :func:`normalize_market` collapses a free-text location into a global datacenter
  hub label.

Both are deliberately side-effect-free and regex/keyword driven so they are trivial
to unit-test and to extend (add a keyword, not a code path).
"""

from __future__ import annotations

import re

from .models import Category

# ---------------------------------------------------------------------------
# Title -> category
# ---------------------------------------------------------------------------
# Ordered list of (compiled regex, category). Order matters: the FIRST pattern
# that matches wins, so the more specific / higher-signal categories are listed
# before the catch-alls. Keywords come straight from the domain spec.
#
# \b word boundaries keep us from matching substrings inside unrelated words
# (e.g. "CET" should not fire inside "faCETs"). Patterns are case-insensitive.
_CATEGORY_PATTERNS: list[tuple[re.Pattern[str], Category]] = [
    (
        re.compile(
            r"\b("
            r"critical environment|data\s*center technician|dc\s*ops|dcops|"
            r"facilit(?:y|ies) (?:engineer|technician|manager)|"
            r"shift manager|shift lead|critical facilit\w*|"
            r"cet\b|mep technician|building engineer"
            r")\b",
            re.IGNORECASE,
        ),
        "Facilities/Ops",
    ),
    (
        re.compile(
            r"\b("
            r"commissioning|cx\s*manager|cxm\b|cx\s*engineer|"
            r"construction project manager|construction manager|"
            r"project controls|scheduler|cost (?:manager|engineer)|"
            r"superintendent|preconstruction"
            r")\b",
            re.IGNORECASE,
        ),
        "Construction/Cx",
    ),
    (
        re.compile(
            r"\b("
            r"network deployment|network engineer|network technician|"
            r"fiber optic|fiber\b|structured cabling|"
            r"hardware tech|hardware engineer|dct\b|"
            r"deployment technician|cabling"
            r")\b",
            re.IGNORECASE,
        ),
        "Network/Hardware",
    ),
    (
        re.compile(
            r"\b("
            r"mechanical engineer|electrical engineer|"
            r"substation|liquid cooling|hvac|"
            r"infrastructure architect|medium voltage|power and cooling|"
            r"power engineer|cooling engineer|controls engineer|"
            r"electrical design|mechanical design"
            r")\b",
            re.IGNORECASE,
        ),
        "Engineering/Design",
    ),
]


def categorize_title(title: str) -> Category:
    """Map a raw job title to exactly one role category.

    Returns ``"Other"`` when nothing matches so the result is always a valid
    :data:`~datacenter_jobs.models.Category` literal.
    """
    text = title or ""
    for pattern, category in _CATEGORY_PATTERNS:
        if pattern.search(text):
            return category
    return "Other"


# ---------------------------------------------------------------------------
# Raw location -> normalized market
# ---------------------------------------------------------------------------
# Each market maps to a list of lowercase substrings to look for in the raw
# location text. Order matters only if a city could plausibly belong to two
# markets (none here), but we keep NoVA first as the densest hub.
_MARKET_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("Northern Virginia", ("ashburn", "loudoun", "sterling", "virginia", " va", ",va")),
    ("FLAP-D", ("frankfurt", "london", "amsterdam", "paris", "dublin")),
    ("APAC/Singapore", ("singapore",)),
    ("APAC/Tokyo", ("tokyo",)),
]


def normalize_market(raw_location: str) -> str:
    """Collapse a free-text location into a global datacenter hub label.

    Case-insensitive substring match. Defaults to ``"Other"`` for anything that
    does not resolve to a known cluster.
    """
    text = (raw_location or "").lower()
    if not text:
        return "Other"
    for market, needles in _MARKET_KEYWORDS:
        if any(needle in text for needle in needles):
            return market
    return "Other"
