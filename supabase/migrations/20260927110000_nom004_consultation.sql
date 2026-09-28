-- =============================================================================
-- 20 - NOM-004 consultation record: prognosis, vital signs, history, address
-- =============================================================================
-- NOM-004-SSA3-2012 gaps closed here:
--   * 6.2.5 Every progress note records the prognosis:
--       clinical_notes.prognosis (text).
--   * 6.2.2 / 5.11 Vital signs are recorded as data, not as abbreviations
--     prefixed into the objective text ("TA 120/-"):
--       clinical_notes.vital_signs (jsonb object; numeric keys bp_sys, bp_dia,
--       spo2, weight_kg, height_cm; every key optional).
--   * 6.1 Clinical history (historia clinica) on the patient record:
--       patients.family_history, personal_pathological_history,
--       non_pathological_history, current_illness (text, optional).
--   * 5.2.3 The patient's address: patients.address (text, optional).
--   * 5.11 A note is never frozen without its core content:
--       finalize_consultation() refuses to finalize while the note has an
--       empty diagnosis (analysis) or plan, or when there is no note at all.
--
-- Charge and finalization are one transaction:
--   "Finalizar Consulta" used to call record_payment() and then, in a second
--   request, finalize_consultation(). When the second call failed the charge
--   stayed recorded for a consultation that was never finalized.
--   finalize_consultation_with_payment() calls finalize_consultation() and then
--   record_payment() inside ONE function call, so both succeed or neither
--   does. It reuses both functions unchanged (their rules, their audit rows);
--   it adds no rule of its own besides the is_staff() check.
--
-- Integrity (migration 10): clinical_notes_enforce_integrity() is redefined
-- from its migration 10 body with prognosis and vital_signs added to the
-- frozen tuple, so both are unalterable after "Finalizar Consulta" exactly
-- like subjective/objective/analysis/plan.
--
-- Privacy:
--   * The patient still has NO write path to public.patients (no UPDATE or
--     INSERT policy for patients, only patients_select_own), so the new
--     clinical history columns are editable by the doctor only, exactly like
--     allergies and chronic_conditions. The gate below proves it.
--   * export_my_data() (redefined from migration 14) adds patients.address and
--     the four clinical history columns to the patient's own access export
--     (owner decision: the patient sees their antecedentes, like allergies).
--     SOAP notes stay excluded (migration 14).
--   * anonymize_patient() (redefined from migration 11) also clears
--     patients.address, an identifier. Clinical history is clinical content and
--     is kept, like allergies.
--   * audit_log keeps storing column NAMES only; the generic audit_row_change()
--     trigger picks up the new columns with no change.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.clinical_notes add column if not exists prognosis   text;
alter table public.clinical_notes add column if not exists vital_signs jsonb;

alter table public.clinical_notes drop constraint if exists clinical_notes_vital_signs_check;
alter table public.clinical_notes add constraint clinical_notes_vital_signs_check
  check (
    vital_signs is null
    or (
      jsonb_typeof(vital_signs) = 'object'
      and (vital_signs - array['bp_sys', 'bp_dia', 'spo2', 'weight_kg', 'height_cm']) = '{}'::jsonb
      and not jsonb_path_exists(vital_signs, '$.* ? (@.type() != "number")')
    )
  );

comment on column public.clinical_notes.prognosis is
  'Prognosis of the consultation (NOM-004-SSA3-2012 6.2.5). Frozen on finalization.';
comment on column public.clinical_notes.vital_signs is
  'Vital signs as numbers: bp_sys, bp_dia (mmHg), spo2 (%), weight_kg, height_cm. Frozen on finalization.';

alter table public.patients add column if not exists address                       text;
alter table public.patients add column if not exists family_history                text;
alter table public.patients add column if not exists personal_pathological_history text;
alter table public.patients add column if not exists non_pathological_history      text;
alter table public.patients add column if not exists current_illness               text;

comment on column public.patients.address is 'Patient address (NOM-004-SSA3-2012 5.2.3). Cleared on anonymization.';
comment on column public.patients.family_history is 'Antecedentes heredofamiliares (NOM-004 6.1). Doctor-only write.';
comment on column public.patients.personal_pathological_history is 'Antecedentes personales patologicos (NOM-004 6.1). Doctor-only write.';
comment on column public.patients.non_pathological_history is 'Antecedentes personales no patologicos (NOM-004 6.1). Doctor-only write.';
comment on column public.patients.current_illness is 'Padecimiento actual (NOM-004 6.1). Doctor-only write.';

-- -----------------------------------------------------------------------------
-- clinical_notes integrity trigger - migration 10 body + prognosis, vital_signs
-- -----------------------------------------------------------------------------
create or replace function public.clinical_notes_enforce_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if public.consultation_is_finalized(new.appointment_id) then
      raise exception 'Esta consulta ya fue finalizada y no se puede modificar. Para corregir el expediente, agrega una nota aclaratoria (adenda).'
        using errcode = 'P0001';
    end if;
    -- Finalization only ever happens through an UPDATE, never at insert time.
    new.finalized_at := null;
    new.finalized_by := null;
    new.author_id    := coalesce(auth.uid(), new.author_id);
    return new;
  end if;

  if old.finalized_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'Una nota clínica finalizada no se puede eliminar (NOM-004-SSA3-2012).'
        using errcode = 'P0001';
    end if;

    if (new.subjective, new.objective, new.analysis, new.plan,
        new.prognosis, new.vital_signs,
        new.patient_id, new.appointment_id, new.created_at,
        new.author_id, new.finalized_at, new.finalized_by)
       is distinct from
       (old.subjective, old.objective, old.analysis, old.plan,
        old.prognosis, old.vital_signs,
        old.patient_id, old.appointment_id, old.created_at,
        old.author_id, old.finalized_at, old.finalized_by) then
      raise exception 'Esta consulta ya fue finalizada y no se puede modificar. Para corregir el expediente, agrega una nota aclaratoria (adenda).'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  -- Not yet finalized. If this update finalizes it, the server owns the stamp.
  if new.finalized_at is not null then
    new.finalized_at := now();
    new.finalized_by := auth.uid();
  else
    new.finalized_by := null;
  end if;

  return new;
end;
$$;

revoke all on function public.clinical_notes_enforce_integrity() from public, anon, authenticated;

drop trigger if exists clinical_notes_enforce_integrity on public.clinical_notes;
create trigger clinical_notes_enforce_integrity
  before insert or update or delete on public.clinical_notes
  for each row execute function public.clinical_notes_enforce_integrity();

-- -----------------------------------------------------------------------------
-- finalize_consultation - migration 10 body + diagnosis and plan required
-- -----------------------------------------------------------------------------
-- A consultation that is already finalized skips the content check, so a
-- repeated call stays harmless (it returns 0), even for notes finalized
-- before this file.
-- -----------------------------------------------------------------------------
create or replace function public.finalize_consultation(p_appointment_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_notes   integer;
  v_rx      integer;
  v_patient uuid;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para finalizar consultas.' using errcode = '42501';
  end if;

  select a.patient_id into v_patient
  from public.appointments a
  where a.id = p_appointment_id;

  if not found then
    raise exception 'No se encontró la cita a finalizar.' using errcode = 'P0001';
  end if;

  if not public.consultation_is_finalized(p_appointment_id) then
    if not exists (
         select 1 from public.clinical_notes cn
         where cn.appointment_id = p_appointment_id
       )
       or exists (
         select 1 from public.clinical_notes cn
         where cn.appointment_id = p_appointment_id
           and cn.finalized_at is null
           and (btrim(coalesce(cn.analysis, '')) = '' or btrim(coalesce(cn.plan, '')) = '')
       ) then
      raise exception 'Para finalizar la consulta, escribe el diagnóstico y el plan.'
        using errcode = 'P0001';
    end if;
  end if;

  update public.clinical_notes
     set finalized_at = now()
   where appointment_id = p_appointment_id
     and finalized_at is null;
  get diagnostics v_notes = row_count;

  update public.prescriptions
     set finalized_at = now()
   where appointment_id = p_appointment_id
     and finalized_at is null;
  get diagnostics v_rx = row_count;

  if v_notes + v_rx > 0 then
    perform public.write_audit_event(
      'FINALIZE', 'appointments', p_appointment_id, v_patient,
      array['clinical_notes', 'prescriptions']
    );
  end if;

  return v_notes + v_rx;
end;
$$;

revoke all on function public.finalize_consultation(uuid) from public, anon, authenticated;
grant execute on function public.finalize_consultation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- finalize_consultation_with_payment - "Finalizar Consulta" in one transaction
-- -----------------------------------------------------------------------------
-- Finalizes first, so an incomplete note is refused before anything is
-- charged; then records the charge through record_payment() (migration 17).
-- Any exception in either step aborts the whole call: no frozen note without
-- its charge, no charge without a frozen note. Both keep their own audit rows
-- (FINALIZE event, payments row trigger), which roll back together too.
-- -----------------------------------------------------------------------------
create or replace function public.finalize_consultation_with_payment(
  p_appointment_id uuid,
  p_status         text,
  p_amount         numeric default null,
  p_method         text default null,
  p_note           text default null
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.payments;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para finalizar consultas.' using errcode = '42501';
  end if;

  perform public.finalize_consultation(p_appointment_id);

  v_row := public.record_payment(p_appointment_id, p_status, p_amount, p_method, p_note);

  return v_row;
end;
$$;

revoke all on function public.finalize_consultation_with_payment(uuid, text, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.finalize_consultation_with_payment(uuid, text, numeric, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- export_my_data - migration 14 body + patients.address
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
-- anonymize_patient - migration 11 body + patients.address cleared
-- -----------------------------------------------------------------------------
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
          'status', 'appointments.cancel_reason']
  );

  return jsonb_build_object('anonymized_at', now(), 'files_to_review', v_files);
end;
$$;

revoke all on function public.anonymize_patient(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_patient(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_col text;
  v_src text;
  v_bad text;
  v_fn  text;
begin
  -- 1. Columns.
  foreach v_col in array array['prognosis', 'vital_signs'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'clinical_notes' and column_name = v_col
    ) then
      raise exception 'Migration 20 FAILED: public.clinical_notes.% is missing.', v_col using errcode = 'P0001';
    end if;
  end loop;

  foreach v_col in array array['address', 'family_history', 'personal_pathological_history',
                               'non_pathological_history', 'current_illness'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'patients' and column_name = v_col
    ) then
      raise exception 'Migration 20 FAILED: public.patients.% is missing.', v_col using errcode = 'P0001';
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clinical_notes'::regclass
      and conname = 'clinical_notes_vital_signs_check'
  ) then
    raise exception 'Migration 20 FAILED: clinical_notes_vital_signs_check is missing.' using errcode = 'P0001';
  end if;

  -- 2. The new clinical fields are frozen after finalization.
  select prosrc into v_src from pg_proc
  where oid = 'public.clinical_notes_enforce_integrity()'::regprocedure;
  if v_src !~ 'new\.prognosis' or v_src !~ 'old\.prognosis'
     or v_src !~ 'new\.vital_signs' or v_src !~ 'old\.vital_signs' then
    raise exception 'Migration 20 FAILED: clinical_notes_enforce_integrity() does not freeze prognosis and vital_signs.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'public.clinical_notes'::regclass
      and tg.tgname = 'clinical_notes_enforce_integrity'
      and not tg.tgisinternal
      and tg.tgenabled <> 'D'
  ) then
    raise exception 'Migration 20 FAILED: the clinical_notes integrity trigger is missing or disabled.'
      using errcode = 'P0001';
  end if;

  -- 3. finalize_consultation: doctor only, requires diagnosis and plan.
  select prosrc into v_src from pg_proc
  where oid = 'public.finalize_consultation(uuid)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff'
     or v_src !~ 'cn\.analysis' or v_src !~ 'cn\.plan' then
    raise exception 'Migration 20 FAILED: finalize_consultation() must check is_staff() and require diagnosis and plan.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.finalize_consultation(uuid)', 'execute') then
    raise exception 'Migration 20 FAILED: anon can execute finalize_consultation.' using errcode = 'P0001';
  end if;

  -- 3b. Charge + finalize in one call: doctor only, reuses both functions.
  v_fn := 'public.finalize_consultation_with_payment(uuid,text,numeric,text,text)';
  if to_regprocedure(v_fn) is null then
    raise exception 'Migration 20 FAILED: % is missing.', v_fn using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = v_fn::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 20 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff'
     or v_src !~ 'public\.finalize_consultation\(p_appointment_id\)'
     or v_src !~ 'public\.record_payment\(p_appointment_id, p_status, p_amount, p_method, p_note\)'
     or strpos(v_src, 'public.finalize_consultation(') > strpos(v_src, 'public.record_payment(') then
    raise exception 'Migration 20 FAILED: % must check is_staff(), then call finalize_consultation() before record_payment().', v_fn
      using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'Migration 20 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', v_fn, 'execute') then
    raise exception 'Migration 20 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
  end if;

  -- 4. Patients have no write path to their own record.
  select string_agg(policyname, ', ')
    into v_bad
  from pg_policies
  where schemaname = 'public' and tablename = 'patients'
    and cmd in ('UPDATE', 'INSERT', 'DELETE', 'ALL')
    and not (coalesce(qual, '') ~ '\mis_staff\(' or coalesce(with_check, '') ~ '\mis_staff\(');
  if v_bad is not null then
    raise exception 'Migration 20 FAILED: non-staff write policies on public.patients: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 5. The doctor can read note authors' names.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select_staff'
      and cmd = 'SELECT'
      and qual ~ '\mis_staff\('
  ) then
    raise exception 'Migration 20 FAILED: profiles_select_staff is missing; note authors would show no name.'
      using errcode = 'P0001';
  end if;

  -- 6. Export: address and clinical history in; internal notes and SOAP
  --    notes out.
  select prosrc into v_src from pg_proc where oid = 'public.export_my_data()'::regprocedure;
  foreach v_col in array array['address', 'family_history', 'personal_pathological_history',
                               'non_pathological_history', 'current_illness'] loop
    if strpos(v_src, format('''%s'', p.%s', v_col, v_col)) = 0 then
      raise exception 'Migration 20 FAILED: export_my_data() does not export patients.%.', v_col
        using errcode = 'P0001';
    end if;
  end loop;

  if v_src !~ '''reason'', a\.reason'
     or v_src ~ '''clinical_notes'''
     or v_src ~ '''notes'', p\.notes' then
    raise exception 'Migration 20 FAILED: export_my_data() must keep appointments.reason and must not export patients.notes or clinical notes.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.export_my_data()', 'execute') then
    raise exception 'Migration 20 FAILED: anon can execute export_my_data().' using errcode = 'P0001';
  end if;

  -- 7. Anonymization clears the address and stays doctor-only.
  select prosrc into v_src from pg_proc where oid = 'public.anonymize_patient(uuid)'::regprocedure;
  if v_src !~ 'address\s+= null' or v_src !~ '\mis_staff\(' then
    raise exception 'Migration 20 FAILED: anonymize_patient() must clear address and check is_staff().'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.anonymize_patient(uuid)', 'execute') then
    raise exception 'Migration 20 FAILED: anon can execute anonymize_patient().' using errcode = 'P0001';
  end if;

  raise notice 'Migration 20 PASSED: notes record prognosis and vital signs (frozen on finalization), finalize_consultation() requires diagnosis and plan, finalize_consultation_with_payment() charges and finalizes in one transaction, patients carry address and clinical history (doctor-only write), the export includes both and anonymization clears the address.';
end $$;
