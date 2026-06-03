"""Output sinks: local file and Google Cloud Storage.

In production the Cloud Run Job calls :func:`upload_gcs` to publish the seed JSON to a
public bucket the browser reads directly. Locally, :func:`write_local` drops the same
file into ``public/data/`` for development.
"""

from __future__ import annotations

import json
import logging
import os

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


def upload_gcs(jobs: list[JobPosting], bucket_name: str, object_name: str) -> None:
    """Upload the seed JSON to GCS.

    Auth uses Application Default Credentials — inside Cloud Run that is the Job's
    service account, so no keys live in code or config. The object is given a short
    browser cache lifetime so the frontend picks up fresh runs quickly.
    """
    # Imported lazily so local runs without the GCS SDK / credentials still work.
    from google.cloud import storage  # type: ignore[import-untyped]

    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_name)
    blob.cache_control = "public, max-age=300"
    blob.upload_from_string(_serialize(jobs), content_type="application/json")
    logger.info(
        "Uploaded %d postings to gs://%s/%s", len(jobs), bucket_name, object_name
    )
