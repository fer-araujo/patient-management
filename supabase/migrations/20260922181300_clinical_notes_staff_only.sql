-- =============================================================================
-- 14 - Clinical notes are staff-only
-- =============================================================================
-- A SOAP note (symptoms, examination, diagnosis, plan) and its addenda are the
-- doctor's working record. Under NOM-004-SSA3-2012 (5.5) the clinical record
-- belongs to the provider and the patient is entitled to a clinical SUMMARY
-- prepared by the doctor on request, not to the raw notes.
--
-- Until now a patient could read their own notes two ways:
--   1. RLS policies clinical_notes_select_own / clinical_note_addenda_select_own
--      let a patient session SELECT them directly through the API.
--   2. export_my_data() included them in the "Mis datos" download.
-- Both are closed here. The patient portal never read these tables, so no
-- screen changes. A patient asks for their clinical summary through the
-- existing ARCO request form (request_type 'access'); the doctor answers it.
--
-- Prescriptions stay readable by the patient: the portal shows them in
-- "Mi Receta" with the "no es receta oficial" notice.
-- =============================================================================

drop policy if exists "clinical_notes_select_own" on public.clinical_notes;
drop policy if exists "clinical_note_addenda_select_own" on public.clinical_note_addenda;

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

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('clinical_notes', 'clinical_note_addenda')
      and not (coalesce(qual, '') ilike '%is_staff()%'
               or coalesce(with_check, '') ilike '%is_staff()%')
  ) then
    raise exception 'A non-staff policy still exists on clinical_notes or clinical_note_addenda.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'export_my_data'
      and p.prosrc ilike '%''clinical_notes''%'
  ) then
    raise exception 'export_my_data() still exports clinical notes.'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.export_my_data()', 'execute') then
    raise exception 'export_my_data() must not be executable by anon.'
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 14 PASSED: clinical notes and addenda are staff-only; the patient export no longer includes them.';
end $$;
