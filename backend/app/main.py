from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import socket
import uuid
from collections import deque
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser

import asyncpg
import httpx
import jwt
from bs4 import BeautifulSoup
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jwt import PyJWKClient
from pydantic import BaseModel, Field
from .crawler import calculate_score, crawl_site, generate_recommendations

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
DATABASE_URL = os.environ["DATABASE_URL"]
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").strip().rstrip("/")
# Allow the production Vercel project and its preview deployments. Keep the
# configured production origin as an explicit allow-list entry as well.
FRONTEND_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv("FRONTEND_ORIGIN", "http://localhost:3000").split(",")
    if origin.strip()
]
MAX_PAGES = 12
MAX_HTML_BYTES = 1_000_000
TIMEOUT = httpx.Timeout(8.0, connect=4.0)
jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5, command_timeout=20)
    yield
    await app.state.pool.close()


app = FastAPI(title="AutopilotSEO API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    # Vercel preview URLs change per deployment. Restrict the regex to this
    # project slug rather than allowing every *.vercel.app origin.
    allow_origin_regex=r"https://autopilot-seo(?:-[a-z0-9-]+)?\\.vercel\\.app",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)


async def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Authentication required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")
        if algorithm == "HS256" and SUPABASE_JWT_SECRET:
            payload = jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")
        else:
            signing_key = jwks_client.get_signing_key_from_jwt(token).key
            payload = jwt.decode(token, signing_key, algorithms=["ES256", "RS256"], audience="authenticated")
        if payload.get("iss") != f"{SUPABASE_URL}/auth/v1":
            raise ValueError("Invalid issuer")
        return {"id": payload["sub"], "email": payload.get("email", "")}
    except Exception:
        raise HTTPException(401, "Session is invalid or expired")


async def db():
    return app.state.pool


class SiteInput(BaseModel):
    url: str = Field(min_length=4, max_length=2048)


class MetadataInput(BaseModel):
    page_url: str
    title: str = Field(max_length=300)
    description: str = Field(max_length=1000)
    keywords: list[str] = Field(default_factory=list, max_length=20)


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
        raise HTTPException(400, "IP address targets are not allowed.")
    except ValueError:
        pass
    return f"https://{host}"


async def assert_public_host(url: str) -> None:
    host = urlparse(url).hostname
    if not host:
        raise HTTPException(400, "Invalid target host.")
    try:
        records = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        addresses = {record[4][0] for record in records}
        if not addresses or any(not ipaddress.ip_address(value).is_global for value in addresses):
            raise HTTPException(400, "The target resolves to a non-public network.")
    except socket.gaierror:
        raise HTTPException(400, "The website domain could not be resolved.")


async def safe_get(client: httpx.AsyncClient, url: str) -> httpx.Response:
    current = url
    for _ in range(4):
        await assert_public_host(current)
        async with client.stream("GET", current, follow_redirects=False) as streamed:
            if streamed.status_code in {301, 302, 303, 307, 308}:
                location = streamed.headers.get("location")
                if not location:
                    return httpx.Response(streamed.status_code, headers=streamed.headers, request=streamed.request)
                current = urljoin(current, location)
                parsed = urlparse(current)
                if parsed.scheme != "https" or parsed.username or parsed.password:
                    raise HTTPException(400, "Unsafe redirect blocked.")
                continue
            chunks, size = [], 0
            async for chunk in streamed.aiter_bytes():
                size += len(chunk)
                if size > MAX_HTML_BYTES:
                    raise HTTPException(413, "Page exceeds the 1 MB crawl limit.")
                chunks.append(chunk)
            return httpx.Response(streamed.status_code, headers=streamed.headers, content=b"".join(chunks), request=streamed.request)
    raise HTTPException(400, "Too many redirects.")




@app.get("/health")
async def health():
    return {"status": "ok", "service": "autopilotseo-api"}


@app.get("/sites")
async def list_sites(user=Depends(current_user), pool=Depends(db)):
    rows = await pool.fetch("SELECT id, url, created_at FROM sites WHERE user_id=$1 ORDER BY created_at DESC", uuid.UUID(user["id"]))
    return {"sites": [dict(row) for row in rows]}


@app.post("/sites", status_code=201)
async def create_site(body: SiteInput, user=Depends(current_user), pool=Depends(db)):
    url = normalize_site(body.url)
    await assert_public_host(url)
    row = await pool.fetchrow(
        "INSERT INTO sites(user_id,url) VALUES($1,$2) ON CONFLICT(user_id,url) DO UPDATE SET url=EXCLUDED.url RETURNING id,url,created_at",
        uuid.UUID(user["id"]), url
    )
    return {"site": dict(row)}


@app.get("/sites/{site_id}/audits")
async def audit_history(site_id: uuid.UUID, user=Depends(current_user), pool=Depends(db)):
    site = await pool.fetchrow("SELECT id FROM sites WHERE id=$1 AND user_id=$2", site_id, uuid.UUID(user["id"]))
    if not site:
        raise HTTPException(404, "Website not found")
    rows = await pool.fetch("SELECT id,score,pages_crawled,issue_count,status,created_at FROM audits WHERE site_id=$1 ORDER BY created_at DESC LIMIT 20", site_id)
    return {"audits": [dict(row) for row in rows]}


@app.post("/sites/{site_id}/audits", status_code=201)
async def run_audit(site_id: uuid.UUID, user=Depends(current_user), pool=Depends(db)):
    site = await pool.fetchrow("SELECT id,url FROM sites WHERE id=$1 AND user_id=$2", site_id, uuid.UUID(user["id"]))
    if not site:
        raise HTTPException(404, "Website not found")
    pages, issues, failures = await crawl_site(site["url"], safe_get)
    score = calculate_score(pages, issues)
    recommendations = await generate_recommendations(issues, site["url"], OPENAI_API_KEY)
    async with pool.acquire() as connection:
        async with connection.transaction():
            audit = await connection.fetchrow(
                "INSERT INTO audits(site_id,score,pages_crawled,issue_count,status,failures,recommendations) VALUES($1,$2,$3,$4,'completed',$5::jsonb,$6::jsonb) RETURNING id,score,pages_crawled,issue_count,status,created_at",
                site_id, score, len(pages), len(issues), json.dumps(failures), json.dumps(recommendations)
            )
            for page in pages:
                await connection.execute(
                    "INSERT INTO audit_pages(audit_id,url,title,description,h1_count,canonical,images_count,images_missing_alt,word_count) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    audit["id"], page["url"], page["title"], page["description"], len(page["h1s"]), page["canonical"], page["images"], page["images_missing_alt"], page["word_count"]
                )
            for issue in issues:
                await connection.execute(
                    "INSERT INTO audit_issues(audit_id,code,severity,url,title,description) VALUES($1,$2,$3,$4,$5,$6)",
                    audit["id"], issue["code"], issue["severity"], issue["url"], issue["title"], issue["description"]
                )
    return {"audit": dict(audit), "issues": issues, "pages": pages, "recommendations": recommendations, "failures": failures}


@app.get("/audits/{audit_id}")
async def get_audit(audit_id: uuid.UUID, user=Depends(current_user), pool=Depends(db)):
    row = await pool.fetchrow(
        """SELECT a.*,s.url AS site_url FROM audits a JOIN sites s ON s.id=a.site_id
           WHERE a.id=$1 AND s.user_id=$2""", audit_id, uuid.UUID(user["id"])
    )
    if not row:
        raise HTTPException(404, "Audit not found")
    pages = await pool.fetch("SELECT * FROM audit_pages WHERE audit_id=$1 ORDER BY url", audit_id)
    issues = await pool.fetch("SELECT * FROM audit_issues WHERE audit_id=$1 ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END", audit_id)
    result = dict(row)
    result["pages"] = [dict(page) for page in pages]
    result["issues"] = [dict(issue) for issue in issues]
    return result


@app.post("/metadata/generate")
async def metadata_generate(body: MetadataInput, user=Depends(current_user)):
    if not OPENAI_API_KEY:
        raise HTTPException(503, "AI generation is not configured.")
    prompt = {"url": body.page_url, "current_title": body.title, "current_description": body.description, "keywords": body.keywords}
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}, json={
            "model": "gpt-4.1-mini",
            "input": [{"role": "system", "content": "Generate accurate SEO metadata. Never invent facts about the business. Return JSON with title, description, rationale."}, {"role": "user", "content": json.dumps(prompt)}],
            "text": {"format": {"type": "json_object"}}
        })
    if response.status_code >= 400:
        raise HTTPException(502, "AI service is temporarily unavailable.")
    data = response.json()
    output = "".join(part.get("text", "") for item in data.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text")
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        raise HTTPException(502, "AI returned an invalid response.")

