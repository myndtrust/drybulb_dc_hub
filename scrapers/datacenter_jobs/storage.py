"""Output sinks: local file and Google Cloud Storage.

In production the Cloud Run Job calls :func:`upload_gcs`, which publishes **two**
objects to the public bucket:

* ``latest.json`` — overwritten every run, short browser cache; the site reads this.
* ``archive/datacenter_jobs_<UTC-timestamp>.json`` — an immutable dated snapshot kept
  as history (a lifecycle rule prunes these after 90 days).

Locally, :func:`write_local` drops a single file into ``public/data/`` for development.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from .models import JobPosting

logger = logging.getLogger(__name__)


def _serialize(jobs: list[JobPosting]) -> str:
    """Produce the indented JSON array string written to either sink."""
    return json.dumps(
        [job.model_dump() for job in jobs],
        indent=2,
        ensure_ascii=False,
    )


def write_local(jobs: list[JobPosting], path: str) -> None:
    """Write the seed JSON to a local file path, creating parent dirs as needed."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(_serialize(jobs))
    logger.info("Wrote %d postings to %s", len(jobs), path)


def upload_gcs(
    jobs: list[JobPosting],
    bucket_name: str,
    latest_object: str = "latest.json",
    archive_prefix: str = "archive",
) -> None:
    """Publish the feed to GCS as an immutable dated archive plus a ``latest`` pointer.

    Auth uses Application Default Credentials — inside Cloud Run that is the Job's
    service account, so no keys live in code or config.

    Two objects are written from the same serialized payload:
      * ``{archive_prefix}/datacenter_jobs_<UTC-timestamp>.json`` — immutable history,
        cached for a year so it can be served straight from cache forever.
      * ``{latest_object}`` — overwritten each run with a short cache so the site
        picks up fresh runs within minutes. Kept OUTSIDE ``archive_prefix`` so the
        90-day retention lifecycle never deletes it.
    """
    # Imported lazily so local runs without the GCS SDK / credentials still work.
    from google.cloud import storage  # type: ignore[import-untyped]

    payload = _serialize(jobs)
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%SZ")
    archive_object = f"{archive_prefix}/datacenter_jobs_{timestamp}.json"

    client = storage.Client()
    bucket = client.bucket(bucket_name)

    # Immutable dated snapshot (long cache).
    archive_blob = bucket.blob(archive_object)
    archive_blob.cache_control = "public, max-age=31536000, immutable"
    archive_blob.upload_from_string(payload, content_type="application/json")

    # The pointer the site reads (short cache, overwritten each run).
    latest_blob = bucket.blob(latest_object)
    latest_blob.cache_control = "public, max-age=300"
    latest_blob.upload_from_string(payload, content_type="application/json")

    logger.info(
        "Uploaded %d postings to gs://%s/%s and gs://%s/%s",
        len(jobs),
        bucket_name,
        archive_object,
        bucket_name,
        latest_object,
    )
