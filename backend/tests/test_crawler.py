import httpx
import pytest

from app.crawler import calculate_score, crawl_site, inspect_page, page_facts


def test_page_facts_extracts_common_seo_fields():
    html = """
    <html><head>
      <title>Example Services | Example</title>
      <meta name="description" content="A useful description for this example page.">
      <link rel="canonical" href="https://example.com/">
    </head><body>
      <h1>Example services</h1><img src="/hero.jpg"><p>Useful content.</p>
      <a href="/about">About</a><a href="https://other.example/">External</a>
    </body></html>
    """
    facts = page_facts("https://example.com/", html)
    assert facts["title"] == "Example Services | Example"
    assert facts["canonical"] == "https://example.com/"
    assert facts["h1s"] == ["Example services"]
    assert facts["images_missing_alt"] == 1
    assert "https://example.com/about" in facts["links"]
    assert "https://other.example/" in facts["links"]


def test_inspection_reports_missing_title_and_h1():
    issues = inspect_page({
        "url": "https://example.com/",
        "title": "",
        "description": "",
        "h1s": [],
        "canonical": "",
        "images_missing_alt": 0,
        "word_count": 10,
    })
    codes = {issue["code"] for issue in issues}
    assert {"missing_title", "missing_description", "missing_h1", "missing_canonical", "thin_content"} <= codes


def test_score_is_bounded_and_zero_when_no_pages():
    assert calculate_score([], []) == 0
    score = calculate_score([{"url": "https://example.com"}], [
        {"severity": "critical"}, {"severity": "warning"}
    ])
    assert 0 <= score <= 100


@pytest.mark.asyncio
async def test_crawler_only_queues_same_host_https_pages():
    async def fake_safe_get(client, url):
        request = httpx.Request("GET", url)
        if url.endswith("/robots.txt"):
            return httpx.Response(200, text="User-agent: *\nAllow: /", request=request)
        if url.endswith("/sitemap.xml"):
            return httpx.Response(404, request=request)
        if url == "https://example.com/":
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                text='<html><head><title>Example home page</title><meta name="description" content="A valid description for the home page of example."><link rel="canonical" href="https://example.com/"></head><body><h1>Welcome</h1><a href="/about">About</a><a href="http://example.com/insecure">Insecure</a><a href="https://other.example/">External</a></body></html>',
                request=request,
            )
        if url == "https://example.com/about":
            return httpx.Response(200, headers={"content-type": "text/html"}, text="<html><head><title>About Example company</title></head><body><h1>About</h1></body></html>", request=request)
        return httpx.Response(404, request=request)

    pages, issues, failures = await crawl_site("https://example.com", fake_safe_get)
    assert len(pages) == 2
    assert all(page["url"].startswith("https://example.com") for page in pages)
    assert not any("other.example" in failure for failure in failures)
