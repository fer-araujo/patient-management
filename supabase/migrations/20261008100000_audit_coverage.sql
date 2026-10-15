-- =============================================================================
-- 28 - Audit coverage for every table
-- =============================================================================
-- Problem this file fixes (audit observation "Audit gaps"):
--   The generic audit_row_change() trigger (migration 08) was attached only to
--   the clinical tables and the tables Phase 2+ created. Six tables had no
--   trail at all, so these changes left no record of who made them or when:
--     profiles             a role change (patient -> doctor/admin), name edits
--     clinic_settings      the doctor-only mode toggle and the opening hours
--     services             catalog prices, durations, archiving a service
--     blocked_slots        blocks in the agenda (they hide booking slots)
--     inventory            item edits and every stock change
--     inventory_movements  the stock ledger (append-only; its INSERTs only)
--   Every other table in public already had the trigger: patients,
--   appointments, clinical_notes, prescriptions, patient_files, consents,
--   clinical_note_addenda, arco_requests, payments, service_supplies,
--   body_measurements, prescriber_profile. audit_log itself never gets it (it
--   would audit its own inserts forever).
--
-- Design:
--   * audit_row_change() keeps migration 08's behavior: column NAMES only,
--     never values; no-op updates are not logged; the actor comes from
--     audit_actor_role(). Migration 28 changes only how ids are read:
--       - row_id is the row's "id" when it is a uuid, otherwise NULL (a
--         non-uuid id used to raise on the cast and abort the write);
--       - patient_id: patients.id for patients; the row's patient_id for
--         tables that have one; the parent note's patient for addenda; NULL
--         for every table without a patient (profiles, clinic_settings,
--         services, blocked_slots, inventory, inventory_movements,
--         service_supplies, prescriber_profile). A malformed reference is
--         NULL, never an error.
--   * The trigger is attached to the six tables above as AFTER INSERT OR
--     UPDATE OR DELETE FOR EACH ROW, the same shape as every other table.
--     It never refuses a write by policy; if the audit insert itself fails,
--     the audited write fails too (fail-closed, as an audit trail should).
--   * EXECUTE on audit_row_change(), write_audit_event() and
--     audit_actor_role() is revoked from public, anon, authenticated AND
--     service_role. Migration 08 left service_role able to call
--     write_audit_event() directly and forge entries; nothing calls it with
--     that role (the triggers and RPCs call it as its owner).
--   * The gate checks that EVERY base table in public except audit_log
--     carries an enabled audit_row_change trigger of that shape (a table added
--     later without it fails a re-run of this file), and repeats migration
--     27's SECURITY DEFINER surface check by signature. This file adds no
--     function anon or authenticated can execute, so the reviewed list is
--     migration 27's, unchanged.
--
-- Effects to expect:
--   * The Bitácora (Centro de Comando) shows the new entries with no patient.
--     A profile created by sign-up or a change made from the SQL editor shows
--     the actor "La consola de base de datos" (role 'system', no actor id).
--   * Every consultation that records supplies now also writes one inventory
--     UPDATE and one inventory_movements INSERT per supply.
--   * The pre-production reset needs no change: this trigger never refuses a
--     delete, and the audit rows written while the reset deletes and resets
--     stock are removed by its final audit_log delete.
--
-- Note for maintainers: re-running migration 08 restores the older
-- audit_row_change() body and leaves service_role able to execute the audit
-- helpers. Run this file again afterwards.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- audit_row_change - migration 08 body + safe id reading
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_row     jsonb;
  v_cols    text[];
  v_row_id  uuid;
  v_ref     text;
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

  -- Migration 28: an id is used only when it is a uuid; anything else is
  -- NULL instead of a failed cast that would abort the audited write.
  v_ref := v_row ->> 'id';
  if v_ref ~ c_uuid then
    v_row_id := v_ref::uuid;
  end if;

  -- Migration 28: tables without a patient (profiles, clinic_settings,
  -- services, blocked_slots, inventory, ...) fall through and log NULL.
  if tg_table_name = 'patients' then
    v_patient := v_row_id;
  elsif v_row ? 'patient_id' then
    v_ref := v_row ->> 'patient_id';
    if v_ref ~ c_uuid then
      v_patient := v_ref::uuid;
    end if;
  elsif v_row ? 'note_id' then
    v_ref := v_row ->> 'note_id';
    if v_ref ~ c_uuid then
      select cn.patient_id into v_patient
      from public.clinical_notes cn
      where cn.id = v_ref::uuid;
    end if;
  end if;

  perform public.write_audit_event(tg_op, tg_table_name, v_row_id, v_patient, v_cols);

  return null;
end;
$$;

comment on function public.audit_row_change() is
  'Generic AFTER row trigger: appends who changed which COLUMN NAMES of which row (never values) to audit_log. patient_id is NULL for tables without a patient. Internal.';

-- -----------------------------------------------------------------------------
-- The audit helpers are internal: no API role executes them
-- -----------------------------------------------------------------------------
revoke all on function public.audit_row_change() from public, anon, authenticated, service_role;
revoke all on function public.write_audit_event(text, text, uuid, uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function public.audit_actor_role() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Attach the trigger to the six tables that lacked it
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'clinic_settings', 'services', 'blocked_slots', 'inventory', 'inventory_movements'
  ] loop
    execute format('drop trigger if exists audit_row_change on public.%I', t);
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I '
      'for each row execute function public.audit_row_change()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn    text;
  v_clean text;
  v_bad   text;
  v_ok    boolean;
  v_rec   record;
begin
  -- 1. audit_log is still append-only and never audits itself.
  if to_regclass('public.audit_log') is null then
    raise exception 'Migration 28 FAILED: public.audit_log is missing (migration 08).' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.audit_log'::regclass and not tgisinternal
      and tgfoid = 'public.audit_row_change()'::regprocedure
  ) then
    raise exception 'Migration 28 FAILED: audit_log has an audit_row_change trigger; it would audit its own inserts.'
      using errcode = 'P0001';
  end if;

  if (select count(*) from pg_trigger
      where tgrelid = 'public.audit_log'::regclass and not tgisinternal and tgenabled <> 'D'
        and tgname in ('audit_log_block_update_delete', 'audit_log_block_truncate')) <> 2 then
    raise exception 'Migration 28 FAILED: an append-only trigger of audit_log is missing or disabled.' using errcode = 'P0001';
  end if;

  -- 2. Every base table in public except audit_log has an enabled
  --    AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW audit_row_change trigger.
  --    tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update, 64 instead.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname <> 'audit_log'
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e'
    )
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid
        and not t.tgisinternal
        and t.tgname = 'audit_row_change'
        and t.tgenabled <> 'D'
        and t.tgfoid = 'public.audit_row_change()'::regprocedure
        and (t.tgtype::integer & 1) = 1
        and (t.tgtype::integer & 2) = 0
        and (t.tgtype::integer & 64) = 0
        -- consents and clinical_note_addenda are append-only (their own
        -- triggers refuse UPDATE and DELETE), so since migrations 08/09 they
        -- are audited on INSERT only. Every other table: all three events.
        and (
          (c.relname in ('consents', 'clinical_note_addenda') and (t.tgtype::integer & 4) = 4)
          or (t.tgtype::integer & 28) = 28
        )
    );
  if v_bad is not null then
    raise exception 'Migration 28 FAILED: tables without an enabled AFTER ROW audit_row_change trigger: %. Attach it (see this file) and re-run.', v_bad
      using errcode = 'P0001';
  end if;

  -- 3. The trigger function: SECURITY DEFINER, pinned search_path, writes
  --    through write_audit_event() and logs keys (names), with safe ids.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.audit_row_change()'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'perform public\.write_audit_event\(tg_op, tg_table_name, v_row_id, v_patient, v_cols\)'
     or v_clean !~ 'select array_agg\(n\.key order by n\.key\)'
     or v_clean !~ 'if v_ref ~ c_uuid then v_row_id := v_ref::uuid' then
    raise exception 'Migration 28 FAILED: audit_row_change() must be SECURITY DEFINER with a pinned search_path, log column names through write_audit_event() and read ids safely.'
      using errcode = 'P0001';
  end if;

  -- 4. Nobody calls the audit helpers through the API, service_role included.
  foreach v_fn in array array[
    'public.audit_row_change()',
    'public.write_audit_event(text,text,uuid,uuid,text[])',
    'public.audit_actor_role()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Migration 28 FAILED: % is executable by anon, authenticated or service_role.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 5. Migration 26 rules still hold: no trigger function is executable by
  --    an API role.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute'))
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    );
  if v_bad is not null then
    raise exception 'Migration 28 FAILED: trigger functions executable by anon, authenticated or service_role: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 6. Migration 27's SECURITY DEFINER surface, unchanged: this file adds
  --    no function anon or authenticated can execute. Functions are
  --    matched by SIGNATURE (oid), never by name, so a new overload
  --    cannot slip in. The guard must be real code: comments and string
  --    literals are stripped from the body before matching, and staff RPCs
  --    need an actual "if not public.<guard>() then raise".
  for v_rec in
    with reviewed (sig, kind) as (
      values
        -- anon and authenticated: public reads that return no identity.
        ('public.get_availability(timestamptz,timestamptz)', 'public'),
        ('public.get_clinic_schedule()', 'public'),
        ('public.get_clinic_mode()', 'public'),
        -- Helpers RLS policies call as the requesting role.
        ('public.is_staff()', 'helper'),
        ('public.is_business_staff()', 'helper'),
        ('public.current_patient_id()', 'helper'),
        -- Doctor only.
        ('public.anonymize_patient(uuid)', 'staff'),
        ('public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)', 'staff'),
        ('public.issue_prescription(uuid)', 'staff'),
        ('public.log_prescription_shared(uuid,text)', 'staff'),
        ('public.record_consent_in_person(uuid)', 'staff'),
        ('public.record_consultation_supplies(uuid,jsonb)', 'staff'),
        ('public.record_payment(uuid,text,numeric,text,text)', 'staff'),
        ('public.resolve_arco_request(uuid,text,text)', 'staff'),
        ('public.set_clinic_mode(boolean)', 'staff'),
        ('public.staff_create_appointment(uuid,uuid,timestamptz)', 'staff'),
        -- Migration 30 (staff_record_past_visit): listed here too so a re-run of this file still passes.
        ('public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'staff'),
        -- Migration 31 (open clinical notes): listed here too so a re-run of this file still passes.
        ('public.close_clinical_note(uuid)', 'staff'),
        ('public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)', 'staff'),
        ('public.staff_register_arco_request(uuid,text,text,text)', 'staff'),
        ('public.staff_reschedule_appointment(uuid,timestamptz)', 'staff'),
        -- Doctor or admin.
        ('public.adjust_stock(uuid,integer,text,numeric,text)', 'business'),
        ('public.get_finance_payments(timestamptz,timestamptz)', 'business'),
        ('public.get_item_movements(uuid)', 'business'),
        ('public.get_procedure_profit(timestamptz,timestamptz)', 'business'),
        ('public.set_service_supplies(uuid,jsonb)', 'business'),
        -- The caller's own patient record.
        ('public.accept_privacy_notice(text,text)', 'patient'),
        ('public.cancel_my_appointment(uuid,text)', 'patient'),
        ('public.export_my_data()', 'patient'),
        ('public.get_my_booking_profile()', 'patient'),
        ('public.register_my_upload(text,text)', 'patient'),
        ('public.request_my_appointment(uuid,timestamptz,text)', 'patient'),
        ('public.reschedule_my_appointment(uuid,timestamptz)', 'patient'),
        ('public.submit_arco_request(text,text)', 'patient'),
        ('public.get_my_profile()', 'patient_sql'),
        ('public.register_me(text,text,text,text,integer,text,text)', 'register')
    )
    select p.oid::regprocedure::text as sig,
           p.prosrc,
           has_function_privilege('anon', p.oid, 'execute') as anon_x,
           r.kind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join reviewed r on to_regprocedure(r.sig) = p.oid
    where n.nspname = 'public'
      and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    if v_rec.kind is null then
      raise exception 'Migration 28 FAILED: unreviewed SECURITY DEFINER function executable by anon or authenticated: %. Nothing was changed.', v_rec.sig
        using errcode = 'P0001';
    end if;

    if v_rec.anon_x and v_rec.kind <> 'public' then
      raise exception 'Migration 28 FAILED: anon can execute %.', v_rec.sig using errcode = 'P0001';
    end if;

    -- Code only: no comments, no string literals, lower case, single spaces.
    v_clean := regexp_replace(
                 lower(regexp_replace(v_rec.prosrc,
                       $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')),
                 '\s+', ' ', 'g');

    v_ok := case v_rec.kind
      when 'staff'       then v_clean ~ 'if not public\.is_staff\(\) then raise'
      when 'business'    then v_clean ~ 'if not public\.is_business_staff\(\) then raise'
      when 'patient'     then v_clean ~ '(\w+) uuid := public\.current_patient_id\(\);.*\mif \1 is null then (raise|return)'
      when 'patient_sql' then v_clean ~ 'where p\.id = public\.current_patient_id\(\)'
      when 'register'    then v_clean ~ 'if public\.is_business_staff\(\) then raise'
                              and v_clean ~ 'if v_phone is null or length\(v_phone\) < 10 then raise'
      else true
    end;

    if not v_ok then
      raise exception 'Migration 28 FAILED: % (%) has no internal % guard in its code.', v_rec.sig, v_rec.kind, v_rec.kind
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 28 PASSED: every table in public except audit_log (profiles, clinic_settings, services, blocked_slots, inventory and inventory_movements included) has the AFTER ROW audit_row_change trigger, which logs column names only with a NULL patient for tables without one and never fails on a non-uuid id; audit_log keeps its append-only triggers and is not self-audited; the audit helpers are not executable by anon, authenticated or service_role; no trigger function is API-executable; the SECURITY DEFINER surface matches the reviewed list by signature.';
end $$;
