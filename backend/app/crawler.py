from __future__ import annotations

import asyncio
import json
from collections import deque
from typing import Any, Awaitable, Callable
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

MAX_PAGES = 12
BATCH_SIZE = 4
SafeGet = Callable[[httpx.AsyncClient, str], Awaitable[httpx.Response]]


def page_facts(url: str, html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    description_tag = soup.find("meta", attrs={"name": "description"})
    description = description_tag.get("content", "").strip() if description_tag else ""
    h1s = [node.get_text(" ", strip=True) for node in soup.find_all("h1")]
    canonical_tag = soup.find("link", rel=lambda value: value and "canonical" in value)
    canonical = canonical_tag.get("href", "") if canonical_tag else ""
    images = soup.find_all("img")
    missing_alt = sum(1 for image in images if not image.get("alt", "").strip())
    links = []
    for anchor in soup.find_all("a", href=True):
        target = urldefrag(urljoin(url, anchor["href"].strip()))[0]
        parsed = urlparse(target)
        if parsed.scheme in {"http", "https"} and parsed.username is None and parsed.password is None:
            links.append(target)
    text = soup.get_text(" ", strip=True)
    return {
        "url": url, "title": title[:500], "description": description[:1000],
        "h1s": h1s[:10], "canonical": canonical[:2048], "images": len(images),
        "images_missing_alt": missing_alt, "word_count": len(text.split()),
        "links": list(dict.fromkeys(links))[:100],
    }


def inspect_page(facts: dict[str, Any]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []

    def add(code: str, severity: str, title: str, description: str):
        issues.append({"code": code, "severity": severity, "url": facts["url"], "title": title, "description": description})

    title, desc, h1s = facts["title"], facts["description"], facts["h1s"]
    if not title:
        add("missing_title", "critical", "Missing title tag", "Add a unique, descriptive title of roughly 30–60 characters.")
    elif len(title) < 20 or len(title) > 60:
        add("title_length", "warning", f"Title length is {len(title)} characters", "Rewrite the title to describe the page clearly in about 30–60 characters.")
    if not desc:
        add("missing_description", "warning", "Missing meta description", "Add a unique, accurate description of roughly 120–160 characters.")
    elif len(desc) < 70 or len(desc) > 160:
        add("description_length", "notice", f"Meta description length is {len(desc)} characters", "Aim for a concise, useful description around 120–160 characters.")
    if not h1s:
        add("missing_h1", "critical", "No H1 heading found", "Add one clear H1 that describes the primary topic of this page.")
    elif len(h1s) > 1:
        add("multiple_h1", "notice", f"{len(h1s)} H1 headings found", "Use one primary H1 and organize subtopics with H2 and H3 headings.")
    if not facts["canonical"]:
        add("missing_canonical", "warning", "Canonical URL is missing", "Add a canonical link element pointing to the preferred URL.")
    if facts["images_missing_alt"]:
        add("missing_image_alt", "warning", f'{facts["images_missing_alt"]} images lack alt text', "Add meaningful alt text to informative images and empty alt text to decorative images.")
    if facts["word_count"] < 120:
        add("thin_content", "notice", "Page has relatively little text", "Check whether the page fully answers its search intent; add useful information where needed.")
    return issues


async def crawl_site(base_url: str, safe_get: SafeGet) -> tuple[list[dict[str, Any]], list[dict[str, str]], list[str]]:
    host = (urlparse(base_url).hostname or "").lower()
    queue = deque([base_url])
    visited: set[str] = set()
    pages: list[dict[str, Any]] = []
    issues: list[dict[str, str]] = []
    failures: list[str] = []
    headers = {"User-Agent": "AutopilotSEO-MVP/1.0"}
    robots = RobotFileParser()

    async with httpx.AsyncClient(timeout=httpx.Timeout(6.0, connect=3.0), headers=headers, follow_redirects=False) as client:
        try:
            response = await safe_get(client, urljoin(base_url + "/", "robots.txt"))
            robots.parse(response.text.splitlines() if response.status_code == 200 else [])
        except Exception:
            # A robots.txt network failure must not crash the audit. The failure
            # is recorded separately; parsing an empty file follows RFC defaults.
            robots.parse([])

        async def inspect_url(url: str):
            try:
                response = await safe_get(client, url)
                if response.status_code != 200:
                    return url, None, f"{url} returned HTTP {response.status_code}"
                if "text/html" not in response.headers.get("content-type", "").lower():
                    return url, None, None
                final_url = str(response.url)
                final = urlparse(final_url)
                if final.scheme != "https" or (final.hostname or "").lower() != host:
                    return url, None, f"{url} redirected outside the registered host"
                facts = page_facts(final_url, response.text)
                return url, facts, None
            except Exception as exc:
                return url, None, f"{url}: {type(exc).__name__}"

        while queue and len(visited) < MAX_PAGES:
            batch: list[str] = []
            while queue and len(batch) < BATCH_SIZE and len(visited) + len(batch) < MAX_PAGES:
                candidate = queue.popleft()
                parsed = urlparse(candidate)
                if parsed.hostname is None or parsed.hostname.lower() != host or parsed.scheme != "https" or candidate in visited:
                    continue
                if not robots.can_fetch("AutopilotSEO-MVP", candidate):
                    visited.add(candidate)
                    continue
                visited.add(candidate)
                batch.append(candidate)
            if not batch:
                continue
            results = await asyncio.gather(*(inspect_url(url) for url in batch))
            for requested_url, facts, failure in results:
                if failure:
                    failures.append(failure)
                if facts is None:
                    if failure and "returned HTTP" in failure:
                        status = failure.rsplit(" ", 1)[-1]
                        issues.append({"code": "http_status", "severity": "critical", "url": requested_url, "title": f"Page returned HTTP {status}", "description": "Resolve the server or routing issue so important pages return HTTP 200."})
                    continue
                pages.append(facts)
                issues.extend(inspect_page(facts))
                for link in facts["links"]:
                    target = urlparse(link)
                    if target.scheme == "https" and (target.hostname or "").lower() == host and link not in visited and len(queue) < MAX_PAGES * 4:
                        queue.append(link)

        async def check_file(path: str, code: str, label: str):
            try:
                response = await safe_get(client, urljoin(base_url + "/", path.lstrip("/")))
                if response.status_code >= 400:
                    return {"code": code, "severity": "warning", "url": base_url, "title": f"{label} not found", "description": f"Publish a valid {label} at the standard location."}
                return None
            except Exception:
                return {"code": code, "severity": "warning", "url": base_url, "title": f"Could not verify {label}", "description": f"Confirm that {label} is publicly accessible."}

        file_issues = await asyncio.gather(
            check_file("/robots.txt", "missing_robots", "robots.txt"),
            check_file("/sitemap.xml", "missing_sitemap", "XML sitemap"),
        )
        issues.extend(issue for issue in file_issues if issue is not None)

    return pages, issues, failures


def calculate_score(pages: list[dict[str, Any]], issues: list[dict[str, str]]) -> int:
    if not pages:
        return 0
    weights = {"critical": 12, "warning": 5, "notice": 2}
    deductions = sum(weights.get(issue["severity"], 1) for issue in issues)
    return max(0, min(100, round(100 - deductions / max(1, len(pages)) * 1.6)))


async def generate_recommendations(issues: list[dict[str, str]], site_url: str, api_key: str) -> list[dict[str, str]]:
    if not api_key or not issues:
        return []
    prompt = {
        "site": site_url,
        "issues": issues[:40],
        "instruction": "Return a JSON object with a recommendations array of at most 5 prioritized recommendations. Each item must have title, priority (high|medium|low), reason, action. Only use supplied findings; do not claim rankings or traffic impact."
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=4.0)) as client:
            response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {api_key}"}, json={
                "model": "gpt-4.1-mini",
                "input": [{"role": "system", "content": "You are a technical SEO analyst. Return only valid JSON, no markdown."}, {"role": "user", "content": json.dumps(prompt)}],
                "text": {"format": {"type": "json_object"}}
            })
        response.raise_for_status()
        data = response.json()
        output = "".join(part.get("text", "") for item in data.get("output", []) for part in item.get("content", []) if part.get("type") == "output_text")
        parsed = json.loads(output)
        raw = parsed.get("recommendations", []) if isinstance(parsed, dict) else []
        if not isinstance(raw, list):
            return []
        clean = []
        for item in raw[:5]:
            if not isinstance(item, dict):
                continue
            title, reason, action = (str(item.get(key, "")).strip()[:500] for key in ("title", "reason", "action"))
            priority = str(item.get("priority", "medium")).lower()
            if title and reason and action:
                clean.append({"title": title, "priority": priority if priority in {"high", "medium", "low"} else "medium", "reason": reason, "action": action})
        return clean
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return []
