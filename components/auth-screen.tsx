"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
type Mode = "login" | "signup" | "reset" | "new-password" | "verify";

function AuthForm({ mode }: { mode: Exclude<Mode, "verify"> }) {
  const params = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const endpoint = mode === "signup" ? "/auth/signup" : mode === "login" ? "/auth/login" : mode === "reset" ? "/auth/password-reset/request" : "/auth/password-reset/confirm";
    if (mode === "new-password") payload.token = params.get("token") || "";
    try {
      if (!api) throw new Error("The API URL is not configured. Set NEXT_PUBLIC_API_URL and redeploy the frontend.");
      const response = await fetch(`${api}${endpoint}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Request failed. Please try again.");
      setMessage(data.message || (mode === "login" ? "You are logged in." : "Done.")); setSuccess(true);
      if (mode === "login") window.location.assign("/app");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to connect. Please try again."); setSuccess(false); }
    finally { setLoading(false); }
  };
  const titles: Record<typeof mode,string> = { login:"Welcome back to better discovery.", signup:"Make search work harder for you.", reset:"Reset your password.", "new-password":"Choose a new password." };
  const subtitles: Record<typeof mode,string> = { login:"Log in to continue to your search visibility workspace.", signup:"Create your workspace and verify your email to get started.", reset:"Enter your account email and we’ll send a secure reset link if it exists.", "new-password":"Choose a new password for your account." };
  return <main className="auth-layout"><section className="auth-pitch"><div className="eyebrow blue-eyebrow">YOUR SEARCH VISIBILITY, IN FOCUS</div><h1>{titles[mode]}</h1><p>{subtitles[mode]}</p><div className="auth-note">Your account details are sent over HTTPS to the AutopilotSEO API. Passwords are never emailed.</div></section><form className="auth-card" onSubmit={submit}><h2>{mode === "signup" ? "Create your account" : mode === "login" ? "Log in" : "Password recovery"}</h2><p>{subtitles[mode]}</p>
    {mode === "signup" && <label>Full name<input name="name" autoComplete="name" minLength={2} maxLength={100} required placeholder="Jane Smith" /></label>}
    {(mode === "login" || mode === "signup" || mode === "reset") && <label>Business email<input name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@company.com" /></label>}
    {(mode === "login" || mode === "signup" || mode === "new-password") && <label>{mode === "new-password" ? "New password" : "Password"}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={12} maxLength={128} required placeholder="At least 12 characters" /></label>}
    {mode === "login" && <div className="forgot-row"><span></span><Link className="forgot-link" href="/reset-password">Forgot password?</Link></div>}
    <button className="button" type="submit" disabled={loading}>{loading ? "Please wait…" : mode === "signup" ? "Create account" : mode === "login" ? "Log in" : mode === "reset" ? "Send reset link" : "Update password"}<span aria-hidden="true">↗</span></button>
    <p className={`auth-message ${success ? "auth-success" : ""}`} role="status" aria-live="polite">{message}</p>
    {mode === "login" && <p className="auth-foot">New to AutopilotSEO? <Link href="/signup">Create an account</Link></p>}
    {mode === "signup" && <p className="auth-foot">Already have an account? <Link href="/login">Log in</Link></p>}
    {(mode === "reset" || mode === "new-password") && <p className="auth-foot"><Link href="/login">← Back to log in</Link></p>}
  </form></main>;
}

function VerifyEmail() {
  const params=useSearchParams(); const [message,setMessage]=useState("Verifying your email…");
  useEffect(() => { const token=params.get("token"); if(!token){setMessage("This verification link is invalid or expired.");return;} if(!api){setMessage("The API URL is not configured yet.");return;} fetch(`${api}/auth/verify-email`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})}).then(async r=>{const d=await r.json() as {message?:string;error?:string};setMessage(r.ok?"Your email is verified. You can log in now.":d.error||"Verification failed.");}).catch(()=>setMessage("We could not reach the account service. Please try again.")); }, [params]);
  return <main className="auth-layout"><section className="auth-pitch"><div className="eyebrow blue-eyebrow">ACCOUNT VERIFICATION</div><h1>One last step.</h1><p>Confirming the email address for your AutopilotSEO account.</p></section><div className="auth-card"><h2>Email verification</h2><p className="auth-message">{message}</p><p className="auth-foot"><Link href="/login">Continue to log in →</Link></p></div></main>;
}

export default function AuthScreen({mode}:{mode:Mode}) { return <div className="auth-page"><header className="auth-top"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span><span>autopilot<span className="brand-light">SEO</span></span></Link></header><Suspense fallback={<div className="auth-layout">Loading…</div>}>{mode === "verify" ? <VerifyEmail/> : <AuthForm mode={mode}/>}</Suspense><footer className="auth-footer"><Link href="/">← Back to AutopilotSEO</Link></footer></div>; }
