-- Apply once to an existing installation BEFORE deploying the matching server.
-- Additive: existing workspace data, timestamps, RLS and grants are preserved.
begin;
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
commit;
