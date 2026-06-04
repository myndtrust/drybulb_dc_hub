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
# Each market maps to lowercase substrings to look for in the raw location text.
# ORDER MATTERS: the first market with any matching needle wins, so distinctive
# city names are listed first and broad backstops (state names) last.
#
# Precision rules to avoid false positives:
#   * Lead with collision-safe CITY names; they match all feed formats
#     ("Santa Clara, CA", Workday "US, CA, Santa Clara", and Lever free-text).
#   * Use a state NAME backstop only where unambiguous (arizona/oregon/ohio/etc.);
#     never "washington" (Washington, DC) or "california" (LA/San Diego ≠ SV).
#   * Avoid 2-letter state-code substrings that collide (", ca" matches
#     "Toronto, Canada"). For NoVA we use ", va" (with the comma) + "virginia",
#     NOT a bare " va" — that previously also matched " va<lley>".
_MARKET_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    # ── US markets (city-name centric) ──
    ("Silicon Valley", (
        "san jose", "santa clara", "sunnyvale", "mountain view", "palo alto",
        "fremont", "san francisco", "silicon valley", "milpitas",
        "redwood city", "menlo park",
    )),
    ("Phoenix", ("phoenix", "mesa", "chandler", "scottsdale", "tempe", "goodyear", "arizona")),
    ("Dallas-Fort Worth", ("dallas", "fort worth", "irving", "plano", "richardson", "garland")),
    ("Chicago", ("chicago", "elk grove", "schaumburg", "northlake")),
    ("Atlanta", ("atlanta", "douglasville", "lithia springs", "georgia")),
    ("Hillsboro/Oregon", ("hillsboro", "portland, or", "oregon")),
    ("Columbus", ("columbus, oh", "columbus, ohio", "new albany")),
    ("Salt Lake City", ("salt lake", "west jordan", "bluffdale", "utah")),
    ("Seattle", ("seattle", "quincy, wa", "redmond", "bellevue", "tacoma")),
    ("Las Vegas", ("las vegas", "henderson", "reno", "nevada")),
    ("New York/New Jersey", (
        "new york", "nyc", "newark", "new jersey", "jersey city",
        "secaucus", "piscataway", "weehawken",
    )),
    ("Northern Virginia", (
        "ashburn", "loudoun", "sterling", "manassas", "reston", "chantilly",
        ", va", "virginia",
    )),
    # ── Global ──
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
