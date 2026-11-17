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

