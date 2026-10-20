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

-- Saved-record revisions: keep in sync with migrations/20261020_workspace_revisions.sql.
alter table public.workspaces
  add column if not exists revision uuid not null default gen_random_uuid();
create or replace function public.rotate_workspace_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.revision := gen_random_uuid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists workspace_revision_on_write on public.workspaces;
create trigger workspace_revision_on_write
before insert or update on public.workspaces
for each row execute function public.rotate_workspace_revision();
revoke all on function public.rotate_workspace_revision() from public, anon, authenticated;
notify pgrst, 'reload schema';
