-- =============================================================================
-- Audit coverage check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 28 objects, that:
--   * every base table in public except audit_log carries the enabled AFTER
--     ROW audit_row_change trigger, and audit_log does not;
--   * a new account (profiles INSERT) and a role change made from the SQL
--     editor are logged with the actor "system", the changed column "role"
--     and no patient;
--   * the doctor's changes are logged with her as the actor and NO patient:
--     the doctor-only toggle (set_clinic_mode) and the schedule
--     (clinic_settings), a catalog service (insert, price change, archive), an
--     agenda block (insert, delete), an inventory item with its stock movements
--     (inventory, inventory_movements) and her own profile;
--   * a no-op update writes nothing;
--   * the log holds column NAMES only: every entry of this run names real
--     columns of its table and never one of the values written;
--   * the admin's catalog change is logged with the actor "admin", and the
--     admin still reads no audit entry;
--   * no API role (anon, authenticated, service_role) can execute
--     audit_row_change(), write_audit_event() or audit_actor_role().
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, service,
--     block, inventory item, movements, the clinic_settings changes and every
--     audit row are never committed, pass or fail. (audit_log ids used here
--     are skipped for good; identity values are never reused.)
--   * No appointment is created, so no WhatsApp webhook can fire. The script
--     refuses to run if an enabled trigger on a touched table looks like an
--     outbound HTTP call.
--   * The clinic_settings updates hold a row lock until the ROLLBACK. The
--     script takes well under a second; run it off-hours.
--
-- Entries of this run are found with occurred_at = now(): now() is the
-- transaction start time, and audit_log.occurred_at defaults to it.
--
-- Expected output: a single notice that starts with "AUDIT COVERAGE CHECK PASSED".
-- Any "AUDIT COVERAGE CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Migration 28 applied; no outbound side effects; catalog coverage
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass and tgname = 'audit_row_change' and not tgisinternal
  ) then
    raise exception 'AUDIT COVERAGE CHECK ABORTED: migration 28 is not applied. Nothing was changed.';
  end if;

  if (select count(*) from public.clinic_settings) <> 1 then
    raise exception 'AUDIT COVERAGE CHECK ABORTED: clinic_settings must have exactly one row (save the opening hours in the app first). Nothing was changed.';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgrelid in (
        'public.profiles'::regclass, 'public.clinic_settings'::regclass,
        'public.services'::regclass, 'public.blocked_slots'::regclass,
        'public.inventory'::regclass, 'public.inventory_movements'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'AUDIT COVERAGE CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;

  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and c.relname <> 'audit_log'
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and not t.tgisinternal
        and t.tgname = 'audit_row_change' and t.tgenabled <> 'D'
        and t.tgfoid = 'public.audit_row_change()'::regprocedure
        and (t.tgtype::integer & 1) = 1 and (t.tgtype::integer & 2) = 0
        -- consents and clinical_note_addenda are append-only: INSERT only.
        and (
          (c.relname in ('consents', 'clinical_note_addenda') and (t.tgtype::integer & 4) = 4)
          or (t.tgtype::integer & 28) = 28
        )
    );
  if v_bad is not null then
    raise exception 'AUDIT COVERAGE CHECK FAILED: tables without the audit trigger: %.', v_bad;
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.audit_log'::regclass and not tgisinternal
      and tgfoid = 'public.audit_row_change()'::regprocedure
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: audit_log audits itself.';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) as r(role)
    cross join unnest(array[
      'public.audit_row_change()',
      'public.write_audit_event(text,text,uuid,uuid,text[])',
      'public.audit_actor_role()'
    ]) as f(sig)
    where has_function_privilege(r.role, f.sig, 'execute')
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: an API role can execute an audit helper (entries could be forged).';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures and the SQL-editor actor (owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_user_d uuid := gen_random_uuid();
  v_user_a uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'audit-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'audit-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  -- handle_new_user() created both profiles: the INSERT is logged.
  if not exists (
    select 1 from public.audit_log
    where occurred_at = now() and table_name = 'profiles' and action = 'INSERT'
      and row_id = v_user_d and patient_id is null
      and actor_id is null and actor_role = 'system'
      and 'role' = any (changed_columns)
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: a new profile was not audited (INSERT, system actor, no patient).';
  end if;

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  if (select count(*) from public.audit_log
      where occurred_at = now() and table_name = 'profiles' and action = 'UPDATE'
        and row_id in (v_user_d, v_user_a) and patient_id is null
        and actor_id is null and actor_role = 'system'
        and 'role' = any (changed_columns)) <> 2 then
    raise exception 'AUDIT COVERAGE CHECK FAILED: a role change from the SQL editor was not audited.';
  end if;

  perform set_config('audit_check.user_d', v_user_d::text, true);
  perform set_config('audit_check.user_a', v_user_a::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor: settings, catalog, agenda block, inventory, own profile
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('audit_check.user_d'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_user_d   uuid := current_setting('audit_check.user_d')::uuid;
  v_settings uuid;
  v_mode     boolean := public.get_clinic_mode();
  v_svc      uuid;
  v_block    uuid;
  v_item     uuid;
  v_before   integer;
  v_after    integer;
begin
  select id into v_settings from public.clinic_settings limit 1;

  -- The doctor-only toggle, both ways (the rollback restores the real mode).
  perform public.set_clinic_mode(not v_mode);
  perform public.set_clinic_mode(v_mode);

  -- A schedule change (rolled back), then a no-op update that must not log.
  update public.clinic_settings
     set schedule = coalesce(schedule, '{}'::jsonb) || jsonb_build_object('audit_check', true)
   where id = v_settings;

  select count(*) into v_before from public.audit_log
  where occurred_at = now() and table_name = 'clinic_settings';
  update public.clinic_settings set schedule = schedule where id = v_settings;
  select count(*) into v_after from public.audit_log
  where occurred_at = now() and table_name = 'clinic_settings';
  if v_after <> v_before then
    raise exception 'AUDIT COVERAGE CHECK FAILED: a no-op update of clinic_settings was logged.';
  end if;

  -- Catalog: create, change the price, archive.
  insert into public.services (name, duration_mins, price, is_active)
  values ('AUDIT-CHECK service', 30, 700, true)
  returning id into v_svc;
  update public.services set price = 750 where id = v_svc;
  update public.services set is_active = false where id = v_svc;

  -- Agenda block far ahead: create, remove.
  insert into public.blocked_slots (start_time, end_time, reason)
  values (now() + interval '900 days', now() + interval '900 days 1 hour', 'personal')
  returning id into v_block;
  delete from public.blocked_slots where id = v_block;

  -- Inventory: an item with initial stock (a movement), then a purchase.
  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
  values ('AUDIT-CHECK item', 'Otro', 2, 0, 'piezas', true)
  returning id into v_item;
  perform public.adjust_stock(v_item, 3, 'purchase', 30, 'AUDIT-CHECK purchase');

  -- Her own display name.
  update public.profiles set first_name = 'AUDIT-CHECK' where id = v_user_d;

  -- What the doctor reads in the Bitácora for this run.
  if not exists (
    select 1 from public.audit_log
    where occurred_at = now() and table_name = 'clinic_settings' and action = 'UPDATE'
      and row_id = v_settings and actor_id = v_user_d and actor_role = 'doctor'
      and patient_id is null and 'doctor_only_mode' = any (changed_columns)
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the doctor-only toggle was not audited with the doctor as actor.';
  end if;

  if not exists (
    select 1 from public.audit_log
    where occurred_at = now() and table_name = 'clinic_settings' and action = 'UPDATE'
      and actor_id = v_user_d and patient_id is null and 'schedule' = any (changed_columns)
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: a schedule change was not audited.';
  end if;

  if not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'services'
                 and action = 'INSERT' and row_id = v_svc and actor_id = v_user_d and patient_id is null)
     or not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'services'
                    and action = 'UPDATE' and row_id = v_svc and 'price' = any (changed_columns))
     or not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'services'
                    and action = 'UPDATE' and row_id = v_svc and 'is_active' = any (changed_columns)) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the service insert, price change or archive was not audited.';
  end if;

  if not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'blocked_slots'
                 and action = 'INSERT' and row_id = v_block and actor_id = v_user_d and patient_id is null)
     or not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'blocked_slots'
                    and action = 'DELETE' and row_id = v_block and actor_id = v_user_d
                    and patient_id is null and changed_columns is null) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the agenda block insert or delete was not audited.';
  end if;

  if not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'inventory'
                 and action = 'INSERT' and row_id = v_item and actor_id = v_user_d)
     or not exists (select 1 from public.audit_log where occurred_at = now() and table_name = 'inventory'
                    and action = 'UPDATE' and row_id = v_item and actor_id = v_user_d
                    and 'stock_quantity' = any (changed_columns))
     or (select count(*) from public.audit_log
         where occurred_at = now() and table_name = 'inventory_movements' and action = 'INSERT'
           and actor_id = v_user_d and patient_id is null
           and row_id in (select m.id from public.inventory_movements m where m.item_id = v_item)) <> 2 then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the inventory item, its stock change or its 2 movements were not audited.';
  end if;

  if not exists (
    select 1 from public.audit_log
    where occurred_at = now() and table_name = 'profiles' and action = 'UPDATE'
      and row_id = v_user_d and actor_id = v_user_d and 'first_name' = any (changed_columns)
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the doctor''s own profile edit was not audited.';
  end if;

  if exists (
    select 1 from public.audit_log
    where occurred_at = now()
      and table_name in ('profiles', 'clinic_settings', 'services', 'blocked_slots', 'inventory', 'inventory_movements')
      and patient_id is not null
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: an entry of a table without patients carries a patient_id.';
  end if;

  perform set_config('audit_check.service', v_svc::text, true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin: a catalog change is audited; the admin reads no audit entry
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('audit_check.user_a'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
begin
  update public.services set price = 800 where id = current_setting('audit_check.service')::uuid;
  if not found then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the admin could not update the test service (setup).';
  end if;

  if exists (select 1 from public.audit_log) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the admin reads audit_log entries.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Owner: the admin's entry, and names-only for every entry of this run
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  perform set_config('request.jwt.claims', '', true);

  if not exists (
    select 1 from public.audit_log
    where occurred_at = now() and table_name = 'services' and action = 'UPDATE'
      and row_id = current_setting('audit_check.service')::uuid
      and actor_id = current_setting('audit_check.user_a')::uuid and actor_role = 'admin'
      and 'price' = any (changed_columns)
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: the admin''s price change was not audited with the admin as actor.';
  end if;

  -- Every logged name is a real column of its table, and no value leaked.
  select string_agg(distinct l.table_name || '.' || c.col, ', ')
    into v_bad
  from public.audit_log l
  cross join lateral unnest(l.changed_columns) as c(col)
  where l.occurred_at = now()
    and l.action in ('INSERT', 'UPDATE', 'DELETE')
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || l.table_name)
        and a.attname = c.col and a.attnum > 0 and not a.attisdropped
    );
  if v_bad is not null then
    raise exception 'AUDIT COVERAGE CHECK FAILED: audit entries hold something other than column names: %.', v_bad;
  end if;

  if exists (
    select 1 from public.audit_log l, unnest(l.changed_columns) as c(col)
    where l.occurred_at = now()
      and (c.col ilike '%AUDIT-CHECK%' or c.col in ('700', '750', '800', 'true', 'false'))
  ) then
    raise exception 'AUDIT COVERAGE CHECK FAILED: a written value appears in the audit log.';
  end if;

  raise notice 'AUDIT COVERAGE CHECK PASSED: every table in public except audit_log has the audit trigger; account creation and role changes, the doctor-only toggle and the schedule, catalog services, agenda blocks, inventory items and movements and profile edits are logged with the right actor (system, doctor, admin) and no patient; a no-op update logs nothing; only column names are stored; the admin reads no entry; no API role can execute the audit helpers. All test data was rolled back.';
end $$;

rollback;
