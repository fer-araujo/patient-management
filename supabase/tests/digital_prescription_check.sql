-- =============================================================================
-- Digital prescription check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 25 objects, that:
--   * the doctor creates and corrects her prescription data (single row,
--     upsert on singleton), the server owns updated_by, and invalid values
--     (cédula with letters, a specialty cédula without a specialty, a
--     signature path that is not signature-<id>.png) are refused; nobody can
--     delete the row;
--   * the doctor creates versioned signature objects 'signature-<id>.png' in
--     the private bucket prescriber_private (verified as owner: the check
--     ABORTS if the object was not really created, so the refusals below can
--     never pass vacuously); every other name is refused with
--     insufficient_privilege; she can neither overwrite nor delete a saved
--     version;
--   * issue_prescription() stores, on first issue of a FINALIZED
--     prescription, the printed prescriber data, the signature version,
--     issued_at and a sequential, unique folio; a second call returns the same
--     snapshot, also after the doctor edits her data and her signature; a
--     draft and an unknown prescription are refused;
--   * nobody writes the snapshot columns directly (insert, update, or an
--     update of an issued row even with the internal flag set);
--   * log_prescription_shared() records an EXPORT audit event with the
--     channel, folio and issue time only, for ISSUED prescriptions only;
--   * the admin, the patient and anon read no prescription data and no
--     signature, and cannot write either, issue or log;
--   * every change to the prescription data and every issue is audited.
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway users,
--     patient, service, appointments, prescriptions, prescription data,
--     storage rows and audit rows are never committed, pass or fail. An
--     existing real prescription data row is removed only inside the
--     transaction and comes back with the ROLLBACK.
--   * Folio numbers come from a sequence, which a ROLLBACK does not rewind:
--     each run uses up 2 folio numbers, so real folios may skip them. Folios
--     stay unique and increasing.
--   * The whatsapp_notifications and appointments_prevent_overlap triggers
--     are disabled INSIDE the transaction, so the test appointments can never
--     send a WhatsApp message or collide with real data.
--   * The script refuses to run if any other enabled trigger on the touched
--     tables looks like an outbound HTTP call.
--   * The storage rows are written with SQL, so no file is uploaded; the
--     bucket's PNG / 256 KB limits are enforced by the Storage API and are
--     checked by the migration gate instead.
--
-- Expected output: a single notice that starts with "DIGITAL PRESCRIPTION CHECK PASSED".
-- Any "DIGITAL PRESCRIPTION CHECK FAILED: ..." error names the exact rule that broke.
-- "DIGITAL PRESCRIPTION CHECK ABORTED: ..." means the check could not set up
-- its test data; nothing was proven and nothing was changed.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects, migration 25 applied
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.prescriber_profile') is null
     or to_regprocedure('public.log_prescription_shared(uuid,text)') is null
     or to_regprocedure('public.issue_prescription(uuid)') is null
     or to_regclass('public.prescription_folio_seq') is null
     or not exists (select 1 from storage.buckets where id = 'prescriber_private') then
    raise exception 'DIGITAL PRESCRIPTION CHECK ABORTED: migration 25 is not applied.';
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
        'public.services'::regclass, 'public.prescriptions'::regclass,
        'public.prescriber_profile'::regclass, 'public.profiles'::regclass,
        'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'DIGITAL PRESCRIPTION CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_phone     text := '+529990000801';
  v_user_d    uuid := gen_random_uuid();
  v_user_a    uuid := gen_random_uuid();
  v_user_p    uuid := gen_random_uuid();
  v_tag       text := replace(gen_random_uuid()::text, '-', '');
  v_patient   uuid;
  v_svc       uuid;
  v_appt      uuid;
  v_rx        uuid;
  i           integer;
begin
  if exists (
    select 1 from public.patients where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) or exists (
    select 1 from auth.users where public.normalize_phone(phone) = public.normalize_phone(v_phone)
  ) then
    raise exception 'DIGITAL PRESCRIPTION CHECK ABORTED: the throwaway test phone % already exists. Nothing was changed.', v_phone;
  end if;

  -- on_auth_user_created provisions a 'patient' profile for each user.
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_user_d, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'rx-check-doctor-' || v_user_d || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     null, 'rx-check-admin-' || v_user_a || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_p, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     public.normalize_phone(v_phone), null, '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user_d;
  update public.profiles set role = 'admin'  where id = v_user_a;

  insert into public.patients (first_name, last_name, phone, status, gender)
  values ('RX-CHECK', 'Patient', v_phone, 'active', 'Femenino')
  returning id into v_patient;

  insert into public.services (name, duration_mins, price, is_active)
  values ('RX-CHECK service', 30, 500, false)
  returning id into v_svc;

  -- Three finalized prescriptions (one appointment each) and one draft.
  for i in 1..4 loop
    insert into public.appointments (patient_id, service_id, start_time, status)
    values (v_patient, v_svc, now() - make_interval(hours => 2 * i), 'confirmed')
    returning id into v_appt;

    insert into public.prescriptions (appointment_id, patient_id, medications)
    values (v_appt, v_patient, jsonb_build_array(jsonb_build_object(
      'nombre', 'Ibuprofeno', 'presentacion', 'Tabletas 400 mg', 'dosis', '1 tableta',
      'via', 'Oral', 'frecuencia', 'Cada 8 h', 'duracion', '5 días', 'indicaciones', 'Con alimentos')))
    returning id into v_rx;

    if i < 4 then
      update public.prescriptions set finalized_at = now() where id = v_rx;
      perform set_config('rx_check.rx_final' || i, v_rx::text, true);
    else
      perform set_config('rx_check.rx_draft', v_rx::text, true);
    end if;
  end loop;

  -- Start from no prescription data: the doctor's first save is an insert.
  delete from public.prescriber_profile where id is not null;

  perform set_config('rx_check.user_d', v_user_d::text, true);
  perform set_config('rx_check.user_a', v_user_a::text, true);
  perform set_config('rx_check.user_p', v_user_p::text, true);
  perform set_config('rx_check.claim_phone', public.normalize_phone(v_phone), true);
  perform set_config('rx_check.patient', v_patient::text, true);
  perform set_config('rx_check.sig1', 'signature-rxcheck' || v_tag || '-1.png', true);
  perform set_config('rx_check.sig2', 'signature-rxcheck' || v_tag || '-2.png', true);
  perform set_config('rx_check.upload_error', '', true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Doctor session (a): prescription data and two signature versions
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rx_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_user_d uuid := current_setting('rx_check.user_d')::uuid;
  v_sig1   text := current_setting('rx_check.sig1');
  v_sig2   text := current_setting('rx_check.sig2');
  v_row    public.prescriber_profile;
  v_count  integer;
  v_state  text;
  c        text;
begin
  if not public.is_staff() then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- The two signature uploads, as the Storage API would insert them. A
  -- failure is recorded and checked as owner right after this block.
  foreach c in array array[v_sig1, v_sig2] loop
    begin
      insert into storage.objects (bucket_id, name, owner, metadata)
      values ('prescriber_private', c, v_user_d, '{"mimetype": "image/png"}'::jsonb);
    exception when others then
      perform set_config('rx_check.upload_error', sqlstate || ': ' || sqlerrm, true);
    end;
  end loop;

  -- First save (insert) and a correction, both as the app's upsert.
  insert into public.prescriber_profile (
    full_name, cedula_profesional, institucion_titulo, consultorio_domicilio, telefono, updated_by
  )
  values ('Dra. RX-CHECK', '1234567', 'Universidad RX-CHECK', 'Calle RX-CHECK 1, Monterrey', '81 1234 5678', gen_random_uuid())
  on conflict (singleton) do update
    set full_name = excluded.full_name
  returning * into v_row;

  if v_row.updated_by is distinct from v_user_d then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: updated_by is %, expected the doctor (a client-sent value must be ignored).', v_row.updated_by;
  end if;

  insert into public.prescriber_profile (especialidad, cedula_especialidad, signature_path)
  values ('Dermatología', '7654321', v_sig1)
  on conflict (singleton) do update
    set especialidad        = excluded.especialidad,
        cedula_especialidad = excluded.cedula_especialidad,
        signature_path      = excluded.signature_path
  returning * into v_row;

  if v_row.full_name is distinct from 'Dra. RX-CHECK'
     or v_row.cedula_especialidad is distinct from '7654321'
     or v_row.signature_path is distinct from v_sig1 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the correction did not merge into the single row.';
  end if;

  select count(*) into v_count from public.prescriber_profile;
  if v_count <> 1 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the doctor sees % prescription data rows, expected 1.', v_count;
  end if;

  perform set_config('rx_check.profile', v_row.id::text, true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 2'. Owner: the signature versions really exist (otherwise nothing below
--     about storage would prove anything)
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(n, ', ') into v_missing
  from unnest(array[current_setting('rx_check.sig1'), current_setting('rx_check.sig2')]) n
  where not exists (
    select 1 from storage.objects o where o.bucket_id = 'prescriber_private' and o.name = n
  );
  if v_missing is not null then
    raise exception 'DIGITAL PRESCRIPTION CHECK ABORTED: the doctor''s signature upload was not stored (%; error: %). The storage checks would prove nothing.',
      v_missing, nullif(current_setting('rx_check.upload_error'), '');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Doctor session (b): refusals, issue snapshot, folio, logging
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rx_check.user_d'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_user_d   uuid := current_setting('rx_check.user_d')::uuid;
  v_profile  uuid := current_setting('rx_check.profile')::uuid;
  v_sig1     text := current_setting('rx_check.sig1');
  v_sig2     text := current_setting('rx_check.sig2');
  v_rx1      uuid := current_setting('rx_check.rx_final1')::uuid;
  v_rx2      uuid := current_setting('rx_check.rx_final2')::uuid;
  v_rx3      uuid := current_setting('rx_check.rx_final3')::uuid;
  v_draft    uuid := current_setting('rx_check.rx_draft')::uuid;
  v_snap1    jsonb;
  v_again    jsonb;
  v_snap2    jsonb;
  v_count    integer;
  v_rows     integer;
  v_state    text;
  c          text;
begin
  -- 3a. Invalid values and a second row are refused; nobody may delete.
  foreach c in array array['cedula', 'telefono', 'signature traversal', 'signature old name', 'cedula especialidad sin especialidad'] loop
    v_state := null;
    begin
      if c = 'cedula' then
        update public.prescriber_profile set cedula_profesional = 'ABC1234' where id = v_profile;
      elsif c = 'telefono' then
        update public.prescriber_profile set telefono = '<script>' where id = v_profile;
      elsif c = 'signature traversal' then
        update public.prescriber_profile set signature_path = '../clinical_records/x.png' where id = v_profile;
      elsif c = 'signature old name' then
        update public.prescriber_profile set signature_path = 'signature.png' where id = v_profile;
      else
        update public.prescriber_profile set especialidad = null where id = v_profile;
      end if;
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: an invalid value (%) was accepted.', c;
    end if;
  end loop;

  v_state := null;
  begin
    insert into public.prescriber_profile (singleton, full_name) values (false, 'Second');
  exception when check_violation or unique_violation then v_state := sqlstate;
  end;
  select count(*) into v_count from public.prescriber_profile;
  if v_count <> 1 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: a second prescription data row was created.';
  end if;

  v_state := null;
  begin
    delete from public.prescriber_profile where id = v_profile;
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the doctor deleted the prescription data row.';
  end if;

  -- 3b. Signature objects: only signature-<id>.png, never replaced or removed.
  foreach c in array array[
    'signature.png', 'other.png', 'nested/signature-a.png', '../signature-a.png',
    'signature-a.jpg', 'signature-a b.png', 'signature-.png'
  ] loop
    v_state := null;
    begin
      insert into storage.objects (bucket_id, name, owner, metadata)
      values ('prescriber_private', c, v_user_d, '{"mimetype": "image/png"}'::jsonb);
    exception when insufficient_privilege then v_state := '42501';
    end;
    if v_state is distinct from '42501' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the doctor wrote the object "%" in prescriber_private.', c;
    end if;
  end loop;

  select count(*) into v_count
  from storage.objects where bucket_id = 'prescriber_private' and name in (v_sig1, v_sig2);
  if v_count <> 2 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the doctor reads % of her 2 signature versions.', v_count;
  end if;

  v_rows := 0;
  begin
    update storage.objects set name = 'signature-renamed.png'
    where bucket_id = 'prescriber_private' and name = v_sig1;
    get diagnostics v_rows = row_count;
  exception when insufficient_privilege then v_rows := 0;
  end;
  if v_rows <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the doctor changed a saved signature version.';
  end if;

  v_rows := 0;
  begin
    delete from storage.objects where bucket_id = 'prescriber_private' and name = v_sig1;
    get diagnostics v_rows = row_count;
  exception when insufficient_privilege then v_rows := 0;
  end;
  if v_rows <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the doctor deleted a saved signature version.';
  end if;

  -- 3c. First issue stores the snapshot; a second call returns it unchanged.
  v_snap1 := public.issue_prescription(v_rx1);
  if (v_snap1 ->> 'folio') is null
     or v_snap1 ->> 'issued_at' is null
     or v_snap1 ->> 'signature_path' is distinct from v_sig1
     or v_snap1 -> 'prescriber' ->> 'full_name' is distinct from 'Dra. RX-CHECK'
     or v_snap1 -> 'prescriber' ->> 'cedula_profesional' is distinct from '1234567'
     or v_snap1 -> 'prescriber' ->> 'consultorio_domicilio' is distinct from 'Calle RX-CHECK 1, Monterrey' then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the first issue did not store the expected snapshot (%).', v_snap1;
  end if;

  v_again := public.issue_prescription(v_rx1);
  if v_again is distinct from v_snap1 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: a second issue changed the snapshot.';
  end if;

  -- 3d. She edits her data and draws a new signature: the issued
  --     prescription keeps the original; the next one uses the new data.
  update public.prescriber_profile
     set full_name = 'Dra. RX-CHECK Editada', signature_path = v_sig2
   where id = v_profile;

  v_again := public.issue_prescription(v_rx1);
  if v_again is distinct from v_snap1 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: editing the prescriber data changed an issued prescription (%).', v_again;
  end if;

  v_snap2 := public.issue_prescription(v_rx2);
  if v_snap2 -> 'prescriber' ->> 'full_name' is distinct from 'Dra. RX-CHECK Editada'
     or v_snap2 ->> 'signature_path' is distinct from v_sig2 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: a new issue did not use the current data and signature.';
  end if;

  -- 3e. Folios: sequential and distinct.
  if (v_snap2 ->> 'folio')::bigint <= (v_snap1 ->> 'folio')::bigint then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: folio % was issued after folio %.',
      v_snap2 ->> 'folio', v_snap1 ->> 'folio';
  end if;

  -- 3f. Drafts and unknown prescriptions are refused.
  foreach c in array array['draft', 'unknown prescription'] loop
    v_state := null;
    begin
      if c = 'draft' then
        perform public.issue_prescription(v_draft);
      else
        perform public.issue_prescription(gen_random_uuid());
      end if;
    exception when raise_exception then v_state := 'P0001';
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: issue_prescription() accepted a %.', c;
    end if;
  end loop;

  -- 3g. Nobody writes the snapshot columns directly.
  foreach c in array array['edit issued snapshot', 'edit issued folio', 'issue by hand', 'issue a draft', 'insert issued', 'flag on issued row'] loop
    v_state := null;
    begin
      if c = 'edit issued snapshot' then
        update public.prescriptions
           set prescriber_snapshot = jsonb_build_object('full_name', 'Otra persona')
         where id = v_rx1;
      elsif c = 'edit issued folio' then
        update public.prescriptions set folio = folio + 100000 where id = v_rx2;
      elsif c = 'issue by hand' then
        update public.prescriptions
           set prescriber_snapshot = '{}'::jsonb, signature_path = v_sig1,
               issued_at = now(), folio = 999999999
         where id = v_rx3;
      elsif c = 'issue a draft' then
        update public.prescriptions set issued_at = now() where id = v_draft;
      elsif c = 'insert issued' then
        insert into public.prescriptions (medications, folio) values ('[]'::jsonb, 999999998);
      else
        -- Even with the RPC's internal flag, an issued row is write-once.
        perform set_config('app.issuing_prescription', v_rx1::text, true);
        update public.prescriptions set signature_path = v_sig2 where id = v_rx1;
      end if;
    exception when insufficient_privilege then v_state := '42501';
    end;
    perform set_config('app.issuing_prescription', '', true);
    if v_state is distinct from '42501' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: a direct write to the issue snapshot was accepted (%).', c;
    end if;
  end loop;

  -- 3h. Logging: issued prescriptions only, known channels only.
  perform public.log_prescription_shared(v_rx1, 'whatsapp_link');
  perform public.log_prescription_shared(v_rx1, 'share_sheet');
  perform public.log_prescription_shared(v_rx1, 'download');
  perform public.log_prescription_shared(v_rx1, 'print');

  foreach c in array array['draft', 'not issued', 'unknown prescription', 'unknown channel', 'null channel'] loop
    v_state := null;
    begin
      if c = 'draft' then
        perform public.log_prescription_shared(v_draft, 'print');
      elsif c = 'not issued' then
        perform public.log_prescription_shared(v_rx3, 'print');
      elsif c = 'unknown prescription' then
        perform public.log_prescription_shared(gen_random_uuid(), 'print');
      elsif c = 'unknown channel' then
        perform public.log_prescription_shared(v_rx1, 'email');
      else
        perform public.log_prescription_shared(v_rx1, null);
      end if;
    exception when raise_exception then v_state := 'P0001';
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: log_prescription_shared() accepted a %.', c;
    end if;
  end loop;

  perform set_config('rx_check.folio1', v_snap1 ->> 'folio', true);
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 4. Owner: versions kept, folio unique
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_rx3   uuid := current_setting('rx_check.rx_final3')::uuid;
  v_folio bigint := current_setting('rx_check.folio1')::bigint;
  v_count integer;
  v_state text;
begin
  select count(*) into v_count
  from storage.objects
  where bucket_id = 'prescriber_private'
    and name in (current_setting('rx_check.sig1'), current_setting('rx_check.sig2'));
  if v_count <> 2 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: a saved signature version disappeared (% of 2 left).', v_count;
  end if;

  -- Even through the RPC's own path, a folio cannot be used twice.
  v_state := null;
  begin
    perform set_config('app.issuing_prescription', v_rx3::text, true);
    update public.prescriptions
       set prescriber_snapshot = '{}'::jsonb, signature_path = current_setting('rx_check.sig1'),
           issued_at = now(), folio = v_folio
     where id = v_rx3;
  exception when unique_violation then v_state := '23505';
  end;
  perform set_config('app.issuing_prescription', '', true);
  if v_state is distinct from '23505' then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: folio % was accepted twice.', v_folio;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Admin session: no prescription data, no signature, no issuing, no logging
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rx_check.user_a'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_profile uuid := current_setting('rx_check.profile')::uuid;
  v_count   integer;
  v_rows    integer;
  v_state   text;
  c         text;
begin
  if public.is_staff() or not public.is_business_staff() then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the throwaway admin is not business-only staff.';
  end if;

  select count(*) into v_count from public.prescriber_profile;
  if v_count <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the admin reads the prescription data.';
  end if;

  update public.prescriber_profile set full_name = 'Admin' where id = v_profile;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the admin changed the prescription data.';
  end if;

  v_state := null;
  begin
    insert into public.prescriber_profile (full_name) values ('Admin');
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the admin wrote prescription data.';
  end if;

  select count(*) into v_count from storage.objects where bucket_id = 'prescriber_private';
  if v_count <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the admin sees % object(s) in prescriber_private.', v_count;
  end if;

  v_state := null;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('prescriber_private', 'signature-admin.png', '{"mimetype": "image/png"}'::jsonb);
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the admin wrote a signature object.';
  end if;

  foreach c in array array['issue', 'log'] loop
    v_state := null;
    begin
      if c = 'issue' then
        perform public.issue_prescription(current_setting('rx_check.rx_final3')::uuid);
      else
        perform public.log_prescription_shared(current_setting('rx_check.rx_final1')::uuid, 'print');
      end if;
    exception when insufficient_privilege then v_state := '42501';
    end;
    if v_state is distinct from '42501' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the admin could % a prescription.', c;
    end if;
  end loop;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 6. Patient session: no prescription data, no signature, no issuing, no logging
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('rx_check.user_p'),
    'phone', current_setting('rx_check.claim_phone'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_count integer;
  v_state text;
  c       text;
begin
  select count(*) into v_count from public.prescriber_profile;
  if v_count <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the patient reads the prescription data.';
  end if;

  select count(*) into v_count from storage.objects where bucket_id = 'prescriber_private';
  if v_count <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the patient sees the signature.';
  end if;

  v_state := null;
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('prescriber_private', 'signature-patient.png', '{"mimetype": "image/png"}'::jsonb);
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the patient wrote a signature object.';
  end if;

  foreach c in array array['issue', 'log'] loop
    v_state := null;
    begin
      if c = 'issue' then
        perform public.issue_prescription(current_setting('rx_check.rx_final3')::uuid);
      else
        perform public.log_prescription_shared(current_setting('rx_check.rx_final1')::uuid, 'print');
      end if;
    exception when insufficient_privilege then v_state := '42501';
    end;
    if v_state is distinct from '42501' then
      raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the patient could % a prescription.', c;
    end if;
  end loop;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 7. anon: nothing
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
end $$;
set local role anon;

do $$
declare
  v_count integer;
begin
  begin
    select count(*) into v_count from public.prescriber_profile;
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: anon reads the prescription data.';
  end if;

  begin
    select count(*) into v_count from storage.objects where bucket_id = 'prescriber_private';
  exception when insufficient_privilege then v_count := 0;
  end;
  if v_count <> 0 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: anon sees the signature.';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 8. Audit (owner, no request context)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

do $$
declare
  v_user_d  uuid := current_setting('rx_check.user_d')::uuid;
  v_patient uuid := current_setting('rx_check.patient')::uuid;
  v_rx1     uuid := current_setting('rx_check.rx_final1')::uuid;
  v_folio   text := lpad(current_setting('rx_check.folio1'), greatest(6, length(current_setting('rx_check.folio1'))), '0');
  v_count   integer;
begin
  select count(*) into v_count
  from public.audit_log
  where action = 'EXPORT' and table_name = 'prescriptions'
    and actor_id = v_user_d and row_id = v_rx1 and patient_id = v_patient;
  if v_count <> 4 then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: % prescription EXPORT event(s), expected 4.', v_count;
  end if;

  if exists (
    select 1 from public.audit_log
    where action = 'EXPORT' and table_name = 'prescriptions' and row_id = v_rx1
      and (array_length(changed_columns, 1) <> 3
           or changed_columns[1] not in ('share_sheet', 'whatsapp_link', 'download', 'print')
           or changed_columns[2] <> 'folio:' || v_folio
           or changed_columns[3] !~ '^issued_at:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$')
  ) then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: a prescription EXPORT event logged more than channel, folio and issue time.';
  end if;

  if not exists (
    select 1 from public.audit_log
    where action = 'UPDATE' and table_name = 'prescriptions' and row_id = v_rx1
      and actor_id = v_user_d and 'folio' = any (changed_columns)
  ) then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: issuing the prescription was not audited.';
  end if;

  if not exists (
    select 1 from public.audit_log
    where table_name = 'prescriber_profile' and action = 'INSERT' and actor_id = v_user_d
  ) or not exists (
    select 1 from public.audit_log
    where table_name = 'prescriber_profile' and action = 'UPDATE' and actor_id = v_user_d
      and 'signature_path' = any (changed_columns)
  ) then
    raise exception 'DIGITAL PRESCRIPTION CHECK FAILED: the prescription data changes were not audited.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'DIGITAL PRESCRIPTION CHECK PASSED: the doctor keeps one value-checked, audited prescription data row she cannot delete; signatures are versioned signature-<id>.png objects she can create but never replace or delete, and every other name is refused; issue_prescription() stores a write-once snapshot (prescriber data, signature version, issued_at, unique sequential folio) that later edits do not change and nobody can write directly; log_prescription_shared() audits issued prescriptions with channel, folio and issue time only; the admin, the patient and anon read and write neither. All test data was rolled back (the sequence used up 2 folio numbers).';
end $$;

rollback;
