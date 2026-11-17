const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SESSION_KEY = "autopilotseo.supabase.session";
export type Session = { access_token: string; refresh_token?: string; expires_at?: number; user?: { id: string; email?: string; user_metadata?: { full_name?: string; name?: string } } };
type AuthResponse = { access_token?: string; refresh_token?: string; expires_in?: number; user?: Session["user"]; msg?: string; message?: string };
export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try { const raw=localStorage.getItem(SESSION_KEY); if(!raw)return null; const session=JSON.parse(raw) as Session; if(session.expires_at&&session.expires_at<Date.now()/1000)return null; return session; } catch { return null; }
}
export function saveSession(session: Session | null) { if(typeof window==="undefined")return; if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY); }
async function authFetch(path:string,init:RequestInit={}) {
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY)throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.");
  const response=await fetch(`${SUPABASE_URL}/auth/v1/${path}`,{...init,headers:{apikey:SUPABASE_ANON_KEY,"Content-Type":"application/json",...init.headers}});
  const data=await response.json().catch(()=>({})) as AuthResponse;
  if(!response.ok)throw new Error(data.msg||data.message||"Authentication request failed."); return data;
}
function persist(data:AuthResponse){if(data.access_token)saveSession({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Math.floor(Date.now()/1000)+(data.expires_in||3600),user:data.user});return data;}
export async function signUp(name:string,email:string,password:string){const redirect=typeof window!=="undefined"?`${window.location.origin}/verify-email`:undefined;return authFetch("signup",{method:"POST",body:JSON.stringify({email,password,data:{full_name:name},options:{emailRedirectTo:redirect}})});}
export async function signIn(email:string,password:string){return persist(await authFetch("token?grant_type=password",{method:"POST",body:JSON.stringify({email,password})}));}
export async function requestPasswordReset(email:string){const redirect=typeof window!=="undefined"?`${window.location.origin}/new-password`:undefined;await authFetch("recover",{method:"POST",body:JSON.stringify({email,redirect_to:redirect})});}
export async function updatePassword(password:string){const session=getSession();if(!session?.access_token)throw new Error("Your reset link is invalid or expired. Request a new one.");await authFetch("user",{method:"PUT",headers:{Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({password})});}
export async function signOut(){const session=getSession();if(session?.access_token)await authFetch("logout",{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`}}).catch(()=>undefined);saveSession(null);}
export async function apiRequest<T>(path:string,init:RequestInit={}):Promise<T>{const session=getSession();if(!API_URL)throw new Error("NEXT_PUBLIC_API_URL is not configured.");if(!session?.access_token)throw new Error("Your session has expired. Please log in again.");const response=await fetch(`${API_URL}${path}`,{...init,headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`,...init.headers}});const data=await response.json().catch(()=>({})) as T&{detail?:string;message?:string};if(!response.ok)throw new Error(data.detail||data.message||"The request failed.");return data;}
