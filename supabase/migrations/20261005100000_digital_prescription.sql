-- =============================================================================
-- 25 - Digital official prescription (PDF) shared by WhatsApp
-- =============================================================================
-- Problem this file solves:
--   The doctor approved issuing OFFICIAL prescriptions as a PDF and sending
--   them to the patient by WhatsApp. Reglamento de Insumos para la Salud,
--   art. 29, requires the prescription to carry the prescriber's printed full
--   name, address and cédula profesional, the date and a signature. Until now
--   the app stored none of these, so it could only keep an informational
--   record of what was prescribed.
--
-- Design:
--   * public.prescriber_profile - the doctor's prescription data (full name,
--     cédula profesional, optional specialty and its cédula, institution that
--     issued the degree, practice address, phone, current signature path). A
--     NEW table, not more columns on clinic_settings, because:
--       - clinic_settings feeds public RPCs (get_clinic_schedule,
--         get_clinic_mode); keeping the prescriber's personal data in another
--         table means no present or future public RPC on clinic_settings can
--         leak it by accident;
--       - its own audit trigger records every change to the doctor's
--         identity data (column names only), which clinic_settings has not;
--       - its own RLS policy and grants can be checked in isolation by the
--         gate below.
--     Single row: singleton boolean, unique and always true, so the browser
--     upserts it (on conflict (singleton)) and a second row is impossible.
--     Access: RLS policy prescriber_profile_staff_all, is_staff() only (the
--     doctor). The admin (business staff) and patients cannot read it through
--     the API; anon has no privilege at all. No DELETE grant: the row is
--     corrected, never removed.
--   * prescriber_profile_guard() (BEFORE trigger): the server owns
--     updated_by (the caller), created_at and updated_at.
--   * Private Storage bucket prescriber_private: VERSIONED signatures. Each
--     saved signature is a new object 'signature-<id>.png' (letters, digits,
--     '_' and '-' only, no folders) and prescriber_profile.signature_path
--     points to the current one. Old files are kept, because an issued
--     prescription keeps pointing to the signature it was issued with.
--     public = false, PNG only, 256 KB cap. Two storage.objects policies, both
--     doctor-only (is_staff()): read (SELECT) and create (INSERT, only names
--     matching ^signature-[A-Za-z0-9_-]+\.png$). No UPDATE and no DELETE
--     policy: a saved signature can never be overwritten or removed. The
--     browser reads it with an authenticated download (never a public URL).
--   * Issue snapshot on public.prescriptions: an issued prescription must
--     not change when the doctor later edits her data or her signature. The
--     first time a FINALIZED prescription becomes a PDF, issue_prescription()
--     stores on the row:
--       - prescriber_snapshot (jsonb): the printed prescriber fields as they
--         were at that moment;
--       - signature_path: the signature version used;
--       - issued_at: when it was issued;
--       - folio: a sequential number from prescription_folio_seq (unique).
--     The call is idempotent: later calls return the stored snapshot. The PDF
--     is always rendered from it. Folios come from a sequence, so a failed or
--     rolled-back issue (e.g. the check script) can skip a number; they are
--     unique and increasing, not gapless.
--     prescriptions_issue_guard() (BEFORE trigger) makes these four columns
--     write-once and writable only inside issue_prescription(), which sets
--     the transaction-local flag app.issuing_prescription to the row id (the
--     same pattern as app.inventory_ledger in migration 16). The API cannot
--     set that flag. The existing integrity trigger keeps the medications of
--     a finalized prescription frozen and refuses its deletion.
--     The patient can read these columns of her own prescriptions
--     (prescriptions_select_own): they hold exactly what is printed on the
--     PDF she receives, plus the signature object name, which only the doctor
--     can download.
--   * log_prescription_shared(prescription_id, channel): the doctor records
--     how an ISSUED prescription left the app (share_sheet, whatsapp_link,
--     download or print). It writes an 'EXPORT' audit event on
--     'prescriptions' with the channel, the folio and the issue time as its
--     only "columns"; no clinical value and no personal data is logged. A
--     prescription that was never issued is refused.
--   * Medications get optional structured fields (presentacion, via,
--     frecuencia, duracion) inside prescriptions.medications (jsonb). No
--     table change; old rows stay valid and the frozen-prescription trigger
--     is unchanged.
--   * Controlled substances (Grupos I-III, art. 226 Ley General de Salud)
--     are out of scope: they need special prescription forms with a COFEPRIS
--     barcode and must never be prescribed with this PDF. The app says so on
--     screen; nothing in the database can detect them.
--
-- Idempotent and re-runnable. Does not redefine any earlier function.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prescriber_profile
-- -----------------------------------------------------------------------------
create table if not exists public.prescriber_profile (
  id                    uuid primary key default gen_random_uuid(),
  singleton             boolean not null default true,
  full_name             text,
  cedula_profesional    text,
  especialidad          text,
  cedula_especialidad   text,
  institucion_titulo    text,
  consultorio_domicilio text,
  telefono              text,
  signature_path        text,
  updated_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.prescriber_profile drop constraint if exists prescriber_profile_singleton_check;
alter table public.prescriber_profile add constraint prescriber_profile_singleton_check
  check (singleton);

alter table public.prescriber_profile drop constraint if exists prescriber_profile_singleton_key;
alter table public.prescriber_profile add constraint prescriber_profile_singleton_key
  unique (singleton);

-- Lengths match the form; the cédulas are the SEP's numeric registration
-- numbers; the signature is one versioned object of the private bucket.
alter table public.prescriber_profile drop constraint if exists prescriber_profile_values_check;
alter table public.prescriber_profile add constraint prescriber_profile_values_check
  check (
    (full_name is null or length(full_name) between 1 and 120)
    and (cedula_profesional is null or cedula_profesional ~ '^[0-9]{4,12}$')
    and (especialidad is null or length(especialidad) between 1 and 120)
    and (cedula_especialidad is null or cedula_especialidad ~ '^[0-9]{4,12}$')
    and (cedula_especialidad is null or especialidad is not null)
    and (institucion_titulo is null or length(institucion_titulo) between 1 and 200)
    and (consultorio_domicilio is null or length(consultorio_domicilio) between 1 and 300)
    and (telefono is null or telefono ~ '^[0-9 +()-]{7,20}$')
    and (signature_path is null or signature_path ~ '^signature-[A-Za-z0-9_-]+\.png$')
  );

comment on table public.prescriber_profile is
  'The doctor''s official prescription data (RIS art. 29) and current signature path. Single row. Doctor only; audited.';
comment on column public.prescriber_profile.signature_path is
  'Object name of the CURRENT drawn signature in the private bucket prescriber_private (signature-<id>.png). Older versions are kept.';

alter table public.prescriber_profile enable row level security;

revoke all on public.prescriber_profile from public, anon, authenticated;
grant select, insert, update on public.prescriber_profile to authenticated;

drop policy if exists "prescriber_profile_staff_all" on public.prescriber_profile;
create policy "prescriber_profile_staff_all"
  on public.prescriber_profile for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- -----------------------------------------------------------------------------
-- prescriber_profile_guard - server-owned fields
-- -----------------------------------------------------------------------------
create or replace function public.prescriber_profile_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.singleton := true;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.prescriber_profile_guard() from public, anon, authenticated, service_role;

drop trigger if exists prescriber_profile_guard on public.prescriber_profile;
create trigger prescriber_profile_guard
  before insert or update on public.prescriber_profile
  for each row execute function public.prescriber_profile_guard();

drop trigger if exists audit_row_change on public.prescriber_profile;
create trigger audit_row_change
  after insert or update or delete on public.prescriber_profile
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- Private bucket for the drawn signatures (versioned, never overwritten)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prescriber_private', 'prescriber_private', false, 262144, array['image/png'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = 262144,
      allowed_mime_types = array['image/png'];

-- Earlier draft of this migration had one FOR ALL policy (it allowed delete).
drop policy if exists "prescriber_private_staff_all" on storage.objects;

-- The doctor reads her signatures.
drop policy if exists "prescriber_private_staff_read" on storage.objects;
create policy "prescriber_private_staff_read"
  on storage.objects for select to authenticated
  using (bucket_id = 'prescriber_private' and public.is_staff());

-- The doctor creates new signature versions; no folders, no other names.
-- No UPDATE / DELETE policy: a saved version is never replaced or removed.
drop policy if exists "prescriber_private_staff_insert" on storage.objects;
create policy "prescriber_private_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'prescriber_private'
    and public.is_staff()
    and name ~ '^signature-[A-Za-z0-9_-]+\.png$'
  );

-- -----------------------------------------------------------------------------
-- Issue snapshot on prescriptions
-- -----------------------------------------------------------------------------
create sequence if not exists public.prescription_folio_seq
  as bigint minvalue 1 start with 1 no cycle;

revoke all on sequence public.prescription_folio_seq from public, anon, authenticated;

alter table public.prescriptions add column if not exists prescriber_snapshot jsonb;
alter table public.prescriptions add column if not exists signature_path      text;
alter table public.prescriptions add column if not exists issued_at           timestamptz;
alter table public.prescriptions add column if not exists folio               bigint;

alter table public.prescriptions drop constraint if exists prescriptions_folio_key;
alter table public.prescriptions add constraint prescriptions_folio_key unique (folio);

-- All four together, only on a finalized prescription.
alter table public.prescriptions drop constraint if exists prescriptions_issue_check;
alter table public.prescriptions add constraint prescriptions_issue_check
  check (
    (prescriber_snapshot is null and signature_path is null and issued_at is null and folio is null)
    or (
      prescriber_snapshot is not null
      and jsonb_typeof(prescriber_snapshot) = 'object'
      and signature_path ~ '^signature-[A-Za-z0-9_-]+\.png$'
      and issued_at is not null
      and folio > 0
      and finalized_at is not null
    )
  );

comment on column public.prescriptions.prescriber_snapshot is
  'Printed prescriber data at first issue (issue_prescription). Write-once; the PDF always renders from it.';
comment on column public.prescriptions.signature_path is
  'Signature version (prescriber_private object) used at first issue. Write-once.';
comment on column public.prescriptions.issued_at is
  'When the prescription was first issued as a PDF. Write-once.';
comment on column public.prescriptions.folio is
  'Sequential folio assigned at first issue (prescription_folio_seq). Unique, write-once.';

-- -----------------------------------------------------------------------------
-- prescriptions_issue_guard - the snapshot is written once, by the RPC only
-- -----------------------------------------------------------------------------
create or replace function public.prescriptions_issue_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.prescriber_snapshot is not null or new.signature_path is not null
       or new.issued_at is not null or new.folio is not null then
      raise exception 'La receta solo se emite desde el botón de la receta en PDF.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if (new.prescriber_snapshot, new.signature_path, new.issued_at, new.folio)
     is not distinct from
     (old.prescriber_snapshot, old.signature_path, old.issued_at, old.folio) then
    return new;
  end if;

  -- Write-once, and only inside issue_prescription() for this very row.
  if old.issued_at is not null
     or old.folio is not null
     or coalesce(current_setting('app.issuing_prescription', true), '') <> old.id::text then
    raise exception 'Una receta emitida no se puede modificar.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.prescriptions_issue_guard() from public, anon, authenticated, service_role;

drop trigger if exists prescriptions_issue_guard on public.prescriptions;
create trigger prescriptions_issue_guard
  before insert or update on public.prescriptions
  for each row execute function public.prescriptions_issue_guard();

-- -----------------------------------------------------------------------------
-- issue_prescription - first issue stores the snapshot; later calls return it
-- -----------------------------------------------------------------------------
create or replace function public.issue_prescription(p_prescription_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_rx       public.prescriptions;
  v_profile  public.prescriber_profile;
  v_snapshot jsonb;
  v_folio    bigint;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para emitir recetas.' using errcode = '42501';
  end if;

  -- Row lock: two taps at once get the same folio, never two.
  select * into v_rx
  from public.prescriptions pr
  where pr.id = p_prescription_id
  for update;

  if not found then
    raise exception 'No se encontró la receta.' using errcode = 'P0001';
  end if;

  if v_rx.finalized_at is null then
    raise exception 'Solo se puede emitir la receta de una consulta finalizada.' using errcode = 'P0001';
  end if;

  if v_rx.issued_at is null then
    if not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(v_rx.medications) = 'array' then v_rx.medications else '[]'::jsonb end
      ) m
      where length(btrim(coalesce(m ->> 'nombre', ''))) > 0
    ) then
      raise exception 'La receta no tiene medicamentos.' using errcode = 'P0001';
    end if;

    select * into v_profile from public.prescriber_profile limit 1;

    -- Same required items as the app (RIS art. 29). The hint lets the app
    -- show what is missing instead of a generic error.
    if v_profile.id is null
       or nullif(btrim(v_profile.full_name), '') is null
       or v_profile.cedula_profesional is null
       or nullif(btrim(v_profile.institucion_titulo), '') is null
       or nullif(btrim(v_profile.consultorio_domicilio), '') is null
       or v_profile.signature_path is null
       or not exists (
         select 1 from storage.objects o
         where o.bucket_id = 'prescriber_private' and o.name = v_profile.signature_path
       ) then
      raise exception 'Faltan datos de la receta.'
        using errcode = 'P0001', hint = 'prescriber_incomplete';
    end if;

    v_snapshot := jsonb_build_object(
      'full_name',             v_profile.full_name,
      'cedula_profesional',    v_profile.cedula_profesional,
      'especialidad',          v_profile.especialidad,
      'cedula_especialidad',   v_profile.cedula_especialidad,
      'institucion_titulo',    v_profile.institucion_titulo,
      'consultorio_domicilio', v_profile.consultorio_domicilio,
      'telefono',              v_profile.telefono
    );
    v_folio := nextval('public.prescription_folio_seq');

    perform set_config('app.issuing_prescription', v_rx.id::text, true);
    update public.prescriptions
       set prescriber_snapshot = v_snapshot,
           signature_path      = v_profile.signature_path,
           issued_at           = now(),
           folio               = v_folio
     where id = v_rx.id
    returning * into v_rx;
    perform set_config('app.issuing_prescription', '', true);
  end if;

  return jsonb_build_object(
    'prescription_id', v_rx.id,
    'folio',           v_rx.folio,
    'issued_at',       v_rx.issued_at,
    'signature_path',  v_rx.signature_path,
    'prescriber',      v_rx.prescriber_snapshot
  );
end;
$$;

comment on function public.issue_prescription(uuid) is
  'Doctor only: issues a finalized prescription (first call stores the prescriber snapshot, signature version, issued_at and folio; later calls return them unchanged).';

revoke all on function public.issue_prescription(uuid) from public, anon, authenticated;
grant execute on function public.issue_prescription(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- log_prescription_shared - audit "the issued prescription left the app"
-- -----------------------------------------------------------------------------
create or replace function public.log_prescription_shared(
  p_prescription_id uuid,
  p_channel         text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_patient   uuid;
  v_finalized timestamptz;
  v_issued    timestamptz;
  v_folio     bigint;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para enviar recetas.' using errcode = '42501';
  end if;

  if p_channel is null or p_channel not in ('share_sheet', 'whatsapp_link', 'download', 'print') then
    raise exception 'Forma de envío de la receta no válida.' using errcode = 'P0001';
  end if;

  select pr.patient_id, pr.finalized_at, pr.issued_at, pr.folio
    into v_patient, v_finalized, v_issued, v_folio
  from public.prescriptions pr
  where pr.id = p_prescription_id;

  if not found then
    raise exception 'No se encontró la receta.' using errcode = 'P0001';
  end if;

  if v_finalized is null then
    raise exception 'Solo se puede emitir la receta de una consulta finalizada.' using errcode = 'P0001';
  end if;

  if v_issued is null then
    raise exception 'La receta todavía no se ha emitido.' using errcode = 'P0001';
  end if;

  -- Channel, folio and issue time only: no medication, dose or name.
  perform public.write_audit_event(
    'EXPORT', 'prescriptions', p_prescription_id, v_patient,
    array[
      p_channel,
      'folio:' || lpad(v_folio::text, greatest(6, length(v_folio::text)), '0'),
      'issued_at:' || to_char(v_issued at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ]
  );
end;
$$;

comment on function public.log_prescription_shared(uuid, text) is
  'Doctor only: audits how an issued prescription left the app (share_sheet, whatsapp_link, download or print), with its folio and issue time. Logs no clinical or personal value.';

revoke all on function public.log_prescription_shared(uuid, text) from public, anon, authenticated;
grant execute on function public.log_prescription_shared(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  c        text;
  v_priv   text;
  v_bad    text;
  v_src    text;
  v_state  text;
  v_public boolean;
  v_limit  bigint;
  v_types  text[];
  v_rx     uuid;
  v_folio  bigint;
begin
  -- 1. prescriber_profile: RLS on, the only policy is doctor-only, grants.
  if not exists (
    select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relname = 'prescriber_profile' and cl.relrowsecurity
  ) then
    raise exception 'Migration 25 FAILED: prescriber_profile is missing or RLS is off.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'prescriber_profile'
      and policyname = 'prescriber_profile_staff_all' and cmd = 'ALL'
      and qual ~ '\mis_staff\(' and qual !~ 'is_business_staff'
      and with_check ~ '\mis_staff\(' and with_check !~ 'is_business_staff'
  ) then
    raise exception 'Migration 25 FAILED: policy prescriber_profile_staff_all is missing or not doctor-only.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'prescriber_profile'
      and policyname <> 'prescriber_profile_staff_all'
  ) then
    raise exception 'Migration 25 FAILED: prescriber_profile has an unexpected policy.' using errcode = 'P0001';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.prescriber_profile', v_priv) then
      raise exception 'Migration 25 FAILED: anon holds % on prescriber_profile.', v_priv using errcode = 'P0001';
    end if;
  end loop;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE'] loop
    if not has_table_privilege('authenticated', 'public.prescriber_profile', v_priv) then
      raise exception 'Migration 25 FAILED: authenticated lacks % on prescriber_profile (RLS decides who).', v_priv
        using errcode = 'P0001';
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.prescriber_profile', 'DELETE') then
    raise exception 'Migration 25 FAILED: authenticated can DELETE prescriber_profile.' using errcode = 'P0001';
  end if;

  -- 2. Constraints and triggers.
  foreach c in array array[
    'prescriber_profile_singleton_check', 'prescriber_profile_singleton_key',
    'prescriber_profile_values_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.prescriber_profile'::regclass and conname = c and convalidated
    ) then
      raise exception 'Migration 25 FAILED: constraint % is missing on prescriber_profile.', c using errcode = 'P0001';
    end if;
  end loop;

  foreach c in array array['prescriptions_folio_key', 'prescriptions_issue_check'] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.prescriptions'::regclass and conname = c and convalidated
    ) then
      raise exception 'Migration 25 FAILED: constraint % is missing on prescriptions.', c using errcode = 'P0001';
    end if;
  end loop;

  foreach c in array array['audit_row_change', 'prescriber_profile_guard'] loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = 'public.prescriber_profile'::regclass and tg.tgname = c
        and not tg.tgisinternal and tg.tgenabled <> 'D'
    ) then
      raise exception 'Migration 25 FAILED: trigger % is missing or disabled on prescriber_profile.', c
        using errcode = 'P0001';
    end if;
  end loop;

  foreach c in array array['prescriptions_issue_guard', 'prescriptions_enforce_integrity', 'audit_row_change'] loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = 'public.prescriptions'::regclass and tg.tgname = c
        and not tg.tgisinternal and tg.tgenabled <> 'D'
    ) then
      raise exception 'Migration 25 FAILED: trigger % is missing or disabled on prescriptions.', c
        using errcode = 'P0001';
    end if;
  end loop;

  foreach c in array array['public.prescriber_profile_guard()', 'public.prescriptions_issue_guard()'] loop
    if not exists (
      select 1 from pg_proc
      where oid = c::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 25 FAILED: % is not SECURITY DEFINER with a pinned search_path.', c
        using errcode = 'P0001';
    end if;
    foreach v_priv in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_priv, c, 'execute') then
        raise exception 'Migration 25 FAILED: % can execute %.', v_priv, c using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  select prosrc into v_src from pg_proc where oid = 'public.prescriptions_issue_guard()'::regprocedure;
  if v_src !~ 'app\.issuing_prescription' or v_src !~ 'old\.issued_at is not null' then
    raise exception 'Migration 25 FAILED: prescriptions_issue_guard() must make the snapshot write-once and RPC-only.'
      using errcode = 'P0001';
  end if;

  -- 3. The folio sequence is not usable through the API.
  if to_regclass('public.prescription_folio_seq') is null then
    raise exception 'Migration 25 FAILED: sequence prescription_folio_seq is missing.' using errcode = 'P0001';
  end if;
  foreach c in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['USAGE', 'UPDATE', 'SELECT'] loop
      if has_sequence_privilege(c, 'public.prescription_folio_seq', v_priv) then
        raise exception 'Migration 25 FAILED: % holds % on prescription_folio_seq.', c, v_priv using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- 4. The signature bucket is private, PNG only, 256 KB.
  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_public, v_limit, v_types
  from storage.buckets b
  where b.id = 'prescriber_private';

  if not found then
    raise exception 'Migration 25 FAILED: bucket prescriber_private does not exist.' using errcode = 'P0001';
  end if;

  if v_public is distinct from false
     or v_limit is distinct from 262144
     or v_types is distinct from array['image/png'] then
    raise exception 'Migration 25 FAILED: bucket prescriber_private must be private, PNG only, 256 KB (public=%, limit=%, types=%).',
      v_public, v_limit, v_types using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'prescriber_private_staff_read' and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
      and qual ~ 'prescriber_private' and qual ~ '\mis_staff\(' and qual !~ 'is_business_staff'
  ) then
    raise exception 'Migration 25 FAILED: storage policy prescriber_private_staff_read is missing or not doctor-only.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'prescriber_private_staff_insert' and cmd = 'INSERT'
      and roles = array['authenticated']::name[]
      and with_check ~ 'prescriber_private' and with_check ~ '\mis_staff\('
      and with_check !~ 'is_business_staff'
      and position('^signature-[A-Za-z0-9_-]+\.png$' in with_check) > 0
  ) then
    raise exception 'Migration 25 FAILED: storage policy prescriber_private_staff_insert is missing, not doctor-only or not limited to signature-<id>.png.'
      using errcode = 'P0001';
  end if;

  -- Only those two: no UPDATE, DELETE or ALL policy may touch the bucket.
  select string_agg(policyname, ', ')
    into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname not in ('prescriber_private_staff_read', 'prescriber_private_staff_insert')
    and (coalesce(qual, '') ~ 'prescriber_private' or coalesce(with_check, '') ~ 'prescriber_private');
  if v_bad is not null then
    raise exception 'Migration 25 FAILED: other storage policies mention prescriber_private: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- A storage policy whose USING (read/update/delete) or WITH CHECK
  -- (insert/update) does not name a bucket would open the signature too.
  -- An UPDATE / ALL policy without WITH CHECK reuses USING for new rows.
  select string_agg(policyname, ', ')
    into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (
      (cmd in ('SELECT', 'UPDATE', 'DELETE', 'ALL') and coalesce(qual, '') !~ 'bucket_id')
      or (cmd in ('INSERT', 'UPDATE', 'ALL') and coalesce(with_check, qual, '') !~ 'bucket_id')
    );
  if v_bad is not null then
    raise exception 'Migration 25 FAILED: storage.objects policies without a bucket condition: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 5. issue_prescription and log_prescription_shared: definer, pinned,
  --    doctor-only, finalized / issued only.
  foreach c in array array['public.issue_prescription(uuid)', 'public.log_prescription_shared(uuid,text)'] loop
    if not exists (
      select 1 from pg_proc
      where oid = c::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 25 FAILED: % is not SECURITY DEFINER with a pinned search_path.', c
        using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', c, 'execute')
       or not has_function_privilege('authenticated', c, 'execute') then
      raise exception 'Migration 25 FAILED: % must be executable by authenticated only.', c
        using errcode = 'P0001';
    end if;
  end loop;

  select prosrc into v_src from pg_proc where oid = 'public.issue_prescription(uuid)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src !~ 'finalized_at is null' or v_src !~ 'for update'
     or v_src !~ 'prescription_folio_seq' or v_src !~ 'issued_at is null' then
    raise exception 'Migration 25 FAILED: issue_prescription() must check is_staff(), refuse drafts, lock the row and issue only once.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.log_prescription_shared(uuid,text)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src !~ 'v_finalized is null' or v_src !~ 'v_issued is null'
     or v_src !~ 'write_audit_event' then
    raise exception 'Migration 25 FAILED: log_prescription_shared() must check is_staff(), refuse drafts and unissued prescriptions and write an audit event.'
      using errcode = 'P0001';
  end if;

  -- 6. Behavior, inside a sub-transaction that is always rolled back.
  begin
    -- No request context here: is_staff() is false, so the RPCs refuse.
    foreach c in array array['issue', 'log'] loop
      v_state := null;
      begin
        if c = 'issue' then
          perform public.issue_prescription(gen_random_uuid());
        else
          perform public.log_prescription_shared(gen_random_uuid(), 'print');
        end if;
      exception when insufficient_privilege then v_state := '42501';
      end;
      if v_state is distinct from '42501' then
        raise exception 'Migration 25 FAILED: % RPC did not refuse a caller who is not the doctor.', c
          using errcode = 'P0001';
      end if;
    end loop;

    -- Start from no row, so the single-row and value checks are exercised.
    delete from public.prescriber_profile where id is not null;

    insert into public.prescriber_profile (full_name, cedula_profesional)
    values ('MIGRATION-25-GATE', '1234567');

    v_state := null;
    begin
      insert into public.prescriber_profile (full_name) values ('MIGRATION-25-GATE second');
    exception when unique_violation then v_state := '23505';
    end;
    if v_state is distinct from '23505' then
      raise exception 'Migration 25 FAILED: a second prescriber_profile row was accepted.' using errcode = 'P0001';
    end if;

    foreach c in array array['cedula', 'signature folder', 'signature old name', 'cedula especialidad sin especialidad'] loop
      v_state := null;
      begin
        if c = 'cedula' then
          update public.prescriber_profile set cedula_profesional = '12A4567' where id is not null;
        elsif c = 'signature folder' then
          update public.prescriber_profile set signature_path = 'other/signature-a.png' where id is not null;
        elsif c = 'signature old name' then
          update public.prescriber_profile set signature_path = 'signature.png' where id is not null;
        else
          update public.prescriber_profile set cedula_especialidad = '7654321', especialidad = null where id is not null;
        end if;
      exception when check_violation then v_state := '23514';
      end;
      if v_state is distinct from '23514' then
        raise exception 'Migration 25 FAILED: an invalid prescriber value (%) was accepted.', c using errcode = 'P0001';
      end if;
    end loop;

    -- The snapshot columns: refused on insert, refused outside the RPC,
    -- write-once inside it. A throwaway finalized prescription with no
    -- appointment and no patient; the folio is far above any real one, so
    -- the sequence is never consumed here.
    -- Live databases enforce NOT NULL on appointment_id/patient_id. Relax it
    -- only inside this sub-transaction (DDL is transactional and is undone
    -- by the rollback below), so the probe needs no real patient or
    -- appointment and fires no appointment trigger.
    alter table public.prescriptions
      alter column appointment_id drop not null,
      alter column patient_id drop not null;

    v_state := null;
    begin
      insert into public.prescriptions (medications, folio) values ('[]'::jsonb, 1);
    exception when insufficient_privilege then v_state := '42501';
    end;
    if v_state is distinct from '42501' then
      raise exception 'Migration 25 FAILED: a prescription was inserted with a folio.' using errcode = 'P0001';
    end if;

    insert into public.prescriptions (medications)
    values (jsonb_build_array(jsonb_build_object('nombre', 'MIGRATION-25-GATE', 'dosis', '1')))
    returning id into v_rx;
    update public.prescriptions set finalized_at = now() where id = v_rx;
    select coalesce(max(folio), 0) + 1000000000 into v_folio from public.prescriptions;

    v_state := null;
    begin
      update public.prescriptions
         set prescriber_snapshot = '{}'::jsonb, signature_path = 'signature-gate.png',
             issued_at = now(), folio = v_folio
       where id = v_rx;
    exception when insufficient_privilege then v_state := '42501';
    end;
    if v_state is distinct from '42501' then
      raise exception 'Migration 25 FAILED: the issue snapshot was written outside issue_prescription().' using errcode = 'P0001';
    end if;

    perform set_config('app.issuing_prescription', v_rx::text, true);
    update public.prescriptions
       set prescriber_snapshot = '{}'::jsonb, signature_path = 'signature-gate.png',
           issued_at = now(), folio = v_folio
     where id = v_rx;

    v_state := null;
    begin
      update public.prescriptions set folio = v_folio + 1 where id = v_rx;
    exception when insufficient_privilege then v_state := '42501';
    end;
    perform set_config('app.issuing_prescription', '', true);
    if v_state is distinct from '42501' then
      raise exception 'Migration 25 FAILED: an issued prescription''s snapshot was changed.' using errcode = 'P0001';
    end if;

    raise exception using errcode = 'P0001', message = 'MIGRATION_25_GATE_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MIGRATION_25_GATE_ROLLBACK' then
      raise;
    end if;
  end;

  raise notice 'Migration 25 PASSED: prescriber_profile is a single doctor-only row (RLS is_staff(), no delete), value-checked and audited; the signature bucket prescriber_private is private, PNG only, 256 KB, doctor-only, insert/read only and limited to signature-<id>.png; issued prescriptions keep a write-once snapshot (prescriber data, signature version, issued_at, unique folio) written only by issue_prescription(); log_prescription_shared() is doctor-only, refuses unissued prescriptions and audits channel, folio and issue time only.';
end $$;
