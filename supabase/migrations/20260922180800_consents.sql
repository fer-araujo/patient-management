-- =============================================================================
-- 09 - Privacy notice consent record (Phase 2)
-- =============================================================================
-- LFPDPPP 2025, art. 8: health data is sensitive, and processing it requires
-- the titular's EXPRESS and WRITTEN consent "a través de su firma autógrafa,
-- firma electrónica, o cualquier mecanismo de autenticación". Until now the
-- registration checkbox was enforced only in the browser and nothing was
-- stored, so the clinic could not prove that any patient ever consented.
--
-- This file:
--   1. Creates public.consents - append-only evidence of which notice version a
--      patient accepted, when, and from which browser (user agent).
--   2. Replaces public.request_appointment with a version that REQUIRES the
--      privacy notice version and records the consent in the same transaction
--      as the patient and appointment rows. Either all three rows exist or none.
--
-- >>> SIGNATURE CHANGE <<<
-- CREATE OR REPLACE with a different argument list does not replace a function
-- in Postgres, it creates a second overload. The old 8-argument version would
-- stay callable by anon and bypass consent entirely, so it is dropped
-- explicitly below and the grants are re-issued for the new signature.
-- Deploy the frontend that sends p_privacy_notice_version together with this
-- file: an old bundle calling the 8-argument form will get "function not found"
-- until the browser reloads.
--
-- >>> VERSION STRING <<<
-- public.privacy_notice_version() must return exactly the value of
-- PRIVACY_NOTICE_VERSION in src/lib/legal/privacyNotice.ts. When the notice
-- text changes, bump BOTH in the same release.
--
-- Known limitation (see docs/compliance.md): the anonymous booking flow does
-- not verify the phone number before this RPC runs, so the stored consent is
-- tied to a phone the visitor typed, not to an authenticated identity. The
-- clinic should additionally obtain a signed consent at the first visit.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Current privacy notice version (single source of truth on the server)
-- -----------------------------------------------------------------------------
create or replace function public.privacy_notice_version()
returns text
language sql
immutable
set search_path = pg_temp
as $$ select '2026-09-23' $$;

revoke all on function public.privacy_notice_version() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- consents
-- -----------------------------------------------------------------------------
create table if not exists public.consents (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid not null references public.patients (id) on delete restrict,
  document     text not null,
  version      text not null,
  accepted_at  timestamptz not null default now(),
  user_agent   text
);

create index if not exists consents_patient_idx on public.consents (patient_id, accepted_at desc);

comment on table public.consents is
  'Append-only evidence of privacy notice acceptance. Written only by SECURITY DEFINER RPCs.';

alter table public.consents enable row level security;

revoke all on public.consents from public, anon, authenticated, service_role;
grant select on public.consents to authenticated;

drop policy if exists "consents_select_staff" on public.consents;
create policy "consents_select_staff"
  on public.consents for select to authenticated
  using (public.is_staff());

drop policy if exists "consents_select_own" on public.consents;
create policy "consents_select_own"
  on public.consents for select to authenticated
  using (patient_id = public.current_patient_id());

drop trigger if exists consents_block_update_delete on public.consents;
create trigger consents_block_update_delete
  before update or delete on public.consents
  for each row execute function public.reject_append_only_mutation();

drop trigger if exists consents_block_truncate on public.consents;
create trigger consents_block_truncate
  before truncate on public.consents
  for each statement execute function public.reject_append_only_mutation();

drop trigger if exists audit_row_change on public.consents;
create trigger audit_row_change
  after insert on public.consents
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- request_appointment - drop the consent-less overload
-- -----------------------------------------------------------------------------
drop function if exists public.request_appointment(text, text, text, text, uuid, timestamptz, text, text);

-- -----------------------------------------------------------------------------
-- request_appointment - anonymous booking, now with consent
-- -----------------------------------------------------------------------------
-- Identical to migration 06 except for the two new trailing parameters, the
-- consent validation, and the consents insert at the end. The comments on the
-- booking critical section and abuse ceilings in migration 06 still apply.
-- -----------------------------------------------------------------------------
create or replace function public.request_appointment(
  p_phone                  text,
  p_first_name             text,
  p_last_name              text,
  p_email                  text,
  p_service_id             uuid,
  p_start_time             timestamptz,
  p_reason                 text,
  p_referred_by            text,
  p_privacy_notice_version text,
  p_user_agent             text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone          text;
  v_duration       integer;
  v_patient_id     uuid;
  v_pending_count  integer;
  v_appointment_id uuid;
  v_reason         text;
begin
  -- Serialize the whole check-and-insert against every other booking path.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  -- Consent gate. Validated against the server's notice version so the stored
  -- evidence always names a document that actually existed.
  if nullif(btrim(coalesce(p_privacy_notice_version, '')), '') is null then
    raise exception 'Debes leer y aceptar el Aviso de Privacidad para continuar.'
      using errcode = 'P0001';
  end if;

  if p_privacy_notice_version <> public.privacy_notice_version() then
    raise exception 'El Aviso de Privacidad se actualizó. Recarga la página, léelo de nuevo y vuelve a aceptarlo.'
      using errcode = 'P0001';
  end if;

  v_phone := public.normalize_phone(p_phone);

  if v_phone is null or length(v_phone) < 10 then
    raise exception 'El número de teléfono no es válido.' using errcode = 'P0001';
  end if;

  v_duration := public.service_duration_or_fail(p_service_id);

  perform public.assert_public_booking_capacity();

  select p.id
    into v_patient_id
  from public.patients p
  where public.normalize_phone(p.phone) = v_phone
  order by p.created_at asc nulls last
  limit 1;

  select count(*)
    into v_pending_count
  from public.appointments a
  where a.patient_id = v_patient_id
    and a.status = 'pending';

  if v_pending_count >= public.booking_limit_pending_per_patient() then
    raise exception 'Tienes demasiadas solicitudes de cita pendientes de confirmación. Comunícate por teléfono con la clínica.'
      using errcode = 'P0001';
  end if;

  perform public.assert_slot_free(p_start_time, v_duration);

  if v_patient_id is null then
    perform public.assert_new_patient_quota();

    v_reason := nullif(btrim(coalesce(p_reason, '')), '');

    insert into public.patients (
      first_name, last_name, phone, email, status, referred_by, notes
    )
    values (
      coalesce(nullif(btrim(coalesce(p_first_name, '')), ''), 'Paciente'),
      coalesce(nullif(btrim(coalesce(p_last_name, '')), ''), 'Sin apellido'),
      public.format_phone_e164(v_phone),
      nullif(btrim(coalesce(p_email, '')), ''),
      'active',
      nullif(btrim(coalesce(p_referred_by, '')), ''),
      case when v_reason is not null then 'Motivo inicial: ' || v_reason else null end
    )
    returning id into v_patient_id;
  end if;

  insert into public.appointments (patient_id, service_id, start_time, status)
  values (v_patient_id, p_service_id, p_start_time, 'pending')
  returning id into v_appointment_id;

  -- Consent evidence, atomically with the rows above. Recorded on every
  -- anonymous booking, including returning phones: each booking is a fresh
  -- acceptance of the notice shown on screen.
  insert into public.consents (patient_id, document, version, user_agent)
  values (
    v_patient_id,
    'aviso_privacidad',
    p_privacy_notice_version,
    left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512)
  );

  return v_appointment_id;
end;
$$;

revoke all on function public.request_appointment(text, text, text, text, uuid, timestamptz, text, text, text, text) from public;
grant execute on function public.request_appointment(text, text, text, text, uuid, timestamptz, text, text, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go assertion
-- -----------------------------------------------------------------------------
do $$
declare
  r      text;
  v_priv text;
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'request_appointment'
      and pg_get_function_identity_arguments(p.oid) not like '%p_privacy_notice_version%'
  ) then
    raise exception 'A request_appointment overload WITHOUT consent still exists: anonymous booking can bypass consent.'
      using errcode = 'P0001';
  end if;

  if not has_function_privilege(
       'anon',
       'public.request_appointment(text,text,text,text,uuid,timestamptz,text,text,text,text)',
       'execute') then
    raise exception 'anon cannot execute the new request_appointment: public booking is broken.'
      using errcode = 'P0001';
  end if;

  if coalesce((select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'request_appointment' limit 1), '')
     not like '%pg_advisory_xact_lock%' then
    raise exception 'request_appointment lost the booking advisory lock.' using errcode = 'P0001';
  end if;

  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(r, 'public.consents', v_priv) then
        raise exception 'Role % holds % on consents: consent evidence could be forged or erased.', r, v_priv
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon', 'public.consents', 'SELECT') then
    raise exception 'anon can SELECT consents.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 09 PASSED: consents table installed, request_appointment requires notice version %.',
    public.privacy_notice_version();
end $$;
