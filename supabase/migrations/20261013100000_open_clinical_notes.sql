-- =============================================================================
-- 31 - Open clinical notes: finalize the consultation, close the note later
-- =============================================================================
-- Problem this file fixes:
--   The doctor often cannot finish the note during the visit. "Finalizar
--   Consulta" (finalize_consultation_with_payment, migrations 20 and 22) froze
--   the note together with the prescription, the charge and the supplies, and
--   refused to run without a diagnosis and a plan. The patient was waiting to
--   pay and take the prescription while the note was still unfinished.
--
-- Design (owner-approved):
--   * "Finalizar Consulta" still records the charge and the supplies and
--     finalizes the PRESCRIPTION (so it can be issued and shared at once), but
--     the CLINICAL NOTE stays OPEN: the doctor keeps editing it from the
--     record. Diagnosis and plan are no longer required to finalize the
--     consultation; they are required to CLOSE the note.
--     finalize_consultation_with_payment() is unchanged: it still calls
--     finalize_consultation() first, then record_payment(), then the supplies
--     step. Only finalize_consultation() (internal, migration 20 body) changes:
--       - no diagnosis/plan check;
--       - when the appointment has no note at all, it inserts an empty open
--         one (also when its prescription was finalized first: the trigger
--         accepts that insert under the same flag), so every finalized
--         consultation has a note (the record shows it pending, and the
--         supplies step has a note to mark);
--       - it stamps clinical_notes.consultation_finalized_at instead of
--         finalized_at; prescriptions are finalized exactly as before.
--   * clinical_notes.consultation_finalized_at (timestamptz): when "Finalizar
--     Consulta" ran. Server-owned: only finalize_consultation() writes it
--     (transaction-local flag app.finalizing_consultation = the appointment),
--     once; a direct write is refused (42501). It replaces "the note is
--     finalized" wherever the code meant "the consultation was finalized":
--       - consultation_is_finalized() (no new note or prescription rows after
--         "Finalizar Consulta", also when there is no prescription);
--       - record_consultation_supplies() ("Registrar insumos");
--       - get_procedure_profit().unrecorded_consultations and the calendar's
--         red "Sin insumos" flag (frontend).
--     Past visits never get it, so they stay out of the supplies flag.
--     Existing finalized notes are backfilled once from finalized_at (every
--     one of them was frozen by "Finalizar Consulta").
--   * close_clinical_note(p_note_id) - "Cerrar nota", doctor only
--     (is_staff()). Refuses an empty diagnosis or plan, and a note that is
--     already closed. It sets finalized_at through the integrity trigger,
--     which stamps finalized_at/finalized_by and freezes the note exactly like
--     before (same frozen tuple). Corrections afterwards only through addenda
--     (clinical_note_addenda, unchanged: addenda still need a closed note).
--   * clinical_notes.recorded_late (boolean not null default false), NOM-004
--     5.10 (honest date and time). Server-owned, computed by the integrity
--     trigger:
--       - true when the note is closed more than 24 h after "Finalizar
--         Consulta" (consultation_finalized_at, a server stamp the doctor
--         cannot move); a note without that stamp is measured against the
--         appointment's start;
--       - true for a note inserted while staff_record_past_visit_with_note()
--         holds app.recording_past_visit = its appointment (a past visit);
--       - any direct change is refused (42501), and it is part of the frozen
--         tuple once the note is closed.
--     The record shows "Registrada posteriormente · cerrada el <fecha hora>".
--   * The open note of a finalized consultation or of a past visit cannot be
--     deleted (it is part of the record); a draft of a consultation that was
--     never finalized can, as before.
--   * A note of a finalized consultation, of a past visit or with recorded
--     supplies cannot be moved to another appointment or patient (42501).
--   * No note is ever closed without a diagnosis and a plan, whatever the
--     path: the trigger refuses it (P0001), also for a direct UPDATE of
--     finalized_at through RLS.
--   * staff_record_past_visit_with_note(...) - "Registrar cita pasada" with
--     the optional "Nota clínica": doctor only. It calls migration 30's
--     staff_record_past_visit() unchanged (same checks, lock, overlap rules,
--     charge dated to the visit) and then, when any note field was written,
--     inserts the OPEN note linked to the new appointment, marked
--     recorded_late. One function call, one transaction: a refused note
--     (e.g. an impossible vital sign) leaves no appointment and no charge.
--     staff_record_past_visit() keeps its signature and body, so its callers
--     and past_visits_check.sql are unaffected.
--
-- Unchanged on purpose:
--   * finalize_consultation_with_payment() body and signature (migrations 22
--     and 26 gates still hold); record_payment(); the supplies step.
--   * Prescriptions: finalized by "Finalizar Consulta" as before, so issuing
--     and sharing work right away ("Consulta finalizada"). Patients still see
--     finalized prescriptions only (migrations 27 and 29).
--   * export_my_data(): SOAP notes were never exported (staff only).
--   * Audit: the generic audit_row_change trigger still logs every note
--     update with column NAMES only (the two new columns included).
--   * A direct UPDATE that sets finalized_at still closes a COMPLETE note
--     (as in migrations 10 and 20; older test scripts use it). The app
--     closes notes only through close_clinical_note().
--
-- Function bodies are copied verbatim from their latest migration (named in
-- each section) and only the marked "Migration 31" lines change.
--
-- Note for maintainers: re-running migration 10, 20, 22 or 30 restores the
-- older body of consultation_is_finalized(), clinical_notes_enforce_integrity(),
-- finalize_consultation(), record_consultation_supplies() or
-- get_procedure_profit(). Run this file again afterwards. Re-running
-- migration 20 also re-grants finalize_consultation(uuid) to authenticated;
-- migration 26 and this file revoke it again.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.clinical_notes add column if not exists recorded_late boolean not null default false;

comment on column public.clinical_notes.recorded_late is
  'NOM-004 5.10: the note was recorded after the fact (closed more than 24 h after the appointment started, or written through a past visit). Server-owned: set by clinical_notes_enforce_integrity, frozen with the note.';

-- Added and backfilled once, BEFORE the integrity trigger below learns about
-- it (the migration 20 trigger does not freeze this column, so the backfill
-- of closed notes is accepted). A re-run never touches it again.
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.clinical_notes'::regclass
      and attname = 'consultation_finalized_at'
      and not attisdropped
  ) then
    alter table public.clinical_notes add column consultation_finalized_at timestamptz;
    update public.clinical_notes
       set consultation_finalized_at = finalized_at
     where finalized_at is not null;
  end if;
end $$;

comment on column public.clinical_notes.consultation_finalized_at is
  'When "Finalizar Consulta" ran (charge, supplies, prescription). The note itself stays open until finalized_at. Server-owned: written once by finalize_consultation().';

-- -----------------------------------------------------------------------------
-- consultation_is_finalized - migration 10 body + consultation_finalized_at
-- -----------------------------------------------------------------------------
create or replace function public.consultation_is_finalized(p_appointment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_appointment_id is not null and (
    exists (select 1 from public.clinical_notes cn
            where cn.appointment_id = p_appointment_id and cn.finalized_at is not null)
    or exists (select 1 from public.prescriptions pr
               where pr.appointment_id = p_appointment_id and pr.finalized_at is not null)
    -- Migration 31: the note may still be open after "Finalizar Consulta".
    or exists (select 1 from public.clinical_notes cn
               where cn.appointment_id = p_appointment_id and cn.consultation_finalized_at is not null)
  );
$$;

revoke all on function public.consultation_is_finalized(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- clinical_notes integrity trigger - migration 20 body + migration 31 markers
-- -----------------------------------------------------------------------------
create or replace function public.clinical_notes_enforce_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Migration 31: finalize_consultation() (flag = this appointment) may add
    -- the empty open note of a consultation that has none, even when its
    -- prescription was finalized first.
    if public.consultation_is_finalized(new.appointment_id)
       and coalesce(current_setting('app.finalizing_consultation', true), '') <> new.appointment_id::text then
      raise exception 'Esta consulta ya fue finalizada y no se puede modificar. Para corregir el expediente, agrega una nota aclaratoria (adenda).'
        using errcode = 'P0001';
    end if;
    -- Finalization only ever happens through an UPDATE, never at insert time.
    new.finalized_at := null;
    new.finalized_by := null;
    new.author_id    := coalesce(auth.uid(), new.author_id);
    -- Migration 31: server-owned markers. Only a note written by
    -- staff_record_past_visit_with_note() (flag = its appointment) starts as
    -- a late entry.
    new.consultation_finalized_at := null;
    new.recorded_late := new.appointment_id is not null
      and coalesce(current_setting('app.recording_past_visit', true), '') = new.appointment_id::text;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Migration 31: consultation_finalized_at is stamped once, only by
    -- finalize_consultation() (flag = this note's appointment), on an open or
    -- a closed note.
    if new.consultation_finalized_at is distinct from old.consultation_finalized_at then
      if old.consultation_finalized_at is null
         and new.appointment_id is not distinct from old.appointment_id
         and coalesce(current_setting('app.finalizing_consultation', true), '') = old.appointment_id::text then
        new.consultation_finalized_at := now();
      else
        raise exception 'La consulta solo se marca como finalizada con «Finalizar Consulta».'
          using errcode = '42501';
      end if;
    end if;

    -- Migration 31: recorded_late is computed below when the note is closed.
    if new.recorded_late is distinct from old.recorded_late then
      raise exception 'La marca de registro posterior de una nota no se puede cambiar.'
        using errcode = '42501';
    end if;

    -- Migration 31: a note that belongs to a finalized consultation, a past
    -- visit or recorded supplies never moves to another appointment or
    -- patient (it would carry its markers along).
    if (old.consultation_finalized_at is not null or old.recorded_late
        or old.supplies_recorded_at is not null)
       and (new.appointment_id, new.patient_id) is distinct from (old.appointment_id, old.patient_id) then
      raise exception 'Esta nota clínica no se puede mover a otra cita ni a otro paciente.'
        using errcode = '42501';
    end if;
  end if;

  if old.finalized_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'Una nota clínica finalizada no se puede eliminar (NOM-004-SSA3-2012).'
        using errcode = 'P0001';
    end if;

    if (new.subjective, new.objective, new.analysis, new.plan,
        new.prognosis, new.vital_signs,
        new.patient_id, new.appointment_id, new.created_at,
        new.author_id, new.finalized_at, new.finalized_by,
        new.recorded_late)
       is distinct from
       (old.subjective, old.objective, old.analysis, old.plan,
        old.prognosis, old.vital_signs,
        old.patient_id, old.appointment_id, old.created_at,
        old.author_id, old.finalized_at, old.finalized_by,
        old.recorded_late) then
      raise exception 'Esta consulta ya fue finalizada y no se puede modificar. Para corregir el expediente, agrega una nota aclaratoria (adenda).'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Migration 31: the open note of a finalized consultation or of a past
    -- visit is part of the record.
    if old.consultation_finalized_at is not null or old.recorded_late then
      raise exception 'Esta nota clínica es parte del expediente y no se puede eliminar.'
        using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- Not yet finalized. If this update finalizes it, the server owns the stamp.
  if new.finalized_at is not null then
    -- Migration 31: whatever the path (close_clinical_note() or a direct
    -- UPDATE through RLS), a note is never closed without its core content.
    if btrim(coalesce(new.analysis, '')) = '' or btrim(coalesce(new.plan, '')) = '' then
      raise exception 'Para cerrar la nota, escribe el diagnóstico y el plan.'
        using errcode = 'P0001';
    end if;
    new.finalized_at := now();
    new.finalized_by := auth.uid();
    -- Migration 31 (NOM-004 5.10): a late entry when closed more than 24 h
    -- after "Finalizar Consulta" (a server stamp nobody can move); without
    -- that stamp, after the appointment's start; a past visit always is.
    new.recorded_late := old.recorded_late or coalesce(
      now() > coalesce(
                new.consultation_finalized_at,
                (select a.start_time from public.appointments a where a.id = new.appointment_id)
              ) + interval '24 hours',
      false);
  else
    new.finalized_by := null;
  end if;

  return new;
end;
$$;

revoke all on function public.clinical_notes_enforce_integrity() from public, anon, authenticated, service_role;

drop trigger if exists clinical_notes_enforce_integrity on public.clinical_notes;
create trigger clinical_notes_enforce_integrity
  before insert or update or delete on public.clinical_notes
  for each row execute function public.clinical_notes_enforce_integrity();

-- -----------------------------------------------------------------------------
-- finalize_consultation - migration 20 body; the note stays open
-- -----------------------------------------------------------------------------
-- Internal since migration 26 (only finalize_consultation_with_payment()
-- calls it, as its owner). Returns the number of rows stamped (consultation
-- markers + prescriptions). Calling it twice is harmless (returns 0).
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

  -- Migration 31: no diagnosis/plan check here (close_clinical_note() has
  -- it). A consultation finalized without a note gets an empty open one,
  -- also when its prescription was finalized first, so the supplies step
  -- always has a note to mark. The flag lets the integrity trigger accept it.
  perform set_config('app.finalizing_consultation', p_appointment_id::text, true);
  if not exists (
       select 1 from public.clinical_notes cn
       where cn.appointment_id = p_appointment_id
     ) then
    insert into public.clinical_notes (appointment_id, patient_id)
    values (p_appointment_id, v_patient);
  end if;

  -- Migration 31: the consultation is stamped, the note stays open.
  update public.clinical_notes
     set consultation_finalized_at = now()
   where appointment_id = p_appointment_id
     and consultation_finalized_at is null;
  get diagnostics v_notes = row_count;
  perform set_config('app.finalizing_consultation', '', true);

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

comment on function public.finalize_consultation(uuid) is
  'Internal (called by finalize_consultation_with_payment): finalizes the prescription and stamps clinical_notes.consultation_finalized_at; the note stays open until close_clinical_note().';

-- Still internal (migration 26): no API role may call it directly.
revoke all on function public.finalize_consultation(uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- record_consultation_supplies - migration 22 body, finalized CONSULTATION
-- -----------------------------------------------------------------------------
create or replace function public.record_consultation_supplies(
  p_appointment_id uuid,
  p_supplies       jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para registrar insumos.' using errcode = '42501';
  end if;

  select a.status into v_status
  from public.appointments a
  where a.id = p_appointment_id;

  if not found then
    raise exception 'No se encontró la cita.' using errcode = 'P0001';
  end if;

  if v_status in ('cancelled', 'rejected') then
    raise exception 'Esta cita está cancelada: no se pueden registrar insumos.' using errcode = 'P0001';
  end if;

  -- Migration 31: the consultation was finalized; its note may still be open.
  if not exists (
    select 1 from public.clinical_notes cn
    where cn.appointment_id = p_appointment_id and cn.consultation_finalized_at is not null
  ) then
    raise exception 'Solo se pueden registrar insumos de una consulta finalizada.' using errcode = 'P0001';
  end if;

  return public.record_supplies_used(p_appointment_id, coalesce(p_supplies, '[]'::jsonb));
end;
$$;

revoke all on function public.record_consultation_supplies(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_consultation_supplies(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- get_procedure_profit - migration 30 body, finalized CONSULTATION
-- -----------------------------------------------------------------------------
create or replace function public.get_procedure_profit(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  service_id               uuid,
  service_name             text,
  times                    integer,
  charged                  numeric,
  courtesy_value           numeric,
  supplies_cost            numeric,
  uncosted_supplies        integer,
  profit                   numeric,
  unrecorded_consultations integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_business_staff() then
    raise exception 'No tienes permisos para ver las finanzas.' using errcode = '42501';
  end if;

  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'El rango de fechas no es válido.' using errcode = 'P0001';
  end if;

  return query
  with pay as (
    select p.appointment_id, p.service_id, p.status, p.amount_charged, p.list_price,
           (
             -- Migration 31: the consultation was finalized (the note may be open).
             exists (select 1 from public.clinical_notes cn
                     where cn.appointment_id = p.appointment_id and cn.consultation_finalized_at is not null)
             and not exists (select 1 from public.clinical_notes cn
                             where cn.appointment_id = p.appointment_id and cn.supplies_recorded_at is not null)
             and exists (select 1 from public.service_supplies ss where ss.service_id = p.service_id)
           ) as unrecorded
    from public.payments p
    -- Migration 30: same date rule as the cash view (received_at).
    where p.received_at >= p_from
      and p.received_at < p_to
  ),
  used as (
    select m.appointment_id,
           sum(coalesce(m.total_cost, 0))                   as cost,
           count(*) filter (where m.total_cost is null)     as uncosted
    from public.inventory_movements m
    where m.type = 'use'
      and m.appointment_id in (select pay.appointment_id from pay)
    group by m.appointment_id
  ),
  per_service as (
    select pay.service_id                                                              as sid,
           count(*)::integer                                                           as n,
           coalesce(sum(pay.amount_charged) filter (where pay.status = 'paid'), 0)     as paid,
           coalesce(sum(coalesce(pay.list_price, 0)) filter (where pay.status = 'courtesy'), 0) as courtesy,
           coalesce(sum(used.cost), 0)                                                 as cost,
           coalesce(sum(used.uncosted), 0)::integer                                    as uncosted,
           (count(*) filter (where pay.unrecorded))::integer                           as unrec
    from pay
    left join used on used.appointment_id = pay.appointment_id
    group by pay.service_id
  )
  select ps.sid,
         s.name::text,
         ps.n,
         round(ps.paid, 2),
         round(ps.courtesy, 2),
         round(ps.cost, 2),
         ps.uncosted,
         round(ps.paid - ps.cost, 2),
         ps.unrec
  from per_service ps
  left join public.services s on s.id = ps.sid
  order by ps.paid desc, s.name;
end;
$$;

revoke all on function public.get_procedure_profit(timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.get_procedure_profit(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- close_clinical_note - "Cerrar nota" (doctor only)
-- -----------------------------------------------------------------------------
-- Returns the closed note. The integrity trigger stamps finalized_at,
-- finalized_by and recorded_late and freezes the note from then on.
create or replace function public.close_clinical_note(p_note_id uuid)
returns public.clinical_notes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_note public.clinical_notes;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para cerrar notas clínicas.' using errcode = '42501';
  end if;

  -- Locked, so a double tap closes it once and the second call is refused.
  select cn.* into v_note
  from public.clinical_notes cn
  where cn.id = p_note_id
  for update;

  if not found then
    raise exception 'No se encontró la nota clínica.' using errcode = 'P0001';
  end if;

  if v_note.finalized_at is not null then
    raise exception 'Esta nota ya está cerrada. Para corregirla, agrega una corrección.'
      using errcode = 'P0001';
  end if;

  if btrim(coalesce(v_note.analysis, '')) = '' or btrim(coalesce(v_note.plan, '')) = '' then
    raise exception 'Para cerrar la nota, escribe el diagnóstico y el plan.' using errcode = 'P0001';
  end if;

  update public.clinical_notes
     set finalized_at = now()
   where id = p_note_id
  returning * into v_note;

  return v_note;
end;
$$;

comment on function public.close_clinical_note(uuid) is
  'Doctor only: closes (freezes) an open clinical note once it has a diagnosis and a plan. Corrections afterwards only through clinical_note_addenda.';

revoke all on function public.close_clinical_note(uuid) from public, anon, authenticated, service_role;
grant execute on function public.close_clinical_note(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- staff_record_past_visit_with_note - "Registrar cita pasada" + "Nota clínica"
-- -----------------------------------------------------------------------------
-- Returns the new appointment's id. Without any note field it is exactly
-- staff_record_past_visit().
create or replace function public.staff_record_past_visit_with_note(
  p_patient_id     uuid,
  p_service_id     uuid,
  p_start_time     timestamptz,
  p_payment_status text,
  p_amount         numeric default null,
  p_method         text default null,
  p_note           text default null,
  p_subjective     text default null,
  p_objective      text default null,
  p_analysis       text default null,
  p_prognosis      text default null,
  p_plan           text default null,
  p_vital_signs    jsonb default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_appointment_id uuid;
  v_vitals         jsonb := nullif(nullif(p_vital_signs, 'null'::jsonb), '{}'::jsonb);
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para registrar citas.' using errcode = '42501';
  end if;

  -- The visit and its charge: migration 30, unchanged (checks, lock, overlap
  -- rules, charge dated to the visit).
  v_appointment_id := public.staff_record_past_visit(
    p_patient_id, p_service_id, p_start_time, p_payment_status, p_amount, p_method, p_note);

  -- The optional note: OPEN, linked to the visit, marked as a late entry by
  -- the integrity trigger while the flag holds this appointment.
  if nullif(btrim(coalesce(p_subjective, '')), '') is not null
     or nullif(btrim(coalesce(p_objective, '')), '') is not null
     or nullif(btrim(coalesce(p_analysis, '')), '') is not null
     or nullif(btrim(coalesce(p_prognosis, '')), '') is not null
     or nullif(btrim(coalesce(p_plan, '')), '') is not null
     or v_vitals is not null then
    perform set_config('app.recording_past_visit', v_appointment_id::text, true);

    insert into public.clinical_notes (
      appointment_id, patient_id, subjective, objective, analysis, prognosis, plan, vital_signs
    )
    values (
      v_appointment_id, p_patient_id,
      nullif(btrim(coalesce(p_subjective, '')), ''),
      nullif(btrim(coalesce(p_objective, '')), ''),
      nullif(btrim(coalesce(p_analysis, '')), ''),
      nullif(btrim(coalesce(p_prognosis, '')), ''),
      nullif(btrim(coalesce(p_plan, '')), ''),
      v_vitals
    );

    perform set_config('app.recording_past_visit', '', true);
  end if;

  return v_appointment_id;
end;
$$;

comment on function public.staff_record_past_visit_with_note(uuid, uuid, timestamptz, text, numeric, text, text, text, text, text, text, text, jsonb) is
  'Doctor only: staff_record_past_visit() plus an optional OPEN clinical note (recorded_late) for that visit, in one transaction.';

revoke all on function public.staff_record_past_visit_with_note(uuid, uuid, timestamptz, text, numeric, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.staff_record_past_visit_with_note(uuid, uuid, timestamptz, text, numeric, text, text, text, text, text, text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn      text;
  v_clean   text;
  v_code    text;
  v_bad     text;
  v_ok      boolean;
  v_rec     record;
begin
  -- 1. Columns.
  if not exists (
    select 1 from pg_attribute att
    join pg_attrdef d on d.adrelid = att.attrelid and d.adnum = att.attnum
    where att.attrelid = 'public.clinical_notes'::regclass
      and att.attname = 'recorded_late'
      and not att.attisdropped
      and att.atttypid = 'boolean'::regtype
      and att.attnotnull
      and pg_get_expr(d.adbin, d.adrelid) = 'false'
  ) then
    raise exception 'Migration 31 FAILED: clinical_notes.recorded_late (boolean not null default false) is missing.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_attribute att
    where att.attrelid = 'public.clinical_notes'::regclass
      and att.attname = 'consultation_finalized_at'
      and not att.attisdropped
      and att.atttypid = 'timestamptz'::regtype
  ) then
    raise exception 'Migration 31 FAILED: clinical_notes.consultation_finalized_at (timestamptz) is missing.'
      using errcode = 'P0001';
  end if;

  -- 2. The integrity trigger: enabled BEFORE INSERT OR UPDATE OR DELETE FOR
  --    EACH ROW (tgtype bits: 1 row, 2 before, 4 insert, 8 delete, 16 update),
  --    with the migration 31 rules. Comments stripped; strings kept (the flag
  --    names are string literals).
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.clinical_notes'::regclass
      and not t.tgisinternal
      and t.tgname = 'clinical_notes_enforce_integrity'
      and t.tgenabled <> 'D'
      and t.tgfoid = 'public.clinical_notes_enforce_integrity()'::regprocedure
      and (t.tgtype::integer & 31) = 31
  ) then
    raise exception 'Migration 31 FAILED: the enabled BEFORE INSERT OR UPDATE OR DELETE trigger clinical_notes_enforce_integrity is missing.'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.clinical_notes_enforce_integrity()'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'new\.consultation_finalized_at := null;'
     or v_clean !~ 'if public\.consultation_is_finalized\(new\.appointment_id\) and coalesce\(current_setting\(''app\.finalizing_consultation'', true\), ''''\) <> new\.appointment_id::text then raise'
     or v_clean !~ 'or old\.supplies_recorded_at is not null\) and \(new\.appointment_id, new\.patient_id\) is distinct from \(old\.appointment_id, old\.patient_id\) then raise'
     or v_clean !~ 'if new\.finalized_at is not null then if btrim\(coalesce\(new\.analysis, ''''\)\) = '''' or btrim\(coalesce\(new\.plan, ''''\)\) = '''' then raise'
     or v_clean !~ 'now\(\) > coalesce\( new\.consultation_finalized_at, \(select a\.start_time from public\.appointments a where a\.id = new\.appointment_id\) \) \+ interval ''24 hours'''
     or v_clean !~ 'current_setting\(''app\.recording_past_visit'', true\), ''''\) = new\.appointment_id::text'
     or v_clean !~ 'current_setting\(''app\.finalizing_consultation'', true\), ''''\) = old\.appointment_id::text then new\.consultation_finalized_at := now\(\);'
     or v_clean !~ 'if new\.recorded_late is distinct from old\.recorded_late then raise'
     or v_clean !~ 'old\.finalized_by, old\.recorded_late\)'
     or v_clean !~ 'old\.prognosis, old\.vital_signs'
     or v_clean !~ 'if old\.consultation_finalized_at is not null or old\.recorded_late then raise'
     or v_clean !~ 'new\.finalized_at := now\(\); new\.finalized_by := auth\.uid\(\); new\.recorded_late := old\.recorded_late or coalesce\(' then
    raise exception 'Migration 31 FAILED: clinical_notes_enforce_integrity() must be SECURITY DEFINER with a pinned search_path, freeze the note (recorded_late included), own consultation_finalized_at and recorded_late (late against the consultation stamp), refuse moving a finalized note and refuse closing without diagnosis and plan.'
      using errcode = 'P0001';
  end if;

  -- 3. consultation_is_finalized() also sees the consultation marker.
  select regexp_replace(lower(coalesce(prosrc, '')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.consultation_is_finalized(uuid)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'cn\.consultation_finalized_at is not null'
     or v_clean !~ 'pr\.finalized_at is not null' then
    raise exception 'Migration 31 FAILED: consultation_is_finalized() must also count clinical_notes.consultation_finalized_at.'
      using errcode = 'P0001';
  end if;

  -- 4. finalize_consultation(): doctor only, no diagnosis/plan check, stamps
  --    the consultation (not the note) and finalizes the prescription.
  --    Comments and string literals stripped.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_code
  from pg_proc
  where oid = 'public.finalize_consultation(uuid)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_code is null
     or v_code !~ 'if not public\.is_staff\(\) then raise'
     or v_code !~ 'set consultation_finalized_at = now\(\)'
     or v_code !~ 'perform set_config\( , p_appointment_id::text, true\); if not exists \( select 1 from public\.clinical_notes cn where cn\.appointment_id = p_appointment_id \) then insert into public\.clinical_notes'
     or v_code ~ 'consultation_is_finalized'
     or v_code !~ 'update public\.prescriptions set finalized_at = now\(\)'
     or v_code ~ 'clinical_notes set finalized_at'
     or v_code ~ 'cn\.analysis' then
    raise exception 'Migration 31 FAILED: finalize_consultation() must check is_staff(), stamp consultation_finalized_at, finalize the prescription and leave the note open (no diagnosis/plan check).'
      using errcode = 'P0001';
  end if;

  -- finalize_consultation_with_payment() still goes through it first.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_code
  from pg_proc
  where oid = 'public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)'::regprocedure and prosecdef;
  if v_code is null
     or v_code !~ 'perform public\.finalize_consultation\(p_appointment_id\)'
     or strpos(v_code, 'public.finalize_consultation(') > strpos(v_code, 'public.record_payment(') then
    raise exception 'Migration 31 FAILED: finalize_consultation_with_payment() must call finalize_consultation() before record_payment() (apply migrations 22 and 26 first).'
      using errcode = 'P0001';
  end if;

  -- 5. close_clinical_note(): doctor only, locks, requires diagnosis and plan,
  --    closes through the trigger.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_code
  from pg_proc
  where oid = 'public.close_clinical_note(uuid)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_code is null
     or v_code !~ 'if not public\.is_staff\(\) then raise'
     or v_code !~ 'for update'
     or v_code !~ 'if v_note\.finalized_at is not null then raise'
     or v_code !~ 'btrim\(coalesce\(v_note\.analysis, \)\) = or btrim\(coalesce\(v_note\.plan, \)\) = then raise'
     or v_code !~ 'update public\.clinical_notes set finalized_at = now\(\) where id = p_note_id' then
    raise exception 'Migration 31 FAILED: close_clinical_note() must be SECURITY DEFINER, doctor only, lock the note, refuse a closed note or a missing diagnosis or plan, and close through the trigger.'
      using errcode = 'P0001';
  end if;

  -- 6. staff_record_past_visit_with_note(): doctor only, the migration 30
  --    RPC first, the note inserted while the flag holds the appointment.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_code
  from pg_proc
  where oid = 'public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_code is null
     or v_code !~ 'if not public\.is_staff\(\) then raise'
     or v_code !~ 'v_appointment_id := public\.staff_record_past_visit\( p_patient_id, p_service_id, p_start_time, p_payment_status, p_amount, p_method, p_note\);'
     or v_code !~ 'perform set_config\( , v_appointment_id::text, true\); insert into public\.clinical_notes' then
    raise exception 'Migration 31 FAILED: staff_record_past_visit_with_note() must be SECURITY DEFINER, doctor only, call staff_record_past_visit() and insert the note under the past-visit flag.'
      using errcode = 'P0001';
  end if;

  -- 7. Supplies and profit follow the finalized CONSULTATION.
  foreach v_fn in array array[
    'public.record_consultation_supplies(uuid,jsonb)',
    'public.get_procedure_profit(timestamptz,timestamptz)'
  ] loop
    select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
      into v_code
    from pg_proc
    where oid = v_fn::regprocedure and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
    if v_code is null
       or v_code !~ 'cn\.consultation_finalized_at is not null'
       or v_code ~ 'cn\.finalized_at is not null' then
      raise exception 'Migration 31 FAILED: % must require a finalized consultation (consultation_finalized_at), not a closed note.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 8. Grants: the two RPCs for authenticated only; the internals for nobody.
  foreach v_fn in array array[
    'public.close_clinical_note(uuid)',
    'public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)',
    'public.record_consultation_supplies(uuid,jsonb)',
    'public.get_procedure_profit(timestamptz,timestamptz)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 31 FAILED: % must be executable by authenticated only.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  foreach v_fn in array array[
    'public.finalize_consultation(uuid)',
    'public.consultation_is_finalized(uuid)',
    'public.clinical_notes_enforce_integrity()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Migration 31 FAILED: % is executable by anon, authenticated or service_role.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 9. Migration 29 rules still hold: default privileges give new functions
  --    to neither PUBLIC, anon nor authenticated, and no trigger function is
  --    API-executable.
  select string_agg(
           coalesce(nullif(d.defaclnamespace, 0::oid)::regnamespace::text, '(all schemas)')
           || ': ' || case when x.grantee = 0::oid then 'PUBLIC' else x.grantee::regrole::text end,
           ', ')
    into v_bad
  from pg_default_acl d
  cross join lateral aclexplode(d.defaclacl) x
  where d.defaclrole = 'postgres'::regrole::oid
    and d.defaclobjtype = 'f'
    and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
    and x.privilege_type = 'EXECUTE'
    and x.grantee in (0::oid, 'anon'::regrole::oid, 'authenticated'::regrole::oid);
  if v_bad is not null then
    raise exception 'Migration 31 FAILED: default privileges give EXECUTE on new functions to % (apply migration 29 first).', v_bad
      using errcode = 'P0001';
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype = 'trigger'::regtype
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute'))
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    );
  if v_bad is not null then
    raise exception 'Migration 31 FAILED: trigger functions executable by anon, authenticated or service_role: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 10. The SECURITY DEFINER surface: migration 30's reviewed list plus
  --     close_clinical_note() and staff_record_past_visit_with_note().
  --     Matched by SIGNATURE (oid), never by name; the guard must be real
  --     code (comments and string literals stripped).
  for v_rec in
    with reviewed (sig, kind) as (
      values
        -- anon and authenticated: public reads that return no identity.
        ('public.get_availability(timestamptz,timestamptz)', 'public'),
        ('public.get_clinic_schedule()', 'public'),
        ('public.get_clinic_mode()', 'public'),
        -- Helpers RLS policies call as the requesting role.
        ('public.is_staff()', 'helper'),
        ('public.is_business_staff()', 'helper'),
        ('public.current_patient_id()', 'helper'),
        -- Doctor only.
        ('public.anonymize_patient(uuid)', 'staff'),
        -- Migration 31.
        ('public.close_clinical_note(uuid)', 'staff'),
        ('public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)', 'staff'),
        ('public.issue_prescription(uuid)', 'staff'),
        ('public.log_prescription_shared(uuid,text)', 'staff'),
        ('public.record_consent_in_person(uuid)', 'staff'),
        ('public.record_consultation_supplies(uuid,jsonb)', 'staff'),
        ('public.record_payment(uuid,text,numeric,text,text)', 'staff'),
        ('public.resolve_arco_request(uuid,text,text)', 'staff'),
        ('public.set_clinic_mode(boolean)', 'staff'),
        ('public.staff_create_appointment(uuid,uuid,timestamptz)', 'staff'),
        -- Migration 30.
        ('public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'staff'),
        -- Migration 31.
        ('public.staff_record_past_visit_with_note(uuid,uuid,timestamptz,text,numeric,text,text,text,text,text,text,text,jsonb)', 'staff'),
        ('public.staff_register_arco_request(uuid,text,text,text)', 'staff'),
        ('public.staff_reschedule_appointment(uuid,timestamptz)', 'staff'),
        -- Doctor or admin.
        ('public.adjust_stock(uuid,integer,text,numeric,text)', 'business'),
        ('public.get_finance_payments(timestamptz,timestamptz)', 'business'),
        ('public.get_item_movements(uuid)', 'business'),
        ('public.get_procedure_profit(timestamptz,timestamptz)', 'business'),
        ('public.set_service_supplies(uuid,jsonb)', 'business'),
        -- The caller's own patient record.
        ('public.accept_privacy_notice(text,text)', 'patient'),
        ('public.cancel_my_appointment(uuid,text)', 'patient'),
        ('public.export_my_data()', 'patient'),
        ('public.get_my_booking_profile()', 'patient'),
        ('public.register_my_upload(text,text)', 'patient'),
        ('public.request_my_appointment(uuid,timestamptz,text)', 'patient'),
        ('public.reschedule_my_appointment(uuid,timestamptz)', 'patient'),
        ('public.submit_arco_request(text,text)', 'patient'),
        ('public.get_my_profile()', 'patient_sql'),
        ('public.register_me(text,text,text,text,integer,text,text)', 'register')
    )
    select p.oid::regprocedure::text as sig,
           p.prosrc,
           has_function_privilege('anon', p.oid, 'execute') as anon_x,
           r.kind
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    left join reviewed r on to_regprocedure(r.sig) = p.oid
    where n.nspname = 'public'
      and p.prosecdef
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute'))
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    if v_rec.kind is null then
      raise exception 'Migration 31 FAILED: unreviewed SECURITY DEFINER function executable by anon or authenticated: %. Nothing was changed.', v_rec.sig
        using errcode = 'P0001';
    end if;

    if v_rec.anon_x and v_rec.kind <> 'public' then
      raise exception 'Migration 31 FAILED: anon can execute %.', v_rec.sig using errcode = 'P0001';
    end if;

    -- Code only: no comments, no string literals, lower case, single spaces.
    v_clean := regexp_replace(
                 lower(regexp_replace(v_rec.prosrc,
                       $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')),
                 '\s+', ' ', 'g');

    v_ok := case v_rec.kind
      when 'staff'       then v_clean ~ 'if not public\.is_staff\(\) then raise'
      when 'business'    then v_clean ~ 'if not public\.is_business_staff\(\) then raise'
      when 'patient'     then v_clean ~ '(\w+) uuid := public\.current_patient_id\(\);.*\mif \1 is null then (raise|return)'
      when 'patient_sql' then v_clean ~ 'where p\.id = public\.current_patient_id\(\)'
      when 'register'    then v_clean ~ 'if public\.is_business_staff\(\) then raise'
                              and v_clean ~ 'if v_phone is null or length\(v_phone\) < 10 then raise'
      else true
    end;

    if not v_ok then
      raise exception 'Migration 31 FAILED: % (%) has no internal % guard in its code.', v_rec.sig, v_rec.kind, v_rec.kind
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 31 PASSED: "Finalizar Consulta" finalizes the prescription and stamps clinical_notes.consultation_finalized_at while the note stays open (no diagnosis/plan needed); close_clinical_note() lets only the doctor close a note; the integrity trigger refuses closing any note without a diagnosis and a plan (direct UPDATE included), freezes it as before and never moves a finalized note to another appointment or patient; recorded_late (closed more than 24 h after Finalizar Consulta, or written through a past visit) and consultation_finalized_at are server-owned; staff_record_past_visit_with_note() records a past visit, its charge and an optional open note in one transaction; supplies and profit follow the finalized consultation; no internal function or trigger function is API-executable; the SECURITY DEFINER surface matches the reviewed list by signature.';
end $$;
