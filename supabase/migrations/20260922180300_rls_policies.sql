-- =============================================================================
-- 04 - Row Level Security rewrite
-- =============================================================================
-- Replaces the permissive "Acceso total a usuarios autenticados" style policies
-- (USING (true) WITH CHECK (true) for role authenticated) with least-privilege
-- ones.
--
-- Before this file, ANY authenticated session - including a patient who signed
-- in with a phone OTP - could read and write every other patient's clinical
-- record and could promote their own profiles.role to 'doctor'.
--
-- PRECONDITION: migration 03 (role bootstrap) must already have run and at
-- least one profile must hold role 'doctor' or 'admin'. From this file onward
-- every clinical table is staff-only; applying it with no staff account is a
-- self-lockout. The assertion at the end of migration 03 is the gate.
--
-- The old policies are removed with a catalog-driven DO block rather than a
-- hand-written list of DROP POLICY statements: the deployed names are not fully
-- known from the repo, and dropping whatever is present makes this file both
-- exhaustive and re-runnable. Only the tables named below are touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Wipe existing policies on the managed tables
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  managed text[] := array[
    'patients', 'profiles', 'services', 'inventory', 'appointments',
    'blocked_slots', 'patient_files', 'prescriptions', 'clinical_notes',
    'clinic_settings'
  ];
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = any (managed)
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Storage is shared with other buckets, so only policies that mention the
-- clinical_records bucket are removed.
do $$
declare
  r record;
begin
  for r in
    select policyname, qual, with_check
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
  loop
    if coalesce(r.qual, '') ilike '%clinical_records%'
       or coalesce(r.with_check, '') ilike '%clinical_records%'
       or r.policyname ilike '%clinical_records%'
       or r.policyname ilike 'Acceso total%'
    then
      execute format('drop policy %I on storage.objects', r.policyname);
    end if;
  end loop;
end $$;

-- =============================================================================
-- profiles
-- =============================================================================
-- Read own row; staff read everything. No client INSERT at all - rows are
-- created by the on_auth_user_created trigger (migration 03) running as the
-- definer, which bypasses RLS.
-- -----------------------------------------------------------------------------
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = auth.uid());

create policy "profiles_select_staff"
  on public.profiles for select to authenticated
  using (public.is_staff());

-- A user may edit their own display fields. The role column is protected by the
-- profiles_block_role_escalation trigger below, not by this policy, because a
-- WITH CHECK subquery against the same table cannot reliably compare the old
-- and new role within one statement.
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles_update_staff"
  on public.profiles for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- The trigger only enforces inside a real end-user request context.
--
-- PostgREST sets request.jwt.claims for every API request it serves, including
-- anonymous ones (the Supabase anon key is itself a signed JWT), so any call
-- that can reach this table over the REST API carries claims and IS checked.
-- When the setting is absent or empty there is no request at all: the SQL
-- editor, a migration, psql, a direct admin connection. Those already hold
-- database-owner privileges and could drop this trigger outright, so blocking
-- them buys nothing and costs a great deal - it is exactly what aborted the
-- doctor promotion when the bootstrap ran after this file.
--
-- Deliberately NOT keyed on `auth.uid() is null`: anon also has a null uid, and
-- that test would wave through precisely the caller this trigger exists to
-- stop. The discriminator is the presence of request JWT claims, not identity.
create or replace function public.profiles_block_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- No request context -> not an end-user statement -> not this trigger's job.
  if v_claims is null or v_claims = 'null' then
    return new;
  end if;

  if not public.is_staff() then
    raise exception 'No tienes permisos para modificar el rol de una cuenta.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_block_role_escalation on public.profiles;
create trigger profiles_block_role_escalation
  before update on public.profiles
  for each row execute function public.profiles_block_role_escalation();

-- =============================================================================
-- patients
-- =============================================================================
-- Staff: full access. Patient: read their own record only. Writes for the
-- public booking flow go through public.request_appointment (migration 06),
-- which is SECURITY DEFINER and therefore not subject to these policies.
-- -----------------------------------------------------------------------------
create policy "patients_staff_all"
  on public.patients for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "patients_select_own"
  on public.patients for select to authenticated
  using (id = public.current_patient_id());

-- =============================================================================
-- appointments
-- =============================================================================
create policy "appointments_staff_all"
  on public.appointments for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "appointments_select_own"
  on public.appointments for select to authenticated
  using (patient_id = public.current_patient_id());

-- =============================================================================
-- clinical_notes / prescriptions / patient_files
-- =============================================================================
-- Read-only for the owning patient, full access for staff.
-- -----------------------------------------------------------------------------
create policy "clinical_notes_staff_all"
  on public.clinical_notes for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "clinical_notes_select_own"
  on public.clinical_notes for select to authenticated
  using (patient_id = public.current_patient_id());

create policy "prescriptions_staff_all"
  on public.prescriptions for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "prescriptions_select_own"
  on public.prescriptions for select to authenticated
  using (patient_id = public.current_patient_id());

create policy "patient_files_staff_all"
  on public.patient_files for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "patient_files_select_own"
  on public.patient_files for select to authenticated
  using (patient_id = public.current_patient_id());

-- =============================================================================
-- services
-- =============================================================================
-- The catalog is the one genuinely public table: the booking screen lists
-- active services before anyone signs in.
-- -----------------------------------------------------------------------------
create policy "services_select_active_public"
  on public.services for select to anon, authenticated
  using (is_active = true);

create policy "services_staff_all"
  on public.services for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- =============================================================================
-- inventory / clinic_settings / blocked_slots
-- =============================================================================
-- Staff only, for reads as well as writes. Public booking screens never touch
-- these tables directly any more; they call public.get_availability() and
-- public.get_clinic_schedule() (migration 06), which expose the minimum needed
-- to render a calendar and nothing else.
-- -----------------------------------------------------------------------------
create policy "inventory_staff_all"
  on public.inventory for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "clinic_settings_staff_all"
  on public.clinic_settings for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "blocked_slots_staff_all"
  on public.blocked_slots for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- =============================================================================
-- storage.objects - bucket clinical_records
-- =============================================================================
-- Staff: full access. Patient: read only, and only inside the folder named
-- after their own patients.id. Uploads are staff-only by design; see the
-- commented policy at the end of this block to re-enable patient uploads.
-- -----------------------------------------------------------------------------
create policy "clinical_records_staff_all"
  on storage.objects for all to authenticated
  using (bucket_id = 'clinical_records' and public.is_staff())
  with check (bucket_id = 'clinical_records' and public.is_staff());

create policy "clinical_records_patient_read_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'clinical_records'
    and public.current_patient_id() is not null
    and (storage.foldername(name))[1] = public.current_patient_id()::text
  );

-- Patients upload their own lab results from the portal ("Subir laboratorios"),
-- so they may INSERT into their own folder only. No UPDATE or DELETE: under
-- NOM-004 an uploaded clinical document is part of the record and must not be
-- silently removed by the patient.
create policy "clinical_records_patient_upload_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'clinical_records'
    and public.current_patient_id() is not null
    and (storage.foldername(name))[1] = public.current_patient_id()::text
  );
