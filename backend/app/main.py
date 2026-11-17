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

import asyncpg
import httpx
import jwt
from bs4 import BeautifulSoup
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from jwt import PyJWKClient
from pydantic import BaseModel, Field

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
DATABASE_URL = os.environ["DATABASE_URL"]
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
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
    allow_origins=[FRONTEND_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
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
        response = await client.get(current, follow_redirects=False)
        if response.status_code not in {301, 302, 303, 307, 308}:
            return response
        location = response.headers.get("location")
        if not location:
            return response
        current = urljoin(current, location)
        parsed = urlparse(current)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            raise HTTPException(400, "Unsafe redirect blocked.")
    raise HTTPException(400, "Too many redirects.")


def page_facts(url: str, html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    description_tag = soup.find("meta", attrs={"name": re.compile("^description$", re.I)})
    description = description_tag.get("content", "").strip() if description_tag else ""
    h1s = [node.get_text(" ", strip=True) for node in soup.find_all("h1")]
    canonical_tag = soup.find("link", rel=lambda value: value and "canonical" in value)
    canonical = canonical_tag.get("href", "") if canonical_tag else ""
    images = soup.find_all("img")
    missing_alt = sum(1 for image in images if not image.get("alt", "").strip())
    links = []
    for anchor in soup.find_all("a", href=True):
        target = urldefrag(urljoin(url, anchor["href"].strip()))[0]
        if urlparse(target).scheme in {"http", "https"}:
            links.append(target)
    text = soup.get_text(" ", strip=True)
    return {
        "url": url, "title": title[:500], "description": description[:1000],
        "h1s": h1s[:10], "canonical": canonical, "images": len(images),
        "images_missing_alt": missing_alt, "word_count": len(text.split()),
        "links": list(dict.fromkeys(links))[:100],
    }


def inspect_page(facts: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    title, desc, h1s = facts["title"], facts["description"], facts["h1s"]
    def add(code: str, severity: str, message: str, fix: str):
        issues.append({"code": code, "severity": severity, "url": facts["url"], "title": message, "description": fix})
    if not title:
        add("missing_title", "critical", "Missing title tag", "Add a unique, descriptive title of roughly 30–60 characters.")
    elif len(title) < 20 or len(title) > 60:
        add("title_length", "warning", f"Title length is {len(title)} characters", "Rewrite the title to communicate the page topic clearly in about 30–60 characters.")
    if not desc:
        add("missing_description", "warning", "Missing meta description", "Add a unique description of roughly 120–160 characters that accurately summarizes the page.")
    elif len(desc) < 70 or len(desc) > 160:
        add("description_length", "notice", f"Meta description length is {len(desc)} characters", "Aim for a concise, compelling description around 120–160 characters.")
    if not h1s:
        add("missing_h1", "critical", "No H1 heading found", "Add one clear H1 that describes the primary topic of this page.")
    elif len(h1s) > 1:
        add("multiple_h1", "notice", f"{len(h1s)} H1 headings found", "Use one primary H1 and organize subtopics with H2 and H3 headings.")
    if not facts["canonical"]:
        add("missing_canonical", "warning", "Canonical URL is missing", "Add a canonical link element pointing to the preferred URL for this page.")
    if facts["images_missing_alt"]:
        add("missing_image_alt", "warning", f'{facts["images_missing_alt"]} images lack alt text', "Add meaningful alt text to informative images; use empty alt text for decorative images.")
    if facts["word_count"] < 120:
        add("thin_content", "notice", "Page has relatively little text", "Check whether the page fully answers its search intent. Add useful information only where it improves the page.")
    return issues


async def crawl_site(base_url: str) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    host = urlparse(base_url).hostname
    queue = deque([base_url])
    visited: set[str] = set()
    pages: list[dict[str, Any]] = []
    issues: list[dict[str, str]] = []
    failures: list[str] = []
    headers = {"User-Agent": "AutopilotSEO-Bot/0.1 (+https://autopilotseo.com/bot)"}
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=headers) as client:
        while queue and len(visited) < MAX_PAGES:
            url = queue.popleft()
            parsed = urlparse(url)
            if parsed.hostname != host or parsed.scheme != "https" or url in visited:
                continue
            visited.add(url)
            try:
                response = await safe_get(client, url)
                if response.status_code != 200:
                    failures.append(f"{url} returned HTTP {response.status_code}")
                    issues.append({"code": "http_status", "severity": "critical", "url": url, "title": f"Page returned HTTP {response.status_code}", "description": "Resolve the server or routing issue so important pages return HTTP 200."})
                    continue
                content_type = response.headers.get("content-type", "")
                if "text/html" not in content_type.lower():
                    continue
                body = response.content[:MAX_HTML_BYTES]
                facts = page_facts(str(response.url), body.decode(response.encoding or "utf-8", errors="replace"))
                pages.append(facts)
                issues.extend(inspect_page(facts))
                for link in facts["links"]:
                    target = urlparse(link)
                    if target.hostname == host and target.scheme == "https" and link not in visited and len(queue) < MAX_PAGES * 4:
                        queue.append(link)
            except (httpx.HTTPError, UnicodeError, ValueError) as exc:
                failures.append(f"{url}: {type(exc).__name__}")
    # Site-level discovery checks
    async with httpx.AsyncClient(timeout=TIMEOUT, headers=headers) as client:
        for path, code, label in [("/robots.txt", "missing_robots", "robots.txt"), ("/sitemap.xml", "missing_sitemap", "XML sitemap")]:
            try:
                response = await safe_get(client, urljoin(base_url + "/", path.lstrip("/")))
                if response.status_code >= 400:
                    issues.append({"code": code, "severity": "warning", "url": base_url, "title": f"{label} not found", "description": f"Publish a valid {label} at the standard location and reference your sitemap from robots.txt."})
            except Exception:
                issues.append({"code": code, "severity": "warning", "url": base_url, "title": f"Could not verify {label}", "description": f"Confirm that {label} is publicly accessible."})
    return pages, issues, failures


def calculate_score(pages: list[dict[str, Any]], issues: list[dict[str, str]]) -> int:
    if not pages:
        return 0
    weights = {"critical": 12, "warning": 5, "notice": 2}
    deductions = sum(weights.get(issue["severity"], 1) for issue in issues)
    return max(0, min(100, round(100 - deductions / max(1, len(pages)) * 1.6)))


async def generate_recommendations(issues: list[dict[str, str]], site_url: str) -> list[dict[str, str]]:
    if not OPENAI_API_KEY or not issues:
        return []
    prompt = {
        "site": site_url,
        "issues": issues[:40],
        "instruction": "Return JSON array of at most 5 prioritized recommendations. Each item must have title, priority (high|medium|low), reason, action. Only use supplied findings; do not claim rankings or traffic impact."
    }
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {OPENAI_API_KEY}"}, json={
            "model": "gpt-4.1-mini",
            "input": [{"role": "system", "content": "You are a technical SEO analyst. Return only valid JSON, no markdown."}, {"role": "user", "content": json.dumps(prompt)}],
            "text": {"format": {"type": "json_object"}}
        })
    if response.status_code >= 400:
        return []
    data = response.json()
    output = "".join(part.get("text", "") for item in data.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text")
    try:
        parsed = json.loads(output)
        items = parsed.get("recommendations", parsed if isinstance(parsed, list) else [])
        return items[:5]
    except (json.JSONDecodeError, AttributeError):
        return []


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
    pages, issues, failures = await crawl_site(site["url"])
    score = calculate_score(pages, issues)
    recommendations = await generate_recommendations(issues, site["url"])
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
