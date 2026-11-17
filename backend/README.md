# AutopilotSEO API (FastAPI)

## Deploy on Render
Create a web service from this repository and use `backend/render.yaml`, or set:
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Set these server-side environment variables:
- `SUPABASE_URL`: project URL
- `SUPABASE_JWT_SECRET`: legacy JWT secret if the project issues HS256 tokens; for asymmetric signing keys, the API uses Supabase's JWKS endpoint.
- `DATABASE_URL`: Supabase Postgres connection string (use the Session pooler if Render cannot reach direct IPv6).
- `OPENAI_API_KEY`: OpenAI project key
- `FRONTEND_ORIGIN`: exact Vercel production origin, e.g. https://your-app.vercel.app

## Database
Open Supabase SQL Editor and run `backend/schema.sql` once. Do not expose the database password, service-role key, JWT secret, or OpenAI key in Next.js public variables.

## Local development
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SUPABASE_URL=...
export DATABASE_URL=...
export FRONTEND_ORIGIN=http://localhost:3000
uvicorn app.main:app --reload
```

The audit currently crawls up to 12 same-host HTTPS pages per request. It checks titles, descriptions, H1 structure, canonical tags, image alt text, page text volume, robots.txt and sitemap.xml. The score is deterministic; AI only prioritizes the observed findings. Crawling is bounded by request timeout, response size, page count, HTTPS-only requests, public-DNS checks and redirect validation. Run longer audits in a dedicated queue/worker before adding scheduled monitoring.
