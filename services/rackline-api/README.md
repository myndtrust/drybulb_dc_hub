# rackline-api — Cloud Run service for the Rackline DCIM tool

The Rackline tool (`/dashboard/tools/rackline`) runs in the drybulb.com Next.js app.
This service carries the parts that should not run in the browser or on the Heroku
dyno:

| Endpoint | What it does |
|---|---|
| `POST /v1/uploads` | Issues a 15-minute signed **PUT** URL for a background drawing (PDF, PNG, JPG, WebP, SVG, DXF; ≤ 50 MB) into a project (owner, editor or staff). |
| `POST /v1/files/url` | Issues a 1-hour signed **GET** URL for a project file (any project member). |
| `POST /v1/files/delete` | Deletes a background and everything derived from it. |
| `POST /v1/backgrounds/pdf` | Renders one PDF sheet to PNG (pdf.js + @napi-rs/canvas, ≤ 7000 px) next to the source. |
| `POST /v1/backgrounds/dxf` | Flattens a DXF to drawable JSON (paths + text) next to the source. |
| `POST /v1/sweep` | Generates and analyses a grid of layouts (nodes/rack × arrangement × cooling, ≤ 120 cases). |
| `GET /health` | Liveness. (`/healthz` also answers locally, but Cloud Run reserves it on `run.app` URLs.) |

```
 Browser (drybulb.com, signed in)                      Cloud Run: rackline-api
   │  Bearer <Supabase access token>  ───────────────▶   verify token with Supabase Auth
   │                                                      sign URLs as its own SA (IAM signBlob)
   │                                                      check rackline_role(project) in Postgres as the caller
   │  PUT file ─────────▶ gs://drybulb-rackline/projects/<project id>/<uuid>/<file>   (private)
   │                                                      render PDF → .pNN.png, DXF → .json
   ◀── signed GET URLs ──────────────────────────────────
 Project documents (layout, racks, striping …) stay in Supabase table rackline_projects
 (docs/rackline/rackline-projects.sql); the doc stores only the object path.
```

- **One engine, two hosts.** The service imports `lib/rackline/` directly (the Docker
  build copies it in), so a sweep on Cloud Run gives the same numbers as the browser.
- **Private bucket, per-project folders.** Unlike `gs://drybulb-jobs`, nothing here is
  public. Files sit under `projects/<project id>/`; before signing any URL the service
  asks Postgres for the caller's role on that project (`rackline_role()`, the same
  function the RLS policies use). Members of the project can read; owners, editors and
  Drybulb staff can write; everyone else gets 403. A customer's drawings are therefore
  visible exactly to the people the customer (or Drybulb staff) invited.
- **No keys.** URLs are signed through IAM `signBlob` as the service account, which
  needs *Service Account Token Creator* on itself.
- **Local dev without the service.** If `NEXT_PUBLIC_RACKLINE_API_URL` is unset the
  tool renders PDFs and parses DXFs in the browser and keeps the drawing for the
  session only; sweeps run in the browser.

## Deployed resources

| Thing | Value |
|---|---|
| GCP project | `wordpress103020` |
| Region | `us-central1` |
| Cloud Run service | `rackline-api` |
| Service account | `rackline-api@wordpress103020.iam.gserviceaccount.com` |
| GCS bucket | `gs://drybulb-rackline` (private, uniform access, CORS for drybulb.com) |
| Image | `us-central1-docker.pkg.dev/wordpress103020/rackline/rackline-api:latest` |
| Service URL | `https://rackline-api-542063411217.us-central1.run.app` |

## One-time setup (PowerShell, from the repo root)

```powershell
$P = "wordpress103020"; $R = "us-central1"; $SA = "rackline-api@$P.iam.gserviceaccount.com"

# Private bucket + CORS for browser PUT/GET via signed URLs
gcloud storage buckets create gs://drybulb-rackline --project=$P --location=$R --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://drybulb-rackline --cors-file=services/rackline-api/bucket-cors.json

# Service account: read/write the bucket, sign URLs as itself
gcloud iam service-accounts create rackline-api --project=$P --display-name="Rackline API"
gcloud storage buckets add-iam-policy-binding gs://drybulb-rackline --member=serviceAccount:$SA --role=roles/storage.objectAdmin
gcloud iam service-accounts add-iam-policy-binding $SA --project=$P --member=serviceAccount:$SA --role=roles/iam.serviceAccountTokenCreator

# Image repository
gcloud artifacts repositories create rackline --repository-format=docker --location=$R --project=$P
```

## Build and deploy

```powershell
gcloud builds submit . --config services/rackline-api/cloudbuild.yaml --project wordpress103020

gcloud run deploy rackline-api `
  --image us-central1-docker.pkg.dev/wordpress103020/rackline/rackline-api:latest `
  --region us-central1 --project wordpress103020 `
  --service-account rackline-api@wordpress103020.iam.gserviceaccount.com `
  --allow-unauthenticated `
  --set-env-vars GCS_BUCKET=drybulb-rackline,SUPABASE_URL=<NEXT_PUBLIC_SUPABASE_URL>,SUPABASE_ANON_KEY=<NEXT_PUBLIC_SUPABASE_ANON_KEY>,ALLOWED_ORIGINS=https://www.drybulb.com,https://drybulb.com,http://localhost:3000 `
  --memory 2Gi --cpu 2 --timeout 120 --max-instances 5
```

`--allow-unauthenticated` only opens the network path; every `/v1` call is still
authenticated with the caller's Supabase session. Use the anon key, never the
service-role key — the service only needs to ask Supabase who a token belongs to.

Then point the website at it (Heroku + `.env.local`), and add the URL to the
`connect-src` list in `next.config.ts`:

```powershell
heroku config:set NEXT_PUBLIC_RACKLINE_API_URL=https://rackline-api-<hash>-uc.a.run.app -a <your-heroku-app>
```

## Local run

```powershell
cd services/rackline-api; npm install
$env:SUPABASE_URL="…"; $env:SUPABASE_ANON_KEY="…"; $env:GCS_BUCKET="drybulb-rackline"
gcloud auth application-default login   # signs URLs as you locally
npm start                                # http://localhost:8080/health
```
