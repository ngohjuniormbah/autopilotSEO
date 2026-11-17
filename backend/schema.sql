-- Run once in the Supabase SQL Editor.
-- Supabase Auth owns identities. The API verifies Supabase JWTs and uses DATABASE_URL.
create extension if not exists pgcrypto;

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now(),
  unique(user_id, url)
);

create table if not exists public.audits (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  score integer not null check (score between 0 and 100),
  pages_crawled integer not null default 0,
  issue_count integer not null default 0,
  status text not null default 'completed',
  failures jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_pages (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  url text not null,
  title text not null default '',
  description text not null default '',
  h1_count integer not null default 0,
  canonical text not null default '',
  images_count integer not null default 0,
  images_missing_alt integer not null default 0,
  word_count integer not null default 0
);

create table if not exists public.audit_issues (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references public.audits(id) on delete cascade,
  code text not null,
  severity text not null check (severity in ('critical','warning','notice')),
  url text not null,
  title text not null,
  description text not null
);

create index if not exists sites_user_id_idx on public.sites(user_id);
create index if not exists audits_site_created_idx on public.audits(site_id, created_at desc);
create index if not exists audit_issues_audit_idx on public.audit_issues(audit_id);

alter table public.sites enable row level security;
alter table public.audits enable row level security;
alter table public.audit_pages enable row level security;
alter table public.audit_issues enable row level security;

create policy "Users manage their own sites" on public.sites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users read audits for their sites" on public.audits
  for select using (exists(select 1 from public.sites s where s.id = site_id and s.user_id = auth.uid()));
create policy "Users read pages for their audits" on public.audit_pages
  for select using (exists(select 1 from public.audits a join public.sites s on s.id = a.site_id where a.id = audit_id and s.user_id = auth.uid()));
create policy "Users read issues for their audits" on public.audit_issues
  for select using (exists(select 1 from public.audits a join public.sites s on s.id = a.site_id where a.id = audit_id and s.user_id = auth.uid()));

-- The FastAPI service connects with the database role from DATABASE_URL.
-- Keep DATABASE_URL and SUPABASE_JWT_SECRET server-side only.
