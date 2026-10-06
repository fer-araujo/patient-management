-- =============================================================================
-- Staff booking check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 19 objects, that:
--   * a doctor's direct INSERT into public.appointments that overlaps an
--     active appointment is rejected, even though RLS allows the write;
--   * a direct UPDATE that moves an appointment onto a taken slot is rejected;
--   * re-activating a cancelled appointment whose slot was taken is rejected;
--   * status-only changes (confirm, complete, cancel) and back-to-back
--     bookings still work;
--   * staff_create_appointment() refuses an overlapping slot and
--     staff_reschedule_appointment() refuses a cancelled appointment.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users, patient,
--     service, appointments and audit rows are never committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so the test appointments can never
--     send a WhatsApp message. The ROLLBACK re-enables it automatically.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call, or if a real appointment or
--     blocked slot sits near the far-future test window.
--   * ALTER TABLE ... DISABLE TRIGGER holds a lock on public.appointments until
--     the ROLLBACK. The script takes well under a second; run it off-hours.
--
-- Expected output: a single notice that starts with "STAFF BOOKING CHECK PASSED".
-- Any "STAFF BOOKING CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Doctor-only mode (migration 23) closes the patient RPCs and keeps staff
-- reschedules confirmed. This check proves the normal (mode off) rules, so the
-- mode is turned off INSIDE this transaction; the ROLLBACK restores it.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinic_settings'
      and column_name = 'doctor_only_mode'
  ) then
    execute 'update public.clinic_settings set doctor_only_mode = false where doctor_only_mode';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'whatsapp_notifications'
  ) then
    execute 'alter table public.appointments disable trigger whatsapp_notifications';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass
      and tgname = 'appointments_prevent_overlap'
      and tgenabled <> 'D'
  ) then
    raise exception 'STAFF BOOKING CHECK ABORTED: migration 19 is not applied (appointments_prevent_overlap is missing or disabled).';
  end if;

  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgrelid in (
        'public.appointments'::regclass, 'public.patients'::regclass,
        'public.services'::regclass, 'public.profiles'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'STAFF BOOKING CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- A 30-minute service and two appointments ~8 years ahead: A at T, B at T+2h.
do $$
declare
  v_phone    text := '+529990000401';
  v_user_s   uuid := gen_random_uuid();
  v_patient  uuid;
  v_svc      uuid;
  v_start    timestamptz := date_trunc('hour', now()) + interval '3000 days';
  v_appt_a   uuid;
  v_appt_b   uuid;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'STAFF BOOKING CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.start_time between v_start - interval '1 day' and v_start + interval '1 day'
  ) or exists (
    select 1 from public.blocked_slots b
    where b.start_time < v_start + interval '1 day' and b.end_time > v_start - interval '1 day'
  ) then
    raise exception 'STAFF BOOKING CHECK ABORTED: real data sits near the test window %. Nothing was changed.', v_start;
  end if;

  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user_s, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          null, 'staff-booking-check-' || v_user_s || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_s;

  insert into public.patients (first_name, last_name, phone, status)
  values ('STAFF-BOOKING-CHECK', 'Patient', v_phone, 'active')
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('STAFF-BOOKING-CHECK service', 30, 500, false)
  returning id into v_svc;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, v_start, 'pending')
  returning id into v_appt_a;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, v_start + interval '2 hours', 'confirmed')
  returning id into v_appt_b;

  perform set_config('staff_booking_check.user_s', v_user_s::text, true);
  perform set_config('staff_booking_check.patient', v_patient::text, true);
  perform set_config('staff_booking_check.service', v_svc::text, true);
  perform set_config('staff_booking_check.start', v_start::text, true);
  perform set_config('staff_booking_check.appt_a', v_appt_a::text, true);
  perform set_config('staff_booking_check.appt_b', v_appt_b::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Staff session (authenticated doctor, direct table writes allowed by RLS)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('staff_booking_check.user_s'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient  uuid        := current_setting('staff_booking_check.patient')::uuid;
  v_svc      uuid        := current_setting('staff_booking_check.service')::uuid;
  v_start    timestamptz := current_setting('staff_booking_check.start')::timestamptz;
  v_appt_a   uuid        := current_setting('staff_booking_check.appt_a')::uuid;
  v_appt_b   uuid        := current_setting('staff_booking_check.appt_b')::uuid;
  v_appt_c   uuid;
  v_refused  boolean;
begin
  if not public.is_staff() then
    raise exception 'STAFF BOOKING CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. A direct INSERT overlapping A (T+15min) is rejected.
  v_refused := false;
  begin
    insert into public.appointments (patient_id, service_id, start_time, status)
    values (v_patient, v_svc, v_start + interval '15 minutes', 'confirmed');
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'STAFF BOOKING CHECK FAILED: a direct overlapping INSERT was accepted.';
  end if;

  -- 2b. A direct UPDATE moving B onto A's slot is rejected.
  v_refused := false;
  begin
    update public.appointments set start_time = v_start + interval '10 minutes' where id = v_appt_b;
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'STAFF BOOKING CHECK FAILED: a direct UPDATE moved an appointment onto a taken slot.';
  end if;

  -- 2c. staff_create_appointment() refuses the same overlap.
  v_refused := false;
  begin
    perform public.staff_create_appointment(v_patient, v_svc, v_start + interval '20 minutes');
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'STAFF BOOKING CHECK FAILED: staff_create_appointment() accepted an overlapping slot.';
  end if;

  -- 2d. Back-to-back is not an overlap: a direct INSERT at T+30min succeeds.
  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, v_start + interval '30 minutes', 'confirmed')
  returning id into v_appt_c;

  -- 2e. Status-only changes are not re-checked.
  update public.appointments set status = 'confirmed' where id = v_appt_a;
  update public.appointments set status = 'completed' where id = v_appt_c;

  -- 2f. Cancelling A frees its slot; a new booking takes it; re-activating A
  --     is then rejected.
  update public.appointments set status = 'cancelled' where id = v_appt_a;

  perform public.staff_create_appointment(v_patient, v_svc, v_start);

  v_refused := false;
  begin
    update public.appointments set status = 'confirmed' where id = v_appt_a;
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'STAFF BOOKING CHECK FAILED: a cancelled appointment was re-activated onto a taken slot.';
  end if;

  -- 2g. staff_reschedule_appointment() refuses a cancelled appointment.
  v_refused := false;
  begin
    perform public.staff_reschedule_appointment(v_appt_a, v_start + interval '5 hours');
  exception when others then v_refused := sqlstate = 'P0001';
  end;
  if not v_refused then
    raise exception 'STAFF BOOKING CHECK FAILED: staff_reschedule_appointment() moved a cancelled appointment.';
  end if;

  -- 2h. A valid staff reschedule still works and sets the status to pending.
  perform public.staff_reschedule_appointment(v_appt_b, v_start + interval '6 hours');
  if not exists (
    select 1 from public.appointments
    where id = v_appt_b and status = 'pending' and start_time = v_start + interval '6 hours'
  ) then
    raise exception 'STAFF BOOKING CHECK FAILED: a valid staff reschedule did not move the appointment.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'STAFF BOOKING CHECK PASSED: direct and RPC staff writes cannot overlap an active appointment, status-only changes still work, and a cancelled appointment cannot be rescheduled or re-activated onto a taken slot. All test data was rolled back.';
end $$;

rollback;
