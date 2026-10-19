-- Run in your own Supabase SQL editor. Do not put secrets in GitHub.
create table if not exists public.customers (
 user_id uuid primary key references auth.users(id) on delete cascade,
 stripe_customer_id text not null unique
);
create table if not exists public.workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.customers enable row level security;
alter table public.workspaces enable row level security;
-- Backend validates each user with Supabase /auth/v1/user and scopes by that ID.
-- Browser/anonymous/authenticated direct table access is deliberately disabled.
revoke all on public.customers from anon, authenticated;
revoke all on public.workspaces from anon, authenticated;
grant all on public.customers to service_role;
grant all on public.workspaces to service_role;
