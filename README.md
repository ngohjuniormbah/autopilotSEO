# AutopilotSEO

Next.js 16 + TypeScript + Tailwind frontend deployed to Cloudflare Workers, with a separate TypeScript Worker API, Cloudflare D1, Resend transactional email, and OpenAI Responses API. No secrets are committed.

## Local setup

Requires Node.js 20.9 or later. Install the web dependencies from the repository root:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

For the API, create `workers/api/.dev.vars` from `.dev.vars.example`, put test-only credentials there, then:

```bash
cd workers/api
npm install
npm run db:local
npm run dev
```

Set `NEXT_PUBLIC_API_URL` in the web app to the local API URL. The API only accepts the exact `APP_ORIGIN` configured in its Wrangler vars.

## Cloudflare resources and deploy

1. Create the D1 database and take its returned ID:

   ```bash
   cd workers/api
   npx wrangler d1 create autopilotseo
   ```

2. Put that ID in `workers/api/wrangler.toml`. Apply the checked-in migration:

   ```bash
   npx wrangler d1 migrations apply autopilotseo --remote
   ```

   To execute the SQL file directly instead of the migrations runner:

   ```bash
   npx wrangler d1 execute autopilotseo --remote --file=migrations/0001_initial.sql
   ```

3. Add the API secrets. Use a verified sender/domain from Resend and an OpenAI project API key:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put EMAIL_FROM
   npx wrangler secret put OPENAI_API_KEY
   ```

4. Set `APP_ORIGIN` in the API Worker to the deployed web origin, then deploy the API:

   ```bash
   npx wrangler deploy
   ```

5. Set `NEXT_PUBLIC_API_URL` in the web build environment to the deployed API origin. Install root dependencies, authenticate Wrangler with the intended Cloudflare account, and deploy the frontend Worker:

   ```bash
   cd ../..
   npm ci
   npm run deploy
   ```

For the safest cookie behavior, use the same registrable domain for the web app and API (for example `app.example.com` and `api.example.com`) and HTTPS in production. The frontend and API are separate Workers so API deployments and secrets remain isolated.

## Authentication and AI

- Sign-up requires a verified email before login. Verification and password reset links are single-use, hashed at rest, and expire.
- Passwords are stored as PBKDF2-SHA-256 hashes. Sessions use random opaque tokens in `HttpOnly`, `Secure` (on HTTPS), `SameSite=Lax` cookies.
- Login, signup, and reset requests use Cloudflare's configured rate limiter. Reset responses do not disclose whether an email is registered.
- The authenticated `/ai/visibility-summary` endpoint uses the OpenAI Responses API. The OpenAI key is read only from a Worker secret; never expose it in a `NEXT_PUBLIC_*` variable.
- Email delivery requires a Resend account and verified sending domain. Until configured, sign-up reports a delivery error and does not create a usable account.
- Set an appropriate Cloudflare Workers paid plan/CPU budget for password hashing and enable D1 backups/monitoring before production traffic.

## Routes

Web: `/`, `/login`, `/signup`, `/verify-email?token=…`, `/reset-password`, `/new-password?token=…`, `/privacy`, `/terms`, `/app`.

API: `/health`, `/auth/signup`, `/auth/verify-email`, `/auth/login`, `/auth/logout`, `/auth/me`, `/auth/password-reset/request`, `/auth/password-reset/confirm`, `/ai/visibility-summary`.

## Environment files

- Root `.env.local`: `NEXT_PUBLIC_API_URL` only.
- `workers/api/.dev.vars`: local API secrets (ignored by Git).
- Production secrets: Cloudflare Worker secret bindings set with `wrangler secret put`.
