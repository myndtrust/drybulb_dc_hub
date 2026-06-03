# Datacenter Jobs Scraper

Async Python pipeline that aggregates **public** datacenter job listings from
Greenhouse, Lever, and Workday, validates them against a strict Pydantic schema, and
publishes `datacenter_jobs_seed.json`.

## Architecture

```
  (manual trigger)              Cloud Run Job                       GCS bucket
  gcloud run jobs execute ───▶  scrape + validate + serialize  ───▶ datacenter_jobs_seed.json
                                (this package)                      (public-read + CORS)
                                                                          │
                                                                          ▼
                              Browser on drybulb.com fetches the JSON directly.
                              Heroku does ZERO scraping work.
```

The entire scrape runs **inside Cloud Run** and writes the result straight to a public
GCS bucket. The Next.js frontend just reads that bucket. A full run takes ~2–10 min
(10 companies, Workday pagination, 1.5–3.5 s anti-bot jitter between hits), so it is
**not** run on a page request — it is triggered manually / on demand.

## Module map

| File | Responsibility |
|---|---|
| `models.py` | Pydantic v2 `JobPosting` schema (Literal-constrained `ats_source` / `category`). |
| `classify.py` | `categorize_title()` + `normalize_market()` — regex/keyword engines. |
| `headers.py` | `build_headers()` — rotating, self-consistent browser footprint. |
| `config.py` | `COMPANIES` roster + tunable `SETTINGS`. |
| `ats.py` | `BaseATSClient` + `Greenhouse`/`Lever`/`Workday` clients. |
| `pipeline.py` | Async fan-out, validation, dedupe. |
| `storage.py` | `write_local()` + `upload_gcs()`. |
| `discover.py` | Optional SerpAPI token discovery. |
| `main.py` | CLI entry point. |

## Company roster

Tokens were live-verified May 2026. Edit `COMPANIES` in `config.py` to add/remove
targets (one line each). For Workday you need three coordinates — tenant, cell host
(`wd1`/`wd5`/…), and the external site name — because none of them are guessable; grab
them from the company's real careers URL: `https://{tenant}.{host}.myworkdayjobs.com/{site}`.

| Company | ATS | Token / tenant |
|---|---|---|
| Anthropic, CoreWeave, Together AI, SambaNova Systems | greenhouse | board slug |
| T5 Data Centers, Cologix | lever | account slug |
| NVIDIA, Equinix, CyrusOne, Iron Mountain | workday | tenant + host + site |

> **Note on Lever:** the public read-only API is **v0** (`api.lever.co/v0/postings/{token}?mode=json`).
> There is no public `v2`. Override with `LEVER_API_VERSION` if that ever changes.

## Run locally

```powershell
cd scrapers
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Full run -> writes ..\public\data\datacenter_jobs_seed.json
python -m datacenter_jobs.main

# Smoke-test one source
python -m datacenter_jobs.main --limit-companies anthropic
```

CLI flags: `--out PATH`, `--no-local`, `--gcs-bucket` / `--gcs-object`,
`--limit-companies a,b`, `--discover "topic"`.

## Deploy to Cloud Run (one-time setup)

Assumes `gcloud` is authenticated and a project is selected. Replace `PROJECT` and the
bucket name as needed.

```bash
# 1. Create the public bucket the frontend will read.
gcloud storage buckets create gs://drybulb-jobs --location=US --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://drybulb-jobs \
  --member=allUsers --role=roles/storage.objectViewer

# 2. Allow the browser to fetch it cross-origin (cors.json is in this folder).
gcloud storage buckets update gs://drybulb-jobs --cors-file=cors.json

# 3. Service account for the Job, with write access to the bucket.
gcloud iam service-accounts create jobs-scraper
gcloud storage buckets add-iam-policy-binding gs://drybulb-jobs \
  --member=serviceAccount:jobs-scraper@PROJECT.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin

# 4. Build + deploy the Cloud Run Job from this folder.
gcloud run jobs deploy datacenter-jobs-scraper \
  --source . \
  --region us-central1 \
  --service-account jobs-scraper@PROJECT.iam.gserviceaccount.com \
  --set-env-vars GCS_BUCKET=drybulb-jobs,GCS_OBJECT=datacenter_jobs_seed.json \
  --max-retries 1 \
  --task-timeout 1200
```

### Trigger a scrape on demand

```bash
gcloud run jobs execute datacenter-jobs-scraper --region us-central1
```

(or click **Execute** on the Job in the Cloud Console). When it finishes, the fresh
JSON is live at:

```
https://storage.googleapis.com/drybulb-jobs/datacenter_jobs_seed.json
```

## Frontend integration (Next.js on Heroku)

Add the public URL to the site env:

```
NEXT_PUBLIC_JOBS_FEED_URL=https://storage.googleapis.com/drybulb-jobs/datacenter_jobs_seed.json
```

Then either fetch it client-side (zero Heroku load) or via ISR in a Server Component:

```ts
// app/(marketing)/jobs/page.tsx (follow-up work)
const res = await fetch(process.env.NEXT_PUBLIC_JOBS_FEED_URL!, {
  next: { revalidate: 300 }, // re-pull the small JSON at most every 5 min
});
const jobs = await res.json();
```

## Optional: discover new ATS tokens

```bash
# Requires SERPAPI_KEY in scrapers/.env.local (git-ignored).
python -m datacenter_jobs.main --discover "liquid cooling data center"
```
