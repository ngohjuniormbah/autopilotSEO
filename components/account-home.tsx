"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { apiRequest, getSession, signOut } from "@/lib/api";


type User = { id: string; name: string; email: string };
type Section = "overview" | "performance" | "audit" | "visibility" | "activity";
type Site = { id: string; url: string };
type Audit = { audit: { id: string; score: number; pages_crawled: number; issue_count: number }; issues: { code: string; severity: string; url: string; title: string; description: string }[]; recommendations: { title: string; priority: string; reason: string; action: string }[] };

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
  const [sites, setSites] = useState<Site[]>([]);
  const [auditResult, setAuditResult] = useState<Audit | null>(null);
  const [siteSaving, setSiteSaving] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setDemo(true);
      setLoading(false);
      return;
    }
    const session = getSession();
    if (!session?.access_token) {
      setError("Please log in to continue.");
      setLoading(false);
      return;
    }
    setUser({ id: session.user?.id || "", name: session.user?.user_metadata?.full_name || session.user?.user_metadata?.name || "there", email: session.user?.email || "" });
    apiRequest<{sites: Site[]}>("/sites")
      .then((data) => setSites(data.sites || []))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load websites."))
      .finally(() => setLoading(false));  const logout = async () => { await signOut(); window.location.assign("/login"); };  const submitWebsite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let parsed: URL;
    try { parsed = new URL(website.startsWith("http") ? website : `https://${website}`); }
    catch { setWebsiteError("Enter a valid website, such as example.com."); return; }
    if (!parsed.hostname.includes(".")) { setWebsiteError("Enter a full domain, such as example.com."); return; }
    setWebsiteError(""); setSiteSaving(true);
    try {
      const created = await apiRequest<{site: Site}>("/sites", { method: "POST", body: JSON.stringify({ url: parsed.toString() }) });
      setWebsite(created.site.url); setSites((current) => [created.site, ...current.filter((site) => site.id !== created.site.id)]);
      setSiteDialogStep(2); setAuditResult(null);
      const result = await apiRequest<Audit>(`/sites/${created.site.id}/audits`, { method: "POST", body: JSON.stringify({}) });
      setAuditResult(result);
    } catch (reason) { setWebsiteError(reason instanceof Error ? reason.message : "Could not save the website or complete its audit."); }
    finally { setSiteSaving(false); }
  };
