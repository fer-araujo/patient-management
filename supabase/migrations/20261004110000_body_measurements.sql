-- =============================================================================
-- 24 - Weight tracking: InBody body composition measurements
-- =============================================================================
-- Problem this file solves:
--   The doctor's InBody scale keeps only the last 10 people. She wants every
--   measurement of the patients she follows stored in the record, with
--   trends, so the scale is no longer the only copy.
--
-- Design:
--   * patients.weight_tracking (boolean, default false): the doctor marks the
--     patients she follows ("Llevar control de peso"). Written through the
--     existing patients_staff_all policy (is_staff(): the doctor only). The
--     patient has NO write path to public.patients (only patients_select_own)
--     and the admin has no access to patients at all; the gate proves it. The
--     generic audit_row_change() trigger on patients logs the column name.
--   * public.body_measurements: one row per measurement. weight_kg is
--     required; every other InBody value is optional. bmi is a STORED
--     generated column (weight / height^2) when the height is known, so it
--     can never disagree with the numbers it comes from. Range checks catch
--     typos (e.g. 700 for 70.0), not clinical judgement; masses can never
--     exceed the weight.
--   * Two separate optional classifications, because the InBody sheet prints
--     both and they are independent:
--       body_type - the "tipo de cuerpo" read on the BMI / body fat %
--                   coordinate chart (obesidad, sobrepeso, promedio, ...);
--       cid_type  - the C / I / D shape of the weight - muscle - fat bars.
--     One column with both lists would force the doctor to choose one of the
--     two readings and would make "both recorded" impossible.
--   * balance_upper_lower: the upper/lower body balance, closed list.
--   * Access: RLS policy body_measurements_staff_all, is_staff() only - the
--     doctor reads and writes; the admin (business staff) never sees clinical
--     data; the patient never reads the table directly (only through
--     export_my_data(), below); anon has no privilege at all.
--   * It is follow-up data, not a frozen consultation note (NOM-004 freezes
--     notes, not measurements), so the doctor may correct or delete a
--     measurement. Every insert, update and delete is written to the audit
--     log by the generic audit_row_change() trigger (column NAMES only).
--   * body_measurements_guard() (BEFORE trigger): refuses any write on an
--     anonymized record (same message the app shows for patient data), a
--     future date (clinic calendar), a measurement moved to another patient,
--     and an appointment of another patient. The server owns author_id
--     (auth.uid() on insert, unchanged on update), created_at and updated_at.
--   * export_my_data() is re-created from its migration 20 body (no later
--     file redefines it) with the patient's own measurements added. The
--     doctor's note on a measurement is NOT exported, like the SOAP notes
--     (migration 14) and the internal reminders.
--   * anonymize_patient() is re-created from its migration 20 body (no later
--     file redefines it) and also clears body_measurements.note, BEFORE it
--     sets anonymized_at (after that the guard freezes the record). The
--     measurements themselves stay: they are clinical data without a name.
--   * patients_keep_weight_tracking (BEFORE UPDATE OF weight_tracking):
--     the flag cannot change on an anonymized record.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- patients.weight_tracking
-- -----------------------------------------------------------------------------
alter table public.patients add column if not exists weight_tracking boolean not null default false;

comment on column public.patients.weight_tracking is
  'The doctor follows this patient''s body composition (InBody). Doctor-only write.';

-- -----------------------------------------------------------------------------
-- body_measurements
-- -----------------------------------------------------------------------------
create table if not exists public.body_measurements (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null,
  measured_at         date not null,
  appointment_id      uuid,
  author_id           uuid default auth.uid(),
  weight_kg           numeric(5,2) not null,
  height_cm           numeric(4,1),
  bmi                 numeric(6,1) generated always as (
                        case
                          when height_cm is null then null
                          else round(weight_kg / ((height_cm / 100) * (height_cm / 100)), 1)
                        end
                      ) stored,
  body_fat_pct        numeric(4,1),
  body_fat_kg         numeric(5,2),
  skeletal_muscle_kg  numeric(5,2),
  lean_mass_kg        numeric(5,2),
  waist_hip_ratio     numeric(3,2),
  visceral_fat_level  smallint,
  bmr_kcal            integer,
  balance_upper_lower text,
  body_type           text,
  cid_type            text,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Patients are anonymized, never deleted: a delete must not erase their
-- measurements silently.
alter table public.body_measurements drop constraint if exists body_measurements_patient_id_fkey;
alter table public.body_measurements add constraint body_measurements_patient_id_fkey
  foreign key (patient_id) references public.patients (id) on delete restrict;

-- The measurement is patient data; it outlives the appointment it was taken in.
alter table public.body_measurements drop constraint if exists body_measurements_appointment_id_fkey;
alter table public.body_measurements add constraint body_measurements_appointment_id_fkey
  foreign key (appointment_id) references public.appointments (id) on delete set null;

-- Wide, physically possible ranges: they catch typos, not clinical judgement.
-- The same weight and height limits as the consultation's vital signs.
alter table public.body_measurements drop constraint if exists body_measurements_values_check;
alter table public.body_measurements add constraint body_measurements_values_check
  check (
    measured_at >= date '2000-01-01'
    and weight_kg between 0.5 and 400
    and (height_cm is null or height_cm between 30 and 250)
    and (body_fat_pct is null or body_fat_pct between 1 and 80)
    and (body_fat_kg is null or (body_fat_kg between 0 and 300 and body_fat_kg <= weight_kg))
    and (skeletal_muscle_kg is null or (skeletal_muscle_kg between 1 and 200 and skeletal_muscle_kg <= weight_kg))
    and (lean_mass_kg is null or (lean_mass_kg between 1 and 400 and lean_mass_kg <= weight_kg))
    and (waist_hip_ratio is null or waist_hip_ratio between 0.40 and 2.00)
    and (visceral_fat_level is null or visceral_fat_level between 1 and 30)
    and (bmr_kcal is null or bmr_kcal between 300 and 5000)
    and (note is null or length(note) <= 1000)
  );

alter table public.body_measurements drop constraint if exists body_measurements_balance_check;
alter table public.body_measurements add constraint body_measurements_balance_check
  check (balance_upper_lower is null or balance_upper_lower in (
    'equilibrado', 'ligero_desequilibrio', 'desequilibrio'
  ));

alter table public.body_measurements drop constraint if exists body_measurements_body_type_check;
alter table public.body_measurements add constraint body_measurements_body_type_check
  check (body_type is null or body_type in (
    'obesidad_sarcopenica', 'obesidad', 'obesidad_leve', 'sobrepeso', 'promedio',
    'figura_atletica', 'figura_musculosa', 'esbelto', 'esbelto_musculoso',
    'ligeramente_delgado', 'delgado'
  ));

alter table public.body_measurements drop constraint if exists body_measurements_cid_type_check;
alter table public.body_measurements add constraint body_measurements_cid_type_check
  check (cid_type is null or cid_type in ('tipo_c', 'tipo_i', 'tipo_d'));

create index if not exists body_measurements_patient_date_idx
  on public.body_measurements (patient_id, measured_at, created_at);

create index if not exists body_measurements_appointment_idx
  on public.body_measurements (appointment_id)
  where appointment_id is not null;

comment on table public.body_measurements is
  'InBody body composition measurements of the patients the doctor follows (patients.weight_tracking). Doctor only; audited.';
comment on column public.body_measurements.bmi is
  'Generated: weight_kg / (height_cm / 100)^2, one decimal; null without a height.';
comment on column public.body_measurements.body_type is
  'InBody body type read on the BMI / body fat % chart.';
comment on column public.body_measurements.cid_type is
  'InBody C / I / D shape of the weight - skeletal muscle - body fat bars.';
comment on column public.body_measurements.note is
  'Doctor''s note on the measurement. Not part of the patient export.';

alter table public.body_measurements enable row level security;

revoke all on public.body_measurements from public, anon;
grant select, insert, update, delete on public.body_measurements to authenticated;

drop policy if exists "body_measurements_staff_all" on public.body_measurements;
create policy "body_measurements_staff_all"
  on public.body_measurements for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- body_measurements_guard - server-owned fields and refusals
-- -----------------------------------------------------------------------------
create or replace function public.body_measurements_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient      uuid := case when tg_op = 'DELETE' then old.patient_id else new.patient_id end;
  v_appt_patient uuid;
begin
  if tg_op = 'UPDATE' and new.patient_id is distinct from old.patient_id then
    raise exception 'Una medición no se puede pasar a otro paciente.' using errcode = 'P0001';
  end if;

  -- Same text as the app's ANONYMIZED_PATIENT_MESSAGE.
  if exists (
    select 1 from public.patients p
    where p.id = v_patient and p.anonymized_at is not null
  ) then
    raise exception 'Este expediente fue anonimizado. Sus datos ya no se pueden editar.'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.measured_at > (now() at time zone 'America/Monterrey')::date then
    raise exception 'La fecha de la medición no puede ser futura.' using errcode = 'P0001';
  end if;

  if new.appointment_id is not null
     and (tg_op = 'INSERT' or new.appointment_id is distinct from old.appointment_id) then
    select a.patient_id into v_appt_patient
    from public.appointments a
    where a.id = new.appointment_id;

    if v_appt_patient is distinct from new.patient_id then
      raise exception 'La cita indicada no es de este paciente.' using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.author_id  := coalesce(auth.uid(), new.author_id);
    new.created_at := now();
  else
    new.author_id  := old.author_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  return new;
end;
$$;

revoke all on function public.body_measurements_guard() from public, anon, authenticated, service_role;

drop trigger if exists body_measurements_guard on public.body_measurements;
create trigger body_measurements_guard
  before insert or update or delete on public.body_measurements
  for each row execute function public.body_measurements_guard();

drop trigger if exists audit_row_change on public.body_measurements;
create trigger audit_row_change
  after insert or update or delete on public.body_measurements
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- export_my_data - migration 20 body + the patient's own measurements
-- -----------------------------------------------------------------------------
-- Same signature as before, so existing grants are kept.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_pid    uuid := public.current_patient_id();
  v_result jsonb;
begin
  if v_pid is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'privacy_notice_version', public.privacy_notice_version(),
    -- Explicit column list: patients.notes is the doctor's internal reminder
    -- pad ("Recordatorios Internos") and must never reach the patient export.
    'profile', (
      select jsonb_build_object(
               'first_name', p.first_name, 'last_name', p.last_name,
               'phone', p.phone, 'email', p.email, 'gender', p.gender,
               'dob', p.dob, 'address', p.address,
               'blood_type', p.blood_type,
               'allergies', p.allergies,
               'chronic_conditions', p.chronic_conditions,
               'family_history', p.family_history,
               'personal_pathological_history', p.personal_pathological_history,
               'non_pathological_history', p.non_pathological_history,
               'current_illness', p.current_illness,
               'referred_by', p.referred_by, 'created_at', p.created_at)
      from public.patients p where p.id = v_pid),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'document', c.document, 'version', c.version,
               'accepted_at', c.accepted_at, 'user_agent', c.user_agent)
             order by c.accepted_at)
      from public.consents c where c.patient_id = v_pid), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'service', s.name, 'start_time', a.start_time,
               'status', a.status, 'reason', a.reason,
               'cancel_reason', a.cancel_reason,
               'created_at', a.created_at)
             order by a.start_time)
      from public.appointments a
      left join public.services s on s.id = a.service_id
      where a.patient_id = v_pid), '[]'::jsonb),
    'prescriptions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pr.id, 'appointment_id', pr.appointment_id,
               'created_at', pr.created_at, 'finalized_at', pr.finalized_at,
               'medications', pr.medications)
             order by pr.created_at)
      from public.prescriptions pr where pr.patient_id = v_pid), '[]'::jsonb),
    -- Migration 24: the patient's body composition measurements. Explicit
    -- column list: the doctor's note on a measurement is not exported.
    'body_measurements', coalesce((
      select jsonb_agg(jsonb_build_object(
               'measured_at', bm.measured_at,
               'weight_kg', bm.weight_kg, 'height_cm', bm.height_cm, 'bmi', bm.bmi,
               'body_fat_pct', bm.body_fat_pct, 'body_fat_kg', bm.body_fat_kg,
               'skeletal_muscle_kg', bm.skeletal_muscle_kg, 'lean_mass_kg', bm.lean_mass_kg,
               'waist_hip_ratio', bm.waist_hip_ratio,
               'visceral_fat_level', bm.visceral_fat_level, 'bmr_kcal', bm.bmr_kcal,
               'balance_upper_lower', bm.balance_upper_lower,
               'body_type', bm.body_type, 'cid_type', bm.cid_type)
             order by bm.measured_at, bm.created_at)
      from public.body_measurements bm where bm.patient_id = v_pid), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', o.name, 'uploaded_at', o.created_at,
               'mime_type', o.metadata ->> 'mimetype',
               'size_bytes', o.metadata ->> 'size')
             order by o.created_at)
      from storage.objects o
      where o.bucket_id = 'clinical_records'
        and (storage.foldername(o.name))[1] = v_pid::text), '[]'::jsonb),
    'file_records', coalesce((
      select jsonb_agg(jsonb_build_object(
               'file_name', pf.file_name, 'file_type', pf.file_type,
               'uploaded_by', pf.uploaded_by, 'created_at', pf.created_at)
             order by pf.created_at)
      from public.patient_files pf where pf.patient_id = v_pid), '[]'::jsonb),
    'arco_requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'request_type', r.request_type, 'details', r.details,
               'status', r.status, 'created_at', r.created_at,
               'resolved_at', r.resolved_at, 'resolution_note', r.resolution_note)
             order by r.created_at)
      from public.arco_requests r where r.patient_id = v_pid), '[]'::jsonb)
  )
  into v_result;

  perform public.write_audit_event('EXPORT', 'patients', v_pid, v_pid, null);

  return v_result;
end;
$$;

revoke all on function public.export_my_data() from public, anon, authenticated;
grant execute on function public.export_my_data() to authenticated;

-- -----------------------------------------------------------------------------
-- anonymize_patient - migration 20 body + body_measurements.note cleared
-- -----------------------------------------------------------------------------
-- Same signature as before, so existing grants are kept.
create or replace function public.anonymize_patient(p_patient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_anonymized_at timestamptz;
  v_exists        boolean;
  v_last          timestamptz;
  v_until         timestamptz;
  v_files         integer;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para anonimizar expedientes.' using errcode = '42501';
  end if;

  select true, p.anonymized_at
    into v_exists, v_anonymized_at
  from public.patients p
  where p.id = p_patient_id
  for update;

  if v_exists is null then
    raise exception 'No se encontró el expediente.' using errcode = 'P0001';
  end if;

  if v_anonymized_at is not null then
    raise exception 'Este expediente ya fue anonimizado el %.', to_char(v_anonymized_at, 'DD/MM/YYYY')
      using errcode = 'P0001';
  end if;

  v_last := public.last_clinical_act_at(p_patient_id);

  if v_last is not null then
    v_until := v_last + public.clinical_record_retention();
    if v_until > now() then
      raise exception 'El expediente debe conservarse al menos 5 años desde el último acto médico (NOM-004-SSA3-2012). Podrá anonimizarse a partir del %.',
        to_char(v_until at time zone 'America/Monterrey', 'DD/MM/YYYY')
        using errcode = 'P0001';
    end if;
  end if;

  if exists (
    select 1 from public.appointments a
    where a.patient_id = p_patient_id
      and a.status in ('pending', 'confirmed')
      and a.start_time > now()
  ) then
    raise exception 'El paciente tiene citas próximas. Cancélalas antes de anonimizar el expediente.'
      using errcode = 'P0001';
  end if;

  -- Migration 24: the doctor's free-text note on a measurement can name the
  -- patient. Cleared BEFORE anonymized_at is set, because
  -- body_measurements_guard() refuses every write on an anonymized record.
  update public.body_measurements
     set note = null
   where patient_id = p_patient_id
     and note is not null;

  update public.patients
     set first_name    = 'Paciente',
         last_name     = 'Anonimizado',
         phone         = null,
         email         = null,
         address       = null,
         dob           = case when dob is null then null
                              else make_date(extract(year from dob)::int, 1, 1) end,
         notes         = null,
         referred_by   = null,
         status        = 'archived',
         anonymized_at = now()
   where id = p_patient_id;

  update public.appointments
     set cancel_reason = null
   where patient_id = p_patient_id
     and cancel_reason is not null;

  select count(*) into v_files
  from storage.objects o
  where o.bucket_id = 'clinical_records'
    and (storage.foldername(o.name))[1] = p_patient_id::text;

  perform public.write_audit_event(
    'ANONYMIZE', 'patients', p_patient_id, p_patient_id,
    array['first_name', 'last_name', 'phone', 'email', 'address', 'dob', 'notes', 'referred_by',
          'status', 'appointments.cancel_reason', 'body_measurements.note']
  );

  return jsonb_build_object('anonymized_at', now(), 'files_to_review', v_files);
end;
$$;

revoke all on function public.anonymize_patient(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_patient(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- patients_keep_weight_tracking - frozen on an anonymized record
-- -----------------------------------------------------------------------------
create or replace function public.patients_keep_weight_tracking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.anonymized_at is not null
     and new.weight_tracking is distinct from old.weight_tracking then
    raise exception 'Este expediente fue anonimizado. Sus datos ya no se pueden editar.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.patients_keep_weight_tracking() from public, anon, authenticated, service_role;

drop trigger if exists patients_keep_weight_tracking on public.patients;
create trigger patients_keep_weight_tracking
  before update of weight_tracking on public.patients
  for each row execute function public.patients_keep_weight_tracking();

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  c          text;
  v_col      text;
  v_priv     text;
  v_src      text;
  v_bad      text;
  v_state    text;
  v_patient  uuid;
  v_anon     uuid;
  v_bmi      numeric;
  v_pos_note integer;
  v_pos_anon integer;
begin
  -- 1. patients.weight_tracking: not null, default false, doctor-only write.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'patients'
      and column_name = 'weight_tracking' and data_type = 'boolean'
      and is_nullable = 'NO' and column_default = 'false'
  ) then
    raise exception 'Migration 24 FAILED: patients.weight_tracking is missing, nullable or not default false.'
      using errcode = 'P0001';
  end if;

  select string_agg(policyname, ', ')
    into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = 'patients'
    and cmd in ('UPDATE', 'INSERT', 'DELETE', 'ALL')
    and not (coalesce(qual, '') ~ '\mis_staff\(' or coalesce(with_check, '') ~ '\mis_staff\(');
  if v_bad is not null then
    raise exception 'Migration 24 FAILED: non-staff write policies on public.patients (patients could change weight_tracking): %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 2. body_measurements: RLS, the only policy is doctor-only, grants.
  if not exists (
    select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relname = 'body_measurements' and cl.relrowsecurity
  ) then
    raise exception 'Migration 24 FAILED: body_measurements is missing or RLS is off.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'body_measurements'
      and policyname = 'body_measurements_staff_all' and cmd = 'ALL'
      and qual ~ '\mis_staff\(' and qual !~ 'is_business_staff'
      and with_check ~ '\mis_staff\(' and with_check !~ 'is_business_staff'
  ) then
    raise exception 'Migration 24 FAILED: policy body_measurements_staff_all is missing or not doctor-only.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'body_measurements'
      and policyname <> 'body_measurements_staff_all'
  ) then
    raise exception 'Migration 24 FAILED: body_measurements has an unexpected policy.' using errcode = 'P0001';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.body_measurements', v_priv) then
      raise exception 'Migration 24 FAILED: anon holds % on body_measurements.', v_priv using errcode = 'P0001';
    end if;
    if not has_table_privilege('authenticated', 'public.body_measurements', v_priv) then
      raise exception 'Migration 24 FAILED: authenticated lacks % on body_measurements (RLS decides who).', v_priv
        using errcode = 'P0001';
    end if;
  end loop;

  -- 3. Constraints, generated BMI, triggers.
  foreach c in array array[
    'body_measurements_patient_id_fkey', 'body_measurements_appointment_id_fkey',
    'body_measurements_values_check', 'body_measurements_balance_check',
    'body_measurements_body_type_check', 'body_measurements_cid_type_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.body_measurements'::regclass and conname = c and convalidated
    ) then
      raise exception 'Migration 24 FAILED: constraint % is missing on body_measurements.', c using errcode = 'P0001';
    end if;
  end loop;

  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.body_measurements'::regclass and attname = 'bmi' and attgenerated = 's'
  ) then
    raise exception 'Migration 24 FAILED: body_measurements.bmi is not a stored generated column.' using errcode = 'P0001';
  end if;

  foreach c in array array['audit_row_change', 'body_measurements_guard'] loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = 'public.body_measurements'::regclass and tg.tgname = c
        and not tg.tgisinternal and tg.tgenabled <> 'D'
    ) then
      raise exception 'Migration 24 FAILED: trigger % is missing or disabled on body_measurements.', c
        using errcode = 'P0001';
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.body_measurements_guard()'::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 24 FAILED: body_measurements_guard() is not SECURITY DEFINER with a pinned search_path.'
      using errcode = 'P0001';
  end if;

  foreach c in array array['anon', 'authenticated'] loop
    if has_function_privilege(c, 'public.body_measurements_guard()', 'execute') then
      raise exception 'Migration 24 FAILED: % can execute body_measurements_guard().', c using errcode = 'P0001';
    end if;
  end loop;

  -- 4. Export: measurements in (without the note); the migration 20 rules kept.
  if not exists (
    select 1 from pg_proc
    where oid = 'public.export_my_data()'::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 24 FAILED: export_my_data() is not SECURITY DEFINER with a pinned search_path.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.export_my_data()'::regprocedure;
  if strpos(v_src, '''body_measurements''') = 0
     or v_src !~ 'bm\.patient_id = v_pid'
     or v_src ~ 'bm\.note' then
    raise exception 'Migration 24 FAILED: export_my_data() must export the caller''s own measurements without the note.'
      using errcode = 'P0001';
  end if;

  foreach v_col in array array['address', 'family_history', 'personal_pathological_history',
                               'non_pathological_history', 'current_illness'] loop
    if strpos(v_src, format('''%s'', p.%s', v_col, v_col)) = 0 then
      raise exception 'Migration 24 FAILED: export_my_data() no longer exports patients.%.', v_col
        using errcode = 'P0001';
    end if;
  end loop;

  if v_src !~ '''reason'', a\.reason'
     or v_src ~ '''clinical_notes'''
     or v_src ~ '''notes'', p\.notes' then
    raise exception 'Migration 24 FAILED: export_my_data() must keep appointments.reason and must not export patients.notes or clinical notes.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.export_my_data()', 'execute')
     or not has_function_privilege('authenticated', 'public.export_my_data()', 'execute') then
    raise exception 'Migration 24 FAILED: export_my_data() must be executable by authenticated only.' using errcode = 'P0001';
  end if;

  -- 5. Anonymization clears the measurement notes before it freezes the
  --    record; the weight_tracking flag is frozen on an anonymized record.
  if not exists (
    select 1 from pg_proc
    where oid = 'public.anonymize_patient(uuid)'::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 24 FAILED: anonymize_patient() is not SECURITY DEFINER with a pinned search_path.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.anonymize_patient(uuid)'::regprocedure;
  v_pos_note := strpos(v_src, 'update public.body_measurements');
  v_pos_anon := strpos(v_src, 'anonymized_at = now()');
  if v_pos_note = 0 or v_pos_anon = 0 or v_pos_note > v_pos_anon
     or v_src !~ 'set note = null'
     or v_src !~ 'address\s+= null' or v_src !~ '\mis_staff\(' then
    raise exception 'Migration 24 FAILED: anonymize_patient() must clear body_measurements.note before setting anonymized_at (and keep the migration 20 rules).'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.anonymize_patient(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.anonymize_patient(uuid)', 'execute') then
    raise exception 'Migration 24 FAILED: anonymize_patient() must be executable by authenticated only.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'public.patients'::regclass and tg.tgname = 'patients_keep_weight_tracking'
      and not tg.tgisinternal and tg.tgenabled <> 'D'
      and tg.tgfoid = 'public.patients_keep_weight_tracking()'::regprocedure
  ) then
    raise exception 'Migration 24 FAILED: trigger patients_keep_weight_tracking is missing or disabled on public.patients.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.patients_keep_weight_tracking()'::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 24 FAILED: patients_keep_weight_tracking() is not SECURITY DEFINER with a pinned search_path.'
      using errcode = 'P0001';
  end if;

  foreach c in array array['anon', 'authenticated'] loop
    if has_function_privilege(c, 'public.patients_keep_weight_tracking()', 'execute') then
      raise exception 'Migration 24 FAILED: % can execute patients_keep_weight_tracking().', c using errcode = 'P0001';
    end if;
  end loop;

  -- 6. Behavior, inside a sub-transaction that is always rolled back.
  begin
    insert into public.patients (first_name, last_name, status)
    values ('MIGRATION-24-GATE', 'Patient', 'active')
    returning id into v_patient;

    insert into public.body_measurements (patient_id, measured_at, weight_kg, height_cm)
    values (v_patient, date '2026-01-15', 70, 170)
    returning bmi into v_bmi;
    if v_bmi is distinct from 24.2 then
      raise exception 'Migration 24 FAILED: 70 kg at 170 cm gave BMI %, expected 24.2.', v_bmi using errcode = 'P0001';
    end if;

    v_state := null;
    begin
      insert into public.body_measurements (patient_id, measured_at, weight_kg)
      values (v_patient, date '2026-01-15', 700);
    exception when check_violation then v_state := '23514';
    end;
    if v_state is distinct from '23514' then
      raise exception 'Migration 24 FAILED: a weight of 700 kg was accepted.' using errcode = 'P0001';
    end if;

    v_state := null;
    begin
      insert into public.body_measurements (patient_id, measured_at, weight_kg)
      values (v_patient, (now() at time zone 'America/Monterrey')::date + 2, 70);
    exception when others then v_state := sqlstate;
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'Migration 24 FAILED: a measurement dated in the future was accepted.' using errcode = 'P0001';
    end if;

    insert into public.patients (first_name, last_name, status, anonymized_at)
    values ('Paciente', 'Anonimizado', 'archived', now())
    returning id into v_anon;

    v_state := null;
    begin
      insert into public.body_measurements (patient_id, measured_at, weight_kg)
      values (v_anon, date '2026-01-15', 70);
    exception when others then v_state := sqlstate;
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'Migration 24 FAILED: a measurement of an anonymized record was accepted.' using errcode = 'P0001';
    end if;

    v_state := null;
    begin
      update public.patients set weight_tracking = true where id = v_anon;
    exception when others then v_state := sqlstate;
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'Migration 24 FAILED: weight_tracking changed on an anonymized record.' using errcode = 'P0001';
    end if;

    update public.patients set weight_tracking = true where id = v_patient;
    if not (select p.weight_tracking from public.patients p where p.id = v_patient) then
      raise exception 'Migration 24 FAILED: weight_tracking could not be set on an active record.' using errcode = 'P0001';
    end if;

    raise exception using errcode = 'P0001', message = 'MIGRATION_24_GATE_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MIGRATION_24_GATE_ROLLBACK' then
      raise;
    end if;
  end;

  raise notice 'Migration 24 PASSED: patients.weight_tracking is doctor-only; body_measurements is doctor-only (RLS is_staff()), audited, range-checked, with a generated BMI; anonymized records, future dates and foreign appointments are refused; weight_tracking is frozen on anonymized records; anonymize_patient() clears the measurement notes; export_my_data() adds the patient''s own measurements without the doctor''s note.';
end $$;
