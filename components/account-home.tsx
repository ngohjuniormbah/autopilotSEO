"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const api = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
type User = { id: string; name: string; email: string };
export default function AccountHome() {
  const [user,setUser]=useState<User|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  useEffect(()=>{if(!api){setError("Set NEXT_PUBLIC_API_URL to connect the account service.");setLoading(false);return;}fetch(`${api}/auth/me`,{credentials:"include"}).then(async r=>{const d=await r.json() as {user?:User;error?:string};if(!r.ok)throw new Error(d.error||"Please log in.");setUser(d.user||null);}).catch(e=>{setError(e instanceof Error?e.message:"Please log in.");}).finally(()=>setLoading(false));},[]);
  const logout=async()=>{if(api)await fetch(`${api}/auth/logout`,{method:"POST",credentials:"include"});window.location.assign("/login");};
  return <div className="auth-page"><header className="auth-top"><Link className="brand" href="/"><span className="brand-mark"><i/><i/><i/><i/></span><span>autopilot<span className="brand-light">SEO</span></span></Link></header><main className="auth-layout"><section className="auth-pitch"><div className="eyebrow blue-eyebrow">WORKSPACE</div><h1>{user?`Welcome, ${user.name}.`:"Your visibility workspace."}</h1><p>Your account area is ready. Connect your website and supported search integrations when the product workspace is enabled.</p></section><section className="auth-card">{loading?<p>Checking your session…</p>:user?<><h2>Account</h2><p>{user.email}</p><p>Your email is verified.</p><button type="button" className="button" onClick={logout}>Log out <span>↗</span></button></>:<><h2>Log in required</h2><p>{error}</p><Link className="button" href="/login">Go to log in <span>↗</span></Link></>}</section></main></div>;
}
