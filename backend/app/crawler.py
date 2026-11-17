from __future__ import annotations

import json
from collections import deque
from typing import Any, Awaitable, Callable
from urllib.parse import urljoin, urlparse, urldefrag
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup

MAX_PAGES = 12
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
    host = urlparse(base_url).hostname
    queue = deque([base_url])
    visited: set[str] = set()
    pages: list[dict[str, Any]] = []
    issues: list[dict[str, str]] = []
    failures: list[str] = []
    headers = {"User-Agent": "AutopilotSEO-Bot/0.1 (+https://autopilotseo.com/bot)"}
    robots = RobotFileParser()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0), headers=headers) as client:
            response = await safe_get(client, urljoin(base_url + "/", "robots.txt"))
            robots.parse(response.text.splitlines() if response.status_code == 200 else [])
    except Exception:
        robots.parse([])
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0), headers=headers) as client:
        while queue and len(visited) < MAX_PAGES:
            url = queue.popleft()
            parsed = urlparse(url)
            if parsed.hostname != host or parsed.scheme != "https" or url in visited:
                continue
            visited.add(url)
            if not robots.can_fetch("AutopilotSEO-Bot", url):
                continue
            try:
                response = await safe_get(client, url)
                if response.status_code != 200:
                    failures.append(f"{url} returned HTTP {response.status_code}")
                    issues.append({"code":"http_status","severity":"critical","url":url,"title":f"Page returned HTTP {response.status_code}","description":"Resolve the server or routing issue so important pages return HTTP 200."})
                    continue
                if "text/html" not in response.headers.get("content-type", "").lower():
                    continue
                facts = page_facts(str(response.url), response.text)
                pages.append(facts)
                issues.extend(inspect_page(facts))
                for link in facts["links"]:
                    target = urlparse(link)
                    if target.hostname == host and target.scheme == "https" and link not in visited and len(queue) < MAX_PAGES * 4:
                        queue.append(link)
            except (httpx.HTTPError, UnicodeError, ValueError) as exc:
                failures.append(f"{url}: {type(exc).__name__}")
    async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=4.0), headers=headers) as client:
        for path, code, label in [("/robots.txt", "missing_robots", "robots.txt"), ("/sitemap.xml", "missing_sitemap", "XML sitemap")]:
            try:
                response = await safe_get(client, urljoin(base_url + "/", path.lstrip("/")))
                if response.status_code >= 400:
                    issues.append({"code":code,"severity":"warning","url":base_url,"title":f"{label} not found","description":f"Publish a valid {label} at the standard location."})
            except Exception:
                issues.append({"code":code,"severity":"warning","url":base_url,"title":f"Could not verify {label}","description":f"Confirm that {label} is publicly accessible."})
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
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post("https://api.openai.com/v1/responses", headers={"Authorization": f"Bearer {api_key}"}, json={
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
        return parsed.get("recommendations", [])[:5] if isinstance(parsed, dict) else []
    except json.JSONDecodeError:
        return []
