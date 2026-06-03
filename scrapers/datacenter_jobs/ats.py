"""ATS client implementations.

Architecture
------------
A single :class:`BaseATSClient` owns the cross-cutting concerns every source shares:

* one pooled ``httpx.AsyncClient`` (HTTP/2) reused across all requests,
* a hardened ``_request`` wrapper that converts *every* failure mode
  (timeouts, 4xx/5xx, malformed JSON) into a logged warning + ``None`` return so a
  single bad endpoint can never crash the pipeline,
* the anti-bot ``_jitter`` (between pages) and ``_detail_jitter`` (between per-job
  detail fetches) sleeps.

Each concrete client (:class:`GreenhouseClient`, :class:`LeverClient`,
:class:`WorkdayClient`) only has to know how to talk to its own endpoint and how to
map that endpoint's raw rows into the common ``RawJob`` dict the pipeline expects.
Clients emit the *raw* full-description HTML; the pipeline sanitizes it (see
``clean.sanitize_html``) and derives the snippet.

``RawJob`` is the small intermediate contract between clients and the pipeline; the
pipeline is what actually validates it into a :class:`~datacenter_jobs.models.JobPosting`.
"""

from __future__ import annotations

import asyncio
import logging
import random
from typing import Any, TypedDict

import httpx

from .classify import categorize_title
from .config import SETTINGS, Company
from .headers import build_headers

logger = logging.getLogger(__name__)


class RawJob(TypedDict):
    """Normalized-but-unvalidated row handed from a client to the pipeline."""

    job_id: str
    title: str
    company: str
    ats_source: str
    original_url: str
    raw_location: str
    description_html: str  # raw full description HTML; sanitized by the pipeline


class BaseATSClient:
    """Shared HTTP behavior, error handling, jitter, and HTML cleanup."""

    ats_source: str = ""

    def __init__(self, client: httpx.AsyncClient) -> None:
        # The AsyncClient is created once (in the pipeline) and shared, so HTTP/2
        # connections are pooled and reused across companies.
        self._client = client

    # -- networking -------------------------------------------------------
    async def _request(
        self,
        method: str,
        url: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any | None:
        """Perform one request and return parsed JSON, or ``None`` on any failure.

        Every downstream network action funnels through here. Connection timeouts,
        4xx/5xx status codes, and malformed JSON are logged and swallowed so the rest
        of the pipeline keeps running (graceful degradation, per the spec).
        """
        try:
            response = await self._client.request(
                method,
                url,
                json=json_body,
                params=params,
                headers=build_headers(),
                timeout=SETTINGS.request_timeout,
            )
            response.raise_for_status()  # turns 4xx/5xx into HTTPStatusError
            return response.json()  # raises on malformed JSON
        except httpx.TimeoutException:
            logger.warning("Timeout on %s %s", method, url)
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "HTTP %s on %s %s", exc.response.status_code, method, url
            )
        except httpx.HTTPError as exc:
            logger.warning("Network error on %s %s: %s", method, url, exc)
        except ValueError as exc:  # JSONDecodeError is a subclass of ValueError
            logger.warning("Malformed JSON from %s %s: %s", method, url, exc)
        return None

    # -- helpers ----------------------------------------------------------
    @staticmethod
    async def _jitter() -> None:
        """Random 1.5-3.5 s pause between paginated hits / company switches."""
        await asyncio.sleep(random.uniform(SETTINGS.jitter_min, SETTINGS.jitter_max))

    @staticmethod
    async def _detail_jitter() -> None:
        """Short pause between per-job detail fetches (lighter than page jitter)."""
        await asyncio.sleep(
            random.uniform(SETTINGS.detail_jitter_min, SETTINGS.detail_jitter_max)
        )

    async def fetch(self, company: Company) -> list[RawJob]:  # pragma: no cover
        """Fetch and normalize all postings for one company. Overridden per ATS."""
        raise NotImplementedError


class GreenhouseClient(BaseATSClient):
    """Greenhouse public Job Board API.

    A single GET with ``content=true`` returns every job *with* its full description,
    so no pagination is needed.
    """

    ats_source = "greenhouse"
    _BASE = "https://boards-api.greenhouse.io/v1/boards/{token}/jobs"

    async def fetch(self, company: Company) -> list[RawJob]:
        url = self._BASE.format(token=company.token)
        data = await self._request("GET", url, params={"content": "true"})
        if not data or "jobs" not in data:
            return []

        jobs: list[RawJob] = []
        for job in data["jobs"]:
            location = (job.get("location") or {}).get("name", "")
            jobs.append(
                RawJob(
                    job_id=str(job.get("id", "")),
                    title=job.get("title", ""),
                    company=company.name,
                    ats_source=self.ats_source,
                    original_url=job.get("absolute_url", ""),
                    raw_location=location,
                    # `content` is the full description as (escaped) HTML; the
                    # pipeline sanitizes it and derives the snippet.
                    description_html=job.get("content", ""),
                )
            )
        return jobs


class LeverClient(BaseATSClient):
    """Lever public Postings API (v0, JSON mode).

    The whole posting list comes back in one JSON array. Each entry carries the full
    description as HTML in ``description`` plus structured ``lists`` (sections such as
    "Requirements" / "Benefits") and a closing ``additional`` block. We reassemble
    those into a single HTML body so no section is lost.
    """

    ats_source = "lever"
    _BASE = "https://api.lever.co/{version}/postings/{token}"

    @staticmethod
    def _assemble_html(job: dict[str, Any]) -> str:
        """Stitch Lever's opening + sectioned lists + closing into one HTML body."""
        parts: list[str] = [job.get("description", "")]
        for section in job.get("lists") or []:
            heading = section.get("text", "")
            if heading:
                parts.append(f"<h3>{heading}</h3>")
            parts.append(section.get("content", ""))
        parts.append(job.get("additional", ""))
        return "\n".join(p for p in parts if p)

    async def fetch(self, company: Company) -> list[RawJob]:
        url = self._BASE.format(version=SETTINGS.lever_api_version, token=company.token)
        data = await self._request("GET", url, params={"mode": "json"})
        # v0 returns a bare JSON array.
        if not isinstance(data, list):
            return []

        jobs: list[RawJob] = []
        for job in data:
            categories = job.get("categories") or {}
            location = categories.get("location", "") or ""
            jobs.append(
                RawJob(
                    job_id=str(job.get("id", "")),
                    title=job.get("text", ""),
                    company=company.name,
                    ats_source=self.ats_source,
                    original_url=job.get("hostedUrl", ""),
                    raw_location=location,
                    description_html=self._assemble_html(job),
                )
            )
        return jobs


class WorkdayClient(BaseATSClient):
    """Workday internal candidate-experience (CXS) search API.

    Workday is the awkward one: there is no per-company "board token" you can guess.
    Every tenant lives at a different cell host (wd1/wd3/wd5...) and exposes a
    differently-named external site, so all three coordinates come from config:

        https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs

    Pagination is server-side and offset-based. We POST a small JSON payload, read the
    ``total`` and the ``jobPostings`` page out of the response, then advance ``offset``
    by ``limit`` and POST again until we have pulled ``total`` rows (or hit an empty
    page / the safety cap).

    The list endpoint carries no description, so for each posting whose *title* is
    datacenter-relevant (gated up front so huge tenants like NVIDIA don't trigger
    thousands of needless requests) we issue a second GET to the job-detail endpoint
    to pull the full ``jobDescription``:

        GET https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}
    """

    ats_source = "workday"
    _CXS = "https://{tenant}.{host}.myworkdayjobs.com/wday/cxs/{tenant}/{site}"

    async def fetch(self, company: Company) -> list[RawJob]:
        cxs_base = self._CXS.format(
            tenant=company.token,
            host=company.workday_host,
            site=company.workday_site,
        )
        endpoint = f"{cxs_base}/jobs"
        # The external job URLs are relative to the human-facing site root, NOT the
        # cxs API path, so we build that base once for joining `externalPath` later.
        site_root = (
            f"https://{company.token}.{company.workday_host}.myworkdayjobs.com/"
            f"{company.workday_site}"
        )

        limit = SETTINGS.workday_page_size
        offset = 0
        collected: list[RawJob] = []
        # Workday reports the grand `total` ONLY on the first page; later pages return
        # total=0. So we capture it once and drive termination from that, falling back
        # to a short/empty page as the end-of-results signal.
        total: int | None = None

        for page in range(SETTINGS.workday_max_pages):
            # ----------------------------------------------------------------
            # Build the Workday search payload for THIS page.
            #
            #   appliedFacets : {}  -> no filters; pull everything and let our own
            #                          classifier bucket the roles afterwards.
            #   searchText    : ""  -> no keyword filter.
            #   limit         : N   -> page size (Workday caps at 20).
            #   offset        : M   -> index of the first record on this page;
            #                          we advance it by `limit` every iteration.
            # ----------------------------------------------------------------
            payload: dict[str, Any] = {
                "appliedFacets": {},
                "searchText": "",
                "limit": limit,
                "offset": offset,
            }

            data = await self._request("POST", endpoint, json_body=payload)
            if not data:
                break  # request failed and was already logged; stop this company

            postings = data.get("jobPostings") or []
            if not postings:
                break  # ran past the end

            for job in postings:
                title = job.get("title", "")
                # Gate the expensive detail fetch on title relevance.
                if categorize_title(title) == "Other":
                    continue

                external_path = job.get("externalPath", "") or ""
                detail = await self._request("GET", f"{cxs_base}{external_path}")
                info = (detail or {}).get("jobPostingInfo", {}) or {}

                # externalPath looks like "/job/Location/Title_JR123"; join to site root.
                fallback_url = (
                    site_root.rstrip("/") + external_path
                    if external_path.startswith("/")
                    else external_path
                )
                bullet = job.get("bulletFields") or [external_path]
                collected.append(
                    RawJob(
                        job_id=str(info.get("jobReqId") or bullet[0]),
                        title=title,
                        company=company.name,
                        ats_source=self.ats_source,
                        original_url=info.get("externalUrl") or fallback_url,
                        raw_location=info.get("location") or job.get("locationsText", "") or "",
                        description_html=info.get("jobDescription", ""),
                    )
                )
                await self._detail_jitter()  # polite pause between detail GETs

            if total is None:  # only the first page carries the real grand total
                total = int(data.get("total", 0) or 0)
            offset += limit

            # Stop when we've pulled the known total, or the page came back short
            # (the last page) — the latter guards against a missing/!0 total too.
            if (total and offset >= total) or len(postings) < limit:
                break

            await self._jitter()  # polite pause before the next page

        return collected


# Maps the config `ats` literal to its client class.
CLIENT_REGISTRY: dict[str, type[BaseATSClient]] = {
    GreenhouseClient.ats_source: GreenhouseClient,
    LeverClient.ats_source: LeverClient,
    WorkdayClient.ats_source: WorkdayClient,
}
