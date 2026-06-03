# Cloud Run — Datacenter Jobs Scraper (operations)

This is the live deployment of the scraper in `scrapers/`. It runs as a **Cloud Run
Job** (on-demand, not a server), scrapes all configured ATS boards, and publishes the
results to a **public GCS bucket** that the drybulb.com site reads.

Each run writes **two** objects:
- `latest.json` — overwritten every run (short cache); **this is what the site reads**.
- `archive/datacenter_jobs_<UTC-timestamp>.json` — an immutable dated snapshot kept as
  history. A bucket lifecycle rule auto-deletes `archive/` objects older than **90 days**
  (`latest.json` is exempt — it lives outside `archive/`).

> **Local source / "GCP directory":** `c:\Users\Eric\Documents\drybulb_datacenter_hub\scrapers`
> — everything is deployed from here (`--source scrapers`). There is no separate local
> GCP config folder; the cloud resources are defined by the commands below.

## Deployed resources

| Thing | Value |
|---|---|
| GCP project | `wordpress103020` |
| Region | `us-central1` |
| Cloud Run Job | `datacenter-jobs-scraper` |
| Service account | `jobs-scraper@wordpress103020.iam.gserviceaccount.com` |
| GCS bucket | `gs://drybulb-jobs` (public-read, CORS for drybulb.com) |
| Latest pointer object | `latest.json` |
| Dated history | `archive/datacenter_jobs_<UTC-timestamp>.json` (auto-deleted after 90 days) |
| **Public feed URL** | `https://storage.googleapis.com/drybulb-jobs/latest.json` |

Console links:
- Job: https://console.cloud.google.com/run/jobs/details/us-central1/datacenter-jobs-scraper?project=wordpress103020
- Bucket: https://console.cloud.google.com/storage/browser/drybulb-jobs?project=wordpress103020
- Logs: https://console.cloud.google.com/run/jobs/details/us-central1/datacenter-jobs-scraper/logs?project=wordpress103020

---

## ▶️ Refresh the job listings (the common task)

Trigger a fresh scrape on demand. This re-scrapes every company, writes a new dated
`archive/` snapshot, and overwrites `latest.json`. A full run takes ~3–6 minutes.

```powershell
gcloud run jobs execute datacenter-jobs-scraper --region us-central1 --project wordpress103020
```

Block until it finishes (and fail the command if the run fails):

```powershell
gcloud run jobs execute datacenter-jobs-scraper --region us-central1 --project wordpress103020 --wait
```

Or just click **EXECUTE** on the [job page](https://console.cloud.google.com/run/jobs/details/us-central1/datacenter-jobs-scraper?project=wordpress103020).

Confirm the feed updated (look at `scraped_at` / size):

```powershell
curl.exe -s "https://storage.googleapis.com/drybulb-jobs/latest.json" | Select-String "scraped_at" | Select-Object -First 1
```

List the dated history:

```powershell
gcloud storage ls gs://drybulb-jobs/archive/ --project wordpress103020
```

---

## 🔁 Redeploy after changing scraper code

Whenever you edit anything under `scrapers/datacenter_jobs/` (new company, new logic,
etc.), rebuild and update the job image:

```powershell
gcloud run jobs deploy datacenter-jobs-scraper `
  --source scrapers `
  --region us-central1 `
  --project wordpress103020 `
  --service-account jobs-scraper@wordpress103020.iam.gserviceaccount.com `
  --set-env-vars GCS_BUCKET=drybulb-jobs,GCS_OBJECT=latest.json,GCS_ARCHIVE_PREFIX=archive `
  --memory 512Mi --max-retries 1 --task-timeout 1200
```

Deploying does **not** run the job — follow with an `execute` (above) to publish a fresh
feed from the new code.

---

## 🔎 Inspect runs

```powershell
# Recent executions and their status
gcloud run jobs executions list --job datacenter-jobs-scraper --region us-central1 --project wordpress103020

# Tail logs for the latest execution
gcloud beta run jobs logs read datacenter-jobs-scraper --region us-central1 --project wordpress103020
```

---

## 🔗 Point the website at the feed

The site reads `NEXT_PUBLIC_JOBS_FEED_URL` (see `.env.example`). Set it in the Heroku
app config so the `/jobs` pages read the live bucket:

```powershell
heroku config:set NEXT_PUBLIC_JOBS_FEED_URL=https://storage.googleapis.com/drybulb-jobs/latest.json -a <your-heroku-app>
```

(Until set, the site falls back to a local seed file in development and shows an empty
state in production.)

---

## 🛠️ One-time setup (already done — kept for reproducibility)

```powershell
# Bucket (public-read + CORS)
gcloud storage buckets create gs://drybulb-jobs --project=wordpress103020 --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://drybulb-jobs --member=allUsers --role=roles/storage.objectViewer
gcloud storage buckets update gs://drybulb-jobs --cors-file=scrapers/cors.json

# Retention: auto-delete dated archives older than 90 days (latest.json is exempt)
gcloud storage buckets update gs://drybulb-jobs --lifecycle-file=scrapers/lifecycle.json

# Service account + write access to the bucket
gcloud iam service-accounts create jobs-scraper --project=wordpress103020 --display-name="Datacenter jobs scraper"
gcloud storage buckets add-iam-policy-binding gs://drybulb-jobs `
  --member=serviceAccount:jobs-scraper@wordpress103020.iam.gserviceaccount.com --role=roles/storage.objectAdmin

# Build + deploy the job (same as the redeploy command above)
gcloud run jobs deploy datacenter-jobs-scraper --source scrapers --region us-central1 --project wordpress103020 `
  --service-account jobs-scraper@wordpress103020.iam.gserviceaccount.com `
  --set-env-vars GCS_BUCKET=drybulb-jobs,GCS_OBJECT=latest.json,GCS_ARCHIVE_PREFIX=archive `
  --memory 512Mi --max-retries 1 --task-timeout 1200
```

Required APIs (already enabled on this project): `run`, `cloudbuild`, `artifactregistry`, `storage`.
