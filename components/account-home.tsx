"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
type User = { id: string; name: string; email: string };
type Section = "overview" | "performance" | "audit" | "visibility" | "activity";

const navItems: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "performance", label: "Search performance", icon: "chart" },
  { id: "audit", label: "Site audit", icon: "scan" },
  { id: "visibility", label: "AI visibility", icon: "spark" },
  { id: "activity", label: "Activity", icon: "clock" },
];

function Icon({ name, size = 19 }: { name: string; size?: number }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 6-7"/></>,
    scan: <><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><path d="M7 12h10M12 7v10"/></>,
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/></>,
    clock: <><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.2.9-1.2 2.1-1.4-.6a8 8 0 0 1-1.7 1l-.2 1.5h-2.4l-.3-1.5a8 8 0 0 1-1.8-.7l-1.3.8-1.7-1.7.8-1.3a8 8 0 0 1-.7-1.8l-1.5-.3v-2.4l1.5-.3a8 8 0 0 1 .7-1.8l-.8-1.3 1.7-1.7 1.3.8a8 8 0 0 1 1.8-.7l.3-1.5h2.4l.2 1.5a8 8 0 0 1 1.8.7l1.3-.8 1.7 1.7-.8 1.3a8 8 0 0 1 .7 1.8l1.5.3v2.4l-1.2.3"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.2 2.4 3.2 5.4 3.2 9s-1 6.6-3.2 9c-2.2-2.4-3.2-5.4-3.2-9S9.8 5.4 12 3Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>{paths[name] ?? paths.grid}</svg>;
}

function Brand() {
  return <Link className="brand workspace-brand" href="/" aria-label="AutopilotSEO home"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span>autopilot<span className="brand-light">SEO</span></span></Link>;
}

function WorkspaceGate({ loading, error }: { loading: boolean; error: string }) {
  return <div className="workspace-gate"><header className="workspace-gate-header"><Brand/></header><main className="workspace-gate-card"><div className="workspace-gate-mark"><Icon name={loading ? "grid" : "settings"} size={25}/></div><div className="workspace-kicker">AUTOPILOTSEO WORKSPACE</div><h1>{loading ? "Checking your account" : "Your workspace is ready"}</h1><p>{loading ? "We’re securely checking your session." : error || "Log in to open your search visibility workspace."}</p><div className="workspace-gate-actions"><Link className="button" href="/login">Log in <Icon name="arrow" size={17}/></Link><Link className="workspace-secondary-link" href="/app?demo=1">Preview the dashboard</Link></div><small>Dashboard preview uses illustrative data. Account and website data require a connected service.</small></main></div>;
}

export default function AccountHome() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demo, setDemo] = useState(false);
  const [active, setActive] = useState<Section>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [siteDialogOpen, setSiteDialogOpen] = useState(false);
  const [siteDialogStep, setSiteDialogStep] = useState(1);
  const [website, setWebsite] = useState("");
  const [websiteError, setWebsiteError] = useState("");
  const [dateRange, setDateRange] = useState("28 days");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setDemo(true);
      setLoading(false);
      return;
    }
    if (!api) {
      setError("The account service isn’t connected in this preview.");
      setLoading(false);
      return;
    }
    fetch(`${api}/auth/me`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { user?: User; error?: string };
        if (!response.ok) throw new Error(data.error || "Please log in to continue.");
        setUser(data.user || null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Please log in to continue."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!siteDialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSiteDialogOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [siteDialogOpen]);

  const logout = async () => {
    try { if (api) await fetch(`${api}/auth/logout`, { method: "POST", credentials: "include" }); }
    catch { /* The local session may already be unavailable; continue to sign-in. */ }
    finally { window.location.assign("/login"); }
  };

  const openSiteDialog = () => { setWebsiteError(""); setSiteDialogStep(1); setSiteDialogOpen(true); };
  const submitWebsite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let parsed: URL;
    try { parsed = new URL(website.startsWith("http") ? website : `https://${website}`); }
    catch { setWebsiteError("Enter a valid website, such as example.com."); return; }
    if (!parsed.hostname.includes(".")) { setWebsiteError("Enter a full domain, such as example.com."); return; }
    setWebsite(parsed.hostname.toLowerCase());
    setWebsiteError("");
    setSiteDialogStep(2);
  };

  if (loading || (!user && !demo)) return <WorkspaceGate loading={loading} error={error}/>;

  const displayName = demo ? "Alex Morgan" : user?.name || "there";
  const displayEmail = demo ? "alex@example.com" : user?.email || "";
  const initials = displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  const scrollTo = (id: Section) => {
    setActive(id);
    setMobileMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <div className={`workspace-shell ${mobileMenuOpen ? "workspace-menu-open" : ""}`}>
    <button className="workspace-backdrop" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}/>
    <aside className="workspace-sidebar" aria-label="Workspace navigation">
      <div className="workspace-sidebar-top"><Brand/><button className="workspace-close-menu" aria-label="Close navigation" onClick={() => setMobileMenuOpen(false)}>×</button></div>
      <div className="workspace-site-switcher"><span className="workspace-site-icon"><Icon name="globe" size={17}/></span><span><small>WORKSPACE</small><strong>{demo ? "Northstar Studio" : "My workspace"}</strong></span><span className="workspace-switch-caret">⌄</span></div>
      <div className="workspace-nav-label">MENU</div>
      <nav className="workspace-nav">
        {navItems.map((item) => <button key={item.id} className={`workspace-nav-item ${active === item.id ? "active" : ""}`} onClick={() => scrollTo(item.id)}><Icon name={item.icon}/><span>{item.label}</span>{item.id === "audit" && <span className="workspace-nav-count">14</span>}</button>)}
      </nav>
      <div className="workspace-sidebar-bottom"><div className="workspace-connect-card"><div className="workspace-connect-icon"><Icon name="globe" size={17}/></div><strong>{demo ? "Sample website" : "No website connected"}</strong><p>{demo ? "northstar-studio.com" : "Connect a site to start tracking progress."}</p><button type="button" onClick={openSiteDialog}>{demo ? "Manage website" : "Connect website"}<span>↗</span></button></div><button className="workspace-nav-item workspace-settings" onClick={() => scrollTo("overview")}><Icon name="settings"/><span>Settings</span></button><div className="workspace-user"><span className="workspace-avatar">{initials}</span><span className="workspace-user-details"><strong>{displayName}</strong><small>{displayEmail}</small></span><button onClick={logout} aria-label="Log out" title="Log out"><span>↗</span></button></div></div>
    </aside>

    <div className="workspace-main">
      <header className="workspace-topbar"><button className="workspace-menu-button" aria-label="Open navigation" aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen(true)}><span/><span/><span/></button><div className="workspace-breadcrumb"><span>Workspace</span><b>/</b><strong>Overview</strong></div><div className="workspace-topbar-actions"><span className={`workspace-mode-badge ${demo ? "sample" : ""}`}><i/>{demo ? "DEMO WORKSPACE" : "WORKSPACE"}</span><button className="workspace-avatar workspace-top-avatar" aria-label={`Signed in as ${displayName}`}>{initials}</button></div></header>

      <main className="workspace-content">
        <section className="workspace-page-heading" id="overview"><div><div className="workspace-kicker">OVERVIEW</div><h1>{demo ? "Good morning, Alex." : `Welcome, ${displayName}.`}</h1><p>{demo ? "Here’s a clear view of your sample search performance and the work in progress." : "Your workspace is ready. Connect a website to start building your search visibility."}</p></div><button className="button workspace-primary-action" onClick={openSiteDialog}><Icon name="plus" size={18}/>{demo ? "Add a website" : "Connect your website"}</button></section>

        {demo ? <div className="workspace-sample-notice"><span className="workspace-notice-icon"><Icon name="spark" size={17}/></span><p><strong>You’re viewing a sample workspace.</strong> Metrics, site details, tasks, and activity below are illustrative—not connected to a real website.</p><Link href="/signup">Create your workspace <Icon name="arrow" size={15}/></Link></div> : <section className="workspace-onboarding" aria-labelledby="onboarding-title"><div className="onboarding-copy"><div className="onboarding-icon"><Icon name="globe" size={21}/></div><div className="workspace-kicker">YOUR FIRST STEP</div><h2 id="onboarding-title">Bring your website into focus.</h2><p>Connect a website to see an audit, track search traffic, and organize the improvements that matter most.</p><button className="button" onClick={openSiteDialog}><Icon name="plus" size={18}/> Connect your website <Icon name="arrow" size={17}/></button><small>Your site isn’t connected yet, so no search metrics are shown.</small></div><div className="onboarding-steps"><div className="onboarding-step current"><span>01</span><div><strong>Add your website</strong><small>Choose the domain you want to improve.</small></div><i>NOW</i></div><div className="onboarding-step"><span>02</span><div><strong>Connect Search Console</strong><small>Bring in your Google search performance.</small></div><b>02</b></div><div className="onboarding-step"><span>03</span><div><strong>Run your first audit</strong><small>Find clear, prioritized next steps.</small></div><b>03</b></div></div></section>}

        {demo ? <>
          <div className="workspace-metric-grid">
            <article className="workspace-metric-card"><div className="workspace-metric-heading"><span>Total clicks</span><span className="workspace-metric-icon blue"><Icon name="arrow" size={17}/></span></div><strong>8.42k</strong><div className="workspace-metric-foot"><span className="workspace-trend">↑ 18.6%</span><span>vs. previous period</span></div><svg viewBox="0 0 170 48" preserveAspectRatio="none" aria-label="Illustrative clicks trend"><path className="metric-spark-fill" d="M0 40 C17 36 22 38 34 31 S50 35 62 28 S81 32 93 22 S111 27 125 17 S146 23 170 4V48H0Z"/><path className="metric-spark-line" d="M0 40 C17 36 22 38 34 31 S50 35 62 28 S81 32 93 22 S111 27 125 17 S146 23 170 4"/></svg></article>
            <article className="workspace-metric-card"><div className="workspace-metric-heading"><span>Impressions</span><span className="workspace-metric-icon violet"><Icon name="chart" size={17}/></span></div><strong>246k</strong><div className="workspace-metric-foot"><span className="workspace-trend">↑ 24.1%</span><span>vs. previous period</span></div><svg viewBox="0 0 170 48" preserveAspectRatio="none" aria-label="Illustrative impressions trend"><path className="metric-spark-fill violet-fill" d="M0 39 C18 36 24 38 38 30 S54 34 67 27 S85 31 98 20 S116 26 131 17 S150 20 170 5V48H0Z"/><path className="metric-spark-line violet-line" d="M0 39 C18 36 24 38 38 30 S54 34 67 27 S85 31 98 20 S116 26 131 17 S150 20 170 5"/></svg></article>
            <article className="workspace-metric-card"><div className="workspace-metric-heading"><span>Average CTR</span><span className="workspace-metric-icon green"><Icon name="scan" size={17}/></span></div><strong>3.4%</strong><div className="workspace-metric-foot"><span className="workspace-trend">↑ 0.3%</span><span>vs. previous period</span></div><div className="workspace-metric-progress"><i style={{ width: "68%" }}/></div></article>
            <article className="workspace-metric-card"><div className="workspace-metric-heading"><span>Average position</span><span className="workspace-metric-icon amber"><Icon name="spark" size={17}/></span></div><strong>12.8</strong><div className="workspace-metric-foot"><span className="workspace-trend">↑ 2.1</span><span>positions improved</span></div><div className="workspace-position-pill">Top 20 average</div></article>
          </div>

          <section className="workspace-panel workspace-performance-panel" id="performance"><div className="workspace-panel-heading"><div><div className="workspace-kicker">GOOGLE SEARCH CONSOLE</div><h2>Search performance</h2><p>Clicks and impressions over time</p></div><label className="workspace-range">Date range<select value={dateRange} onChange={(event) => setDateRange(event.target.value)}><option>28 days</option><option>7 days</option><option>90 days</option></select></label></div><div className="workspace-chart-legend"><span><i className="chart-legend-clicks"/>Clicks</span><span><i className="chart-legend-impressions"/>Impressions</span><span className="workspace-chart-sample">Sample data</span></div><div className="workspace-main-chart"><div className="workspace-chart-y"><span>400</span><span>300</span><span>200</span><span>100</span><span>0</span></div><svg viewBox="0 0 780 215" preserveAspectRatio="none" role="img" aria-label={`Illustrative clicks and impressions over ${dateRange}`}><defs><linearGradient id="workspaceChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4f82df" stopOpacity=".2"/><stop offset="1" stopColor="#4f82df" stopOpacity="0"/></linearGradient></defs><g className="workspace-chart-grid"><path d="M0 8H780M0 57H780M0 106H780M0 155H780M0 204H780"/></g><path className="workspace-chart-area" d="M0 177 C35 165 45 174 75 158 S112 167 146 148 S181 158 215 139 S255 147 288 126 S322 139 358 114 S399 127 432 104 S471 119 507 88 S548 103 581 79 S616 96 653 57 S706 77 780 30 V210H0Z"/><path className="workspace-chart-line clicks-line" d="M0 177 C35 165 45 174 75 158 S112 167 146 148 S181 158 215 139 S255 147 288 126 S322 139 358 114 S399 127 432 104 S471 119 507 88 S548 103 581 79 S616 96 653 57 S706 77 780 30"/><path className="workspace-chart-line impressions-line" d="M0 192 C38 188 44 192 75 181 S111 187 146 172 S181 181 215 164 S255 173 288 156 S321 166 358 146 S397 159 432 137 S472 148 507 125 S547 138 581 114 S617 128 653 94 S706 111 780 76"/></svg></div><div className="workspace-chart-x"><span>Oct 1</span><span>Oct 5</span><span>Oct 10</span><span>Oct 15</span><span>Oct 20</span><span>Oct 28</span></div></section>

          <div className="workspace-dashboard-grid">
            <section className="workspace-panel workspace-audit-panel" id="audit"><div className="workspace-panel-heading compact"><div><div className="workspace-kicker">SITE HEALTH</div><h2>Priority opportunities</h2><p>Issues ranked by potential impact</p></div><button className="workspace-text-action" onClick={() => scrollTo("audit")}>View audit <Icon name="arrow" size={15}/></button></div><div className="workspace-audit-score"><div className="health-score"><strong>86</strong><span>/100</span><small>HEALTH</small></div><div><strong>Good foundation</strong><p>14 opportunities to strengthen search visibility.</p></div><span className="health-trend">+8 pts</span></div><div className="workspace-issue-list"><div className="workspace-issue"><span className="issue-dot high"/><span className="workspace-issue-copy"><strong>Missing meta descriptions</strong><small>4 pages · High impact</small></span><span className="issue-priority high-priority">HIGH</span><span className="issue-chevron">›</span></div><div className="workspace-issue"><span className="issue-dot medium"/><span className="workspace-issue-copy"><strong>Images missing alt text</strong><small>7 images · Medium impact</small></span><span className="issue-priority medium-priority">MED</span><span className="issue-chevron">›</span></div><div className="workspace-issue"><span className="issue-dot low"/><span className="workspace-issue-copy"><strong>Local schema opportunity</strong><small>Homepage · Improvement</small></span><span className="issue-priority low-priority">LOW</span><span className="issue-chevron">›</span></div></div><button className="workspace-audit-cta" onClick={openSiteDialog}>Review all 14 opportunities <Icon name="arrow" size={15}/></button></section>

            <section className="workspace-panel workspace-visibility-panel" id="visibility"><div className="workspace-panel-heading compact"><div><div className="workspace-kicker">AI VISIBILITY</div><h2>Brand mentions</h2><p>Sample tracked questions</p></div><span className="workspace-ai-icon"><Icon name="spark" size={19}/></span></div><div className="visibility-score-row"><strong>32<span>/50</span></strong><span className="workspace-trend">↑ 4 mentions</span></div><div className="workspace-mention-bar"><span>ChatGPT</span><div><i style={{ width: "72%" }}/></div><b>18</b></div><div className="workspace-mention-bar"><span>Perplexity</span><div><i style={{ width: "48%" }}/></div><b>9</b></div><div className="workspace-mention-bar"><span>Other AI</span><div><i style={{ width: "26%" }}/></div><b>5</b></div><div className="workspace-visibility-note">AI results vary by question and time. Counts here are illustrative.</div></section>
          </div>

          <section className="workspace-panel workspace-activity-panel" id="activity"><div className="workspace-panel-heading compact"><div><div className="workspace-kicker">RECENT WORK</div><h2>Activity</h2><p>Recent updates in this sample workspace</p></div><button className="workspace-text-action" onClick={() => setActive("activity")}>All activity <Icon name="arrow" size={15}/></button></div><div className="workspace-activity-list"><div className="workspace-activity-row"><span className="activity-check"><Icon name="check" size={15}/></span><span><strong>Updated page descriptions</strong><small>4 pages · Site audit</small></span><time>2h ago</time></div><div className="workspace-activity-row"><span className="activity-check"><Icon name="check" size={15}/></span><span><strong>Submitted updated sitemap</strong><small>Google Search Console · Indexing</small></span><time>Yesterday</time></div><div className="workspace-activity-row"><span className="activity-review">◷</span><span><strong>Review location page update</strong><small>Suggested change · Awaiting approval</small></span><button className="workspace-review-button" onClick={openSiteDialog}>Review</button></div></div></section>
          <div className="workspace-footer-note">Illustrative dashboard preview · Search Console and AI visibility metrics are sample data.</div>
        </> : <>
          <div className="workspace-real-stats"><div><span>Websites</span><strong>0</strong><small>Connect your first domain</small></div><div><span>Audit status</span><strong className="stat-empty">Not started</strong><small>Start with a site scan</small></div><div><span>Search data</span><strong className="stat-empty">Not connected</strong><small>Link Google Search Console</small></div></div>
          <section className="workspace-real-preview"><div className="workspace-real-preview-copy"><span className="workspace-kicker">A PREVIEW OF YOUR WORKSPACE</span><h2>Know what to work on next.</h2><p>Once your website and search data are connected, this is where you’ll see traffic, site health, and recommended actions.</p><Link className="workspace-preview-link" href="/app?demo=1">Explore sample dashboard <Icon name="arrow" size={16}/></Link></div><div className="workspace-mini-chart"><div><span>Search performance</span><small>ILLUSTRATIVE</small></div><svg viewBox="0 0 360 130" preserveAspectRatio="none" aria-label="Example of the search performance chart"><path d="M0 107H360M0 70H360M0 34H360" className="workspace-mini-grid"/><path d="M0 103 C30 95 42 104 69 85 S104 92 133 75 S169 81 197 60 S231 70 260 48 S300 56 360 20" className="workspace-mini-line"/></svg><div className="mini-chart-legend"><span>Clicks</span><span>Impressions</span></div></div></section>
          <div className="workspace-real-bottom"><div className="workspace-real-tip"><span className="workspace-tip-icon">01</span><div><strong>Start by adding your website</strong><p>We’ll guide you through the setup as integrations become available.</p></div><button onClick={openSiteDialog} aria-label="Connect your website"><Icon name="arrow" size={18}/></button></div><div className="workspace-integration-card"><span className="workspace-integration-mark">G</span><div><strong>Google Search Console</strong><small>Connect to bring in clicks and impressions.</small></div><span className="workspace-coming-soon">SETUP NEXT</span></div></div>
        </>}
      </main>
    </div>

    {siteDialogOpen && <div className="workspace-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSiteDialogOpen(false); }}><section className="workspace-dialog" role="dialog" aria-modal="true" aria-labelledby="site-dialog-title"><button className="workspace-dialog-close" aria-label="Close" onClick={() => setSiteDialogOpen(false)}>×</button><div className="workspace-dialog-icon"><Icon name={siteDialogStep === 1 ? "globe" : "check"} size={23}/></div><div className="workspace-kicker">WEBSITE SETUP · STEP {siteDialogStep} OF 2</div><h2 id="site-dialog-title">{siteDialogStep === 1 ? "Add your website" : "Your setup plan is ready"}</h2>{siteDialogStep === 1 ? <><p>Start with the main domain you want to monitor. You can add more sites later.</p><form onSubmit={submitWebsite}><label htmlFor="site-url">Website address</label><input id="site-url" type="text" inputMode="url" autoComplete="url" placeholder="example.com" value={website} onChange={(event) => setWebsite(event.target.value)} aria-invalid={Boolean(websiteError)} aria-describedby={websiteError ? "site-url-error" : "site-url-help"}/>{websiteError && <span className="workspace-field-error" id="site-url-error">{websiteError}</span>}<span className="workspace-field-help" id="site-url-help">Enter a domain you own or manage.</span><button className="button" type="submit">Continue <Icon name="arrow" size={17}/></button></form></> : <><p><strong>{website}</strong> is ready to add to your workspace.</p><div className="workspace-dialog-integration"><span className="workspace-integration-mark">G</span><span><strong>Google Search Console</strong><small>Connection will be enabled with the backend integration.</small></span><span className="workspace-coming-soon">COMING SOON</span></div><div className="workspace-preview-disclosure">This is a frontend preview. The website won’t be saved or connected yet.</div><div className="workspace-dialog-actions"><button className="workspace-dialog-back" onClick={() => setSiteDialogStep(1)}>Back</button><button className="button" onClick={() => setSiteDialogOpen(false)}>Done <Icon name="check" size={17}/></button></div></>}</section></div>}
  </div>;
}
