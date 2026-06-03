"""Static configuration: the company roster and runtime settings.

Keeping the roster as plain dataclasses (rather than buried in the clients) means
adding or removing a target is a one-line edit and the whole pipeline can be reasoned
about from this single file. Tokens here were live-verified against the public ATS
APIs in May 2026.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

from .models import AtsSource


@dataclass(frozen=True, slots=True)
class Company:
    """One scrape target.

    Attributes:
        name: Normalized, human-facing company name (stored on every JobPosting).
        ats: Which ATS platform this company uses.
        token: Greenhouse board token / Lever account slug / Workday tenant id.
        workday_host: Workday cell subdomain, e.g. "wd1" / "wd5". Workday only.
        workday_site: Workday external site/board name. Workday only.
    """

    name: str
    ats: AtsSource
    token: str
    workday_host: str = ""
    workday_site: str = ""


# ---------------------------------------------------------------------------
# The roster (live-verified May 2026). Every ATS has >= 2 targets.
# ---------------------------------------------------------------------------
COMPANIES: list[Company] = [
    # ── Greenhouse (board token == careers URL slug) ──
    Company("Anthropic", "greenhouse", "anthropic"),
    Company("CoreWeave", "greenhouse", "coreweave"),
    Company("Together AI", "greenhouse", "togetherai"),
    Company("SambaNova Systems", "greenhouse", "sambanovasystems"),
    # ── Lever (account slug) ── pure datacenter operators ──
    Company("T5 Data Centers", "lever", "t5datacenters"),
    Company("Cologix", "lever", "cologix"),
    # ── Workday (tenant + cell host + external site name all vary per company) ──
    Company("NVIDIA", "workday", "nvidia", "wd5", "NVIDIAExternalCareerSite"),
    Company("Equinix", "workday", "equinix", "wd1", "External"),
    Company("CyrusOne", "workday", "cyrusone", "wd1", "CyrusOneCareerPortal"),
    Company("Iron Mountain", "workday", "ironmountain", "wd5", "iron-mountain-jobs"),
]


@dataclass(frozen=True, slots=True)
class Settings:
    """Tunable runtime knobs (overridable via environment variables)."""

    # Anti-bot jitter window (seconds) applied between paginated hits / company switches.
    jitter_min: float = 1.5
    jitter_max: float = 3.5
    # Lighter jitter between per-job detail fetches (Workday), to keep runtime sane.
    detail_jitter_min: float = 0.4
    detail_jitter_max: float = 1.0
    # Per-request network timeout (seconds).
    request_timeout: float = 30.0
    # Max companies scraped concurrently (politeness + avoids fan-out spikes).
    max_concurrency: int = 4
    # Workday server-side page size (Workday caps this at 20).
    workday_page_size: int = 20
    # Hard safety cap on Workday pages per company (avoids runaway pagination).
    workday_max_pages: int = 50
    # Lever public postings API version. The spec named v2, which does not exist as a
    # public endpoint; v0 is the real read-only JSON API. Configurable just in case.
    lever_api_version: str = field(default_factory=lambda: os.getenv("LEVER_API_VERSION", "v0"))

    # GCS publish target (set in the Cloud Run Job env).
    gcs_bucket: str = field(default_factory=lambda: os.getenv("GCS_BUCKET", ""))
    gcs_object: str = field(
        default_factory=lambda: os.getenv("GCS_OBJECT", "datacenter_jobs_seed.json")
    )


SETTINGS = Settings()

# Default local output path: public/data/ so a local dev run is immediately fetchable
# by the Next.js app. Resolved relative to the repo root (parent of scrapers/).
DEFAULT_LOCAL_OUT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "public",
    "data",
    "datacenter_jobs_seed.json",
)
