-- =============================================================================
-- Transactional backup import.
--
-- import_backup runs as a single statement, therefore in a single transaction:
-- any validation error or constraint violation raises an exception and rolls
-- back every change, so a failed import can never leave the database partially
-- overwritten. SECURITY INVOKER + RLS + the ownership trigger guarantee that
-- imported rows always belong to the caller, whatever the file claims.
--
-- mode = 'replace'
--   Existing rows that are not in the backup are soft-deleted; rows in the
--   backup are inserted, or overwrite/restore the existing row with the same id.
-- mode = 'merge'
--   Existing live rows always win. Backup rows with unknown ids are added;
--   backup rows whose id matches a previously deleted row restore that row.
-- =============================================================================

create function public.import_backup(payload jsonb, mode text) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid();
  data jsonb;
  tbl text;
  tbl_rows jsonb;
  cols text;
  set_list text;
  parent_cond text;
  total integer;
  matched_live integer;
  matched_deleted integer;
  removed integer;
  n integer;
  summary jsonb := '{}'::jsonb;
  counts jsonb := '{}'::jsonb;
  ts timestamptz := now();
  tables constant text[] := array['groups', 'labels', 'recurrence_series', 'tasks', 'subtasks', 'task_labels'];
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if mode is null or mode not in ('replace', 'merge') then
    raise exception 'Invalid import mode' using errcode = '22023';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' or payload ->> 'format' is distinct from 'ppd-backup' then
    raise exception 'Not a Personal Productivity Dashboard backup' using errcode = '22023';
  end if;
  if (payload ->> 'version') is distinct from '1' then
    raise exception 'Unsupported backup version %', coalesce(payload ->> 'version', '(none)') using errcode = '22023';
  end if;
  data := payload -> 'data';
  if data is null or jsonb_typeof(data) <> 'object' then
    raise exception 'Backup has no data section' using errcode = '22023';
  end if;

  -- ---- Structural validation (before any write) ---------------------------
  foreach tbl in array tables || array['user_settings'] loop
    tbl_rows := coalesce(data -> tbl, '[]'::jsonb);
    if jsonb_typeof(tbl_rows) <> 'array' then
      raise exception 'Backup section "%" must be a list', tbl using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(tbl_rows) e where jsonb_typeof(e.value) <> 'object') then
      raise exception 'Backup section "%" contains an invalid record', tbl using errcode = '22023';
    end if;
  end loop;

  foreach tbl in array tables loop
    tbl_rows := coalesce(data -> tbl, '[]'::jsonb);
    if exists (select 1 from jsonb_array_elements(tbl_rows) e where (e.value ->> 'id') is null) then
      raise exception 'A record in "%" has no id', tbl using errcode = '22023';
    end if;
    if (select count(*) <> count(distinct e.value ->> 'id') from jsonb_array_elements(tbl_rows) e) then
      raise exception 'Duplicate ids in "%"', tbl using errcode = '22023';
    end if;
  end loop;
  if (select count(*) <> count(distinct e.value ->> 'key') from jsonb_array_elements(coalesce(data -> 'user_settings', '[]'::jsonb)) e) then
    raise exception 'Duplicate keys in "user_settings"' using errcode = '22023';
  end if;

  -- ---- Relationship validation: the backup must be self-contained ----------
  if exists (
    select 1 from jsonb_array_elements(coalesce(data -> 'recurrence_series', '[]'::jsonb)) s
    where not exists (select 1 from jsonb_array_elements(coalesce(data -> 'groups', '[]'::jsonb)) g where g.value ->> 'id' = s.value ->> 'group_id')
  ) then
    raise exception 'A recurrence series refers to a group that is not in the backup' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(data -> 'tasks', '[]'::jsonb)) t
    where not exists (select 1 from jsonb_array_elements(coalesce(data -> 'groups', '[]'::jsonb)) g where g.value ->> 'id' = t.value ->> 'group_id')
  ) then
    raise exception 'A task refers to a group that is not in the backup' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(data -> 'tasks', '[]'::jsonb)) t
    where (t.value ->> 'series_id') is not null
      and not exists (select 1 from jsonb_array_elements(coalesce(data -> 'recurrence_series', '[]'::jsonb)) s where s.value ->> 'id' = t.value ->> 'series_id')
  ) then
    raise exception 'A task refers to a recurrence series that is not in the backup' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(data -> 'subtasks', '[]'::jsonb)) s
    where not exists (select 1 from jsonb_array_elements(coalesce(data -> 'tasks', '[]'::jsonb)) t where t.value ->> 'id' = s.value ->> 'task_id')
  ) then
    raise exception 'A checklist item refers to a task that is not in the backup' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(data -> 'task_labels', '[]'::jsonb)) tl
    where not exists (select 1 from jsonb_array_elements(coalesce(data -> 'tasks', '[]'::jsonb)) t where t.value ->> 'id' = tl.value ->> 'task_id')
       -- A label may also be one the caller already has: when merging, the
       -- client maps backup labels onto existing labels with the same name.
       or (not exists (select 1 from jsonb_array_elements(coalesce(data -> 'labels', '[]'::jsonb)) l where l.value ->> 'id' = tl.value ->> 'label_id')
           and not exists (select 1 from public.labels l where l.id = (tl.value ->> 'label_id')::uuid and l.deleted_at is null))
  ) then
    raise exception 'A task label refers to a task or label that is not in the backup' using errcode = '22023';
  end if;

  -- ---- Count matches before anything is written ----------------------------
  -- (restoring a parent also restores its children, which would otherwise
  -- make them look like live rows by the time their table is processed)
  foreach tbl in array tables loop
    execute format(
      'select count(*) filter (where t.deleted_at is null), count(*) filter (where t.deleted_at is not null)
         from public.%I t join jsonb_array_elements($1) e on (e.value ->> ''id'')::uuid = t.id',
      tbl) into matched_live, matched_deleted using coalesce(data -> tbl, '[]'::jsonb);
    counts := counts || jsonb_build_object(tbl, jsonb_build_object('live', matched_live, 'deleted', matched_deleted));
  end loop;

  -- ---- Upsert, parents before children -------------------------------------
  foreach tbl in array tables loop
    tbl_rows := coalesce(data -> tbl, '[]'::jsonb);
    select coalesce(jsonb_agg(e.value || jsonb_build_object('user_id', uid, 'deleted_at', null)), '[]'::jsonb)
      into tbl_rows from jsonb_array_elements(tbl_rows) e;
    total := jsonb_array_length(tbl_rows);
    cols := public.sync_columns(tbl);
    select string_agg(format('%I = excluded.%I', trim(c), trim(c)), ', ')
      into set_list from unnest(string_to_array(cols, ',')) c;

    -- A row that already exists must keep its parent: parent ids are immutable.
    parent_cond := case tbl
      when 'recurrence_series' then 't.group_id <> i.group_id'
      when 'tasks' then 't.group_id <> i.group_id'
      when 'subtasks' then 't.task_id <> i.task_id'
      when 'task_labels' then 't.task_id <> i.task_id or t.label_id <> i.label_id'
    end;
    if parent_cond is not null then
      execute format(
        'select count(*) from public.%I t join jsonb_populate_recordset(null::public.%I, $1) i on i.id = t.id where %s',
        tbl, tbl, parent_cond) into n using tbl_rows;
      if n > 0 then
        raise exception 'A record in "%" already exists under a different parent', tbl using errcode = '22023';
      end if;
    end if;

    matched_live := (counts -> tbl ->> 'live')::integer;
    matched_deleted := (counts -> tbl ->> 'deleted')::integer;

    if mode = 'replace' then
      execute format(
        'insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)
           on conflict (id) do update set %s',
        tbl, tbl, set_list) using tbl_rows;
      summary := summary || jsonb_build_object(tbl, jsonb_build_object(
        'added', total - matched_live - matched_deleted,
        'updated', matched_live,
        'restored', matched_deleted,
        'skipped', 0));
    else
      execute format(
        'insert into public.%I as t select * from jsonb_populate_recordset(null::public.%I, $1)
           on conflict (id) do update set %s where t.deleted_at is not null',
        tbl, tbl, set_list) using tbl_rows;
      summary := summary || jsonb_build_object(tbl, jsonb_build_object(
        'added', total - matched_live - matched_deleted,
        'updated', 0,
        'restored', matched_deleted,
        'skipped', matched_live,
        'removed', 0));
    end if;

    -- Every imported id must now be a row the caller owns. If one is not
    -- visible here, the id belongs to someone else's data: abort everything.
    execute format(
      'select count(*) from public.%I t join jsonb_populate_recordset(null::public.%I, $1) i on i.id = t.id',
      tbl, tbl) into n using tbl_rows;
    if n <> total then
      raise exception 'A record id in "%" is not available to this account', tbl using errcode = '42501';
    end if;
  end loop;

  -- ---- Replace: retire everything that is not part of the backup -----------
  -- Runs after the upserts (restoring a group also restores the children that
  -- were deleted with it, and those must be retired again if they are not in
  -- the backup) and walks children before parents so the counts are exact.
  if mode = 'replace' then
    foreach tbl in array array['subtasks', 'task_labels', 'tasks', 'recurrence_series', 'labels', 'groups'] loop
      tbl_rows := coalesce(data -> tbl, '[]'::jsonb);
      execute format(
        'update public.%I t set deleted_at = $1
          where t.user_id = $2 and t.deleted_at is null
            and not exists (select 1 from jsonb_array_elements($3) e where (e.value ->> ''id'')::uuid = t.id)',
        tbl) using ts, uid, tbl_rows;
      get diagnostics removed = row_count;
      summary := summary || jsonb_build_object(tbl,
        coalesce(summary -> tbl, '{}'::jsonb) || jsonb_build_object('removed', removed));
    end loop;
  end if;

  -- ---- Settings are matched by key ------------------------------------------
  tbl_rows := coalesce(data -> 'user_settings', '[]'::jsonb);
  total := jsonb_array_length(tbl_rows);
  select count(*) into matched_live
    from public.user_settings s
    join jsonb_array_elements(tbl_rows) e on e.value ->> 'key' = s.key
   where s.user_id = uid and s.value is not null and s.value <> 'null'::jsonb;

  if mode = 'replace' then
    update public.user_settings s set value = null
      where s.user_id = uid and s.value is not null
        and not exists (select 1 from jsonb_array_elements(tbl_rows) e where e.value ->> 'key' = s.key);
    get diagnostics removed = row_count;
    insert into public.user_settings (id, user_id, key, value)
      select (e.value ->> 'id')::uuid, uid, e.value ->> 'key', e.value -> 'value'
        from jsonb_array_elements(tbl_rows) e
      on conflict (user_id, key) do update set value = excluded.value, deleted_at = null;
    summary := summary || jsonb_build_object('user_settings', jsonb_build_object(
      'added', total - matched_live, 'updated', matched_live, 'restored', 0, 'skipped', 0, 'removed', removed));
  else
    insert into public.user_settings as s (id, user_id, key, value)
      select (e.value ->> 'id')::uuid, uid, e.value ->> 'key', e.value -> 'value'
        from jsonb_array_elements(tbl_rows) e
      on conflict (user_id, key) do update set value = excluded.value, deleted_at = null
        where s.value is null or s.value = 'null'::jsonb;
    summary := summary || jsonb_build_object('user_settings', jsonb_build_object(
      'added', total - matched_live, 'updated', 0, 'restored', 0, 'skipped', matched_live, 'removed', 0));
  end if;

  return jsonb_build_object('mode', mode, 'tables', summary);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.import_backup(jsonb, text) to authenticated;
