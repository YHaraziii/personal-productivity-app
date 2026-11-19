-- =============================================================================
-- Synchronization RPCs.
--
-- Both functions are SECURITY INVOKER: they run with the caller's privileges,
-- so every statement is subject to the RLS policies defined in the schema
-- migration. Nothing here can read or write another user's rows.
-- =============================================================================

-- Columns a client is allowed to change with an 'update' mutation, per table.
-- Anything not listed (id, user_id, version, timestamps, parent ids) is
-- server-managed or immutable.
create function public.sync_columns(tbl text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case tbl
    when 'groups' then 'name, description, color, icon, sort_index, collapsed, grid_x, grid_y, grid_w, grid_h, sort_field, sort_dir, deleted_at'
    when 'labels' then 'name, color, deleted_at'
    when 'recurrence_series' then 'unit, interval_count, anchor_date, title, description, priority, due_time, label_ids, subtasks, ended_at, deleted_at'
    when 'tasks' then 'title, description, priority, due_date, due_time, completed_at, manual_index, series_id, occurrence_date, deleted_at'
    when 'subtasks' then 'text, completed, sort_index, deleted_at'
    when 'task_labels' then 'deleted_at'
    when 'user_settings' then 'value, deleted_at'
  end;
$$;

-- Apply a batch of client mutations in order.
--
-- Each mutation: { mutation_id, table, op, row_id, base_version?, payload? }
--   op = 'insert'  payload = full row. Idempotent: an existing id is reported
--                  as 'exists' and left untouched.
--   op = 'update'  payload = changed columns only; applied only when the row's
--                  current version equals base_version, otherwise 'conflict'
--                  is returned together with the current server row.
--   op = 'delete'  soft delete, same version check. Deleting an already
--                  deleted row succeeds (idempotent).
--
-- Result per mutation: { mutation_id, status, row?, message? } where status is
-- one of applied | duplicate | exists | conflict | missing | error.
--
-- Every mutation runs in its own sub-transaction: one failure does not abort
-- the others, and a failed mutation leaves no partial writes behind.
create function public.sync_push(mutations jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  m jsonb;
  results jsonb := '[]'::jsonb;
  res jsonb;
  mid uuid;
  tbl text;
  op text;
  rid uuid;
  cols text;
  cur jsonb;
  payload jsonb;
  n integer;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if mutations is null or jsonb_typeof(mutations) <> 'array' then
    raise exception 'mutations must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(mutations) > 500 then
    raise exception 'too many mutations in one batch (max 500)' using errcode = '22023';
  end if;

  delete from public.applied_mutations
    where user_id = uid and applied_at < now() - interval '90 days';

  for m in select t.value from jsonb_array_elements(mutations) with ordinality as t(value, ord) order by t.ord loop
    begin
      mid := (m ->> 'mutation_id')::uuid;
      tbl := m ->> 'table';
      op := m ->> 'op';
      rid := (m ->> 'row_id')::uuid;
      cols := public.sync_columns(tbl);
      if cols is null then
        raise exception 'unknown table "%"', tbl using errcode = '22023';
      end if;
      if mid is null or rid is null then
        raise exception 'mutation_id and row_id are required' using errcode = '22023';
      end if;

      if exists (select 1 from public.applied_mutations a where a.user_id = uid and a.mutation_id = mid) then
        execute format('select to_jsonb(t) from public.%I t where t.id = $1', tbl) into cur using rid;
        res := jsonb_build_object('mutation_id', mid, 'status', 'duplicate', 'row', cur);

      elsif op = 'insert' then
        payload := coalesce(m -> 'payload', '{}'::jsonb)
          || jsonb_build_object('id', rid, 'user_id', uid, 'deleted_at', null);
        execute format(
          'insert into public.%I select (jsonb_populate_record(null::public.%I, $1)).* on conflict (id) do nothing',
          tbl, tbl) using payload;
        get diagnostics n = row_count;
        execute format('select to_jsonb(t) from public.%I t where t.id = $1', tbl) into cur using rid;
        if cur is null then
          raise exception 'row id is not available' using errcode = '42501';
        end if;
        if n = 1 then
          insert into public.applied_mutations (user_id, mutation_id) values (uid, mid);
          res := jsonb_build_object('mutation_id', mid, 'status', 'applied', 'row', cur);
        else
          res := jsonb_build_object('mutation_id', mid, 'status', 'exists', 'row', cur);
        end if;

      elsif op in ('update', 'delete') then
        execute format('select to_jsonb(t) from public.%I t where t.id = $1 for update', tbl) into cur using rid;
        if cur is null then
          res := jsonb_build_object('mutation_id', mid, 'status', 'missing');
        elsif op = 'delete' and (cur ->> 'deleted_at') is not null then
          insert into public.applied_mutations (user_id, mutation_id) values (uid, mid);
          res := jsonb_build_object('mutation_id', mid, 'status', 'applied', 'row', cur);
        elsif (m ->> 'base_version') is null or (cur ->> 'version')::integer <> (m ->> 'base_version')::integer then
          res := jsonb_build_object('mutation_id', mid, 'status', 'conflict', 'row', cur);
        else
          if op = 'delete' then
            payload := jsonb_build_object('deleted_at', now());
            cols := 'deleted_at';
          else
            payload := coalesce(m -> 'payload', '{}'::jsonb);
            if jsonb_typeof(payload) <> 'object' then
              raise exception 'payload must be an object' using errcode = '22023';
            end if;
          end if;
          execute format(
            'update public.%I t set (%s) = (select %s from jsonb_populate_record(t, $1)) where t.id = $2',
            tbl, cols, cols) using payload, rid;
          execute format('select to_jsonb(t) from public.%I t where t.id = $1', tbl) into cur using rid;
          insert into public.applied_mutations (user_id, mutation_id) values (uid, mid);
          res := jsonb_build_object('mutation_id', mid, 'status', 'applied', 'row', cur);
        end if;

      else
        raise exception 'unknown op "%"', op using errcode = '22023';
      end if;
    exception when others then
      res := jsonb_build_object(
        'mutation_id', m ->> 'mutation_id',
        'status', 'error',
        'code', sqlstate,
        'message', sqlerrm);
    end;
    results := results || jsonb_build_array(res);
  end loop;

  return results;
end;
$$;

-- Return every row of the caller changed after `since` (all rows when NULL),
-- including tombstones. `next_since` deliberately overlaps by a few seconds so
-- a transaction that was still in flight during this call is not missed;
-- re-applying an unchanged row on the client is a no-op.
create function public.sync_pull(since timestamptz default null) returns jsonb
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  started timestamptz := clock_timestamp();
  result jsonb := '{}'::jsonb;
  tbl text;
  tbl_rows jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  foreach tbl in array array[
    'groups', 'labels', 'recurrence_series', 'tasks', 'subtasks', 'task_labels', 'user_settings'
  ] loop
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) order by t.updated_at, t.id), ''[]''::jsonb)
         from public.%I t
        where t.user_id = $1 and ($2::timestamptz is null or t.updated_at > $2)',
      tbl) into tbl_rows using uid, since;
    result := result || jsonb_build_object(tbl, tbl_rows);
  end loop;
  return jsonb_build_object(
    'next_since', started - interval '10 seconds',
    'tables', result);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(timestamptz) to authenticated;
grant execute on function public.sync_columns(text) to authenticated;
