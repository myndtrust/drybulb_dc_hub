# Container image for the datacenter jobs scraper, run as a Cloud Run Job.
# The Job scrapes all ATS sources, validates, and uploads the seed JSON to GCS.
FROM python:3.11-slim

# Avoid .pyc files and unbuffered stdout so logs stream to Cloud Logging promptly.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install deps first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy the package.
COPY datacenter_jobs ./datacenter_jobs

# Default: scrape and upload to the bucket named by GCS_BUCKET (set as a Job env var).
# --no-local because the container filesystem is ephemeral; the bucket is the sink.
ENTRYPOINT ["python", "-m", "datacenter_jobs.main"]
CMD ["--no-local"]
