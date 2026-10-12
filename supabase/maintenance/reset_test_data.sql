-- =============================================================================
-- PRE-PRODUCTION RESET - DESTRUCTIVE - deletes every patient and test record
-- =============================================================================
-- NOT a migration. Never run it automatically, never run it once real
-- patients use the app. Paste it into the Supabase SQL editor by hand.
-- Never SAVE the edited script in the SQL Editor and never commit it to git:
-- the confirmation and the deadline must be typed fresh every time.
--
-- What it does, in ONE transaction:
--   DELETES every row of: clinical_note_addenda, inventory_movements,
--   payments, prescriptions (with their issue snapshots and folios),
--   clinical_notes, body_measurements, patient_files, consents,
--   arco_requests, appointments, patients, blocked_slots and audit_log.
--   RESETS: inventory.stock_quantity to 0 and last_restock_date to null on
--   every item (the stock ledger is now empty, so the stock must be 0 to
--   match it); the prescription folio sequence and the audit_log id back to
--   1. Doctor-only mode is turned ON (and left on): the patient portal stays
--   closed until the manual checklist is done (test phone numbers and test
--   users removed); only then turn it off in the app if the clinic wants it.
--   KEEPS untouched: services (catalog), inventory items (name, category,
--   alert level, unit, active flag), service_supplies, clinic_settings (the
--   opening hours), prescriber_profile and the signature files, and every
--   profiles row (doctor, admin and the test patients' profiles, which go away
--   with their auth users; see the manual checklist).
--
-- Scope (app.reset_scope):
--   'test_data'  (default) exactly what is described above.
--   'everything' the clinic starts completely empty. ALSO DELETES every row
--                of service_supplies, services (the catalog) and inventory
--                (every item). ALSO RESETS clinic_settings.schedule to NULL
--                (the app and the booking RPCs fall back to the default
--                hours until the doctor saves hers) and
--                prescriber_profile.signature_path to NULL (the doctor draws
--                a new signature; the old PNGs in Storage prescriber_private
--                must be deleted by hand, see the checklist). KEEPS the
--                profiles, the single clinic_settings row (doctor-only mode
--                ON) and every other prescriber_profile field. The
--                confirmation phrase becomes 'BORRAR TODO <N> FILAS', so a
--                phrase from a 'test_data' dry run can never run 'everything'.
--
-- Protection it bypasses, and only inside this transaction:
--   append-only and integrity triggers that refuse DELETE (audit_log,
--   consents, clinical_note_addenda, inventory_movements, clinical_notes,
--   prescriptions, body_measurements) and the stock guard on inventory. They
--   are disabled by name with ALTER TABLE ... DISABLE TRIGGER, re-enabled
--   before the end, and the script verifies that every trigger that was
--   enabled at the start is enabled again. ALTER TABLE is transactional: if
--   anything fails, Postgres rolls back the deletes AND the trigger changes.
--   Scope 'everything' needs no extra one: nothing refuses deleting the
--   catalog, and prescriber_profile_guard only stamps updated_at.
--
-- How to run:
--   1. DRY RUN (default, changes nothing): paste the file as it is (set
--      app.reset_scope first if you want 'everything'). It checks every
--      precondition the real run needs (so a clean dry run predicts a clean
--      run), and prints the scope it evaluated, the rows it would delete, the
--      exact confirmation phrase, the Storage files and the test auth users.
--   2. EXECUTE, right after a fresh dry run of the SAME scope:
--        set local app.confirm_reset  = 'BORRAR <N> FILAS';  -- exactly as the dry run printed it
--        set local app.reset_deadline = 'YYYY-MM-DD';        -- today .. today + 7
--        set local app.reset_scope    = 'test_data';         -- or 'everything', as in the dry run
--        set local app.reset_mode     = 'execute';
--      The script counts again after locking the tables: if the phrase is not
--      exactly the one for this scope and count (new data appeared, or the
--      scope differs from the dry run), or the deadline is missing, invalid
--      or past, it aborts before touching a row.
--   3. Expected output: a notice starting with "RESET DRY RUN" or
--      "RESET DONE". Any "RESET ABORTED/FAILED: ..." error means nothing
--      was changed (the transaction rolls back).
--   4. Do the manual checklist printed at the end. SQL cannot do those safely.
--
-- Run it with nobody using the app. It waits at most 5 seconds for each lock
-- (lock_timeout) and then aborts instead of queueing behind the app.
-- =============================================================================

begin;

-- Fail fast instead of waiting behind the app's open transactions.
set local lock_timeout = '5s';

-- STEP 1: the confirmation phrase exactly as the dry run printed it,
--         'BORRAR <N> FILAS' ('BORRAR TODO <N> FILAS' for scope everything)
--         (ignored by a dry run).
set local app.confirm_reset = '';
-- STEP 2: the last day this edited copy may run, 'YYYY-MM-DD' (execute only).
set local app.reset_deadline = '';
-- STEP 3: 'test_data' (patients and test records only) or 'everything' (also
--         the catalog, the inventory items, the opening hours and the
--         doctor's signature). Use the same scope in the dry run and the run.
set local app.reset_scope = 'test_data';
-- STEP 4: 'dry_run' (only reports) or 'execute' (deletes).
set local app.reset_mode = 'dry_run';

do $$
declare
  v_tz       constant text := 'America/Monterrey';
  v_mode     text := coalesce(current_setting('app.reset_mode', true), '');
  v_scope    text := coalesce(current_setting('app.reset_scope', true), '');
  v_confirm  text := btrim(coalesce(current_setting('app.confirm_reset', true), ''));
  v_deadline_text text := btrim(coalesce(current_setting('app.reset_deadline', true), ''));
  v_deadline date;
  v_today    date := (now() at time zone 'America/Monterrey')::date;
  -- Child tables first, so no foreign key is ever in the way; audit_log
  -- last, because every delete above it writes audit rows. The same order
  -- is used to take the locks.
  v_wipe     text[] := array[
    'clinical_note_addenda', 'inventory_movements', 'payments', 'prescriptions',
    'clinical_notes', 'body_measurements', 'patient_files', 'consents',
    'arco_requests', 'appointments', 'patients', 'blocked_slots', 'audit_log'
  ];
  v_keep     text[] := array[
    'services', 'inventory', 'service_supplies', 'clinic_settings',
    'prescriber_profile', 'profiles'
  ];
  -- Scope 'everything' also empties these (filled below; children first:
  -- service_supplies references both services and inventory).
  v_extra    text[] := '{}';
  -- Tables whose content must not change at all (fingerprinted). Scope
  -- 'everything' narrows it to profiles; prescriber_profile and
  -- clinic_settings are then checked column by column.
  v_untouched text[] := array['services', 'service_supplies', 'prescriber_profile', 'profiles'];
  -- table.trigger: the protections that refuse the deletes (and the stock reset).
  v_guards   text[] := array[
    'audit_log.audit_log_block_update_delete',
    'consents.consents_block_update_delete',
    'clinical_note_addenda.clinical_note_addenda_block_update_delete',
    'inventory_movements.inventory_movements_block_update_delete',
    'clinical_notes.clinical_notes_enforce_integrity',
    'prescriptions.prescriptions_enforce_integrity',
    'body_measurements.body_measurements_guard',
    'inventory.inventory_guard_stock'
  ];
  v_tbl      text;
  v_guard    text;
  v_count    bigint;
  v_total    bigint := 0;
  v_phrase   text;
  v_report   text := '';
  v_bad      text;
  v_before   jsonb := '{}'::jsonb;
  v_after    jsonb := '{}'::jsonb;
  v_triggers jsonb;
  v_disabled text[] := '{}';
  v_files    text;
  v_users    text;
  v_n_files  bigint;
  v_n_users  bigint;
  v_seq      record;
  v_audit_seq text;
  v_checklist text;
  v_n_sigs   bigint;
  v_n_prescriber bigint;
  v_n_stock  bigint;
  v_has_sig  boolean;
  v_has_sched boolean;
  v_scope_notes text;
begin
  -- -------------------------------------------------------------------------
  -- 0. Preconditions (BOTH modes: a clean dry run predicts a clean run)
  -- -------------------------------------------------------------------------
  if v_mode not in ('dry_run', 'execute') then
    raise exception 'RESET ABORTED: app.reset_mode must be dry_run or execute (got "%"). Nothing was changed.', v_mode;
  end if;

  if v_scope not in ('test_data', 'everything') then
    raise exception 'RESET ABORTED: app.reset_scope must be test_data or everything (got "%"). Nothing was changed.', v_scope;
  end if;

  if v_scope = 'everything' then
    v_extra := array['service_supplies', 'services', 'inventory'];
    v_untouched := array['profiles'];
  end if;

  -- Every public table must be known: a new table added after this script
  -- was written could hold patient data the reset would silently leave.
  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname <> all (v_wipe || v_keep);
  if v_bad is not null then
    raise exception 'RESET ABORTED: public has tables this script does not know: %. Update supabase/maintenance/reset_test_data.sql first. Nothing was changed.', v_bad;
  end if;

  foreach v_tbl in array v_wipe || v_keep loop
    if to_regclass('public.' || v_tbl) is null then
      raise exception 'RESET ABORTED: table public.% is missing; are all migrations applied? Nothing was changed.', v_tbl;
    end if;
  end loop;

  if to_regclass('public.prescription_folio_seq') is null then
    raise exception 'RESET ABORTED: public.prescription_folio_seq is missing (migration 25). Nothing was changed.';
  end if;

  v_audit_seq := pg_get_serial_sequence('public.audit_log', 'id');
  if v_audit_seq is null then
    raise exception 'RESET ABORTED: public.audit_log.id has no identity sequence. Nothing was changed.';
  end if;

  -- The SQL editor's role must own (or be a member of the owner of) every
  -- table it deletes from, locks, alters or updates, and the sequences it
  -- restarts. Otherwise the real run would fail half way.
  select string_agg(c.oid::regclass::text, ', ')
    into v_bad
  from pg_class c
  where c.oid in (
          select to_regclass('public.' || t)
          from unnest(v_wipe || v_extra || array['inventory', 'clinic_settings']
                      || case when v_scope = 'everything' then array['prescriber_profile'] else '{}'::text[] end) as t
          union all select to_regclass('public.prescription_folio_seq')
          union all select to_regclass(v_audit_seq)
        )
    and not pg_has_role(current_user, c.relowner, 'USAGE');
  if v_bad is not null then
    raise exception 'RESET ABORTED: the current role (%) does not own: %. Run it from the SQL editor as postgres. Nothing was changed.',
      current_user, v_bad;
  end if;

  -- The eight protections must exist and be ON: a missing or already
  -- disabled guard means the database is not in the state this script was
  -- written for.
  foreach v_guard in array v_guards loop
    select string_agg(format('%s (%s)', v_guard,
                             case when t.oid is null then 'missing' else 'disabled' end), ', ')
      into v_bad
    from (select 1) one
    left join pg_trigger t
      on t.tgrelid = to_regclass('public.' || split_part(v_guard, '.', 1))
     and t.tgname = split_part(v_guard, '.', 2)
     and not t.tgisinternal
    where t.oid is null or t.tgenabled = 'D';
    if v_bad is not null then
      raise exception 'RESET ABORTED: protective trigger %. Nothing was changed.', v_bad;
    end if;
  end loop;

  if not exists (select 1 from public.profiles where role = 'doctor') then
    raise exception 'RESET ABORTED: no profile has role doctor. Nothing was changed.';
  end if;

  if (select count(*) from public.clinic_settings) <> 1 then
    raise exception 'RESET ABORTED: clinic_settings must have exactly one row (save the opening hours in the app first). Nothing was changed.';
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Execute only: deadline, then locks, then the exact count
  -- -------------------------------------------------------------------------
  if v_mode = 'execute' then
    begin
      v_deadline := v_deadline_text::date;
    exception when others then
      v_deadline := null;
    end;
    if v_deadline is null then
      raise exception 'RESET ABORTED: set app.reset_deadline to a date (YYYY-MM-DD) between today and 7 days ahead. Nothing was changed.';
    end if;
    if v_today > v_deadline then
      raise exception 'RESET ABORTED: the deadline % has passed (today is %). Do a fresh dry run and type a new deadline. Nothing was changed.',
        v_deadline, v_today;
    end if;
    if v_deadline > v_today + 7 then
      raise exception 'RESET ABORTED: the deadline % is more than 7 days ahead. Nothing was changed.', v_deadline;
    end if;

    -- Nobody else may read or write these tables until the end (children
    -- first, the same order as the deletes; at most 5 s per lock).
    execute 'lock table public.clinical_note_addenda, public.inventory_movements, public.payments,'
         || ' public.prescriptions, public.clinical_notes, public.body_measurements,'
         || ' public.patient_files, public.consents, public.arco_requests, public.appointments,'
         || ' public.patients, public.blocked_slots, public.audit_log,'
         || ' public.inventory, public.clinic_settings in access exclusive mode';
    if v_scope = 'everything' then
      execute 'lock table public.service_supplies, public.services, public.prescriber_profile'
           || ' in access exclusive mode';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Report (both modes; in execute mode, counted under the locks)
  -- -------------------------------------------------------------------------
  foreach v_tbl in array v_wipe || v_extra loop
    execute format('select count(*) from public.%I', v_tbl) into v_count;
    v_total := v_total + v_count;
    v_report := v_report || format(E'\n  %-24s %s', v_tbl, v_count);
  end loop;
  -- The scope is part of the phrase: a phrase from a 'test_data' dry run
  -- never matches an 'everything' run, even when the extra tables are empty.
  v_phrase := case v_scope
                when 'everything' then format('BORRAR TODO %s FILAS', v_total)
                else format('BORRAR %s FILAS', v_total)
              end;

  if v_mode = 'execute' and v_confirm <> v_phrase then
    raise exception 'RESET ABORTED: app.confirm_reset must be exactly "%" (the count right now). Got "%". If the number changed, data was added since the dry run; if the words differ, the scope differs from the dry run. Run the dry run again and check why. Nothing was changed.',
      v_phrase, v_confirm;
  end if;

  select count(*), string_agg(o.name, E'\n    ' order by o.name)
    into v_n_files, v_files
  from (select name from storage.objects where bucket_id = 'clinical_records' order by name limit 200) o;
  select count(*) into v_n_files from storage.objects where bucket_id = 'clinical_records';

  select count(*),
         string_agg(format('%s  phone=%s  email=%s  created=%s',
                           u.id, coalesce(u.phone, '-'), coalesce(u.email, '-'),
                           to_char(u.created_at, 'YYYY-MM-DD')), E'\n    ' order by u.created_at)
    into v_n_users, v_users
  from auth.users u
  left join public.profiles p on p.id = u.id
  where coalesce(p.role, 'patient') not in ('doctor', 'admin');

  select count(*) into v_n_sigs from storage.objects where bucket_id = 'prescriber_private';
  select count(*), coalesce(bool_or(signature_path is not null), false)
    into v_n_prescriber, v_has_sig
  from public.prescriber_profile;
  select coalesce(bool_or(schedule is not null), false) into v_has_sched from public.clinic_settings;
  select count(*) into v_n_stock from public.inventory where stock_quantity is distinct from 0;

  -- -------------------------------------------------------------------------
  -- 3. Delete (execute only)
  -- -------------------------------------------------------------------------
  if v_mode = 'execute' then
    -- Fingerprints of what must stay untouched.
    foreach v_tbl in array v_untouched loop
      execute format(
        'select md5(coalesce(string_agg(to_jsonb(t)::text, '','' order by to_jsonb(t)::text), '''')) from public.%I t',
        v_tbl) into v_bad;
      v_before := v_before || jsonb_build_object(v_tbl, v_bad);
    end loop;
    if v_scope = 'test_data' then
      select md5(coalesce(string_agg((to_jsonb(t) - 'stock_quantity' - 'last_restock_date')::text, ','
                                     order by (to_jsonb(t) - 'stock_quantity' - 'last_restock_date')::text), ''))
        into v_bad from public.inventory t;
      v_before := v_before || jsonb_build_object('inventory', v_bad);
      select md5(coalesce(string_agg((to_jsonb(t) - 'doctor_only_mode')::text, ','
                                     order by (to_jsonb(t) - 'doctor_only_mode')::text), ''))
        into v_bad from public.clinic_settings t;
      v_before := v_before || jsonb_build_object('clinic_settings', v_bad);
    else
      -- Everything but the mode and the schedule.
      select md5(coalesce(string_agg((to_jsonb(t) - 'doctor_only_mode' - 'schedule')::text, ','
                                     order by (to_jsonb(t) - 'doctor_only_mode' - 'schedule')::text), ''))
        into v_bad from public.clinic_settings t;
      v_before := v_before || jsonb_build_object('clinic_settings', v_bad);
      -- Everything but the signature and updated_at (prescriber_profile_guard
      -- sets updated_at = now() on every update; it keeps updated_by when
      -- there is no JWT, as in the SQL editor).
      select md5(coalesce(string_agg((to_jsonb(t) - 'signature_path' - 'updated_at')::text, ','
                                     order by (to_jsonb(t) - 'signature_path' - 'updated_at')::text), ''))
        into v_bad from public.prescriber_profile t;
      v_before := v_before || jsonb_build_object('prescriber_profile', v_bad);
      select count(*) into v_count from public.prescriber_profile;
      v_before := v_before || jsonb_build_object('prescriber_profile_rows', v_count);
    end if;
    select count(*) into v_count from storage.objects where bucket_id = 'prescriber_private';
    v_before := v_before || jsonb_build_object('prescriber_private_objects', v_count);

    -- Every non-internal trigger on public tables and whether it is enabled.
    select coalesce(jsonb_object_agg(c.relname || '.' || t.tgname, t.tgenabled <> 'D'), '{}'::jsonb)
      into v_triggers
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal;

    -- Disable ONLY the eight protections (all checked enabled above).
    foreach v_guard in array v_guards loop
      execute format('alter table public.%I disable trigger %I',
                     split_part(v_guard, '.', 1), split_part(v_guard, '.', 2));
      v_disabled := v_disabled || v_guard;
    end loop;

    -- v_extra (scope 'everything') goes after v_wipe: the stock movements,
    -- appointments and payments that reference the catalog are gone by then.
    foreach v_tbl in array v_wipe || v_extra loop
      -- "where true": pg-safeupdate (if loaded) refuses a DELETE without WHERE.
      execute format('delete from public.%I where true', v_tbl);
    end loop;

    -- Scope 'everything' emptied inventory, so this touches no row there.
    update public.inventory
       set stock_quantity = 0,
           last_restock_date = null
     where stock_quantity is distinct from 0 or last_restock_date is not null;

    -- The portal stays closed until the manual checklist is done.
    update public.clinic_settings set doctor_only_mode = true where not doctor_only_mode;

    if v_scope = 'everything' then
      -- NULL = no saved hours: settingsService and get_clinic_schedule() /
      -- assert_patient_booking_window() fall back to DEFAULT_SCHEDULE.
      update public.clinic_settings set schedule = null where schedule is not null;
      -- The check constraint allows NULL; prescriber_profile_guard only
      -- stamps updated_at (it refuses nothing). The PNGs stay in Storage
      -- until they are deleted by hand (checklist).
      update public.prescriber_profile set signature_path = null where signature_path is not null;
    end if;

    -- ALTER SEQUENCE / ALTER TABLE are transactional (a failure below undoes them).
    execute 'alter sequence public.prescription_folio_seq restart';

    -- The audit rows written by the deletes and updates above (including the
    -- catalog, clinic_settings and prescriber_profile ones), then its numbering.
    delete from public.audit_log where true;
    execute 'alter table public.audit_log alter column id restart';

    foreach v_guard in array v_disabled loop
      execute format('alter table public.%I enable trigger %I',
                     split_part(v_guard, '.', 1), split_part(v_guard, '.', 2));
    end loop;

    -- -----------------------------------------------------------------------
    -- 4. Verify; any mismatch raises and rolls EVERYTHING back
    -- -----------------------------------------------------------------------
    foreach v_tbl in array v_wipe || v_extra loop
      execute format('select count(*) from public.%I', v_tbl) into v_count;
      if v_count <> 0 then
        raise exception 'RESET FAILED: public.% still has % row(s). Everything was rolled back.', v_tbl, v_count;
      end if;
    end loop;

    foreach v_tbl in array v_untouched loop
      execute format(
        'select md5(coalesce(string_agg(to_jsonb(t)::text, '','' order by to_jsonb(t)::text), '''')) from public.%I t',
        v_tbl) into v_bad;
      v_after := v_after || jsonb_build_object(v_tbl, v_bad);
    end loop;
    if v_scope = 'test_data' then
      select md5(coalesce(string_agg((to_jsonb(t) - 'stock_quantity' - 'last_restock_date')::text, ','
                                     order by (to_jsonb(t) - 'stock_quantity' - 'last_restock_date')::text), ''))
        into v_bad from public.inventory t;
      v_after := v_after || jsonb_build_object('inventory', v_bad);
      select md5(coalesce(string_agg((to_jsonb(t) - 'doctor_only_mode')::text, ','
                                     order by (to_jsonb(t) - 'doctor_only_mode')::text), ''))
        into v_bad from public.clinic_settings t;
      v_after := v_after || jsonb_build_object('clinic_settings', v_bad);
    else
      select md5(coalesce(string_agg((to_jsonb(t) - 'doctor_only_mode' - 'schedule')::text, ','
                                     order by (to_jsonb(t) - 'doctor_only_mode' - 'schedule')::text), ''))
        into v_bad from public.clinic_settings t;
      v_after := v_after || jsonb_build_object('clinic_settings', v_bad);
      select md5(coalesce(string_agg((to_jsonb(t) - 'signature_path' - 'updated_at')::text, ','
                                     order by (to_jsonb(t) - 'signature_path' - 'updated_at')::text), ''))
        into v_bad from public.prescriber_profile t;
      v_after := v_after || jsonb_build_object('prescriber_profile', v_bad);
      select count(*) into v_count from public.prescriber_profile;
      v_after := v_after || jsonb_build_object('prescriber_profile_rows', v_count);
    end if;
    select count(*) into v_count from storage.objects where bucket_id = 'prescriber_private';
    v_after := v_after || jsonb_build_object('prescriber_private_objects', v_count);

    if v_after is distinct from v_before then
      raise exception 'RESET FAILED: a table that must stay untouched changed (before %, after %). Everything was rolled back.',
        v_before, v_after;
    end if;

    if v_scope = 'everything' then
      if (select count(*) from public.clinic_settings) <> 1
         or exists (select 1 from public.clinic_settings where schedule is not null)
         or public.get_clinic_schedule() <> '{}'::jsonb then
        raise exception 'RESET FAILED: clinic_settings must keep exactly one row with schedule NULL. Everything was rolled back.';
      end if;
      if exists (select 1 from public.prescriber_profile where signature_path is not null) then
        raise exception 'RESET FAILED: prescriber_profile.signature_path is not NULL. Everything was rolled back.';
      end if;
    end if;

    if exists (select 1 from public.inventory where stock_quantity <> 0 or last_restock_date is not null) then
      raise exception 'RESET FAILED: some inventory item still has stock. Everything was rolled back.';
    end if;

    if exists (select 1 from public.clinic_settings where doctor_only_mode is not true)
       or not public.get_clinic_mode() then
      raise exception 'RESET FAILED: doctor-only mode is not on. Everything was rolled back.';
    end if;

    select last_value, is_called into v_seq from public.prescription_folio_seq;
    if v_seq.is_called or v_seq.last_value <> 1 then
      raise exception 'RESET FAILED: the folio sequence was not reset to 1 (last_value %, is_called %). Everything was rolled back.',
        v_seq.last_value, v_seq.is_called;
    end if;

    execute format('select last_value, is_called from %s', v_audit_seq) into v_seq;
    if v_seq.is_called or v_seq.last_value <> 1 then
      raise exception 'RESET FAILED: the audit_log id was not reset to 1 (last_value %, is_called %). Everything was rolled back.',
        v_seq.last_value, v_seq.is_called;
    end if;

    select string_agg(c.relname || '.' || t.tgname, ', ')
      into v_bad
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal
      and (v_triggers ->> (c.relname || '.' || t.tgname))::boolean is true
      and t.tgenabled = 'D';
    if v_bad is not null then
      raise exception 'RESET FAILED: triggers left disabled: %. Everything was rolled back.', v_bad;
    end if;

    if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and not t.tgisinternal) <> (select count(*) from jsonb_object_keys(v_triggers)) then
      raise exception 'RESET FAILED: the set of triggers changed during the reset. Everything was rolled back.';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 5. Output
  -- -------------------------------------------------------------------------
  v_checklist := E'\n\nBEFORE an execute (go/no-go):'
    || E'\n  [ ] The QA walkthrough (docs/qa-walkthrough.md) is finished. After the reset only'
    || E'\n      read-only smoke checks are allowed (log in, empty dashboards).'
    || E'\n  [ ] A backup exists and you wrote down its time: the public AND auth schemas'
    || E'\n      (pg_dump --schema=public --schema=auth, or the Supabase backup if the plan'
    || E'\n      has one: Database > Backups), plus a Storage download if the files matter.'
    || E'\n      No backup possible = do NOT execute.'
    || E'\n\nMANUAL CHECKLIST after an execute (SQL cannot do these safely):'
    || E'\n  [ ] Storage > clinical_records: delete EVERY folder (' || v_n_files || ' file(s) now). They are'
    || E'\n      the deleted patients'' studies and consents. Deleting storage.objects rows by SQL'
    || E'\n      is blocked by Supabase and would leave the files orphaned in the object store,'
    || E'\n      so use the dashboard (select all > Delete) or the Storage API.'
    || case v_scope
         when 'everything' then
              E'\n  [ ] Storage > prescriber_private: delete EVERY file (' || v_n_sigs || ' file(s) now). They are'
           || E'\n      the old signatures; signature_path is now NULL and nothing references them.'
           || E'\n      There is no delete policy on that bucket, so use the dashboard. Then the'
           || E'\n      doctor draws a new signature in the app: prescriptions cannot be issued'
           || E'\n      until she does.'
         else E'\n      Do NOT touch prescriber_private (the doctor''s signatures).'
       end
    || E'\n  [ ] Authentication > Users: delete the ' || v_n_users || ' test user(s) listed above (every'
    || E'\n      user that is not the doctor or the admin). Their profiles go with them.'
    || E'\n  [ ] Authentication > Sign In / Providers > Phone: remove every test phone number'
    || E'\n      with a fixed OTP.'
    || E'\n  [ ] Demote the development account if it is not the doctor (set its role to'
    || E'\n      ''patient'' or delete the user).'
    || E'\n  [ ] Expect new rows in audit_log after RESET DONE: deleting the test users and'
    || E'\n      demoting the dev account are audited too (ids and column names only).'
    || E'\n  [ ] Residual personal data outside these tables: check auth.audit_log_entries,'
    || E'\n      net._http_response (webhook responses), the Edge Function logs and the Twilio'
    || E'\n      message logs; purge them if they hold patient phones or names.'
    || E'\n  [ ] Rotate WEBHOOK_SECRET (Edge Functions > Secrets) AND recreate the'
    || E'\n      whatsapp_notifications trigger with the new value (runbook step 8).'
    || case v_scope
         when 'everything' then
              E'\n  [ ] The clinic is empty: the doctor saves her opening hours (until then the'
           || E'\n      app and the booking RPCs use the default hours), creates the services, the'
           || E'\n      inventory items with a "Compra" (real cost) or "Ajuste" for the real stock,'
           || E'\n      and the supplies per service. Her prescriber data was kept.'
         else
              E'\n  [ ] Inventory: stock is 0. Register the real count of each item: "Compra" with'
           || E'\n      its real cost (it counts as an expense this month) or "Ajuste" (no cost;'
           || E'\n      the supplies show "sin costo" in Ganancia por procedimiento until the'
           || E'\n      first purchase).'
       end
    || E'\n  [ ] Doctor-only mode is ON. Turn it OFF in the app ONLY after every item above'
    || E'\n      is done, and only if the clinic will take online bookings.';

  v_scope_notes := case v_scope
    when 'everything' then format(
      'clinic_settings.schedule to NULL (before: %s; the app falls back to its default hours), prescriber_profile.signature_path to NULL (%s; %s row(s), every other field kept), doctor-only mode to ON, prescription folio and audit_log id to 1. Storage prescriber_private: %s file(s) to delete by hand',
      case when v_has_sched then 'saved hours' else 'already NULL' end,
      case when v_has_sig then 'before: set' else 'already NULL' end,
      v_n_prescriber, v_n_sigs)
    else format(
      'inventory stock of %s item(s) to 0, doctor-only mode to ON, prescription folio and audit_log id to 1',
      v_n_stock)
  end;

  if v_mode = 'dry_run' then
    raise notice E'RESET DRY RUN (scope %): nothing was changed. All preconditions hold. Rows that WOULD be deleted (% in total):%\n\nTo execute, run a copy with:\n  set local app.confirm_reset = ''%'';\n  set local app.reset_deadline = ''%'';   -- or a later date, at most 7 days ahead\n  set local app.reset_scope = ''%'';\n  set local app.reset_mode = ''execute'';\n\nWould reset: %.\n\nStorage clinical_records: % file(s) (first 200):\n    %\n\nTest auth users (not doctor/admin): %\n    %\n%',
      v_scope, v_total, v_report,
      v_phrase, to_char(v_today, 'YYYY-MM-DD'), v_scope,
      v_scope_notes,
      v_n_files, coalesce(v_files, '(none)'),
      v_n_users, coalesce(v_users, '(none)'),
      v_checklist;
  else
    raise notice E'RESET DONE (scope %): deleted % row(s):%\n\nReset: %. Triggers disabled and re-enabled: %. Kept data verified unchanged.\n\nStorage clinical_records still holds % file(s) (first 200):\n    %\n\nTest auth users still to delete: %\n    %\n%',
      v_scope, v_total, v_report,
      v_scope_notes,
      array_to_string(v_disabled, ', '),
      v_n_files, coalesce(v_files, '(none)'),
      v_n_users, coalesce(v_users, '(none)'),
      v_checklist;
  end if;
end $$;

commit;
