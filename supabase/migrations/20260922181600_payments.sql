-- =============================================================================
-- 17 - Consultation payments (Phase 5)
-- =============================================================================
-- Problem this file fixes:
--   The clinic had no record of what each consultation was charged, so the
--   Finances view (income - supply spending) had no income source, and a
--   consultation given for free (a courtesy) was indistinguishable from one the
--   doctor forgot to charge.
--
-- Design:
--   * public.payments holds ONE row per appointment (appointment_id is unique).
--     status 'paid' carries the amount actually charged (> 0) and how it was
--     paid; status 'courtesy' records a free consultation (amount 0, no method)
--     and keeps the service's list price, so the Finances view can show how much
--     value was given away.
--   * public.record_payment() is the ONLY writer. It upserts by appointment, so
--     a charge can be corrected later ("Editar cobro"), and it fills
--     patient_id, service_id and list_price on the server from the appointment
--     and its service. The browser cannot send a patient or a price.
--   * list_price is the service price when the payment was FIRST recorded; a
--     correction keeps it, so a later catalog price change does not rewrite the
--     value of past courtesies.
--   * Staff only: staff can SELECT; nobody can INSERT/UPDATE/DELETE through the
--     API (writes go through record_payment, SECURITY DEFINER). Patients and
--     anon get nothing.
--   * Foreign keys are ON DELETE RESTRICT: a financial record must not vanish
--     because an appointment, patient or service row was deleted.
--   * Every insert/correction is written to public.audit_log by the existing
--     audit_row_change trigger (column NAMES only, never amounts), so "who
--     changed this charge, when" is answerable.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid not null references public.appointments (id) on delete restrict,
  patient_id      uuid references public.patients (id) on delete restrict,
  service_id      uuid references public.services (id) on delete restrict,
  list_price      numeric(12,2),
  amount_charged  numeric(12,2) not null default 0,
  status          text not null,
  method          text,
  note            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.payments drop constraint if exists payments_appointment_id_key;
alter table public.payments add constraint payments_appointment_id_key unique (appointment_id);

alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('paid', 'courtesy'));

alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method is null or method in ('cash', 'card', 'transfer'));

alter table public.payments drop constraint if exists payments_amount_check;
alter table public.payments add constraint payments_amount_check
  check (amount_charged >= 0 and (list_price is null or list_price >= 0));

-- A courtesy is free and has no method; a paid consultation has both.
alter table public.payments drop constraint if exists payments_consistency_check;
alter table public.payments add constraint payments_consistency_check
  check (
    (status = 'courtesy' and amount_charged = 0 and method is null)
    or (status = 'paid' and amount_charged > 0 and method is not null)
  );

alter table public.payments drop constraint if exists payments_note_check;
alter table public.payments add constraint payments_note_check
  check (note is null or length(note) <= 500);

create index if not exists payments_created_at_idx on public.payments (created_at);

comment on table public.payments is
  'One charge per appointment (paid or courtesy). Written only by record_payment().';

-- -----------------------------------------------------------------------------
-- Privileges and RLS: staff read; writes only through record_payment()
-- -----------------------------------------------------------------------------
alter table public.payments enable row level security;

revoke all on public.payments from public, anon, authenticated, service_role;
grant select on public.payments to authenticated;

drop policy if exists "payments_select_staff" on public.payments;
create policy "payments_select_staff"
  on public.payments for select to authenticated
  using (public.is_staff());

-- -----------------------------------------------------------------------------
-- Audit: same generic trigger as the clinical tables (migration 08)
-- -----------------------------------------------------------------------------
drop trigger if exists audit_row_change on public.payments;
create trigger audit_row_change
  after insert or update or delete on public.payments
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- record_payment - the only way to record or correct a charge
-- -----------------------------------------------------------------------------
--   paid     -> p_amount > 0 (rounded to cents) and p_method in cash/card/transfer.
--   courtesy -> stored as amount 0 and no method, whatever was passed.
-- Returns the stored row.
create or replace function public.record_payment(
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
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_amount   numeric(12,2);
  v_method   text;
  v_patient  uuid;
  v_service  uuid;
  v_price    numeric;
  v_appt     text;
  v_row      public.payments;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para registrar cobros.' using errcode = '42501';
  end if;

  if p_status is null or p_status not in ('paid', 'courtesy') then
    raise exception 'Indica si cobraste la consulta o si fue cortesía.' using errcode = 'P0001';
  end if;

  if p_status = 'paid' then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Indica cuánto cobraste (más de 0).' using errcode = 'P0001';
    end if;
    if p_amount >= 10000000000 then
      raise exception 'El monto es demasiado grande.' using errcode = 'P0001';
    end if;
    if p_method is null or p_method not in ('cash', 'card', 'transfer') then
      raise exception 'Indica cómo te pagaron (efectivo, tarjeta o transferencia).' using errcode = 'P0001';
    end if;
    v_amount := round(p_amount, 2);
    if v_amount <= 0 then
      raise exception 'Indica cuánto cobraste (más de 0).' using errcode = 'P0001';
    end if;
    v_method := p_method;
  else
    v_amount := 0;
    v_method := null;
  end if;

  if v_note is not null and length(v_note) > 500 then
    raise exception 'La nota es demasiado larga (máximo 500 caracteres).' using errcode = 'P0001';
  end if;

  select a.patient_id, a.service_id, s.price, a.status
    into v_patient, v_service, v_price, v_appt
  from public.appointments a
  left join public.services s on s.id = a.service_id
  where a.id = p_appointment_id;

  if not found then
    raise exception 'No se encontró la cita.' using errcode = 'P0001';
  end if;

  if v_appt in ('cancelled', 'rejected') then
    raise exception 'Esta cita está cancelada: no se puede registrar un cobro.' using errcode = 'P0001';
  end if;

  insert into public.payments (
    appointment_id, patient_id, service_id, list_price,
    amount_charged, status, method, note
  )
  values (
    p_appointment_id, v_patient, v_service,
    case when v_price is not null and v_price >= 0 then round(v_price, 2) end,
    v_amount, p_status, v_method, v_note
  )
  on conflict (appointment_id) do update
    set patient_id     = excluded.patient_id,
        service_id     = excluded.service_id,
        list_price     = coalesce(public.payments.list_price, excluded.list_price),
        amount_charged = excluded.amount_charged,
        status         = excluded.status,
        method         = excluded.method,
        note           = excluded.note,
        updated_at     = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.record_payment(uuid, text, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.record_payment(uuid, text, numeric, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  r      text;
  v_priv text;
  c      text;
begin
  if not exists (
    select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relname = 'payments' and cl.relrowsecurity
  ) then
    raise exception 'Migration 17 FAILED: payments is missing or RLS is off.' using errcode = 'P0001';
  end if;

  foreach c in array array[
    'payments_appointment_id_key', 'payments_status_check', 'payments_method_check',
    'payments_amount_check', 'payments_consistency_check', 'payments_note_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.payments'::regclass and conname = c and convalidated
    ) then
      raise exception 'Migration 17 FAILED: constraint % is missing on payments.', c using errcode = 'P0001';
    end if;
  end loop;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments'
      and policyname = 'payments_select_staff' and cmd = 'SELECT'
  ) then
    raise exception 'Migration 17 FAILED: policy payments_select_staff is missing.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments' and cmd <> 'SELECT'
  ) then
    raise exception 'Migration 17 FAILED: payments has a non-SELECT policy; writes must go through record_payment().'
      using errcode = 'P0001';
  end if;

  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(r, 'public.payments', v_priv) then
        raise exception 'Migration 17 FAILED: role % holds % on payments.', r, v_priv using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon', 'public.payments', 'SELECT') then
    raise exception 'Migration 17 FAILED: anon can SELECT payments.' using errcode = 'P0001';
  end if;

  if not has_table_privilege('authenticated', 'public.payments', 'SELECT') then
    raise exception 'Migration 17 FAILED: authenticated cannot SELECT payments (staff would see nothing).' using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', 'public.record_payment(uuid,text,numeric,text,text)', 'execute') then
    raise exception 'Migration 17 FAILED: authenticated cannot execute record_payment.' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.record_payment(uuid,text,numeric,text,text)', 'execute') then
    raise exception 'Migration 17 FAILED: anon can execute record_payment.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.record_payment(uuid,text,numeric,text,text)'::regprocedure
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 17 FAILED: record_payment is not SECURITY DEFINER with a pinned search_path.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'public.payments'::regclass and tg.tgname = 'audit_row_change'
      and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) then
    raise exception 'Migration 17 FAILED: audit_row_change trigger is missing on payments.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 17 PASSED: payments is staff-only, one row per appointment, consistent (paid > 0 with a method, courtesy = 0 without one), written only by record_payment(), and audited.';
end $$;
