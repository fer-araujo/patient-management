-- =============================================================================
-- 10 - Clinical note and prescription integrity (Phase 2)
-- =============================================================================
-- NOM-004-SSA3-2012 numeral 5.10: every note carries date, time and the full
-- name and signature of whoever wrote it. Numeral 5.11: notes are written
-- without "enmendaduras ni tachaduras". NOM-024-SSA3-2012 numeral 6.6.2:
-- electronic records are kept as structured, UNALTERABLE documents.
--
-- The electronic equivalent implemented here:
--   * A note is freely editable while the consultation is in progress
--     (saveSoapNote upserts it).
--   * "Finalizar Consulta" calls public.finalize_consultation(appointment_id),
--     which stamps finalized_at / finalized_by on the note and on the
--     prescription of that appointment.
--   * From then on a trigger rejects UPDATE of the clinical fields and any
--     DELETE, for every role including the table owner.
--   * Corrections are appended to public.clinical_note_addenda, which is
--     itself append-only.
--
-- Also added: author_id on notes and prescriptions (defaults to auth.uid()),
-- so each record identifies the account that wrote it.
--
-- NOT done here on purpose: back-filling finalized_at for historical notes.
-- That is irreversible, so it is an optional, explicit step in
-- docs/security-runbook.md (Phase 2, step P2-3b) for the operator to decide.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.clinical_notes add column if not exists author_id    uuid default auth.uid();
alter table public.clinical_notes add column if not exists finalized_at timestamptz;
alter table public.clinical_notes add column if not exists finalized_by uuid;

alter table public.prescriptions add column if not exists author_id    uuid default auth.uid();
alter table public.prescriptions add column if not exists finalized_at timestamptz;
alter table public.prescriptions add column if not exists finalized_by uuid;

create index if not exists clinical_notes_appointment_idx on public.clinical_notes (appointment_id);
create index if not exists prescriptions_appointment_idx  on public.prescriptions (appointment_id);

-- -----------------------------------------------------------------------------
-- Internal: is the consultation for this appointment already finalized?
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
  );
$$;

revoke all on function public.consultation_is_finalized(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- clinical_notes integrity trigger
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
        new.patient_id, new.appointment_id, new.created_at,
        new.author_id, new.finalized_at, new.finalized_by)
       is distinct from
       (old.subjective, old.objective, old.analysis, old.plan,
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
-- prescriptions integrity trigger - same rule, frozen with the consultation
-- -----------------------------------------------------------------------------
create or replace function public.prescriptions_enforce_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if public.consultation_is_finalized(new.appointment_id) then
      raise exception 'Esta consulta ya fue finalizada: sus indicaciones médicas ya no se pueden modificar.'
        using errcode = 'P0001';
    end if;
    new.finalized_at := null;
    new.finalized_by := null;
    new.author_id    := coalesce(auth.uid(), new.author_id);
    return new;
  end if;

  if old.finalized_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'Las indicaciones de una consulta finalizada no se pueden eliminar (NOM-004-SSA3-2012).'
        using errcode = 'P0001';
    end if;

    if (new.medications, new.patient_id, new.appointment_id, new.created_at,
        new.author_id, new.finalized_at, new.finalized_by)
       is distinct from
       (old.medications, old.patient_id, old.appointment_id, old.created_at,
        old.author_id, old.finalized_at, old.finalized_by) then
      raise exception 'Esta consulta ya fue finalizada: sus indicaciones médicas ya no se pueden modificar.'
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.finalized_at is not null then
    new.finalized_at := now();
    new.finalized_by := auth.uid();
  else
    new.finalized_by := null;
  end if;

  return new;
end;
$$;

revoke all on function public.prescriptions_enforce_integrity() from public, anon, authenticated;

drop trigger if exists prescriptions_enforce_integrity on public.prescriptions;
create trigger prescriptions_enforce_integrity
  before insert or update or delete on public.prescriptions
  for each row execute function public.prescriptions_enforce_integrity();

-- -----------------------------------------------------------------------------
-- clinical_note_addenda - append-only corrections
-- -----------------------------------------------------------------------------
create table if not exists public.clinical_note_addenda (
  id          uuid primary key default gen_random_uuid(),
  note_id     uuid not null references public.clinical_notes (id) on delete restrict,
  author_id   uuid not null default auth.uid(),
  body        text not null,
  created_at  timestamptz not null default now()
);

alter table public.clinical_note_addenda drop constraint if exists clinical_note_addenda_body_check;
alter table public.clinical_note_addenda add constraint clinical_note_addenda_body_check
  check (length(btrim(body)) between 1 and 5000);

create index if not exists clinical_note_addenda_note_idx
  on public.clinical_note_addenda (note_id, created_at);

comment on table public.clinical_note_addenda is
  'Append-only corrections to finalized clinical notes (NOM-004-SSA3-2012).';

-- Server-owned author and timestamp; addenda only on finalized notes (before
-- finalization the note itself is still editable, so an addendum is noise).
create or replace function public.clinical_note_addenda_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Solo el personal de la clínica puede agregar adendas.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.clinical_notes cn
    where cn.id = new.note_id and cn.finalized_at is not null
  ) then
    raise exception 'Solo se pueden agregar adendas a notas de consultas finalizadas.'
      using errcode = 'P0001';
  end if;

  new.author_id  := auth.uid();
  new.created_at := now();
  new.body       := btrim(new.body);
  return new;
end;
$$;

revoke all on function public.clinical_note_addenda_before_insert() from public, anon, authenticated;

drop trigger if exists clinical_note_addenda_before_insert on public.clinical_note_addenda;
create trigger clinical_note_addenda_before_insert
  before insert on public.clinical_note_addenda
  for each row execute function public.clinical_note_addenda_before_insert();

drop trigger if exists clinical_note_addenda_block_update_delete on public.clinical_note_addenda;
create trigger clinical_note_addenda_block_update_delete
  before update or delete on public.clinical_note_addenda
  for each row execute function public.reject_append_only_mutation();

drop trigger if exists clinical_note_addenda_block_truncate on public.clinical_note_addenda;
create trigger clinical_note_addenda_block_truncate
  before truncate on public.clinical_note_addenda
  for each statement execute function public.reject_append_only_mutation();

drop trigger if exists audit_row_change on public.clinical_note_addenda;
create trigger audit_row_change
  after insert on public.clinical_note_addenda
  for each row execute function public.audit_row_change();

alter table public.clinical_note_addenda enable row level security;

revoke all on public.clinical_note_addenda from public, anon, authenticated, service_role;
grant select, insert on public.clinical_note_addenda to authenticated;

drop policy if exists "clinical_note_addenda_select_staff" on public.clinical_note_addenda;
create policy "clinical_note_addenda_select_staff"
  on public.clinical_note_addenda for select to authenticated
  using (public.is_staff());

drop policy if exists "clinical_note_addenda_insert_staff" on public.clinical_note_addenda;
create policy "clinical_note_addenda_insert_staff"
  on public.clinical_note_addenda for insert to authenticated
  with check (public.is_staff());

drop policy if exists "clinical_note_addenda_select_own" on public.clinical_note_addenda;
create policy "clinical_note_addenda_select_own"
  on public.clinical_note_addenda for select to authenticated
  using (
    exists (
      select 1 from public.clinical_notes cn
      where cn.id = note_id
        and cn.patient_id = public.current_patient_id()
    )
  );

-- -----------------------------------------------------------------------------
-- finalize_consultation - the single entry point used by "Finalizar Consulta"
-- -----------------------------------------------------------------------------
-- Returns the number of rows frozen. Calling it twice is harmless.
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
-- Go/no-go assertion
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['clinical_notes', 'prescriptions'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'finalized_at'
    ) then
      raise exception 'public.%.finalized_at is missing.', t using errcode = 'P0001';
    end if;

    if not exists (
      select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
      where c.relname = t and tg.tgname = t || '_enforce_integrity' and not tg.tgisinternal
    ) then
      raise exception 'Integrity trigger missing on public.%: finalized records are still editable.', t
        using errcode = 'P0001';
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.clinical_note_addenda', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_note_addenda', 'DELETE')
     or has_table_privilege('anon', 'public.clinical_note_addenda', 'SELECT') then
    raise exception 'clinical_note_addenda privileges are too broad.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'clinical_note_addenda'
      and tg.tgname = 'clinical_note_addenda_block_update_delete' and not tg.tgisinternal
  ) then
    raise exception 'clinical_note_addenda is not append-only.' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.finalize_consultation(uuid)', 'execute') then
    raise exception 'anon can execute finalize_consultation.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 10 PASSED: notes and prescriptions freeze on finalization, addenda are append-only.';
end $$;
