-- =============================================================================
-- 12 - Clinical upload limits and file registration (Phase 2)
-- =============================================================================
-- 1. Server-side limits on the clinical_records bucket: 10 MB per object and
--    only PDF, JPEG, PNG and HEIC. The browser validates the same rules first
--    (src/lib/files/clinicalUploadRules.ts) so the patient gets a clear Spanish
--    message, but the bucket setting is what actually enforces them. Existing
--    objects are not affected.
--
-- 2. public.register_my_upload(): until now uploads only created a Storage
--    object and never a public.patient_files row, so the audit trigger on
--    patient_files (migration 08) would never fire and uploads would be
--    invisible in the audit trail. Staff insert patient_files directly (their
--    RLS policy allows it); patients have no direct write access to any table,
--    so they register their upload through this SECURITY DEFINER RPC, which
--    verifies the object really exists inside their own folder.
--
-- Idempotent and re-runnable.
-- =============================================================================

update storage.buckets
   set file_size_limit    = 10485760,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/heic']
 where id = 'clinical_records';

-- -----------------------------------------------------------------------------
-- register_my_upload
-- -----------------------------------------------------------------------------
create or replace function public.register_my_upload(
  p_object_name text,
  p_file_name   text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient_id uuid := public.current_patient_id();
  v_mime       text;
  v_id         uuid;
begin
  if v_patient_id is null then
    raise exception 'No encontramos un expediente clínico vinculado a tu cuenta.'
      using errcode = 'P0001';
  end if;

  select o.metadata ->> 'mimetype'
    into v_mime
  from storage.objects o
  where o.bucket_id = 'clinical_records'
    and o.name = p_object_name
    and (storage.foldername(o.name))[1] = v_patient_id::text;

  if not found then
    raise exception 'No se encontró el archivo subido.' using errcode = 'P0001';
  end if;

  select pf.id into v_id
  from public.patient_files pf
  where pf.patient_id = v_patient_id
    and pf.file_url = p_object_name;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.patient_files (patient_id, file_url, file_name, file_type, uploaded_by)
  values (
    v_patient_id,
    p_object_name,
    left(coalesce(nullif(btrim(coalesce(p_file_name, '')), ''), p_object_name), 255),
    v_mime,
    'patient'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_my_upload(text, text) from public, anon, authenticated;
grant execute on function public.register_my_upload(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go assertion
-- -----------------------------------------------------------------------------
do $$
declare
  v_limit bigint;
  v_types text[];
begin
  select b.file_size_limit, b.allowed_mime_types
    into v_limit, v_types
  from storage.buckets b
  where b.id = 'clinical_records';

  if not found then
    raise exception 'Bucket clinical_records does not exist.' using errcode = 'P0001';
  end if;

  if v_limit is distinct from 10485760 then
    raise exception 'clinical_records file_size_limit is %, expected 10485760 (10 MB).', v_limit
      using errcode = 'P0001';
  end if;

  if v_types is null
     or not (v_types @> array['application/pdf', 'image/jpeg', 'image/png', 'image/heic'])
     or array_length(v_types, 1) <> 4 then
    raise exception 'clinical_records allowed_mime_types is %, expected exactly PDF, JPEG, PNG and HEIC.', v_types
      using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.register_my_upload(text,text)', 'execute') then
    raise exception 'anon can execute register_my_upload.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 12 PASSED: clinical_records limited to 10 MB and PDF/JPEG/PNG/HEIC.';
end $$;
