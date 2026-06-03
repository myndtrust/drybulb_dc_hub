"""Pydantic v2 schema for a normalized job posting.

Every scraped record from every ATS is funneled through :class:`JobPosting` before it
is allowed into the export. The ``Literal`` types turn the spec's controlled
vocabularies (ATS source, category) into hard runtime constraints: anything outside
the allowed set raises ``ValidationError`` and is dropped by the pipeline rather than
silently corrupting the dataset.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Controlled vocabularies -- kept as module-level aliases so the classifier and the
# schema share a single source of truth.
AtsSource = Literal["greenhouse", "lever", "workday"]
Category = Literal[
    "Facilities/Ops",
    "Engineering/Design",
    "Construction/Cx",
    "Network/Hardware",
    "Other",
]


def utc_now_iso() -> str:
    """ISO 8601 timestamp in UTC (timezone-aware)."""
    return datetime.now(timezone.utc).isoformat()


class JobPosting(BaseModel):
    """A single, fully normalized datacenter job listing.

    Mirrors the export schema exactly. ``model_config`` strips incidental whitespace
    from every string field so titles/locations are clean by construction.
    """

    model_config = ConfigDict(str_strip_whitespace=True, extra="ignore")

    job_id: str = Field(..., description="Unique identifier from the source ATS.")
    title: str = Field(..., min_length=1, description="Cleaned, trimmed job title.")
    company: str = Field(..., description="Normalized company name.")
    ats_source: AtsSource = Field(..., description="Originating ATS platform.")
    original_url: str = Field(..., description="Absolute URL to the application page.")
    raw_location: str = Field("", description="Raw ATS location string.")
    normalized_market: str = Field(
        ..., description="Standardized datacenter cluster (e.g. 'Northern Virginia')."
    )
    category: Category = Field(..., description="One of the five role categories.")
    description_snippet: str = Field(
        "", max_length=300, description="First 300 chars of description, HTML stripped."
    )
    description_html: str = Field(
        "", description="Full job description as sanitized, formatting-only HTML."
    )
    scraped_at: str = Field(
        default_factory=utc_now_iso, description="ISO 8601 UTC scrape timestamp."
    )
