-- =============================================================================
-- 08 - Audit trail (Phase 2)
-- =============================================================================
-- Append-only record of who touched which clinical row and when.
--
-- Requirements this file answers:
--   * NOM-024-SSA3-2012 numeral 6.6.1 asks for traceability ("trazabilidad") and
--     non-repudiation of health information, and numeral 3.42 defines an audit
--     record as a chronological log of user activity.
--   * LFPDPPP 2025, art. 18: administrative, technical and physical security
--     measures proportional to the sensitivity of the data.
--
-- Design decisions:
--   1. The log stores the NAMES of the changed columns, never their values.
--      A value-level log would be a second, unprotected copy of the clinical
--      record; the name-level log answers "who changed what, when" without
--      duplicating health data.
--   2. patient_id is denormalized onto every entry (no foreign key). It is what
--      makes "show me everything that happened to this patient" a single indexed
--      query, and having no FK means the entry survives even if the row it
--      points at is later removed or anonymized.
--   3. Append-only is enforced three ways: no INSERT/UPDATE/DELETE/TRUNCATE
--      privilege for anon, authenticated or service_role; RLS with a SELECT-only
--      policy for staff; and BEFORE UPDATE/DELETE/TRUNCATE triggers that raise
--      for every role, including the table owner. The owner can still drop the
--      trigger - that residual risk is documented in docs/compliance.md.
--   4. Rows are written only by SECURITY DEFINER code (the row trigger below
--      and the Phase 2 RPCs) through public.write_audit_event().
--
-- Idempotent and re-runnable.
-- =============================================================================

create table if not exists public.audit_log (
  id               bigint generated always as identity primary key,
  occurred_at      timestamptz not null default now(),
  actor_id         uuid,
  actor_role       text not null,
  action           text not null,
  table_name       text not null,
  row_id           uuid,
  patient_id       uuid,
  changed_columns  text[]
);

-- Action vocabulary. Dropped and re-added so a re-run picks up new values.
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'FINALIZE', 'EXPORT', 'ANONYMIZE'));

create index if not exists audit_log_occurred_at_idx
  on public.audit_log (occurred_at desc);
create index if not exists audit_log_patient_occurred_idx
  on public.audit_log (patient_id, occurred_at desc);

comment on table public.audit_log is
  'Append-only audit trail. Stores changed column NAMES only, never values.';

-- -----------------------------------------------------------------------------
-- Privileges and RLS
-- -----------------------------------------------------------------------------
alter table public.audit_log enable row level security;

revoke all on public.audit_log from public, anon, authenticated, service_role;
grant select on public.audit_log to authenticated;

drop policy if exists "audit_log_select_staff" on public.audit_log;
create policy "audit_log_select_staff"
  on public.audit_log for select to authenticated
  using (public.is_staff());

-- -----------------------------------------------------------------------------
-- Append-only guard, reusable by every append-only table in Phase 2
-- -----------------------------------------------------------------------------
create or replace function public.reject_append_only_mutation()
returns trigger
language plpgsql
set search_path = pg_temp
as $$
begin
  raise exception 'La tabla % es de solo agregado: no se permite %.', tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

revoke all on function public.reject_append_only_mutation() from public, anon, authenticated;

drop trigger if exists audit_log_block_update_delete on public.audit_log;
create trigger audit_log_block_update_delete
  before update or delete on public.audit_log
  for each row execute function public.reject_append_only_mutation();

drop trigger if exists audit_log_block_truncate on public.audit_log;
create trigger audit_log_block_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_append_only_mutation();

-- -----------------------------------------------------------------------------
-- audit_actor_role - what kind of caller is acting right now
-- -----------------------------------------------------------------------------
-- Signed-in users resolve to their profiles.role (doctor / admin / patient).
-- Without a user id the request role from the JWT is used (anon for the public
-- booking RPC, service_role for the edge function). With no request context at
-- all the statement came from the SQL editor, a migration or psql: 'system'.
-- -----------------------------------------------------------------------------
create or replace function public.audit_actor_role()
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_role   text;
begin
  if auth.uid() is not null then
    select p.role into v_role from public.profiles p where p.id = auth.uid();
    return coalesce(v_role, 'authenticated');
  end if;

  if v_claims is null or v_claims = 'null' then
    return 'system';
  end if;

  begin
    return coalesce(nullif(v_claims::jsonb ->> 'role', ''), 'unknown');
  exception when others then
    return 'unknown';
  end;
end;
$$;

revoke all on function public.audit_actor_role() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- write_audit_event - the only writer of audit_log
-- -----------------------------------------------------------------------------
create or replace function public.write_audit_event(
  p_action          text,
  p_table_name      text,
  p_row_id          uuid,
  p_patient_id      uuid,
  p_changed_columns text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (
    actor_id, actor_role, action, table_name, row_id, patient_id, changed_columns
  )
  values (
    auth.uid(), public.audit_actor_role(), p_action, p_table_name,
    p_row_id, p_patient_id, p_changed_columns
  );
end;
$$;

revoke all on function public.write_audit_event(text, text, uuid, uuid, text[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- audit_row_change - generic AFTER row trigger
-- -----------------------------------------------------------------------------
-- INSERT: logs the columns that were given a non-null value.
-- UPDATE: logs the columns whose value actually changed; a no-op update is not
--         logged at all.
-- DELETE: logs the event with no column list.
-- The patient is resolved from the row itself (patients.id or <row>.patient_id)
-- or, for addenda, through the parent note.
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_row     jsonb;
  v_cols    text[];
  v_patient uuid;
begin
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into v_cols
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key);

    if v_cols is null then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    select array_agg(n.key order by n.key)
      into v_cols
    from jsonb_each(v_new) n
    where jsonb_typeof(n.value) <> 'null';
  end if;

  if tg_table_name = 'patients' then
    v_patient := (v_row ->> 'id')::uuid;
  elsif v_row ? 'patient_id' then
    v_patient := (v_row ->> 'patient_id')::uuid;
  elsif v_row ? 'note_id' then
    select cn.patient_id into v_patient
    from public.clinical_notes cn
    where cn.id = (v_row ->> 'note_id')::uuid;
  end if;

  perform public.write_audit_event(
    tg_op, tg_table_name, (v_row ->> 'id')::uuid, v_patient, v_cols
  );

  return null;
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Attach to the five clinical tables named in the Phase 2 brief. Later Phase 2
-- migrations attach the same trigger to the tables they create.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'patients', 'appointments', 'clinical_notes', 'prescriptions', 'patient_files'
  ] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I '
      'for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Go/no-go assertion
-- -----------------------------------------------------------------------------
do $$
declare
  t      text;
  r      text;
  v_priv text;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'audit_log' and c.relrowsecurity
  ) then
    raise exception 'audit_log is missing or RLS is off.' using errcode = 'P0001';
  end if;

  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(r, 'public.audit_log', v_priv) then
        raise exception 'Role % still holds % on audit_log: it is not append-only.', r, v_priv
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon', 'public.audit_log', 'SELECT') then
    raise exception 'anon can SELECT audit_log.' using errcode = 'P0001';
  end if;

  foreach t in array array['audit_log_block_update_delete', 'audit_log_block_truncate'] loop
    if not exists (
      select 1 from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      where c.relname = 'audit_log' and tg.tgname = t and not tg.tgisinternal
    ) then
      raise exception 'Append-only trigger % is missing on audit_log.', t using errcode = 'P0001';
    end if;
  end loop;

  foreach t in array array[
    'patients', 'appointments', 'clinical_notes', 'prescriptions', 'patient_files'
  ] loop
    if not exists (
      select 1 from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and tg.tgname = 'audit_row_change' and not tg.tgisinternal
    ) then
      raise exception 'audit_row_change trigger missing on public.%.', t using errcode = 'P0001';
    end if;
  end loop;

  if has_function_privilege('authenticated', 'public.write_audit_event(text,text,uuid,uuid,text[])', 'execute')
     or has_function_privilege('anon', 'public.write_audit_event(text,text,uuid,uuid,text[])', 'execute') then
    raise exception 'write_audit_event is callable from the API: anyone could forge audit entries.'
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 08 PASSED: audit_log is append-only, staff-readable, and wired to 5 tables.';
end $$;
