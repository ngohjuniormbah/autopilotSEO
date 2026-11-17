# AutopilotSEO

AutopilotSEO is a search-visibility workspace. The MVP lets a user register, connect a website, crawl a bounded set of public pages, inspect technical/on-page SEO issues, calculate a deterministic health score, and receive AI-prioritized recommendations.

## Architecture

- **Frontend:** Next.js 16 + TypeScript + Tailwind, deployed on Vercel.
- **Backend:** FastAPI + Python, deployed on Render.
- **Database:** Supabase Postgres.
- **Identity:** Supabase Auth. The browser sends Supabase access tokens to FastAPI; FastAPI verifies JWT signatures and scopes every database query to the authenticated user.
- **AI:** OpenAI Responses API. The deterministic rules engine computes findings and score; AI only prioritizes/explains findings and generates metadata.
- **Crawl limits:** Up to 12 same-host HTTPS pages per audit, 1 MB response limit per page, bounded redirects, request timeouts, public-DNS checks, and robots.txt directives.

The former Cloudflare Worker/D1/Resend backend is no longer the active architecture.

## 1. Supabase setup

1. Create a Supabase project.
2. In **SQL Editor**, run the complete contents of `backend/schema.sql`.
3. In **Authentication → URL Configuration**, set your Vercel site as the Site URL and add these Redirect URLs:
   - `https://YOUR-VERCEL-DOMAIN/verify-email`
   - `https://YOUR-VERCEL-DOMAIN/new-password`
   - `http://localhost:3000/verify-email`
   - `http://localhost:3000/new-password`
4. In **Project Settings → API**, copy the Project URL and publishable/anon key. These are the only Supabase values exposed to the browser.
5. In **Project Settings → Database**, copy a PostgreSQL connection string. For Render, prefer the Supabase Session Pooler connection string if the direct database host is unreachable from Render. Use the password-safe URI format and URL-encode special characters.

### Supabase email templates

The frontend supports Supabase OTP verification links. Configure the confirmation email template to link to:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup">Verify email</a>
```

Configure the password recovery template to link to:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

Use the correct template variables shown in your Supabase project's email template editor. Confirm that the Site URL and redirect allowlist match the deployed domain.

## 2. Render backend setup

Create a Render Web Service from this repository. Use the checked-in `backend/render.yaml` Blueprint or configure:

- Root Directory: `backend`
- Runtime: Python
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/health`

Set these environment variables in Render:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Supabase Project URL |
| `DATABASE_URL` | Supabase Postgres connection string |
| `SUPABASE_JWT_SECRET` | Legacy JWT secret only if the project uses HS256; asymmetric JWTs use Supabase JWKS |
| `OPENAI_API_KEY` | Server-side OpenAI API key |
| `FRONTEND_ORIGIN` | Exact Vercel origin, e.g. `https://your-app.vercel.app` |

Never put the database password, JWT secret, or OpenAI key in a `NEXT_PUBLIC_*` variable.

## 3. Vercel frontend setup

Import this GitHub repository into Vercel. Framework preset: Next.js. Root directory: repository root. Build command: `npm run build`.

Set these Vercel environment variables for Preview and Production:

- `NEXT_PUBLIC_API_URL`: deployed Render service URL, e.g. `https://autopilotseo-api.onrender.com`
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase publishable/anon key

For local development, copy `.env.example` to `.env.local`, install dependencies with `npm ci`, then run `npm run dev`.

## MVP workflow

1. Sign up and verify email through Supabase Auth.
2. Log in and open the workspace.
3. Add an HTTPS website.
4. FastAPI stores the site under the authenticated Supabase user.
5. The crawler checks up to 12 pages and common technical/on-page signals.
6. A deterministic score and issue list are stored in Supabase Postgres.
7. OpenAI optionally produces prioritized recommendations from observed findings.

## API endpoints

- `GET /health`
- `GET /sites`
- `POST /sites`
- `GET /sites/{site_id}/audits`
- `POST /sites/{site_id}/audits`
- `GET /audits/{audit_id}`
- `POST /metadata/generate`

## Known MVP limitations

- Google Search Console OAuth and real click/impression data are not implemented.
- The crawler is synchronous and intentionally capped. Move crawling into a durable background queue before increasing crawl limits or adding scheduled audits.
- The AI visibility section in the demo dashboard remains illustrative; it does not query ChatGPT, Perplexity, or other AI search systems.
- SEO score is a transparent heuristic, not a Google ranking score.
- DNS is checked before requests and redirects are revalidated; production hardening should bind outbound connections to validated IPs or use an isolated egress proxy to fully eliminate DNS-rebinding risk.
- Render free instances may sleep; use an always-on service for a dependable live demo and customer-facing crawl execution.
