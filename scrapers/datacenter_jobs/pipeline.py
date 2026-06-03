"""Async orchestration: fan out across companies, validate, dedupe.

This is the layer that ties the clients, the classifier, and the schema together.
It owns the single shared ``httpx.AsyncClient`` and a concurrency bound so we scrape
several companies in parallel without spiking every host at once.
"""

from __future__ import annotations

import asyncio
import logging

import httpx
from pydantic import ValidationError

from .ats import CLIENT_REGISTRY, RawJob
from .classify import categorize_title, normalize_market
from .clean import sanitize_html, text_snippet
from .config import COMPANIES, SETTINGS, Company
from .models import JobPosting

logger = logging.getLogger(__name__)


def _to_job_posting(raw: RawJob) -> JobPosting | None:
    """Validate one raw row into a JobPosting, applying domain classification.

    Returns ``None`` (and logs) on validation failure so one malformed row never
    aborts the run.
    """
    try:
        raw_description = raw["description_html"]
        return JobPosting(
            job_id=raw["job_id"],
            title=raw["title"],
            company=raw["company"],
            ats_source=raw["ats_source"],  # validated against the Literal
            original_url=raw["original_url"],
            raw_location=raw["raw_location"],
            normalized_market=normalize_market(raw["raw_location"]),
            category=categorize_title(raw["title"]),
            description_snippet=text_snippet(raw_description),
            description_html=sanitize_html(raw_description),
        )
    except ValidationError as exc:
        logger.warning(
            "Dropping invalid row from %s (%s): %s",
            raw.get("company"),
            raw.get("job_id"),
            exc.errors(include_url=False),
        )
        return None


async def _scrape_company(
    company: Company,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> list[JobPosting]:
    """Scrape and validate a single company's postings."""
    client_cls = CLIENT_REGISTRY.get(company.ats)
    if client_cls is None:
        logger.error("No client for ATS '%s' (%s)", company.ats, company.name)
        return []

    async with semaphore:
        ats_client = client_cls(client)
        try:
            raw_jobs = await ats_client.fetch(company)
        except Exception:  # defensive: a client bug must not kill the whole run
            logger.exception("Unexpected error scraping %s", company.name)
            return []

        # Jitter after finishing a company before the slot is reused (company switch).
        await ats_client._jitter()

    # Keep only datacenter-relevant roles: anything that classifies as "Other" is
    # dropped here so it never reaches the seed file / jobs board.
    validated = [
        jp
        for raw in raw_jobs
        if (jp := _to_job_posting(raw)) is not None and jp.category != "Other"
    ]
    logger.info(
        "%s [%s]: %d raw -> %d relevant (Other excluded)",
        company.name,
        company.ats,
        len(raw_jobs),
        len(validated),
    )
    return validated


async def run(companies: list[Company] | None = None) -> list[JobPosting]:
    """Scrape the whole roster concurrently and return deduped, validated postings."""
    roster = companies if companies is not None else COMPANIES
    semaphore = asyncio.Semaphore(SETTINGS.max_concurrency)

    # http2=True enables clean multiplexed connections; one client is shared by all.
    async with httpx.AsyncClient(http2=True, follow_redirects=True) as client:
        results = await asyncio.gather(
            *(_scrape_company(c, client, semaphore) for c in roster)
        )

    # Flatten and dedupe on (ats_source, job_id) — the same posting can occasionally
    # appear twice within a paginated source.
    seen: set[tuple[str, str]] = set()
    deduped: list[JobPosting] = []
    for batch in results:
        for job in batch:
            key = (job.ats_source, job.job_id)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(job)

    logger.info(
        "Collected %d unique postings across %d companies", len(deduped), len(roster)
    )
    return deduped
