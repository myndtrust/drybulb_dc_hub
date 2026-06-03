"""Async datacenter job-listing scraper.

Aggregates public datacenter job postings from Greenhouse, Lever, and Workday
applicant-tracking systems, validates them against a strict Pydantic schema, and
publishes a seed JSON file consumed by the drybulb.com jobs board.

The whole pipeline is designed to run inside a Cloud Run Job: it scrapes, validates,
and uploads the result straight to a public GCS bucket. The Next.js frontend then
reads that bucket directly, so the Heroku app does no scraping work.

Entry point: ``python -m datacenter_jobs.main``
"""

__version__ = "0.1.0"
