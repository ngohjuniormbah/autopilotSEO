import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

type Env = {
  DB: D1Database;
  AUTH_LIMITER: RateLimit;
  APP_ORIGIN: string;
  SESSION_COOKIE_NAME?: string;
  SESSION_TTL_SECONDS?: string;
  RESEND_API_KEY: string;
  EMAIL_FROM: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL?: string;
};
type D1Value = string | number | null | ArrayBuffer;
type D1Result<T = unknown> = { success: boolean; results?: T[]; meta?: Record<string, unknown> };
interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
}
interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}
interface RateLimit { limit(input: { key: string }): Promise<{ success: boolean }>; }
type Variables = { user: { id: string; name: string; email: string } };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();
const encoder = new TextEncoder();
const cookieName = (env: Env) => env.SESSION_COOKIE_NAME || "autopilotseo_session";
const randomId = () => crypto.randomUUID();
const randomToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const sha256 = async (value: string) => {
  const result = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(result), (x) => x.toString(16).padStart(2, "0")).join("");
};
const passwordHash = async (password: string, salt = randomToken()) => {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 310000, hash: "SHA-256" }, key, 256);
  return `pbkdf2-sha256$310000$${salt}$${btoa(String.fromCharCode(...new Uint8Array(bits)))}`;
};
const verifyPassword = async (password: string, stored: string) => {
  const [, iterations, salt, expected] = stored.split("$");
  if (iterations !== "310000" || !salt || !expected) return false;
  const actual = await passwordHash(password, salt);
  const actualBytes = encoder.encode(actual.split("$")[3]);
  const expectedBytes = encoder.encode(expected);
  if (actualBytes.length !== expectedBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index++) difference |= actualBytes[index] ^ expectedBytes[index];
  return difference === 0;
};
const expiry = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const sendEmail = async (env: Env, to: string, subject: string, html: string) => {
  const result = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!result.ok) throw new Error("Email delivery failed");
};
const createAuthToken = async (env: Env, userId: string, purpose: "verify_email" | "reset_password", ttl: number) => {
  const token = randomToken();
  await env.DB.prepare("DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?").bind(userId, purpose).run();
  await env.DB.prepare("INSERT INTO auth_tokens (id,user_id,token_hash,purpose,expires_at) VALUES (?,?,?,?,?)")
    .bind(randomId(), userId, await sha256(token), purpose, expiry(ttl)).run();
  return token;
};
const createSession = async (c: any, userId: string) => {
  const token = randomToken();
  const ttl = Number(c.env.SESSION_TTL_SECONDS || 2592000);
  const expiresAt = expiry(ttl);
  await c.env.DB.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at) VALUES (?,?,?,?)")
    .bind(randomId(), userId, await sha256(token), expiresAt).run();
  setCookie(c, cookieName(c.env), token, { httpOnly: true, secure: new URL(c.req.url).protocol === "https:", sameSite: "Lax", path: "/", maxAge: ttl });
};
const verifyAuth = async (c: any, next: () => Promise<void>) => {
  const token = getCookie(c, cookieName(c.env));
  if (!token) return c.json({ error: "Authentication required" }, 401);
  const row = await c.env.DB.prepare("SELECT users.id,users.name,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.email_verified_at IS NOT NULL")
    .bind(await sha256(token), new Date().toISOString()).first();
  if (!row) return c.json({ error: "Session expired. Please log in again." }, 401);
  c.set("user", row);
  await next();
};

app.use("*", cors({ origin: (origin, c) => origin === c.env.APP_ORIGIN ? origin : "", credentials: true, allowHeaders: ["Content-Type"], allowMethods: ["GET", "POST", "OPTIONS"] }));
app.get("/health", (c) => c.json({ status: "ok" }));
const limited = (c: any, key: string) => c.env.AUTH_LIMITER.limit({ key });
app.post("/auth/signup", async (c) => {
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  if (!(await limited(c, `signup:${ip}`)).success) return c.json({ error: "Too many attempts. Try again shortly." }, 429);
  const body = await c.req.json<{ name?: string; email?: string; password?: string }>().catch(() => ({}));
  const name = body.name?.trim(); const email = body.email?.trim().toLowerCase(); const password = body.password;
  if (!name || name.length > 100 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12 || password.length > 128)
    return c.json({ error: "Enter a name, valid email, and a password between 12 and 128 characters." }, 400);
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (existing) return c.json({ error: "An account with that email already exists. Try logging in or resetting your password." }, 409);
  const id = randomId();
  await c.env.DB.prepare("INSERT INTO users (id,name,email,password_hash) VALUES (?,?,?,?)").bind(id,name,email,await passwordHash(password)).run();
  const token = await createAuthToken(c.env,id,"verify_email",86400);
  const link = `${c.env.APP_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`;
  try { await sendEmail(c.env,email,"Verify your AutopilotSEO email",`<p>Hi ${name.replace(/[&<>"']/g,"_")},</p><p><a href="${link}">Verify your email address</a>. This link expires in 24 hours.</p>`); }
  catch { await c.env.DB.prepare("DELETE FROM users WHERE id=?").bind(id).run(); return c.json({ error: "We could not send your verification email. Please try again later." }, 503); }
  return c.json({ message: "Account created. Check your inbox for a verification link." }, 201);
});
app.post("/auth/verify-email", async (c) => {
  const { token } = await c.req.json<{token?:string}>().catch(()=>({}));
  if (!token || token.length > 200) return c.json({ error: "Verification link is invalid or expired." },400);
  const row = await c.env.DB.prepare("SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>?").bind(await sha256(token),new Date().toISOString()).first<{id:string;user_id:string}>();
  if (!row) return c.json({ error: "Verification link is invalid or expired." },400);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET email_verified_at=?,updated_at=? WHERE id=?").bind(new Date().toISOString(),new Date().toISOString(),row.user_id),
    c.env.DB.prepare("UPDATE auth_tokens SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),row.id),
  ]);
  await createSession(c,row.user_id);
  return c.json({ message: "Email verified." });
});
app.post("/auth/login", async (c) => {
  const ip=c.req.header("CF-Connecting-IP")||"unknown";
  if (!(await limited(c,`login:${ip}`)).success) return c.json({error:"Too many attempts. Try again shortly."},429);
  const {email,password}=await c.req.json<{email?:string;password?:string}>().catch(()=>({}));
  if (!email || !password) return c.json({error:"Enter your email and password."},400);
  const user=await c.env.DB.prepare("SELECT id,name,email,password_hash,email_verified_at FROM users WHERE email=?").bind(email.trim().toLowerCase()).first<{id:string;name:string;email:string;password_hash:string;email_verified_at:string|null}>();
  if (!user || !(await verifyPassword(password,user.password_hash))) return c.json({error:"Email or password is incorrect."},401);
  if (!user.email_verified_at) return c.json({error:"Verify your email before logging in. Check your inbox for the verification link."},403);
  await createSession(c,user.id);
  return c.json({user:{id:user.id,name:user.name,email:user.email}});
});
app.post("/auth/logout",async c=>{const token=getCookie(c,cookieName(c.env));if(token)await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();deleteCookie(c,cookieName(c.env),{path:"/"});return c.json({message:"Logged out."});});
app.get("/auth/me",verifyAuth,c=>c.json({user:c.get("user")}));
app.post("/auth/password-reset/request",async c=>{
  const ip=c.req.header("CF-Connecting-IP")||"unknown";if(!(await limited(c,`reset:${ip}`)).success)return c.json({message:"If an account exists, a reset link will be sent."});
  const {email}=await c.req.json<{email?:string}>().catch(()=>({}));
  if(email&&email.length<255){const user=await c.env.DB.prepare("SELECT id,email FROM users WHERE email=? AND email_verified_at IS NOT NULL").bind(email.trim().toLowerCase()).first<{id:string;email:string}>();if(user){const token=await createAuthToken(c.env,user.id,"reset_password",3600);const link=`${c.env.APP_ORIGIN}/new-password?token=${encodeURIComponent(token)}`;try{await sendEmail(c.env,user.email,"Reset your AutopilotSEO password",`<p><a href="${link}">Choose a new password</a>. This link expires in one hour.</p>`);}catch{return c.json({error:"We could not send the password reset email. Please try again later."},503);}}}
  return c.json({message:"If a verified account exists for that email, a reset link will be sent."});
});
app.post("/auth/password-reset/confirm",async c=>{
  const {token,password}=await c.req.json<{token?:string;password?:string}>().catch(()=>({}));if(!token||token.length>200||!password||password.length<12||password.length>128)return c.json({error:"Use a valid reset link and a password between 12 and 128 characters."},400);
  const row=await c.env.DB.prepare("SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>?").bind(await sha256(token),new Date().toISOString()).first<{id:string;user_id:string}>();if(!row)return c.json({error:"Reset link is invalid or expired."},400);
  const now=new Date().toISOString();await c.env.DB.batch([c.env.DB.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").bind(await passwordHash(password),now,row.user_id),c.env.DB.prepare("UPDATE auth_tokens SET consumed_at=? WHERE id=?").bind(now,row.id),c.env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(row.user_id)]);return c.json({message:"Password updated. You can now log in."});
});
app.post("/ai/visibility-summary",verifyAuth,async c=>{
  const {text}=await c.req.json<{text?:string}>().catch(()=>({}));if(!text||text.length>8000)return c.json({error:"Provide site or search-visibility context up to 8,000 characters."},400);
  const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${c.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:c.env.OPENAI_MODEL||"gpt-4.1-mini",input:[{role:"system",content:"You are an SEO visibility assistant. Give careful, actionable suggestions. Never promise rankings or AI recommendations."},{role:"user",content:text}]})});
  if(!response.ok)return c.json({error:"AI service is temporarily unavailable."},502);const data=await response.json<{output?:Array<{content?:Array<{text?:string}>}>}>();const answer=data.output?.flatMap(x=>x.content||[]).map(x=>x.text||"").join("\n");return c.json({answer});
});
app.notFound(c=>c.json({error:"Not found"},404));
app.onError((error,c)=>{console.error("request_failed",error.message);return c.json({error:"Unexpected server error"},500);});
export default app;
