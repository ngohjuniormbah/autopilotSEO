# AutopilotSEO API (FastAPI)

## Render deployment

Use a Render Web Service connected to the repository and branch `feat/fastapi-supabase-mvp` (or the production branch after merging). Configure:

- Root directory: `backend`
- Runtime: Python 3
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check: `/health`

Set these server-side environment variables in Render:

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `DATABASE_URL` | Supabase Postgres connection string; use the Session Pooler if direct connectivity is unavailable |
| `SUPABASE_JWT_SECRET` | Required only for legacy HS256 Supabase JWT projects; asymmetric signing uses Supabase JWKS |
| `OPENAI_API_KEY` | Optional server-side key for recommendations and metadata generation |
| `MAX_SITES_PER_USER` | Optional; defaults to 10 |
| `MAX_AUDITS_PER_USER_PER_DAY` | Optional; defaults to 20 |
| `AUDIT_TIMEOUT_SECONDS` | Optional; defaults to 75 |
| `LOG_LEVEL` | Optional; defaults to INFO |

Do not expose database credentials, JWT secrets, or OpenAI keys to the browser.

## Database

Run `backend/schema.sql` once in the Supabase SQL Editor. The API uses the Postgres connection string directly and scopes every application query by the authenticated Supabase user ID. Keep RLS enabled as defense in depth.

## Health and readiness

- `GET /health`: process health; used by Render.
- `GET /ready`: verifies the Postgres connection and returns 503 if the database is unavailable.
- `GET /docs`: interactive API documentation; disable or protect this before a broader public launch if desired.

## Current MVP operating limits

- Maximum 10 registered sites per user by default.
- Maximum 20 audits per user in a rolling 24-hour window by default.
- Two concurrent audits per Render process.
- 75-second audit deadline by default.
- Up to 12 same-host HTTPS HTML pages per audit.
- 1 MB decoded response-body limit per fetched resource.
- Four same-host HTTPS redirects maximum; cross-host redirects are rejected.
- Public DNS address checks before outbound requests.
- Robots.txt directives are respected.
- OpenAI recommendations are optional; a missing or failing AI service does not invalidate deterministic SEO findings.
- Audits run synchronously inside the API request. Keep the crawl cap low. A durable queue/worker is required before adding long crawls, scheduled scans, or high concurrency.

## Security and deployment caveats

The API uses bearer-token JWT verification and per-user database scoping. CORS is configured for bearer-token browser clients and is not an authentication mechanism. The crawler rejects private/non-public DNS answers, IP literals, non-HTTPS destinations, and cross-host redirects. DNS is checked before each request, but fully eliminating DNS-rebinding risk requires binding outbound connections to the validated IP or using an isolated egress proxy. Do not treat this MVP crawler as a general-purpose URL fetch service.

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export DATABASE_URL="YOUR_POSTGRES_CONNECTION_STRING"
uvicorn app.main:app --reload
```

Run backend tests from the `backend` directory:

```bash
pip install pytest pytest-asyncio
pytest -q
```
