-- =============================================================================
-- 11 - ARCO rights (Phase 2)
-- =============================================================================
-- LFPDPPP 2025 (DOF 20-03-2025), Chapter III:
--   * art. 22  Access          -> export_my_data()  (JSON download in the portal)
--   * art. 23  Rectification   -> submit_arco_request('rectification', ...)
--   * art. 24  Cancellation    -> submit_arco_request('cancellation', ...)
--   * art. 26  Opposition      -> submit_arco_request('opposition', ...)
--   * art. 7   Revocation of consent -> submit_arco_request('revocation', ...)
--   * art. 31  The controller answers within 20 días (art. 2 VIII: días
--              hábiles) and makes the answer effective within 15 more. Both
--              can be extended once by an equal period when justified.
--
-- Cancellation vs. clinical retention:
--   NOM-004-SSA3-2012 numeral 5.4 requires the clinical record to be kept for
--   at least 5 years from the last medical act, and LFPDPPP art. 25 VII says the
--   controller is not obliged to cancel data processed for medical diagnosis or
--   health services by a professional bound by secrecy. So a cancellation
--   request never hard-deletes clinical data. Instead staff may call
--   anonymize_patient(), which REFUSES while the record is inside the retention
--   window and, once outside it, strips identifiers from the patient row while
--   keeping the clinical content (notes, prescriptions, allergies, blood type,
--   birth year, sex) usable for statistics.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tunables
-- -----------------------------------------------------------------------------
-- NOM-004-SSA3-2012 numeral 5.4: minimum retention of the clinical record.
create or replace function public.clinical_record_retention()
returns interval language sql immutable set search_path = pg_temp as $$ select interval '5 years' $$;

-- Abuse ceiling: open ARCO requests one patient may hold at once.
create or replace function public.arco_limit_open_per_patient()
returns integer language sql immutable set search_path = pg_temp as $$ select 5 $$;

revoke all on function public.clinical_record_retention()   from public, anon, authenticated;
revoke all on function public.arco_limit_open_per_patient() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- patients.anonymized_at
-- -----------------------------------------------------------------------------
alter table public.patients add column if not exists anonymized_at timestamptz;

-- -----------------------------------------------------------------------------
-- arco_requests
-- -----------------------------------------------------------------------------
create table if not exists public.arco_requests (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.patients (id) on delete restrict,
  request_type     text not null,
  details          text not null,
  status           text not null default 'received',
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolution_note  text
);

alter table public.arco_requests drop constraint if exists arco_requests_request_type_check;
alter table public.arco_requests add constraint arco_requests_request_type_check
  check (request_type in ('access', 'rectification', 'cancellation', 'opposition', 'revocation'));

alter table public.arco_requests drop constraint if exists arco_requests_status_check;
alter table public.arco_requests add constraint arco_requests_status_check
  check (status in ('received', 'in_progress', 'resolved', 'rejected'));

alter table public.arco_requests drop constraint if exists arco_requests_details_check;
alter table public.arco_requests add constraint arco_requests_details_check
  check (length(btrim(details)) between 1 and 4000);

create index if not exists arco_requests_patient_idx on public.arco_requests (patient_id, created_at desc);
create index if not exists arco_requests_status_idx  on public.arco_requests (status, created_at);

alter table public.arco_requests enable row level security;

-- Read-only through the API; every write goes through the RPCs below.
revoke all on public.arco_requests from public, anon, authenticated, service_role;
grant select on public.arco_requests to authenticated;

drop policy if exists "arco_requests_select_staff" on public.arco_requests;
create policy "arco_requests_select_staff"
  on public.arco_requests for select to authenticated
  using (public.is_staff());

drop policy if exists "arco_requests_select_own" on public.arco_requests;
create policy "arco_requests_select_own"
  on public.arco_requests for select to authenticated
  using (patient_id = public.current_patient_id());

drop trigger if exists audit_row_change on public.arco_requests;
create trigger audit_row_change
  after insert or update or delete on public.arco_requests
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- submit_arco_request - patient files a request from the portal
-- -----------------------------------------------------------------------------
create or replace function public.submit_arco_request(
  p_request_type text,
  p_details      text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid := public.current_patient_id();
  v_open       integer;
  v_details    text := btrim(coalesce(p_details, ''));
  v_id         uuid;
begin
  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  if p_request_type is null
     or p_request_type not in ('access', 'rectification', 'cancellation', 'opposition', 'revocation') then
    raise exception 'Elige qué tipo de solicitud quieres hacer.' using errcode = 'P0001';
  end if;

  if length(v_details) < 5 then
    raise exception 'Describe brevemente tu solicitud para que la doctora pueda atenderla.'
      using errcode = 'P0001';
  end if;

  if length(v_details) > 4000 then
    raise exception 'Tu descripción es demasiado larga. Resúmela en menos de 4000 caracteres.'
      using errcode = 'P0001';
  end if;

  select count(*) into v_open
  from public.arco_requests r
  where r.patient_id = v_patient_id
    and r.status in ('received', 'in_progress');

  if v_open >= public.arco_limit_open_per_patient() then
    raise exception 'Ya tienes varias solicitudes en trámite. Espera la respuesta o comunícate con la clínica.'
      using errcode = 'P0001';
  end if;

  insert into public.arco_requests (patient_id, request_type, details)
  values (v_patient_id, p_request_type, v_details)
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- resolve_arco_request - staff moves a request forward
-- -----------------------------------------------------------------------------
create or replace function public.resolve_arco_request(
  p_request_id      uuid,
  p_status          text,
  p_resolution_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current text;
  v_note    text := nullif(btrim(coalesce(p_resolution_note, '')), '');
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para atender solicitudes ARCO.' using errcode = '42501';
  end if;

  if p_status not in ('in_progress', 'resolved', 'rejected') then
    raise exception 'Estado de solicitud no válido.' using errcode = 'P0001';
  end if;

  select r.status into v_current
  from public.arco_requests r
  where r.id = p_request_id
  for update;

  if v_current is null then
    raise exception 'No se encontró la solicitud.' using errcode = 'P0001';
  end if;

  if v_current in ('resolved', 'rejected') then
    raise exception 'Esta solicitud ya fue cerrada y no se puede modificar.' using errcode = 'P0001';
  end if;

  if p_status in ('resolved', 'rejected') and v_note is null then
    raise exception 'Escribe la respuesta que se le dio al paciente antes de cerrar la solicitud.'
      using errcode = 'P0001';
  end if;

  update public.arco_requests
     set status          = p_status,
         resolution_note = coalesce(v_note, resolution_note),
         resolved_at     = case when p_status in ('resolved', 'rejected') then now() else null end
   where id = p_request_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- export_my_data - right of access / portability (LFPDPPP art. 22 and 32)
-- -----------------------------------------------------------------------------
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
               'dob', p.dob, 'blood_type', p.blood_type,
               'allergies', p.allergies,
               'chronic_conditions', p.chronic_conditions,
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
               'status', a.status, 'cancel_reason', a.cancel_reason,
               'created_at', a.created_at)
             order by a.start_time)
      from public.appointments a
      left join public.services s on s.id = a.service_id
      where a.patient_id = v_pid), '[]'::jsonb),
    'clinical_notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', cn.id, 'appointment_id', cn.appointment_id,
               'created_at', cn.created_at, 'finalized_at', cn.finalized_at,
               'subjective', cn.subjective, 'objective', cn.objective,
               'analysis', cn.analysis, 'plan', cn.plan,
               'addenda', coalesce((
                 select jsonb_agg(jsonb_build_object('created_at', ad.created_at, 'body', ad.body)
                                  order by ad.created_at)
                 from public.clinical_note_addenda ad where ad.note_id = cn.id), '[]'::jsonb))
             order by cn.created_at)
      from public.clinical_notes cn where cn.patient_id = v_pid), '[]'::jsonb),
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

-- -----------------------------------------------------------------------------
-- last_clinical_act_at - start of the NOM-004 retention clock
-- -----------------------------------------------------------------------------
-- "Último acto médico" is approximated as the latest of: a completed
-- appointment that already happened, a clinical note (written or finalized),
-- an addendum, a prescription, or an uploaded clinical file.
-- -----------------------------------------------------------------------------
create or replace function public.last_clinical_act_at(p_patient_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select greatest(
    (select max(a.start_time) from public.appointments a
      where a.patient_id = p_patient_id and a.status = 'completed' and a.start_time <= now()),
    (select max(greatest(cn.created_at, cn.finalized_at)) from public.clinical_notes cn
      where cn.patient_id = p_patient_id),
    (select max(ad.created_at) from public.clinical_note_addenda ad
      join public.clinical_notes cn on cn.id = ad.note_id
      where cn.patient_id = p_patient_id),
    (select max(pr.created_at) from public.prescriptions pr
      where pr.patient_id = p_patient_id),
    (select max(pf.created_at) from public.patient_files pf
      where pf.patient_id = p_patient_id),
    (select max(o.created_at) from storage.objects o
      where o.bucket_id = 'clinical_records'
        and (storage.foldername(o.name))[1] = p_patient_id::text)
  );
$$;

revoke all on function public.last_clinical_act_at(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- anonymize_patient - staff-only answer to a cancellation request
-- -----------------------------------------------------------------------------
-- Refuses while the record is inside the retention period. Otherwise replaces
-- identifiers on the patient row and free-text administrative fields, keeps
-- clinical content, and returns how many storage files still exist so staff
-- can review them (scanned studies may carry the patient's name; they must be
-- reviewed and deleted from the Storage dashboard by hand).
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
    array['first_name', 'last_name', 'phone', 'email', 'dob', 'notes', 'referred_by',
          'status', 'appointments.cancel_reason']
  );

  return jsonb_build_object('anonymized_at', now(), 'files_to_review', v_files);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
revoke all on function public.submit_arco_request(text, text)        from public, anon, authenticated;
revoke all on function public.resolve_arco_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.export_my_data()                       from public, anon, authenticated;
revoke all on function public.anonymize_patient(uuid)                from public, anon, authenticated;

grant execute on function public.submit_arco_request(text, text)        to authenticated;
grant execute on function public.resolve_arco_request(uuid, text, text) to authenticated;
grant execute on function public.export_my_data()                       to authenticated;
grant execute on function public.anonymize_patient(uuid)                to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go assertion
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.submit_arco_request(text,text)',
    'public.resolve_arco_request(uuid,text,text)',
    'public.export_my_data()',
    'public.anonymize_patient(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'anon can execute %.', f using errcode = 'P0001';
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'authenticated cannot execute %: the portal / admin panel will fail.', f
        using errcode = 'P0001';
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.arco_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.arco_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.arco_requests', 'DELETE') then
    raise exception 'arco_requests is directly writable through the API.' using errcode = 'P0001';
  end if;

  if public.clinical_record_retention() < interval '5 years' then
    raise exception 'Retention is shorter than the NOM-004 minimum of 5 years.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 11 PASSED: ARCO RPCs installed, retention = %.', public.clinical_record_retention();
end $$;
