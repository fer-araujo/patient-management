-- =============================================================================
-- 30 - Past visits transcribed from the paper agenda
-- =============================================================================
-- Problem this file fixes:
--   After the pre-production reset the database is empty. The doctor will
--   transcribe her paper agenda: visits that ALREADY HAPPENED (earlier today
--   included) with what she charged for each. Nothing allowed it:
--     * staff_create_appointment() and the appointments_prevent_overlap
--       trigger call assert_slot_free(), which refuses any start in the past;
--     * a payment is dated by payments.created_at = now(), so Finanzas would
--       put every backfilled charge in the current month.
--
-- Design:
--   * assert_slot_free_at(p_start, p_duration_mins, p_exclude_appointment,
--     p_allow_past): migration 06's assert_slot_free() body with the "not in
--     the past" rule behind p_allow_past. assert_slot_free() keeps its
--     signature and now only calls it with p_allow_past = false, so every
--     existing caller behaves exactly as before. Internal: no API role can
--     execute either.
--   * payments.received_at timestamptz not null default now(): the date the
--     money counts for in Finanzas. Existing rows are backfilled from
--     created_at (once, when the column is added). It is server-owned: the
--     BEFORE trigger payments_guard_received_at sets it to now() on every
--     INSERT, except while staff_record_past_visit() holds the
--     transaction-local flag app.recording_past_visit = that appointment's
--     id, where it becomes the visit's start; and it refuses any later
--     change (42501). Clients cannot write payments at all (migration 17);
--     the trigger also covers the SQL editor and future code paths.
--     record_payment() is unchanged: it inserts without received_at (now()),
--     and a later correction ("Editar cobro") keeps the original date.
--   * get_finance_payments() (migration 26 body) and get_procedure_profit()
--     (migration 22 body) filter and order by received_at. The output column
--     of get_finance_payments() keeps its name created_at so the return type
--     (and migration 26's re-run) stays valid; it now carries received_at.
--     The doctor's Finanzas reads the table directly and switches to
--     received_at in the frontend (financeService).
--   * staff_record_past_visit(patient, service, start, payment_status,
--     amount, method, note): doctor only (is_staff()). Refuses a start in the
--     future, an archived or anonymized patient and an inactive service;
--     takes the booking advisory lock; checks the slot with
--     assert_slot_free_at(..., true) (busy appointments and blocks, the past
--     allowed); inserts the appointment as 'completed' with a pre-generated
--     id while the flag app.recording_past_visit holds that id; and records
--     the charge with record_payment() (same rules: paid needs amount > 0 and
--     a method, a courtesy is 0 with no method, same caps), dated to the
--     visit by the payments trigger. One transaction: a refused charge leaves
--     no appointment behind. Not blocked by doctor-only mode (staff RPC). No
--     clinical note and no inventory movement are written (stock starts at
--     0), so the calendar shows no "Sin insumos" flag for these visits (that
--     flag needs a finalized note).
--   * appointments_prevent_overlap() (migration 21 body): an INSERT with
--     status 'completed' whose id equals app.recording_past_visit may start
--     in the past; every other insert, move or re-activation still runs the
--     "not in the past" rule. The API cannot set app.* settings, so no other
--     path can use the exception.
--   * notify-appointment never sends a message for an INSERT with status
--     'completed' (the decision is explicit and unit-tested), so a past
--     visit never notifies even when the WhatsApp trigger is on.
--
-- Function bodies are copied verbatim from their latest migration (named in
-- each section) and only the marked "Migration 30" lines change.
--
-- Note for maintainers: re-running migration 06, 21, 22 or 26 restores the
-- older body of assert_slot_free(), appointments_prevent_overlap(),
-- get_procedure_profit() or get_finance_payments(). Run this file again
-- afterwards. Migration 19's gate looks for the busy rule inside
-- assert_slot_free(); it now lives in assert_slot_free_at(), so a re-run of
-- 19 alone fails its gate and changes nothing (19 has nothing left to apply
-- after 21).
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- assert_slot_free_at - migration 06 assert_slot_free body + p_allow_past
-- -----------------------------------------------------------------------------
create or replace function public.assert_slot_free_at(
  p_start                timestamptz,
  p_duration_mins        integer,
  p_exclude_appointment  uuid,
  p_allow_past           boolean
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_end timestamptz := p_start + make_interval(mins => p_duration_mins);
begin
  -- Migration 30: the past is refused unless the caller allows it (only a
  -- past visit recorded by staff_record_past_visit()).
  if p_start is null or (not coalesce(p_allow_past, false) and p_start <= now()) then
    raise exception 'La fecha y hora seleccionadas ya no están disponibles.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.appointments a
    join public.services s on s.id = a.service_id
    where a.status not in ('cancelled', 'rejected')
      and (p_exclude_appointment is null or a.id <> p_exclude_appointment)
      and a.start_time < v_end
      and a.start_time + make_interval(mins => coalesce(s.duration_mins, 45)) > p_start
  ) then
    raise exception 'El horario seleccionado acaba de ocuparse. Por favor elige otro.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.blocked_slots b
    where b.start_time < v_end
      and b.end_time > p_start
  ) then
    raise exception 'El horario seleccionado no está disponible. Por favor elige otro.'
      using errcode = 'P0001';
  end if;
end;
$$;

comment on function public.assert_slot_free_at(timestamptz, integer, uuid, boolean) is
  'Internal: fails in Spanish when the window collides with a busy appointment or a block; refuses a start at or before now() unless p_allow_past. assert_slot_free() is this with p_allow_past = false.';

revoke all on function public.assert_slot_free_at(timestamptz, integer, uuid, boolean) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- assert_slot_free - same signature and behavior, now a thin wrapper
-- -----------------------------------------------------------------------------
create or replace function public.assert_slot_free(
  p_start                timestamptz,
  p_duration_mins        integer,
  p_exclude_appointment  uuid default null
)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  -- Migration 30: the migration 06 rules, past refused, unchanged.
  perform public.assert_slot_free_at(p_start, p_duration_mins, p_exclude_appointment, false);
end;
$$;

revoke all on function public.assert_slot_free(timestamptz, integer, uuid) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- appointments_prevent_overlap - migration 21 body + the past-visit exception
-- -----------------------------------------------------------------------------
-- The trigger itself (BEFORE INSERT OR UPDATE OF start_time, service_id,
-- status, migration 19) is unchanged and still points at this function.
create or replace function public.appointments_prevent_overlap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration   integer;
  v_allow_past boolean := false;
begin
  if new.status in ('cancelled', 'rejected') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.start_time is not distinct from old.start_time
     and new.service_id is not distinct from old.service_id
     and old.status not in ('cancelled', 'rejected') then
    return new;
  end if;

  -- Migration 21: no appointment is created, moved or re-activated for an
  -- archived patient, whatever the write path.
  if exists (
    select 1 from public.patients p
    where p.id = new.patient_id
      and p.status = 'archived'
  ) then
    raise exception 'Este paciente está archivado. Restáuralo desde el Directorio de Pacientes para agendarle una cita.'
      using errcode = 'P0001';
  end if;

  -- Migration 30: only the completed row staff_record_past_visit() is
  -- inserting (its id is in the transaction-local flag) may start in the past.
  if tg_op = 'INSERT'
     and new.status = 'completed'
     and coalesce(current_setting('app.recording_past_visit', true), '') = new.id::text then
    v_allow_past := true;
  end if;

  -- Same booking critical section as every booking RPC; see migration 06.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  select coalesce(s.duration_mins, 45)
    into v_duration
  from public.services s
  where s.id = new.service_id;

  -- Migration 30: assert_slot_free_at() with the flag above (false = the
  -- migration 06 rule, past refused).
  perform public.assert_slot_free_at(new.start_time, coalesce(v_duration, 45), new.id, v_allow_past);

  return new;
end;
$$;

revoke all on function public.appointments_prevent_overlap() from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- payments.received_at - the date a charge counts for in Finanzas
-- -----------------------------------------------------------------------------
-- Added and backfilled once: a re-run must never reset the dates of past
-- visits to created_at.
do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.payments'::regclass
      and attname = 'received_at'
      and not attisdropped
  ) then
    alter table public.payments add column received_at timestamptz;
    update public.payments set received_at = created_at;
  end if;
end $$;

alter table public.payments alter column received_at set default now();
alter table public.payments alter column received_at set not null;

create index if not exists payments_received_at_idx on public.payments (received_at);

comment on column public.payments.received_at is
  'When the money counts in Finanzas. now() when the charge is recorded; the visit start for a past visit (staff_record_past_visit). Server-owned: set by payments_guard_received_at, never changed afterwards.';

create or replace function public.payments_guard_received_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.recording_past_visit', true), '') = new.appointment_id::text then
      new.received_at := (
        select a.start_time from public.appointments a where a.id = new.appointment_id
      );
    else
      new.received_at := now();
    end if;

    if new.received_at is null then
      raise exception 'No se encontró la fecha de la cita para el cobro.' using errcode = 'P0001';
    end if;
  elsif new.received_at is distinct from old.received_at then
    raise exception 'La fecha del cobro no se puede cambiar.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.payments_guard_received_at() from public, anon, authenticated, service_role;

drop trigger if exists payments_guard_received_at on public.payments;
create trigger payments_guard_received_at
  before insert or update on public.payments
  for each row execute function public.payments_guard_received_at();

-- -----------------------------------------------------------------------------
-- get_finance_payments - migration 26 body, by received_at
-- -----------------------------------------------------------------------------
create or replace function public.get_finance_payments(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  id             uuid,
  created_at     timestamptz,
  status         text,
  method         text,
  amount_charged numeric,
  list_price     numeric,
  service_name   text
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

  -- Migration 30: the payment date is received_at (the visit's date for a
  -- past visit). The output column keeps the name created_at.
  return query
  select p.id,
         p.received_at,
         p.status,
         p.method,
         p.amount_charged,
         p.list_price,
         s.name::text
  from public.payments p
  left join public.services s on s.id = p.service_id
  where p.received_at >= p_from
    and p.received_at < p_to
  order by p.received_at, p.id;
end;
$$;

comment on function public.get_finance_payments(timestamptz, timestamptz) is
  'Finanzas for business staff: date (payments.received_at, returned as created_at), status, method, amount, list price and service name of each payment received in [p_from, p_to). Never the patient, the appointment or the note.';

revoke all on function public.get_finance_payments(timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.get_finance_payments(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- get_procedure_profit - migration 22 body, by received_at
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
             exists (select 1 from public.clinical_notes cn
                     where cn.appointment_id = p.appointment_id and cn.finalized_at is not null)
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
-- staff_record_past_visit - "Registrar cita pasada" (doctor only)
-- -----------------------------------------------------------------------------
-- Returns the new appointment's id.
create or replace function public.staff_record_past_visit(
  p_patient_id     uuid,
  p_service_id     uuid,
  p_start_time     timestamptz,
  p_payment_status text,
  p_amount         numeric default null,
  p_method         text default null,
  p_note           text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_duration       integer;
  v_appointment_id uuid := gen_random_uuid();
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para registrar citas.' using errcode = '42501';
  end if;

  if p_start_time is null or p_start_time > now() then
    raise exception 'Una cita pasada debe tener una fecha y hora que ya pasaron.'
      using errcode = 'P0001';
  end if;

  -- Same booking critical section as every other booking path; see migration 06.
  perform pg_advisory_xact_lock(public.booking_lock_key());

  if p_patient_id is null
     or not exists (select 1 from public.patients p where p.id = p_patient_id) then
    raise exception 'No se encontró el paciente.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.patients p
    where p.id = p_patient_id
      and (p.status = 'archived' or p.anonymized_at is not null)
  ) then
    raise exception 'Este paciente está archivado. Restáuralo desde el Directorio de Pacientes para registrarle una cita.'
      using errcode = 'P0001';
  end if;

  v_duration := public.service_duration_or_fail(p_service_id);

  -- Busy appointments and blocks, the past allowed.
  begin
    perform public.assert_slot_free_at(p_start_time, v_duration, null, true);
  exception when sqlstate 'P0001' then
    raise exception 'Ya hay una cita o un bloqueo en ese horario. Revisa la hora.'
      using errcode = 'P0001';
  end;

  -- The flag lets appointments_prevent_overlap accept this one past start
  -- and payments_guard_received_at date the charge to the visit.
  perform set_config('app.recording_past_visit', v_appointment_id::text, true);

  insert into public.appointments (id, patient_id, service_id, start_time, status)
  values (v_appointment_id, p_patient_id, p_service_id, p_start_time, 'completed');

  -- Same rules as "Registrar cobro": paid > 0 with a method, a courtesy is 0
  -- with no method, the same caps and note length.
  perform public.record_payment(v_appointment_id, p_payment_status, p_amount, p_method, p_note);

  perform set_config('app.recording_past_visit', '', true);

  return v_appointment_id;
end;
$$;

comment on function public.staff_record_past_visit(uuid, uuid, timestamptz, text, numeric, text, text) is
  'Doctor only: records a visit that already happened (completed, no clinical note, no supplies) and its charge, dated to the visit.';

revoke all on function public.staff_record_past_visit(uuid, uuid, timestamptz, text, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.staff_record_past_visit(uuid, uuid, timestamptz, text, numeric, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn      text;
  v_clean   text;
  v_src     text;
  v_bad     text;
  v_ok      boolean;
  v_message text;
  v_rec     record;
begin
  -- 1. payments.received_at: not null with a default, indexed.
  if not exists (
    select 1 from pg_attribute att
    join pg_attrdef d on d.adrelid = att.attrelid and d.adnum = att.attnum
    where att.attrelid = 'public.payments'::regclass
      and att.attname = 'received_at'
      and not att.attisdropped
      and att.atttypid = 'timestamptz'::regtype
      and att.attnotnull
  ) then
    raise exception 'Migration 30 FAILED: payments.received_at (timestamptz not null default now()) is missing.'
      using errcode = 'P0001';
  end if;

  if to_regclass('public.payments_received_at_idx') is null then
    raise exception 'Migration 30 FAILED: index payments_received_at_idx is missing.' using errcode = 'P0001';
  end if;

  -- 2. The received_at guard: enabled BEFORE INSERT OR UPDATE FOR EACH ROW.
  --    tgtype bits: 1 row, 2 before, 4 insert, 16 update.
  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.payments'::regclass
      and not t.tgisinternal
      and t.tgname = 'payments_guard_received_at'
      and t.tgenabled <> 'D'
      and t.tgfoid = 'public.payments_guard_received_at()'::regprocedure
      and (t.tgtype::integer & 23) = 23
  ) then
    raise exception 'Migration 30 FAILED: the enabled BEFORE INSERT OR UPDATE FOR EACH ROW trigger payments_guard_received_at is missing.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.payments_guard_received_at()'::regprocedure;
  if v_src !~ 'app\.recording_past_visit' or v_src !~ 'new\.received_at := now\(\)'
     or v_src !~ 'new\.received_at is distinct from old\.received_at' then
    raise exception 'Migration 30 FAILED: payments_guard_received_at() must set received_at on insert and refuse any change.'
      using errcode = 'P0001';
  end if;

  -- 3. assert_slot_free_at() holds the migration 06 rules; assert_slot_free()
  --    calls it with the past refused.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.assert_slot_free_at(timestamptz,integer,uuid,boolean)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'not in \(''cancelled'', ''rejected''\)'
     or v_clean !~ 'from public\.blocked_slots b'
     or v_clean !~ 'p_start is null or \(not coalesce\(p_allow_past, false\) and p_start <= now\(\)\)' then
    raise exception 'Migration 30 FAILED: assert_slot_free_at() must be SECURITY DEFINER with a pinned search_path and keep the migration 06 busy, block and past rules.'
      using errcode = 'P0001';
  end if;

  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.assert_slot_free(timestamptz,integer,uuid)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'perform public\.assert_slot_free_at\(p_start, p_duration_mins, p_exclude_appointment, false\)' then
    raise exception 'Migration 30 FAILED: assert_slot_free() must call assert_slot_free_at(..., false).'
      using errcode = 'P0001';
  end if;

  -- Behavior, not only text: the past is refused by assert_slot_free() and
  -- a null start by both.
  v_message := null;
  begin
    perform public.assert_slot_free(now() - interval '1 hour', 30, null);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'La fecha y hora seleccionadas ya no están disponibles.' then
    raise exception 'Migration 30 FAILED: assert_slot_free() no longer refuses a start in the past (got: %).', v_message
      using errcode = 'P0001';
  end if;

  v_message := null;
  begin
    perform public.assert_slot_free_at(null, 30, null, true);
  exception when others then v_message := sqlerrm;
  end;
  if v_message is distinct from 'La fecha y hora seleccionadas ya no están disponibles.' then
    raise exception 'Migration 30 FAILED: assert_slot_free_at() accepts a null start (got: %).', v_message
      using errcode = 'P0001';
  end if;

  -- 4. The overlap trigger: past allowed only for the flagged completed insert.
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.appointments_prevent_overlap()'::regprocedure;
  if v_clean is null
     or v_clean !~ 'if tg_op = ''insert'' and new\.status = ''completed'' and coalesce\(current_setting\(''app\.recording_past_visit'', true\), ''''\) = new\.id::text then v_allow_past := true;'
     or v_clean !~ 'perform public\.assert_slot_free_at\(new\.start_time, coalesce\(v_duration, 45\), new\.id, v_allow_past\)'
     or v_clean !~ 'p\.status = ''archived''' then
    raise exception 'Migration 30 FAILED: appointments_prevent_overlap() must allow the past only for the flagged completed insert and keep the archived check.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.appointments'::regclass
      and not t.tgisinternal
      and t.tgname = 'appointments_prevent_overlap'
      and t.tgenabled <> 'D'
      and t.tgfoid = 'public.appointments_prevent_overlap()'::regprocedure
  ) then
    raise exception 'Migration 30 FAILED: the appointments_prevent_overlap trigger is missing or disabled (apply migration 19 first).'
      using errcode = 'P0001';
  end if;

  -- 5. Finance reads by received_at.
  foreach v_fn in array array[
    'public.get_finance_payments(timestamptz,timestamptz)',
    'public.get_procedure_profit(timestamptz,timestamptz)'
  ] loop
    select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
      into v_clean
    from pg_proc
    where oid = v_fn::regprocedure and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
    if v_clean is null
       or v_clean !~ 'where p\.received_at >= p_from and p\.received_at < p_to'
       or v_clean ~ 'p\.created_at' then
      raise exception 'Migration 30 FAILED: % must filter payments by received_at.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- 6. staff_record_past_visit(): doctor only, past only, locked, charged
  --    through record_payment().
  select regexp_replace(lower(regexp_replace(coalesce(prosrc, ''), $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')), '\s+', ' ', 'g')
    into v_clean
  from pg_proc
  where oid = 'public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)'::regprocedure and prosecdef
    and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%');
  if v_clean is null
     or v_clean !~ 'if not public\.is_staff\(\) then raise'
     or v_clean !~ 'if p_start_time is null or p_start_time > now\(\) then raise'
     or v_clean !~ 'perform pg_advisory_xact_lock\(public\.booking_lock_key\(\)\)'
     or v_clean !~ 'p\.anonymized_at is not null'
     or v_clean !~ 'perform public\.assert_slot_free_at\(p_start_time, v_duration, null, true\)'
     or v_clean !~ 'perform set_config\( , v_appointment_id::text, true\); insert into public\.appointments \(id, patient_id, service_id, start_time, status\)'
     or v_clean !~ 'perform public\.record_payment\(v_appointment_id, p_payment_status, p_amount, p_method, p_note\)' then
    raise exception 'Migration 30 FAILED: staff_record_past_visit() must be SECURITY DEFINER, doctor only, refuse a future start and archived patients, lock, check the slot and charge through record_payment().'
      using errcode = 'P0001';
  end if;

  -- 7. Grants: the RPC for authenticated only; the internals for nobody.
  if has_function_privilege('anon', 'public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'execute') then
    raise exception 'Migration 30 FAILED: staff_record_past_visit() must be executable by authenticated only.'
      using errcode = 'P0001';
  end if;

  foreach v_fn in array array[
    'public.assert_slot_free_at(timestamptz,integer,uuid,boolean)',
    'public.assert_slot_free(timestamptz,integer,uuid)',
    'public.appointments_prevent_overlap()',
    'public.payments_guard_received_at()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'Migration 30 FAILED: % is executable by anon, authenticated or service_role.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  foreach v_fn in array array[
    'public.get_finance_payments(timestamptz,timestamptz)',
    'public.get_procedure_profit(timestamptz,timestamptz)'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 30 FAILED: % must be executable by authenticated only.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 8. Migration 29 rules still hold: default privileges give new functions
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
    raise exception 'Migration 30 FAILED: default privileges give EXECUTE on new functions to % (apply migration 29 first).', v_bad
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
    raise exception 'Migration 30 FAILED: trigger functions executable by anon, authenticated or service_role: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 9. The SECURITY DEFINER surface: migration 29's reviewed list plus
  --    staff_record_past_visit(). Matched by SIGNATURE (oid), never by name;
  --    the guard must be real code (comments and string literals stripped).
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
        -- Migration 31 (open clinical notes): listed here too so a re-run of this file still passes.
        ('public.close_clinical_note(uuid)', 'staff'),
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
      raise exception 'Migration 30 FAILED: unreviewed SECURITY DEFINER function executable by anon or authenticated: %. Nothing was changed.', v_rec.sig
        using errcode = 'P0001';
    end if;

    if v_rec.anon_x and v_rec.kind <> 'public' then
      raise exception 'Migration 30 FAILED: anon can execute %.', v_rec.sig using errcode = 'P0001';
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
      raise exception 'Migration 30 FAILED: % (%) has no internal % guard in its code.', v_rec.sig, v_rec.kind, v_rec.kind
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 30 PASSED: staff_record_past_visit() lets only the doctor record a visit that already happened (completed, locked, slot checked with the past allowed) and charges it through record_payment() dated to the visit; assert_slot_free() still refuses the past and the overlap trigger allows it only for that flagged insert; payments.received_at is server-owned and Finanzas (get_finance_payments, get_procedure_profit) counts by it; no internal function or trigger function is API-executable; the SECURITY DEFINER surface matches the reviewed list by signature.';
end $$;
