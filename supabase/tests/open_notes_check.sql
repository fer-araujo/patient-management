-- =============================================================================
-- Open clinical notes check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 31 objects, that:
--   * "Finalizar Consulta" (finalize_consultation_with_payment) charges,
--     finalizes the PRESCRIPTION and stamps consultation_finalized_at, but
--     leaves the clinical note OPEN, even with an empty diagnosis and plan;
--     a consultation finalized without a note gets an empty open note; a
--     refused charge stamps nothing;
--   * after "Finalizar Consulta" no new note or prescription can be added
--     (also when the consultation had no prescription);
--   * the open note is still editable by the doctor (draft save);
--   * close_clinical_note() refuses an empty diagnosis or plan, closes a
--     complete note (finalized_at and finalized_by stamped), refuses a second
--     close, and the closed note is frozen (content and recorded_late);
--   * a direct UPDATE of finalized_at (RLS) cannot close a note with an
--     empty plan either;
--   * a note of a finalized consultation cannot be moved to another
--     appointment or patient;
--   * "Finalizar Consulta" with a supplies list works for a consultation whose
--     prescription was finalized first and that has no note (an empty open
--     note is created);
--   * recorded_late is true when the note is closed more than 24 h after
--     "Finalizar Consulta" (moving the appointment's start_time does not
--     avoid it), false when closed within 24 h, true for a note written
--     through a past visit, and never client-settable;
--     consultation_finalized_at is never client-settable either;
--   * staff_record_past_visit_with_note() records the past visit, its charge
--     and an OPEN late note in one transaction; without note fields it writes
--     no note; a refused note (impossible vital sign) leaves no appointment
--     and no charge;
--   * an open note of a finalized consultation or of a past visit cannot be
--     deleted; a draft of a consultation never finalized still can;
--   * addenda still need a closed note, and work on one;
--   * supplies follow the finalized CONSULTATION: "Registrar insumos" works
--     on a finalized consultation whose note is open, is refused for a past
--     visit, and get_procedure_profit() counts the open-note consultation as
--     unrecorded until then (and never the past visit);
--   * every note update is audited with column names only;
--   * the admin cannot call close_clinical_note() or
--     staff_record_past_visit_with_note(); grants are as reviewed.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users,
--     patient, service, item, appointments, notes, prescriptions, payments,
--     movements and audit rows are never committed, pass or fail.
--   * The whatsapp_notifications trigger is disabled INSIDE the transaction
--     (DDL is transactional in Postgres), so no WhatsApp can ever be sent. The
--     appointments_prevent_overlap trigger is disabled the same way, so the
--     fixture appointments (in the past) cannot fail on real data;
--     staff_booking_check.sql and past_visits_check.sql cover that trigger.
--     The ROLLBACK re-enables both. To simulate a consultation finalized 3
--     days ago, the integrity trigger is disabled for ONE owner UPDATE inside
--     the transaction and re-enabled right after.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * The past visit is recorded about 2000 days ago (before the clinic used
--     the system); the script aborts if that hour is busy.
--
-- Expected output: a single notice that starts with "OPEN NOTES CHECK PASSED".
-- Any "OPEN NOTES CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Migration 31 applied; no outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.close_clinical_note(uuid)') is null
     or to_regprocedure('public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)') is null
     or not exists (
       select 1 from pg_attribute
       where attrelid = 'public.clinical_notes'::regclass
         and attname = 'consultation_finalized_at' and not attisdropped
     ) then
    raise exception 'OPEN NOTES CHECK ABORTED: migration 31 is not applied. Nothing was changed.';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass and tgname = 'whatsapp_notifications'
  ) then
    execute 'alter table public.appointments disable trigger whatsapp_notifications';
  end if;

  if exists (
    select 1 from pg_trigger
    where tgrelid = 'public.appointments'::regclass and tgname = 'appointments_prevent_overlap'
  ) then
    execute 'alter table public.appointments disable trigger appointments_prevent_overlap';
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
        'public.services'::regclass, 'public.payments'::regclass,
        'public.inventory'::regclass, 'public.inventory_movements'::regclass,
        'public.service_supplies'::regclass, 'public.clinical_notes'::regclass,
        'public.clinical_note_addenda'::regclass, 'public.prescriptions'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'OPEN NOTES CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
-- Appointments: A (3 days ago, finalized with an empty diagnosis, closed
-- late), B (1 hour ago, finalized with no note at all, closed in time),
-- C (draft of a consultation never finalized), F (refused charge),
-- G (prescription finalized first, no note, finalized with supplies).
-- The past visits are recorded by the doctor in step 2.
do $$
declare
  v_user_d  uuid := gen_random_uuid();
  v_user_a  uuid := gen_random_uuid();
  v_patient uuid;
  v_svc     uuid;
  v_item    uuid;
  v_appt    uuid;
  v_past    timestamptz := date_trunc('hour', now() - interval '2000 days');
begin
  if exists (
    select 1 from public.appointments a
    where a.status not in ('cancelled', 'rejected')
      and a.start_time < v_past + interval '4 hours'
      and a.start_time > v_past - interval '4 hours'
  ) or exists (
    select 1 from public.blocked_slots b
    where b.start_time < v_past + interval '4 hours'
      and b.end_time > v_past - interval '4 hours'
  ) then
    raise exception 'OPEN NOTES CHECK ABORTED: the past-visit hour (%) is busy. Nothing was changed.', v_past;
  end if;

  insert into auth.users (id, instance_id, aud, role, phone, email,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'open-notes-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'open-notes-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status)
  values ('OPEN-NOTES-CHECK', 'Patient', null, 'active')
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('OPEN-NOTES-CHECK service', 30, 900, true)
  returning id into v_svc;

  -- One configured supply, so the service can be flagged "Sin insumos".
  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
  values ('OPEN-NOTES-CHECK item', 'Otro', 0, 1, 'piezas', true)
  returning id into v_item;
  insert into public.service_supplies (service_id, item_id, quantity)
  values (v_svc, v_item, 1);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '3 days', 'confirmed')
  returning id into v_appt;
  perform set_config('open_check.appt_a', v_appt::text, true);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '1 hour', 'confirmed')
  returning id into v_appt;
  perform set_config('open_check.appt_b', v_appt::text, true);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '2 hours', 'confirmed')
  returning id into v_appt;
  perform set_config('open_check.appt_c', v_appt::text, true);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '4 hours', 'confirmed')
  returning id into v_appt;
  perform set_config('open_check.appt_f', v_appt::text, true);

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient, v_svc, now() - interval '5 hours', 'confirmed')
  returning id into v_appt;
  perform set_config('open_check.appt_g', v_appt::text, true);

  perform set_config('open_check.user_d', v_user_d::text, true);
  perform set_config('open_check.user_a', v_user_a::text, true);
  perform set_config('open_check.patient', v_patient::text, true);
  perform set_config('open_check.service', v_svc::text, true);
  perform set_config('open_check.past', v_past::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('open_check.user_d'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_user_d   uuid := current_setting('open_check.user_d')::uuid;
  v_patient  uuid := current_setting('open_check.patient')::uuid;
  v_svc      uuid := current_setting('open_check.service')::uuid;
  v_appt_a   uuid := current_setting('open_check.appt_a')::uuid;
  v_appt_b   uuid := current_setting('open_check.appt_b')::uuid;
  v_appt_c   uuid := current_setting('open_check.appt_c')::uuid;
  v_appt_f   uuid := current_setting('open_check.appt_f')::uuid;
  v_appt_g   uuid := current_setting('open_check.appt_g')::uuid;
  v_past     timestamptz := current_setting('open_check.past')::timestamptz;
  v_note_a   uuid;
  v_note_b   uuid;
  v_note_c   uuid;
  v_note_p   uuid;
  v_visit    uuid;
  v_plain    uuid;
  v_row      public.payments;
  v_note     public.clinical_notes;
  v_message  text;
  v_state    text;
  v_count    integer;
  v_profit   record;
begin
  if not public.is_staff() then
    raise exception 'OPEN NOTES CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. Finalize A with an empty diagnosis and plan and a prescription.
  insert into public.clinical_notes (appointment_id, patient_id, subjective, analysis, plan)
  values (v_appt_a, v_patient, 'OPEN-CHECK S', '', '   ')
  returning id into v_note_a;
  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt_a, v_patient,
          '[{"nombre": "Ibuprofeno", "dosis": "400 mg", "indicaciones": "Cada 8 h", "via": "Oral", "frecuencia": "Cada 8 horas"}]'::jsonb);

  v_row := public.finalize_consultation_with_payment(v_appt_a, 'paid', 900, 'cash', null);
  if v_row.amount_charged <> 900 or v_row.appointment_id is distinct from v_appt_a then
    raise exception 'OPEN NOTES CHECK FAILED: finalizing A stored the charge as % for %.', v_row.amount_charged, v_row.appointment_id;
  end if;

  select * into v_note from public.clinical_notes where id = v_note_a;
  if v_note.finalized_at is not null or v_note.consultation_finalized_at is null or v_note.recorded_late then
    raise exception 'OPEN NOTES CHECK FAILED: after "Finalizar Consulta" the note must stay open with consultation_finalized_at set (got: %).', row_to_json(v_note);
  end if;
  if not exists (select 1 from public.prescriptions where appointment_id = v_appt_a and finalized_at is not null) then
    raise exception 'OPEN NOTES CHECK FAILED: "Finalizar Consulta" did not finalize the prescription.';
  end if;

  -- 2b. Finalize B with no note at all: an empty open note is created.
  perform public.finalize_consultation_with_payment(v_appt_b, 'courtesy');
  select count(*), min(id::text)::uuid into v_count, v_note_b
  from public.clinical_notes
  where appointment_id = v_appt_b
    and finalized_at is null
    and consultation_finalized_at is not null
    and author_id = v_user_d
    and coalesce(analysis, '') = '';
  if v_count <> 1 then
    raise exception 'OPEN NOTES CHECK FAILED: finalizing without a note did not create one empty open note (% rows).', v_count;
  end if;

  -- 2c. A refused charge stamps nothing.
  insert into public.clinical_notes (appointment_id, patient_id, analysis, plan)
  values (v_appt_f, v_patient, 'Dx', 'Plan');
  v_message := null;
  begin
    perform public.finalize_consultation_with_payment(v_appt_f, 'paid', 0, 'cash', null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Indica cuánto cobraste (más de 0).'
     or exists (select 1 from public.clinical_notes where appointment_id = v_appt_f and consultation_finalized_at is not null)
     or exists (select 1 from public.payments where appointment_id = v_appt_f) then
    raise exception 'OPEN NOTES CHECK FAILED: a refused charge still stamped the consultation or stored a payment (got: %).', v_message;
  end if;

  -- 2d. No new rows after "Finalizar Consulta" (B has no prescription).
  foreach v_state in array array['note', 'prescription'] loop
    v_message := null;
    begin
      if v_state = 'note' then
        insert into public.clinical_notes (appointment_id, patient_id, analysis) values (v_appt_b, v_patient, 'X');
      else
        insert into public.prescriptions (appointment_id, patient_id, medications) values (v_appt_b, v_patient, '[]'::jsonb);
      end if;
    exception when others then v_message := sqlstate;
    end;
    if v_message is distinct from 'P0001' then
      raise exception 'OPEN NOTES CHECK FAILED: a new % was accepted after "Finalizar Consulta" (%).', v_state, coalesce(v_message, 'no error');
    end if;
  end loop;

  -- 2e. Markers are not client-settable.
  v_state := null;
  begin
    update public.clinical_notes set consultation_finalized_at = null where id = v_note_a;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'OPEN NOTES CHECK FAILED: consultation_finalized_at could be cleared (%).', v_state;
  end if;

  v_state := null;
  begin
    update public.clinical_notes set recorded_late = true where id = v_note_b;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'OPEN NOTES CHECK FAILED: recorded_late could be set by hand (%).', v_state;
  end if;

  insert into public.clinical_notes (appointment_id, patient_id, analysis, recorded_late, consultation_finalized_at)
  values (v_appt_c, v_patient, 'Draft', true, now())
  returning id into v_note_c;
  if (select recorded_late or consultation_finalized_at is not null from public.clinical_notes where id = v_note_c) then
    raise exception 'OPEN NOTES CHECK FAILED: an insert set recorded_late or consultation_finalized_at.';
  end if;

  -- 2f. The open note of A is still editable (draft save), and audited.
  update public.clinical_notes
     set objective = 'OPEN-CHECK O', prognosis = 'Favorable',
         vital_signs = '{"bp_sys": 120, "bp_dia": 80}'::jsonb
   where id = v_note_a;
  if (select objective from public.clinical_notes where id = v_note_a) is distinct from 'OPEN-CHECK O' then
    raise exception 'OPEN NOTES CHECK FAILED: the open note of a finalized consultation could not be edited.';
  end if;

  -- 2g. Closing needs a diagnosis and a plan.
  v_message := null;
  begin
    perform public.close_clinical_note(v_note_a);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Para cerrar la nota, escribe el diagnóstico y el plan.'
     or (select finalized_at from public.clinical_notes where id = v_note_a) is not null then
    raise exception 'OPEN NOTES CHECK FAILED: a note without diagnosis or plan was closed (got: %).', v_message;
  end if;

  update public.clinical_notes set analysis = 'Melasma' where id = v_note_a;
  v_message := null;
  begin
    perform public.close_clinical_note(v_note_a);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Para cerrar la nota, escribe el diagnóstico y el plan.' then
    raise exception 'OPEN NOTES CHECK FAILED: a note with a blank plan was closed (got: %).', v_message;
  end if;

  -- 2g1. A direct close through RLS with an empty plan is refused too.
  update public.clinical_notes set analysis = 'Melasma', plan = '  ' where id = v_note_a;
  v_message := null;
  begin
    update public.clinical_notes set finalized_at = now() where id = v_note_a;
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Para cerrar la nota, escribe el diagnóstico y el plan.'
     or (select finalized_at from public.clinical_notes where id = v_note_a) is not null then
    raise exception 'OPEN NOTES CHECK FAILED: a direct UPDATE closed a note with an empty plan (got: %).', v_message;
  end if;

  -- 2g2. A note of a finalized consultation is never moved.
  foreach v_state in array array['appointment', 'patient'] loop
    v_message := null;
    begin
      if v_state = 'appointment' then
        update public.clinical_notes set appointment_id = v_appt_c where id = v_note_b;
      else
        update public.clinical_notes set patient_id = gen_random_uuid() where id = v_note_b;
      end if;
    exception when others then v_message := sqlstate;
    end;
    if v_message is distinct from '42501' then
      raise exception 'OPEN NOTES CHECK FAILED: a finalized consultation''s note was moved to another % (%).', v_state, coalesce(v_message, 'no error');
    end if;
  end loop;

  -- 2g3. Prescription finalized first, no note: "Finalizar Consulta" with
  --      a supplies list still works (an empty open note is created).
  insert into public.prescriptions (appointment_id, patient_id, medications)
  values (v_appt_g, v_patient, '[]'::jsonb);
  update public.prescriptions set finalized_at = now() where appointment_id = v_appt_g;
  perform public.finalize_consultation_with_payment(v_appt_g, 'courtesy', null, null, null, '[]'::jsonb);
  if not exists (
    select 1 from public.clinical_notes
    where appointment_id = v_appt_g
      and finalized_at is null
      and consultation_finalized_at is not null
      and supplies_recorded_at is not null
  ) then
    raise exception 'OPEN NOTES CHECK FAILED: finalizing with supplies after the prescription did not create the open note.';
  end if;

  perform set_config('open_check.note_a', v_note_a::text, true);
  perform set_config('open_check.note_b', v_note_b::text, true);
  perform set_config('open_check.note_c', v_note_c::text, true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 2'. Owner: A's consultation was finalized 3 days ago
-- -----------------------------------------------------------------------------
-- consultation_finalized_at can only be now() through the trigger, so the
-- integrity trigger is disabled for this single UPDATE and re-enabled.
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'alter table public.clinical_notes disable trigger clinical_notes_enforce_integrity';
  update public.clinical_notes
     set consultation_finalized_at = now() - interval '3 days'
   where id = current_setting('open_check.note_a')::uuid;
  execute 'alter table public.clinical_notes enable trigger clinical_notes_enforce_integrity';
end $$;

-- -----------------------------------------------------------------------------
-- 2''. Doctor session again
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('open_check.user_d'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_user_d   uuid := current_setting('open_check.user_d')::uuid;
  v_patient  uuid := current_setting('open_check.patient')::uuid;
  v_svc      uuid := current_setting('open_check.service')::uuid;
  v_appt_a   uuid := current_setting('open_check.appt_a')::uuid;
  v_appt_b   uuid := current_setting('open_check.appt_b')::uuid;
  v_appt_c   uuid := current_setting('open_check.appt_c')::uuid;
  v_appt_f   uuid := current_setting('open_check.appt_f')::uuid;
  v_past     timestamptz := current_setting('open_check.past')::timestamptz;
  v_note_a   uuid := current_setting('open_check.note_a')::uuid;
  v_note_b   uuid := current_setting('open_check.note_b')::uuid;
  v_note_c   uuid := current_setting('open_check.note_c')::uuid;
  v_note_p   uuid;
  v_visit    uuid;
  v_plain    uuid;
  v_note     public.clinical_notes;
  v_message  text;
  v_state    text;
  v_profit   record;
begin
  -- 2h. A complete note closes. Moving the appointment's start to now does
  --     not avoid the late-entry flag: it is measured from "Finalizar
  --     Consulta" (3 days ago), a stamp the doctor cannot move.
  update public.appointments set start_time = now() where id = v_appt_a;
  update public.clinical_notes set plan = 'Protector solar' where id = v_note_a;
  v_note := public.close_clinical_note(v_note_a);
  if v_note.finalized_at is null or v_note.finalized_by is distinct from v_user_d or not v_note.recorded_late then
    raise exception 'OPEN NOTES CHECK FAILED: closing A did not stamp finalized_at/finalized_by, or moving start_time avoided recorded_late (got: %).', row_to_json(v_note);
  end if;

  v_message := null;
  begin
    perform public.close_clinical_note(v_note_a);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Esta nota ya está cerrada. Para corregirla, agrega una corrección.' then
    raise exception 'OPEN NOTES CHECK FAILED: a closed note was closed again (got: %).', v_message;
  end if;

  -- 2i. The closed note is frozen, recorded_late included.
  foreach v_state in array array['analysis', 'vital_signs', 'delete'] loop
    v_message := null;
    begin
      if v_state = 'analysis' then
        update public.clinical_notes set analysis = 'Cambio' where id = v_note_a;
      elsif v_state = 'vital_signs' then
        update public.clinical_notes set vital_signs = null where id = v_note_a;
      else
        delete from public.clinical_notes where id = v_note_a;
      end if;
    exception when others then v_message := sqlstate;
    end;
    if v_message is distinct from 'P0001' then
      raise exception 'OPEN NOTES CHECK FAILED: the closed note accepted a % (%).', v_state, coalesce(v_message, 'no error');
    end if;
  end loop;

  v_state := null;
  begin
    update public.clinical_notes set recorded_late = false where id = v_note_a;
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'OPEN NOTES CHECK FAILED: recorded_late of a closed note could be changed (%).', v_state;
  end if;

  -- 2j. Addenda: on the closed note yes, on an open note no.
  insert into public.clinical_note_addenda (note_id, body) values (v_note_a, 'OPEN-CHECK addendum');

  v_message := null;
  begin
    insert into public.clinical_note_addenda (note_id, body) values (v_note_b, 'OPEN-CHECK addendum');
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Solo se pueden agregar adendas a notas de consultas finalizadas.' then
    raise exception 'OPEN NOTES CHECK FAILED: an addendum was accepted on an open note (got: %).', v_message;
  end if;

  -- 2k. B closed within 24 h of "Finalizar Consulta" is not a late entry.
  update public.clinical_notes set analysis = 'Sano', plan = 'Alta' where id = v_note_b;
  v_note := public.close_clinical_note(v_note_b);
  if v_note.recorded_late then
    raise exception 'OPEN NOTES CHECK FAILED: a note closed within 24 h was marked as a late entry.';
  end if;

  -- 2l. Deleting: the draft of a consultation never finalized can go; the
  --     open note of a finalized consultation cannot (checked on F's twin
  --     below, after the past visit).
  delete from public.clinical_notes where id = v_note_c;
  if exists (select 1 from public.clinical_notes where id = v_note_c) then
    raise exception 'OPEN NOTES CHECK FAILED: a draft of a consultation never finalized could not be deleted.';
  end if;

  -- 2m. A past visit with a note: open, late, linked, in one transaction.
  v_visit := public.staff_record_past_visit_with_note(
    v_patient, v_svc, v_past, 'paid', 700, 'card', null,
    'Dolor', 'Sin lesiones', '', null, 'Revisión', '{"spo2": 97}'::jsonb);

  if not exists (select 1 from public.appointments where id = v_visit and status = 'completed' and start_time = v_past)
     or not exists (select 1 from public.payments where appointment_id = v_visit and received_at = v_past) then
    raise exception 'OPEN NOTES CHECK FAILED: the past visit or its charge is wrong.';
  end if;

  select * into v_note from public.clinical_notes where appointment_id = v_visit;
  v_note_p := v_note.id;
  if v_note_p is null
     or v_note.finalized_at is not null
     or not v_note.recorded_late
     or v_note.consultation_finalized_at is not null
     or v_note.subjective is distinct from 'Dolor'
     or v_note.analysis is not null
     or v_note.plan is distinct from 'Revisión'
     or v_note.vital_signs is distinct from '{"spo2": 97}'::jsonb
     or v_note.author_id is distinct from v_user_d then
    raise exception 'OPEN NOTES CHECK FAILED: the past-visit note is not an open late note with the typed fields (got: %).', row_to_json(v_note);
  end if;

  -- Without note fields it is exactly staff_record_past_visit(): no note.
  v_plain := public.staff_record_past_visit_with_note(
    v_patient, v_svc, v_past + interval '1 hour', 'courtesy', null, null, null,
    '  ', null, null, null, null, '{}'::jsonb);
  if exists (select 1 from public.clinical_notes where appointment_id = v_plain) then
    raise exception 'OPEN NOTES CHECK FAILED: a past visit without note fields wrote a note.';
  end if;

  -- A refused note leaves no appointment and no charge.
  v_message := null;
  begin
    perform public.staff_record_past_visit_with_note(
      v_patient, v_svc, v_past + interval '2 hours', 'paid', 500, 'cash', null,
      'S', null, null, null, null, '{"bp_sys": "120"}'::jsonb);
  exception when others then v_message := sqlstate;
  end;
  if v_message is distinct from '23514'
     or exists (select 1 from public.appointments where patient_id = v_patient and start_time = v_past + interval '2 hours') then
    raise exception 'OPEN NOTES CHECK FAILED: a refused past-visit note left an appointment behind (%).', coalesce(v_message, 'no error');
  end if;

  -- The open past-visit note cannot be deleted; neither can A's twin open note
  -- of a finalized consultation (F finalized now, note left open).
  perform public.finalize_consultation_with_payment(v_appt_f, 'paid', 100, 'cash', null);
  foreach v_state in array array[v_note_p::text,
                                 (select id::text from public.clinical_notes where appointment_id = v_appt_f)] loop
    v_message := null;
    begin
      delete from public.clinical_notes where id = v_state::uuid;
    exception when others then v_message := sqlerrm;
    end;
    if v_message is distinct from 'Esta nota clínica es parte del expediente y no se puede eliminar.' then
      raise exception 'OPEN NOTES CHECK FAILED: an open note of the record was deleted (got: %).', v_message;
    end if;
  end loop;

  -- 2n. Supplies follow the finalized consultation, never a past visit.
  select * into v_profit
  from public.get_procedure_profit(now() - interval '1 minute', now() + interval '1 minute') r
  where r.service_id = v_svc;
  -- A, B, F and G were charged now; only G recorded its supplies.
  if v_profit is null or v_profit.times <> 4 or v_profit.unrecorded_consultations <> 3 then
    raise exception 'OPEN NOTES CHECK FAILED: get_procedure_profit() does not count the finalized consultations as unrecorded (got: %).', row_to_json(v_profit);
  end if;

  select * into v_profit
  from public.get_procedure_profit(v_past - interval '1 minute', v_past + interval '3 hours') r
  where r.service_id = v_svc;
  if v_profit is null or v_profit.times <> 2 or v_profit.unrecorded_consultations <> 0 then
    raise exception 'OPEN NOTES CHECK FAILED: past visits were counted as consultations without supplies (got: %).', row_to_json(v_profit);
  end if;

  -- "Registrar insumos" on F (finalized, note open) works.
  perform public.record_consultation_supplies(v_appt_f, '[]'::jsonb);
  if not exists (select 1 from public.clinical_notes where appointment_id = v_appt_f and supplies_recorded_at is not null and finalized_at is null) then
    raise exception 'OPEN NOTES CHECK FAILED: "Registrar insumos" did not mark the finalized consultation with an open note.';
  end if;

  v_message := null;
  begin
    perform public.record_consultation_supplies(v_visit, '[]'::jsonb);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'Solo se pueden registrar insumos de una consulta finalizada.' then
    raise exception 'OPEN NOTES CHECK FAILED: "Registrar insumos" accepted a past visit (got: %).', v_message;
  end if;

  -- 2o. The past-visit note is completed and closed later from the record.
  update public.clinical_notes set analysis = 'Lumbalgia' where id = v_note_p;
  v_note := public.close_clinical_note(v_note_p);
  if v_note.finalized_at is null or not v_note.recorded_late then
    raise exception 'OPEN NOTES CHECK FAILED: the past-visit note did not close as a late entry.';
  end if;

  perform set_config('open_check.note_a', v_note_a::text, true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. Admin: not the doctor, refused
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('open_check.user_a'), 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_patient uuid := current_setting('open_check.patient')::uuid;
  v_svc     uuid := current_setting('open_check.service')::uuid;
  v_past    timestamptz := current_setting('open_check.past')::timestamptz;
  v_note_a  uuid := current_setting('open_check.note_a')::uuid;
  v_state   text;
begin
  v_state := null;
  begin
    perform public.close_clinical_note(v_note_a);
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'OPEN NOTES CHECK FAILED: the admin could call close_clinical_note() (%).', v_state;
  end if;

  v_state := null;
  begin
    perform public.staff_record_past_visit_with_note(
      v_patient, v_svc, v_past + interval '3 hours', 'courtesy', null, null, null,
      'S', null, null, null, null, null);
    v_state := 'no error';
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'OPEN NOTES CHECK FAILED: the admin could record a past visit with a note (%).', v_state;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Owner: audit trail and grants
-- -----------------------------------------------------------------------------
do $$
declare
  v_note_a uuid := current_setting('open_check.note_a')::uuid;
  v_bad    text;
begin
  perform set_config('request.jwt.claims', '', true);

  -- Every note update is audited with column NAMES only.
  if not exists (
    select 1 from public.audit_log
    where table_name = 'clinical_notes' and row_id = v_note_a and action = 'UPDATE'
      and changed_columns @> array['objective', 'prognosis', 'vital_signs']
  ) or not exists (
    select 1 from public.audit_log
    where table_name = 'clinical_notes' and row_id = v_note_a and action = 'UPDATE'
      and changed_columns @> array['finalized_at', 'recorded_late']
  ) then
    raise exception 'OPEN NOTES CHECK FAILED: the edit or the close of the open note was not audited.';
  end if;

  select string_agg(c, ', ') into v_bad
  from public.audit_log l
  cross join lateral unnest(l.changed_columns) c
  where l.table_name = 'clinical_notes' and l.row_id = v_note_a
    and not exists (
      select 1 from pg_attribute
      where attrelid = 'public.clinical_notes'::regclass and attname = c and not attisdropped
    );
  if v_bad is not null then
    raise exception 'OPEN NOTES CHECK FAILED: the audit trail of a note holds something other than column names: %.', v_bad;
  end if;

  if has_function_privilege('anon', 'public.close_clinical_note(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.close_clinical_note(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.close_clinical_note(uuid)', 'execute')
     or has_function_privilege('anon', 'public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.finalize_consultation(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.consultation_is_finalized(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.clinical_notes_enforce_integrity()', 'execute') then
    raise exception 'OPEN NOTES CHECK FAILED: a migration 31 function has the wrong grants.';
  end if;

  raise notice 'OPEN NOTES CHECK PASSED: "Finalizar Consulta" charges, finalizes the prescription and stamps the consultation while the note stays open (an empty one is created when missing, also after a prescription finalized first; a refused charge stamps nothing); a direct close without a plan is refused and the note of a finalized consultation cannot be moved; no new note or prescription after it; the open note stays editable and audited; close_clinical_note() needs a diagnosis and a plan, closes once and freezes the note; recorded_late is true 24 h after "Finalizar Consulta" even if the appointment start moves, and for past visits, false within 24 h, and neither marker is client-settable; a past visit records its charge and an open late note in one transaction (none without fields, nothing left behind when refused); open notes of the record cannot be deleted while a never-finalized draft can; addenda need a closed note; supplies follow the finalized consultation and never a past visit; the admin cannot close notes or record past visits; grants are as reviewed. All test data was rolled back.';
end $$;

rollback;
