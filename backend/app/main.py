from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import socket
import uuid
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urljoin, urlparse

import asyncpg
import httpx
import jwt
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jwt import PyJWKClient
from pydantic import BaseModel, Field, field_validator

from .crawler import calculate_score, crawl_site, generate_recommendations

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper())
logger = logging.getLogger("autopilotseo")

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
DATABASE_URL = os.environ["DATABASE_URL"]
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
MAX_SITES_PER_USER = int(os.getenv("MAX_SITES_PER_USER", "10"))
MAX_AUDITS_PER_USER_PER_DAY = int(os.getenv("MAX_AUDITS_PER_USER_PER_DAY", "20"))
AUDIT_TIMEOUT_SECONDS = int(os.getenv("AUDIT_TIMEOUT_SECONDS", "75"))
MAX_HTML_BYTES = 1_000_000
CRAWL_CONCURRENCY = asyncio.Semaphore(2)
jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = None
    last_error: Exception | None = None
    for attempt in range(5):
        try:
            pool = await asyncpg.create_pool(
                DATABASE_URL,
                min_size=1,
                max_size=5,
                command_timeout=15,
                timeout=10,
                server_settings={"application_name": "autopilotseo-api"},
            )
            async with pool.acquire() as connection:
                await connection.fetchval("SELECT 1")
            break
        except Exception as exc:
            last_error = exc
            logger.exception("Database connection attempt %s/5 failed", attempt + 1)
            if pool is not None:
                await pool.close()
                pool = None
            if attempt < 4:
                await asyncio.sleep(min(2 ** attempt, 10))
    if pool is None:
        raise RuntimeError("Could not connect to Supabase Postgres during startup") from last_error
    app.state.pool = pool
    logger.info("AutopilotSEO API started; database connection verified")
    try:
        yield
    finally:
        await pool.close()
        logger.info("Database pool closed")


app = FastAPI(title="AutopilotSEO API", version="0.2.0", lifespan=lifespan)
# The API uses bearer-token authentication, not browser cookies. CORS is not
# an access-control boundary; JWT verification and per-user SQL scopes are.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


async def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    if not token or len(token) > 16_384:
        raise HTTPException(401, "Invalid session token")
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")
        if algorithm == "HS256":
            if not SUPABASE_JWT_SECRET:
                raise ValueError("Legacy HS256 verification is not configured")
            payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")
        elif algorithm in {"ES256", "RS256"}:
            signing_key = await asyncio.to_thread(jwks_client.get_signing_key_from_jwt, token)
            payload = jwt.decode(token, signing_key.key, algorithms=[algorithm], audience="authenticated")
        else:
            raise ValueError("Unsupported JWT algorithm")
        if payload.get("iss") != f"{SUPABASE_URL}/auth/v1":
            raise ValueError("Invalid issuer")
        user_id = str(uuid.UUID(payload["sub"]))
        return {"id": user_id, "email": str(payload.get("email", ""))}
    except Exception as exc:
        logger.info("Rejected invalid bearer token: %s", type(exc).__name__)
        raise HTTPException(401, "Session is invalid or expired") from None


async def db():
    pool = getattr(app.state, "pool", None)
    if pool is None:
        raise HTTPException(503, "Database is not ready")
    return pool


class SiteInput(BaseModel):
    url: str = Field(min_length=4, max_length=2048)


class MetadataInput(BaseModel):
    page_url: str = Field(min_length=8, max_length=2048)
    title: str = Field(max_length=300)
    description: str = Field(max_length=1000)
    keywords: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("page_url")
    @classmethod
    def validate_page_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("page_url must be a public HTTPS URL")
        return value


def normalize_site(raw: str) -> str:
    candidate = raw.strip()
    if not candidate.startswith(("https://", "http://")):
        candidate = "https://" + candidate
    parsed = urlparse(candidate)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise HTTPException(400, "Enter a valid HTTPS website URL.")
    host = parsed.hostname.lower().rstrip(".")
    if host in {"localhost", "localhost.localdomain"} or "." not in host:
        raise HTTPException(400, "Local and private hosts are not allowed.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise HTTPException(400, "IP address targets are not allowed.")
    return f"https://{host}"


async def assert_public_host(url: str) -> None:
    parsed = urlparse(url)
    host = parsed.hostname
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise HTTPException(400, "Only public HTTPS destinations are allowed.")
    try:
        records = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM),
            timeout=4,
        )
        addresses = {record[4][0] for record in records}
        if not addresses or any(not ipaddress.ip_address(value).is_global for value in addresses):
            raise HTTPException(400, "The target resolves to a non-public network.")
    except (socket.gaierror, asyncio.TimeoutError):
        raise HTTPException(400, "The website domain could not be resolved.") from None


async def safe_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    initial = urlparse(url)
    expected_host = (initial.hostname or "").lower()
    current = url
    for _ in range(4):
        await assert_public_host(current)
        async with client.stream("GET", current, follow_redirects=False) as streamed:
            if streamed.status_code in {301, 302, 303, 307, 308}:
                location = streamed.headers.get("location")
                if not location:
                    return httpx.Response(streamed.status_code, headers=streamed.headers, request=streamed.request)
                redirected = urlparse(urljoin(current, location))
                if (
                    redirected.scheme != "https"
                    or not redirected.hostname
                    or redirected.hostname.lower() != expected_host
                    or redirected.username
                    or redirected.password
                ):
                    raise HTTPException(400, "Cross-host or unsafe redirect blocked.")
                current = redirected.geturl()
                continue
            chunks: list[bytes] = []
            size = 0
            async for chunk in streamed.aiter_bytes():
                size += len(chunk)
                if size > MAX_HTML_BYTES:
                    raise HTTPException(413, "Page exceeds the 1 MB crawl limit.")
                chunks.append(chunk)
            return httpx.Response(
                streamed.status_code,
                headers=streamed.headers,
                content=b"".join(chunks),
                request=streamed.request,
            )
    raise HTTPException(400, "Too many redirects.")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "autopilotseo-api"}


@app.get("/ready")
async def readiness(pool=Depends(db)):
    try:
        await pool.fetchval("SELECT 1")
        return {"status": "ready", "database": "connected"}
    except Exception:
        logger.exception("Readiness database check failed")
        raise HTTPException(503, "Database is unavailable") from None


@app.get("/sites")
async def list_sites(user=Depends(current_user), pool=Depends(db)):
    rows = await pool.fetch(
        "SELECT id, url, created_at FROM sites WHERE user_id=$1 ORDER BY created_at DESC",
        uuid.UUID(user["id"]),
    )
    return {"sites": [dict(row) for row in rows]}


@app.post("/sites", status_code=201)
async def create_site(body: SiteInput, user=Depends(current_user), pool=Depends(db)):
    url = normalize_site(body.url)
    await assert_public_host(url)
    user_id = uuid.UUID(user["id"])
    existing = await pool.fetchrow("SELECT id,url,created_at FROM sites WHERE user_id=$1 AND url=$2", user_id, url)
    if existing:
        return {"site": dict(existing)}
    count = await pool.fetchval("SELECT count(*) FROM sites WHERE user_id=$1", user_id)
    if count >= MAX_SITES_PER_USER:
        raise HTTPException(429, f"Your account is limited to {MAX_SITES_PER_USER} websites in the MVP.")
    row = await pool.fetchrow(
        "INSERT INTO sites(user_id,url) VALUES($1,$2) ON CONFLICT(user_id,url) DO UPDATE SET url=EXCLUDED.url RETURNING id,url,created_at",
        user_id,
        url,
    )
    return {"site": dict(row)}


@app.get("/sites/{site_id}/audits")
async def audit_history(site_id: uuid.UUID, user=Depends(current_user), pool=Depends(db)):
    site = await pool.fetchrow(
        "SELECT id FROM sites WHERE id=$1 AND user_id=$2",
        site_id,
        uuid.UUID(user["id"]),
    )
    if not site:
        raise HTTPException(404, "Website not found")
    rows = await pool.fetch(
        "SELECT id,score,pages_crawled,issue_count,status,created_at FROM audits WHERE site_id=$1 ORDER BY created_at DESC LIMIT 20",
        site_id,
    )
    return {"audits": [dict(row) for row in rows]}


@app.post("/sites/{site_id}/audits", status_code=201)
async def run_audit(site_id: uuid.UUID, user=Depends(current_user), pool=Depends(db)):
    user_id = uuid.UUID(user["id"])
    site = await pool.fetchrow(
        "SELECT id,url FROM sites WHERE id=$1 AND user_id=$2",
        site_id,
        user_id,
    )
    if not site:
        raise HTTPException(404, "Website not found")
    audits_today = await pool.fetchval(
        "SELECT count(*) FROM audits a JOIN sites s ON s.id=a.site_id WHERE s.user_id=$1 AND a.created_at >= now() - interval '24 hours'",
        user_id,
    )
    if audits_today >= MAX_AUDITS_PER_USER_PER_DAY:
        raise HTTPException(429, f"Daily MVP audit limit reached ({MAX_AUDITS_PER_USER_PER_DAY}).")
    if CRAWL_CONCURRENCY.locked():
        raise HTTPException(503, "The audit service is busy. Please retry in a minute.")
    try:
        async with CRAWL_CONCURRENCY:
            pages, issues, failures = await asyncio.wait_for(
                crawl_site(site["url"], safe_get),
                timeout=AUDIT_TIMEOUT_SECONDS,
            )
            if not pages:
                detail = failures[0] if failures else "The crawler could not access any HTML pages."
                raise HTTPException(422, f"Audit could not inspect this website: {detail[:240]}")
            score = calculate_score(pages, issues)
            recommendations = await generate_recommendations(issues, site["url"], OPENAI_API_KEY)
    except asyncio.TimeoutError:
        raise HTTPException(504, "The website audit exceeded its time limit. Try a smaller or faster website.") from None
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected audit failure for site %s", site_id)
        raise HTTPException(502, "The website audit failed unexpectedly. Please retry.") from None

    async with pool.acquire() as connection:
        async with connection.transaction():
            audit = await connection.fetchrow(
                """INSERT INTO audits(site_id,score,pages_crawled,issue_count,status,failures,recommendations)
                   VALUES($1,$2,$3,$4,'completed',$5::jsonb,$6::jsonb)
                   RETURNING id,score,pages_crawled,issue_count,status,created_at""",
                site_id,
                score,
                len(pages),
                len(issues),
                json.dumps(failures),
                json.dumps(recommendations),
            )
            await connection.executemany(
                """INSERT INTO audit_pages(audit_id,url,title,description,h1_count,canonical,images_count,images_missing_alt,word_count)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)""",
                [
                    (audit["id"], page["url"], page["title"], page["description"], len(page["h1s"]), page["canonical"], page["images"], page["images_missing_alt"], page["word_count"])
                    for page in pages
                ],
            )
            await connection.executemany(
                "INSERT INTO audit_issues(audit_id,code,severity,url,title,description) VALUES($1,$2,$3,$4,$5,$6)",
                [(audit["id"], issue["code"], issue["severity"], issue["url"], issue["title"], issue["description"]) for issue in issues],
            )
    return {"audit": dict(audit), "issues": issues, "pages": pages, "recommendations": recommendations, "failures": failures}


@app.get("/audits/{audit_id}")
async def get_audit(audit_id: uuid.UUID, user=Depends(current_user), pool=Depends(db)):
    row = await pool.fetchrow(
        """SELECT a.*,s.url AS site_url FROM audits a JOIN sites s ON s.id=a.site_id
           WHERE a.id=$1 AND s.user_id=$2""",
        audit_id,
        uuid.UUID(user["id"]),
    )
    if not row:
        raise HTTPException(404, "Audit not found")
    pages = await pool.fetch("SELECT * FROM audit_pages WHERE audit_id=$1 ORDER BY url", audit_id)
    issues = await pool.fetch(
        "SELECT * FROM audit_issues WHERE audit_id=$1 ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END",
        audit_id,
    )
    result = dict(row)
    result["pages"] = [dict(page) for page in pages]
    result["issues"] = [dict(issue) for issue in issues]
    return result


@app.post("/metadata/generate")
async def metadata_generate(body: MetadataInput, user=Depends(current_user)):
    if not OPENAI_API_KEY:
        raise HTTPException(503, "AI generation is not configured.")
    prompt = {
        "url": body.page_url,
        "current_title": body.title,
        "current_description": body.description,
        "keywords": body.keywords,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=4.0)) as client:
            response = await client.post(
                "https://api.openai.com/v1/responses",
                headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
                json={
                    "model": "gpt-4.1-mini",
                    "input": [
                        {"role": "system", "content": "Generate accurate SEO metadata. Never invent facts about the business. Return JSON with title, description, rationale."},
                        {"role": "user", "content": json.dumps(prompt)},
                    ],
                    "text": {"format": {"type": "json_object"}},
                },
            )
            response.raise_for_status()
        data = response.json()
        output = "".join(
            part.get("text", "")
            for item in data.get("output", [])
            for part in item.get("content", [])
            if part.get("type") == "output_text"
        )
        result = json.loads(output)
        if not isinstance(result, dict):
            raise ValueError("Expected JSON object")
        return result
    except (httpx.HTTPError, ValueError, TypeError):
        logger.exception("Metadata generation failed")
        raise HTTPException(502, "AI metadata generation is temporarily unavailable.") from None
