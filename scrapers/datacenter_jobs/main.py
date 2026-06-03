"""CLI entry point.

Examples
--------
Local full run (writes public/data/datacenter_jobs_seed.json)::

    python -m datacenter_jobs.main

Smoke-test a single company::

    python -m datacenter_jobs.main --limit-companies anthropic

Cloud Run Job (upload to GCS; env GCS_BUCKET/GCS_OBJECT also work)::

    python -m datacenter_jobs.main --gcs-bucket drybulb-jobs

Discover new ATS tokens for a topic (needs SERPAPI_KEY)::

    python -m datacenter_jobs.main --discover "liquid cooling data center"
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys

from . import pipeline, storage
from .config import COMPANIES, DEFAULT_LOCAL_OUT, SETTINGS, Company


def _configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )


def _select_companies(limit_csv: str | None) -> list[Company]:
    """Filter the roster by a comma-separated list of company names or tokens."""
    if not limit_csv:
        return COMPANIES
    wanted = {w.strip().lower() for w in limit_csv.split(",") if w.strip()}
    selected = [
        c for c in COMPANIES if c.name.lower() in wanted or c.token.lower() in wanted
    ]
    if not selected:
        logging.getLogger(__name__).warning(
            "No companies matched %r; nothing to scrape.", limit_csv
        )
    return selected


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Datacenter jobs scraper")
    parser.add_argument(
        "--out",
        default=DEFAULT_LOCAL_OUT,
        help="Local output path (default: repo public/data/datacenter_jobs_seed.json).",
    )
    parser.add_argument(
        "--gcs-bucket",
        default=SETTINGS.gcs_bucket,
        help="GCS bucket to upload to (or env GCS_BUCKET). Enables upload when set.",
    )
    parser.add_argument(
        "--gcs-object",
        default=SETTINGS.gcs_object,
        help="GCS object name (or env GCS_OBJECT).",
    )
    parser.add_argument(
        "--no-local",
        action="store_true",
        help="Skip writing the local file (e.g. when only uploading to GCS).",
    )
    parser.add_argument(
        "--limit-companies",
        default=None,
        help="Comma-separated company names/tokens to restrict the run to.",
    )
    parser.add_argument(
        "--discover",
        default=None,
        metavar="TOPIC",
        help="Run SerpAPI token discovery for TOPIC and exit (no scrape).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    args = _parse_args(argv)

    if args.discover:
        from . import discover as discover_mod

        discover_mod.discover(args.discover)
        return 0

    roster = _select_companies(args.limit_companies)
    jobs = asyncio.run(pipeline.run(roster))

    if not jobs:
        logging.getLogger(__name__).warning("No postings collected; writing nothing.")
        return 1

    if not args.no_local:
        storage.write_local(jobs, args.out)

    if args.gcs_bucket:
        storage.upload_gcs(jobs, args.gcs_bucket, args.gcs_object)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
