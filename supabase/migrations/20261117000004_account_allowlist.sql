-- =============================================================================
-- Account allowlist (defense in depth).
--
-- Public sign-up is disabled in the Supabase Auth settings. As a second,
-- independent safeguard, data access additionally requires the account to be
-- listed in public.app_users. If sign-ups were ever re-enabled by mistake, a
-- newly registered stranger could sign in but could not read, write, sync or
-- import anything.
--
-- The list is maintained only from the Supabase SQL editor (see README,
-- "Secure initial account provisioning"). The API roles have no access to it.
-- =============================================================================

create table public.app_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- RLS enabled with no policies: anon/authenticated can never see or change it.
alter table public.app_users enable row level security;
revoke all on table public.app_users from public, anon, authenticated;

-- SECURITY DEFINER so it can consult the list on the caller's behalf; it only
-- ever answers "is the CURRENT user allowed?", never anything about others.
create function public.is_app_user() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.app_users where user_id = auth.uid())
$$;
revoke execute on function public.is_app_user() from public, anon;
grant execute on function public.is_app_user() to authenticated;

-- Re-create every data policy with the allowlist condition.
do $$
declare
  t text;
  cond text := 'user_id = (select auth.uid()) and (select public.is_app_user())';
begin
  foreach t in array array[
    'groups', 'labels', 'recurrence_series', 'tasks', 'subtasks',
    'task_labels', 'user_settings', 'applied_mutations'
  ] loop
    execute format('drop policy %I on public.%I', t || '_select_own', t);
    execute format('drop policy %I on public.%I', t || '_insert_own', t);
    execute format('drop policy %I on public.%I', t || '_update_own', t);
    execute format('drop policy %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select_own', t, cond);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert_own', t, cond);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update_own', t, cond, cond);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete_own', t, cond);
  end loop;
end;
$$;

-- The RPCs fail fast with a clear message for accounts that are not enabled.
create function public.assert_app_user() returns void
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_app_user() then
    raise exception 'This account is not enabled for this dashboard' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function public.assert_app_user() from public, anon;
grant execute on function public.assert_app_user() to authenticated;

-- Wrap the public RPCs so the allowlist check runs first and a clear message
-- is returned. The renamed originals stay callable by `authenticated` (the
-- SECURITY INVOKER wrappers need that), which is harmless: they run with the
-- caller's rights, so RLS, including the allowlist condition, still applies.
alter function public.sync_push(jsonb) rename to sync_push_impl;
alter function public.sync_pull(timestamptz) rename to sync_pull_impl;
alter function public.import_backup(jsonb, text) rename to import_backup_impl;

create function public.sync_push(mutations jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform public.assert_app_user();
  return public.sync_push_impl(mutations);
end;
$$;

create function public.sync_pull(since timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  perform public.assert_app_user();
  return public.sync_pull_impl(since);
end;
$$;

create function public.import_backup(payload jsonb, mode text) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  perform public.assert_app_user();
  return public.import_backup_impl(payload, mode);
end;
$$;

revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(timestamptz) from public, anon;
revoke execute on function public.import_backup(jsonb, text) from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(timestamptz) to authenticated;
grant execute on function public.import_backup(jsonb, text) to authenticated;
