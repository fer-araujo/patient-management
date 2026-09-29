-- =============================================================================
-- 22 - Supplies per service and profit per procedure
-- =============================================================================
-- Problems this file fixes:
--   1. The catalog did not know which supplies each service consumes, so the
--      doctor had to remember to discount them from the inventory by hand.
--   2. "Finalizar Consulta" recorded the charge but never the supplies used,
--      so the stock drifted from reality and nothing tied a supply cost to a
--      procedure.
--   3. Finanzas could only compare income against PURCHASES (cash view). The
--      doctor could not see whether a given procedure pays for its supplies.
--
-- Design:
--   * public.service_supplies (service_id, item_id, quantity > 0) is the
--     "recipe" of each service, unique per (service, item). Business staff
--     (doctor or admin) read and write it (RLS via is_business_staff()), like
--     the rest of the catalog. Every change is audited by the generic
--     audit_row_change() trigger (column NAMES only), like payments.
--     set_service_supplies() replaces the list of one service in ONE call, so
--     the catalog modal never leaves a half-saved list.
--   * inventory_movements.appointment_id (nullable, FK ON DELETE RESTRICT)
--     links a 'use' movement to the consultation it was used in.
--   * apply_stock_movement() is the core of adjust_stock() moved into an
--     internal helper (no grant to any API role): the transaction-local ledger
--     flag, the single atomic UPDATE that refuses negative stock and archived
--     items, the same error messages, and the ledger insert. adjust_stock() is
--     re-created from its migration 18 body with its own validation unchanged
--     and now calls the helper, so there is still exactly ONE place that
--     changes stock and "sum of the ledger = stock" keeps holding.
--   * record_supplies_used() (internal) is THE supplies step: one 'use'
--     movement per supply ([{ "item_id": uuid, "quantity": integer > 0 }])
--     linked to the appointment, with a SERVER-SIDE unit cost snapshot: the
--     weighted average of that item's purchases (sum total_cost / sum
--     quantity), null when the item was never purchased. The client never
--     sends a cost: any key other than item_id and quantity is refused. It
--     then stamps clinical_notes.supplies_recorded_at, also for an EMPTY list
--     ("used none"). Supplies are recorded once per consultation.
--   * finalize_consultation_with_payment() is re-created from its migration 20
--     body, copied verbatim, plus p_supplies jsonb DEFAULT NULL. A list (even
--     empty) runs the supplies step in the same transaction; null means the
--     step was skipped (e.g. the inventory did not load) and leaves the
--     consultation pending. Insufficient stock, an archived item or a bad list
--     aborts the WHOLE call (note, payment, movements, marker). The previous
--     5-argument overload is dropped; callers that send 5 arguments reach the
--     new one through the default.
--   * record_consultation_supplies() ("Registrar insumos" in the calendar)
--     runs the same step later for a finalized consultation whose supplies
--     were never recorded. The calendar shows those in red when their service
--     has supplies configured.
--   * inventory_movements_cost_check keeps "purchases need a cost" and
--     "manual uses and adjustments carry no cost"; the only relaxation is that
--     a 'use' linked to an appointment may carry the server-computed
--     unit_cost/total_cost. A new check allows appointment_id only on 'use'
--     movements that remove stock.
--   * get_procedure_profit(from, to): one row per service for the payments
--     recorded in the range (the same date rule as the cash view): times,
--     charged (paid), value of courtesies, cost of the supplies used on those
--     appointments, supplies without a registered cost, and charged minus
--     supplies. Business staff only; it returns no patient data, so the admin
--     can read it. It also counts, per service, the consultations whose
--     supplies were never recorded. The cash view (income - purchases) is unchanged: 'use'
--     movements are never counted as spending, so nothing is counted twice.
--
-- Note for maintainers: migration 18's gate whitelists every policy and
-- function that uses is_business_staff() as of migration 18. This file adds
-- service_supplies_business_all, set_service_supplies() and
-- get_procedure_profit(), so re-running migration 18 after this file makes
-- its gate report them. Re-running migrations 16, 18 or 20 after this file
-- would also restore their older adjust_stock() / finalize overloads; run
-- this file again afterwards.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pre-flight: no manual use or adjustment may already carry a cost
-- -----------------------------------------------------------------------------
-- adjust_stock() always refused a cost outside purchases, so this should find
-- nothing. appointment_id is read through to_jsonb() because the column does
-- not exist yet on the first run.
do $$
declare
  v_count integer;
  v_list  text;
begin
  select count(*),
         string_agg(format('  id=%s | item_id=%s | type=%s | total_cost=%s', m.id, m.item_id, m.type, m.total_cost),
                    E'\n' order by m.created_at)
    into v_count, v_list
  from public.inventory_movements m
  where m.type <> 'purchase'
    and (m.unit_cost is not null or m.total_cost is not null)
    and not (m.type = 'use' and (to_jsonb(m) ->> 'appointment_id') is not null);

  if v_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        E'Migration 22 ABORTED: %s movement(s) that are not purchases carry a cost. Nothing was changed.\n%s\n'
        'These rows cannot come from adjust_stock(). Review them before running this migration again.',
        v_count, v_list);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- inventory_movements: link a use to its consultation
-- -----------------------------------------------------------------------------
alter table public.inventory_movements add column if not exists appointment_id uuid;

alter table public.inventory_movements drop constraint if exists inventory_movements_appointment_id_fkey;
alter table public.inventory_movements add constraint inventory_movements_appointment_id_fkey
  foreign key (appointment_id) references public.appointments (id) on delete restrict;

create index if not exists inventory_movements_appointment_idx
  on public.inventory_movements (appointment_id)
  where appointment_id is not null;

comment on column public.inventory_movements.appointment_id is
  'Consultation a ''use'' movement was recorded for (finalize_consultation_with_payment). Null for manual movements.';

-- Purchases need a cost; manual uses and adjustments carry none; a use linked
-- to a consultation may carry the cost snapshot computed by the server.
alter table public.inventory_movements drop constraint if exists inventory_movements_cost_check;
alter table public.inventory_movements add constraint inventory_movements_cost_check
  check (
    (total_cost is null or total_cost >= 0)
    and (unit_cost is null or unit_cost >= 0)
    and (type <> 'purchase' or (quantity > 0 and total_cost is not null))
    and (
      type = 'purchase'
      or (unit_cost is null and total_cost is null)
      or (type = 'use' and appointment_id is not null)
    )
  );

alter table public.inventory_movements drop constraint if exists inventory_movements_appointment_check;
alter table public.inventory_movements add constraint inventory_movements_appointment_check
  check (appointment_id is null or (type = 'use' and quantity < 0));

-- -----------------------------------------------------------------------------
-- service_supplies - what each service consumes
-- -----------------------------------------------------------------------------
create table if not exists public.service_supplies (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null,
  item_id     uuid not null,
  quantity    integer not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The list belongs to the service; a line of a deleted item means nothing.
-- (Items and services are archived, not deleted, in the app.)
alter table public.service_supplies drop constraint if exists service_supplies_service_id_fkey;
alter table public.service_supplies add constraint service_supplies_service_id_fkey
  foreign key (service_id) references public.services (id) on delete cascade;

alter table public.service_supplies drop constraint if exists service_supplies_item_id_fkey;
alter table public.service_supplies add constraint service_supplies_item_id_fkey
  foreign key (item_id) references public.inventory (id) on delete cascade;

alter table public.service_supplies drop constraint if exists service_supplies_service_item_key;
alter table public.service_supplies add constraint service_supplies_service_item_key
  unique (service_id, item_id);

alter table public.service_supplies drop constraint if exists service_supplies_quantity_check;
alter table public.service_supplies add constraint service_supplies_quantity_check
  check (quantity > 0 and quantity <= 100000);

create index if not exists service_supplies_item_idx on public.service_supplies (item_id);

comment on table public.service_supplies is
  'Supplies each service uses (catalog). Pre-fills "Insumos usados" when a consultation is finalized.';

alter table public.service_supplies enable row level security;

revoke all on public.service_supplies from public, anon;
grant select, insert, update, delete on public.service_supplies to authenticated;

drop policy if exists "service_supplies_business_all" on public.service_supplies;
create policy "service_supplies_business_all"
  on public.service_supplies for all to authenticated
  using (public.is_business_staff())
  with check (public.is_business_staff());

drop trigger if exists audit_row_change on public.service_supplies;
create trigger audit_row_change
  after insert or update or delete on public.service_supplies
  for each row execute function public.audit_row_change();

-- -----------------------------------------------------------------------------
-- clinical_notes.supplies_recorded_at - "the supplies step was done"
-- -----------------------------------------------------------------------------
-- Set when the doctor confirms the supplies of a consultation, INCLUDING an
-- empty list (she may have used none). Null on a finalized note means the
-- consultation was closed without that step (e.g. the inventory failed to
-- load); the calendar flags it and "Registrar insumos" records them later.
--
-- It lives on the note, not on the appointment: every UPDATE of
-- public.appointments fires the whatsapp_notifications webhook, which resends
-- "CONFIRMADA" to the patient for a confirmed appointment (finalization happens
-- before the status becomes 'completed'). Every finalized consultation has a
-- note (migration 20), and notes are doctor-only like this marker.
--
-- Old data: the column is added with the migration time as a stored default,
-- so every existing note gets a value WITHOUT an UPDATE (no row trigger, no
-- audit entry per note), then the default is dropped. Only still-open drafts
-- are reset to null, since they have not been finalized yet. This runs once,
-- when the column is created, so a re-run never marks newer pending
-- consultations as recorded.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_notes'
      and column_name = 'supplies_recorded_at'
  ) then
    alter table public.clinical_notes add column supplies_recorded_at timestamptz default now();
    alter table public.clinical_notes alter column supplies_recorded_at drop default;

    perform set_config('app.supplies_marker', 'on', true);
    update public.clinical_notes set supplies_recorded_at = null where finalized_at is null;
    perform set_config('app.supplies_marker', '', true);
  end if;
end $$;

comment on column public.clinical_notes.supplies_recorded_at is
  'When the supplies of the consultation were confirmed (even none). Null on a finalized note = never recorded. Written only by record_supplies_used().';

-- Only record_supplies_used() writes it (transaction-local flag, like the
-- inventory ledger). A direct UPDATE could hide a pending consultation or, if
-- cleared, reopen it; a direct INSERT always starts at null.
create or replace function public.guard_supplies_marker()
returns trigger
language plpgsql
set search_path = pg_temp
as $$
begin
  if coalesce(current_setting('app.supplies_marker', true), '') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.supplies_recorded_at := null;
  elsif new.supplies_recorded_at is distinct from old.supplies_recorded_at then
    raise exception 'Los insumos de una consulta solo se registran al finalizarla o con "Registrar insumos".'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_supplies_marker() from public, anon, authenticated;

drop trigger if exists clinical_notes_guard_supplies_marker on public.clinical_notes;
create trigger clinical_notes_guard_supplies_marker
  before insert or update on public.clinical_notes
  for each row execute function public.guard_supplies_marker();

-- -----------------------------------------------------------------------------
-- parse_supply_list - validates [{item_id, quantity}] and merges duplicates
-- -----------------------------------------------------------------------------
-- Internal (no API grant). Used by set_service_supplies() and
-- finalize_consultation_with_payment(), so both accept exactly the same shape.
-- Only item_id and quantity are accepted: a cost sent by the browser is
-- refused, never stored.
create or replace function public.parse_supply_list(p_supplies jsonb)
returns table (item_id uuid, quantity integer)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_list jsonb := coalesce(p_supplies, '[]'::jsonb);
  v_elem jsonb;
  v_qty  text;
begin
  if jsonb_typeof(v_list) <> 'array' then
    raise exception 'La lista de insumos no es válida.' using errcode = 'P0001';
  end if;

  if jsonb_array_length(v_list) > 50 then
    raise exception 'Son demasiados insumos (máximo 50).' using errcode = 'P0001';
  end if;

  for v_elem in select e.value from jsonb_array_elements(v_list) e loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'La lista de insumos no es válida.' using errcode = 'P0001';
    end if;

    if (v_elem - array['item_id', 'quantity']) <> '{}'::jsonb then
      raise exception 'De cada insumo solo se indica el artículo y la cantidad; el costo lo calcula el sistema.'
        using errcode = 'P0001';
    end if;

    if jsonb_typeof(v_elem -> 'item_id') is distinct from 'string'
       or (v_elem ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Uno de los insumos no es válido.' using errcode = 'P0001';
    end if;

    v_qty := v_elem ->> 'quantity';
    if jsonb_typeof(v_elem -> 'quantity') is distinct from 'number' or v_qty !~ '^[0-9]{1,6}$' then
      raise exception 'La cantidad de cada insumo debe ser un número entero mayor que 0.' using errcode = 'P0001';
    end if;
    if v_qty::integer < 1 or v_qty::integer > 100000 then
      raise exception 'La cantidad de cada insumo debe ser un número entero mayor que 0.' using errcode = 'P0001';
    end if;
  end loop;

  return query
    select (e.value ->> 'item_id')::uuid,
           sum((e.value ->> 'quantity')::integer)::integer
    from jsonb_array_elements(v_list) e
    group by 1;
end;
$$;

revoke all on function public.parse_supply_list(jsonb) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- apply_stock_movement - the core of adjust_stock(), shared
-- -----------------------------------------------------------------------------
-- Internal (no API grant): only SECURITY DEFINER RPCs that already checked
-- permissions and validated the movement call it. Same statements and messages
-- as the migration 16/18 body of adjust_stock(); the table checks still
-- enforce the cost rules.
create or replace function public.apply_stock_movement(
  p_item_id        uuid,
  p_delta          integer,
  p_type           text,
  p_unit_cost      numeric,
  p_total_cost     numeric,
  p_note           text,
  p_appointment_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_stock integer;
  v_current   integer;
  v_active    boolean;
begin
  -- One atomic statement: concurrent calls on the same row queue on its lock
  -- and each re-evaluates the WHERE against the latest committed stock.
  perform set_config('app.inventory_ledger', 'on', true);

  update public.inventory
     set stock_quantity    = coalesce(stock_quantity, 0) + p_delta,
         last_restock_date = case
                               when p_type = 'purchase'
                                 then (now() at time zone 'America/Monterrey')::date
                               else last_restock_date
                             end
   where id = p_item_id
     and is_active is distinct from false
     and coalesce(stock_quantity, 0) + p_delta >= 0
  returning stock_quantity into v_new_stock;

  perform set_config('app.inventory_ledger', '', true);

  if v_new_stock is null then
    select i.stock_quantity, i.is_active into v_current, v_active
    from public.inventory i
    where i.id = p_item_id;

    if not found then
      raise exception 'No se encontró el artículo.' using errcode = 'P0001';
    end if;
    if v_active is false then
      raise exception 'Este artículo está archivado. Reactívalo para mover su stock.' using errcode = 'P0001';
    end if;
    raise exception 'No hay suficiente stock: quedan % unidades.', coalesce(v_current, 0)
      using errcode = 'P0001';
  end if;

  insert into public.inventory_movements (
    item_id, type, quantity, unit_cost, total_cost, note, appointment_id
  )
  values (
    p_item_id, p_type, p_delta, p_unit_cost, p_total_cost, p_note, p_appointment_id
  );

  return v_new_stock;
end;
$$;

revoke all on function public.apply_stock_movement(uuid, integer, text, numeric, numeric, text, uuid)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- adjust_stock - migration 18 body; the stock change moved to the helper
-- -----------------------------------------------------------------------------
-- Same signature, permission check, validation and messages as before. Manual
-- movements are never linked to a consultation and only purchases carry cost.
create or replace function public.adjust_stock(
  p_item_id    uuid,
  p_delta      integer,
  p_type       text,
  p_total_cost numeric default null,
  p_note       text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_business_staff() then
    raise exception 'No tienes permisos para modificar el inventario.' using errcode = '42501';
  end if;

  if p_type is null or p_type not in ('purchase', 'use', 'adjustment') then
    raise exception 'Tipo de movimiento no válido.' using errcode = 'P0001';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'La cantidad debe ser distinta de cero.' using errcode = 'P0001';
  end if;

  if p_type = 'purchase' then
    if p_delta < 0 then
      raise exception 'Una compra debe sumar unidades.' using errcode = 'P0001';
    end if;
    if p_total_cost is null or p_total_cost < 0 then
      raise exception 'Indica cuánto pagaste en total (0 o más).' using errcode = 'P0001';
    end if;
  else
    if p_total_cost is not null then
      raise exception 'Solo las compras llevan costo.' using errcode = 'P0001';
    end if;
    if p_type = 'use' and p_delta > 0 then
      raise exception 'Un uso debe restar unidades.' using errcode = 'P0001';
    end if;
  end if;

  if v_note is not null and length(v_note) > 500 then
    raise exception 'La nota es demasiado larga (máximo 500 caracteres).' using errcode = 'P0001';
  end if;

  return public.apply_stock_movement(
    p_item_id,
    p_delta,
    p_type,
    case when p_type = 'purchase' then round(p_total_cost / p_delta, 2) end,
    case when p_type = 'purchase' then p_total_cost end,
    v_note,
    null
  );
end;
$$;

revoke all on function public.adjust_stock(uuid, integer, text, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.adjust_stock(uuid, integer, text, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- set_service_supplies - "Insumos que usa" of one service, saved at once
-- -----------------------------------------------------------------------------
-- Replaces the list: rows not in p_supplies are removed, the rest inserted or
-- updated. Unchanged rows are not touched, so saving a service without
-- changing its supplies writes no audit entry. Returns how many supplies the
-- service now has.
create or replace function public.set_service_supplies(
  p_service_id uuid,
  p_supplies   jsonb default '[]'::jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if not public.is_business_staff() then
    raise exception 'No tienes permisos para modificar el catálogo.' using errcode = '42501';
  end if;

  -- Two saves of the same service queue here instead of interleaving.
  perform 1 from public.services s where s.id = p_service_id for update;
  if not found then
    raise exception 'No se encontró el tratamiento.' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.parse_supply_list(p_supplies) l
    where not exists (select 1 from public.inventory i where i.id = l.item_id)
  ) then
    raise exception 'Uno de los insumos ya no existe en el inventario.' using errcode = 'P0001';
  end if;

  delete from public.service_supplies ss
   where ss.service_id = p_service_id
     and ss.item_id not in (select l.item_id from public.parse_supply_list(p_supplies) l);

  insert into public.service_supplies as ss (service_id, item_id, quantity)
  select p_service_id, l.item_id, l.quantity
  from public.parse_supply_list(p_supplies) l
  on conflict (service_id, item_id) do update
    set quantity   = excluded.quantity,
        updated_at = now()
    where ss.quantity is distinct from excluded.quantity;

  select count(*) into v_count
  from public.service_supplies ss
  where ss.service_id = p_service_id;

  return v_count;
end;
$$;

revoke all on function public.set_service_supplies(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.set_service_supplies(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- record_supplies_used - the supplies step, shared by finalize and "later"
-- -----------------------------------------------------------------------------
-- Internal (no API grant). Callers check permissions and the appointment.
-- One 'use' movement per item, linked to the appointment, with a server-side
-- cost snapshot (weighted average of the item's purchases, null if never
-- bought), through apply_stock_movement(). Then it stamps
-- clinical_notes.supplies_recorded_at, also for an EMPTY list. Refused when
-- the supplies of the consultation were already recorded. Returns how many
-- movements it wrote.
create or replace function public.record_supplies_used(
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
  v_supply record;
  v_name   text;
  v_stock  integer;
  v_active boolean;
  v_avg    numeric;
  v_count  integer := 0;
begin
  -- A double submit (or finalize racing "Registrar insumos") queues here, so
  -- the check below sees the first call's marker and movements.
  perform pg_advisory_xact_lock(hashtextextended('finalize_supplies:' || p_appointment_id::text, 0));

  if not exists (
    select 1 from public.clinical_notes cn where cn.appointment_id = p_appointment_id
  ) then
    raise exception 'Esta consulta no tiene nota clínica: no se pueden registrar sus insumos.'
      using errcode = 'P0001';
  end if;

  if exists (
       select 1 from public.clinical_notes cn
       where cn.appointment_id = p_appointment_id and cn.supplies_recorded_at is not null
     )
     or exists (
       select 1 from public.inventory_movements m
       where m.appointment_id = p_appointment_id
     ) then
    raise exception 'Los insumos de esta consulta ya estaban registrados.' using errcode = 'P0001';
  end if;

  -- Ordered by item, so two consultations lock items in the same order.
  for v_supply in
    select l.item_id, l.quantity
    from public.parse_supply_list(p_supplies) l
    order by l.item_id
  loop
    select i.name, coalesce(i.stock_quantity, 0), i.is_active
      into v_name, v_stock, v_active
    from public.inventory i
    where i.id = v_supply.item_id;

    if not found then
      raise exception 'Uno de los insumos ya no existe en el inventario.' using errcode = 'P0001';
    end if;
    if v_active is false then
      raise exception '"%" está archivado en el inventario. Quítalo de los insumos usados.', v_name
        using errcode = 'P0001';
    end if;
    if v_stock < v_supply.quantity then
      raise exception 'Solo hay % de "%" en inventario.', v_stock, v_name using errcode = 'P0001';
    end if;

    -- Weighted average of every purchase of the item; null if never bought.
    select sum(m.total_cost) / nullif(sum(m.quantity), 0)
      into v_avg
    from public.inventory_movements m
    where m.item_id = v_supply.item_id
      and m.type = 'purchase';

    -- Re-checks the stock atomically (a concurrent use may have taken it).
    perform public.apply_stock_movement(
      v_supply.item_id,
      -v_supply.quantity,
      'use',
      round(v_avg, 2),
      round(v_avg * v_supply.quantity, 2),
      'Usado en consulta',
      p_appointment_id
    );
    v_count := v_count + 1;
  end loop;

  perform set_config('app.supplies_marker', 'on', true);
  update public.clinical_notes
     set supplies_recorded_at = now()
   where appointment_id = p_appointment_id;
  perform set_config('app.supplies_marker', '', true);

  return v_count;
end;
$$;

revoke all on function public.record_supplies_used(uuid, jsonb) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- finalize_consultation_with_payment - migration 20 body + supplies used
-- -----------------------------------------------------------------------------
-- The migration 20 body is copied verbatim; the block marked "Migration 22"
-- is the only addition. p_supplies:
--   * a list, even empty -> the supplies step was done: recorded and marked;
--   * null (the default, and what a 5-argument call sends) -> the step was
--     skipped (e.g. the inventory did not load): nothing is recorded and the
--     consultation stays pending for "Registrar insumos".
-- Any exception (incomplete note, refused charge, bad list, archived item, not
-- enough stock) aborts the whole call: no frozen note, no payment, no
-- movement, no marker.
drop function if exists public.finalize_consultation_with_payment(uuid, text, numeric, text, text);

create or replace function public.finalize_consultation_with_payment(
  p_appointment_id uuid,
  p_status         text,
  p_amount         numeric default null,
  p_method         text default null,
  p_note           text default null,
  p_supplies       jsonb default null
)
returns public.payments
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.payments;
begin
  if not public.is_staff() then
    raise exception 'No tienes permisos para finalizar consultas.' using errcode = '42501';
  end if;

  perform public.finalize_consultation(p_appointment_id);

  v_row := public.record_payment(p_appointment_id, p_status, p_amount, p_method, p_note);

  -- Migration 22: the supplies step, when it was done.
  if p_supplies is not null then
    perform public.record_supplies_used(p_appointment_id, p_supplies);
  end if;

  return v_row;
end;
$$;

revoke all on function public.finalize_consultation_with_payment(uuid, text, numeric, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.finalize_consultation_with_payment(uuid, text, numeric, text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- record_consultation_supplies - "Registrar insumos" from the calendar
-- -----------------------------------------------------------------------------
-- For a finalized consultation whose supplies step was skipped. Same list,
-- validation, cost snapshot and stock path as finalize (record_supplies_used).
-- A second call is refused. Returns how many movements were written.
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

  if not exists (
    select 1 from public.clinical_notes cn
    where cn.appointment_id = p_appointment_id and cn.finalized_at is not null
  ) then
    raise exception 'Solo se pueden registrar insumos de una consulta finalizada.' using errcode = 'P0001';
  end if;

  return public.record_supplies_used(p_appointment_id, coalesce(p_supplies, '[]'::jsonb));
end;
$$;

revoke all on function public.record_consultation_supplies(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_consultation_supplies(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- get_procedure_profit - "Ganancia por procedimiento" in Finanzas
-- -----------------------------------------------------------------------------
-- p_from inclusive, p_to exclusive, on payments.created_at (the cash view's
-- rule). One row per service; no patient data, so the admin can read it.
-- unrecorded_consultations counts the finalized consultations of a service
-- with supplies configured whose supplies were never recorded (the calendar's
-- red flag): their profit may be overstated.
drop function if exists public.get_procedure_profit(timestamptz, timestamptz);

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
    where p.created_at >= p_from
      and p.created_at < p_to
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
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  r        text;
  v_priv   text;
  c        text;
  v_fn     text;
  v_src    text;
  v_bad    integer;
  v_item   uuid;
  v_appt   uuid;
  v_note   uuid;
  v_state  text;
begin
  -- 1. service_supplies: table, RLS, policy, grants, constraints, audit.
  if not exists (
    select 1 from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relname = 'service_supplies' and cl.relrowsecurity
  ) then
    raise exception 'Migration 22 FAILED: service_supplies is missing or RLS is off.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_supplies'
      and policyname = 'service_supplies_business_all' and cmd = 'ALL'
      and qual ~ '\mis_business_staff\(' and qual !~ '\mis_staff\('
      and with_check ~ '\mis_business_staff\(' and with_check !~ '\mis_staff\('
  ) then
    raise exception 'Migration 22 FAILED: policy service_supplies_business_all is missing or not business-staff only.'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'service_supplies'
      and policyname <> 'service_supplies_business_all'
  ) then
    raise exception 'Migration 22 FAILED: service_supplies has an unexpected policy.' using errcode = 'P0001';
  end if;

  foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if has_table_privilege('anon', 'public.service_supplies', v_priv) then
      raise exception 'Migration 22 FAILED: anon holds % on service_supplies.', v_priv using errcode = 'P0001';
    end if;
    if not has_table_privilege('authenticated', 'public.service_supplies', v_priv) then
      raise exception 'Migration 22 FAILED: authenticated lacks % on service_supplies (RLS decides who).', v_priv
        using errcode = 'P0001';
    end if;
  end loop;

  foreach c in array array[
    'service_supplies_service_id_fkey', 'service_supplies_item_id_fkey',
    'service_supplies_service_item_key', 'service_supplies_quantity_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.service_supplies'::regclass and conname = c and convalidated
    ) then
      raise exception 'Migration 22 FAILED: constraint % is missing on service_supplies.', c using errcode = 'P0001';
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'public.service_supplies'::regclass and tg.tgname = 'audit_row_change'
      and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) then
    raise exception 'Migration 22 FAILED: audit_row_change trigger is missing on service_supplies.' using errcode = 'P0001';
  end if;

  -- 2. inventory_movements: appointment FK and the cost rules.
  foreach c in array array[
    'inventory_movements_appointment_id_fkey', 'inventory_movements_cost_check',
    'inventory_movements_appointment_check'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.inventory_movements'::regclass and conname = c and convalidated
    ) then
      raise exception 'Migration 22 FAILED: constraint % is missing on inventory_movements.', c using errcode = 'P0001';
    end if;
  end loop;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_movements' and cmd <> 'SELECT'
  ) or has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT') then
    raise exception 'Migration 22 FAILED: inventory_movements must stay read-only through the API.' using errcode = 'P0001';
  end if;

  -- 3. Functions: signatures, SECURITY DEFINER, pinned search_path, grants.
  if to_regprocedure('public.finalize_consultation_with_payment(uuid,text,numeric,text,text)') is not null then
    raise exception 'Migration 22 FAILED: the old 5-argument finalize_consultation_with_payment still exists (calls would be ambiguous).'
      using errcode = 'P0001';
  end if;

  foreach v_fn in array array[
    'public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)',
    'public.set_service_supplies(uuid,jsonb)',
    'public.get_procedure_profit(timestamptz,timestamptz)',
    'public.adjust_stock(uuid,integer,text,numeric,text)',
    'public.record_consultation_supplies(uuid,jsonb)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Migration 22 FAILED: % is missing.', v_fn using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 22 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;
    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 22 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'Migration 22 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  foreach v_fn in array array[
    'public.apply_stock_movement(uuid,integer,text,numeric,numeric,text,uuid)',
    'public.parse_supply_list(jsonb)',
    'public.record_supplies_used(uuid,jsonb)'
  ] loop
    if to_regprocedure(v_fn) is null then
      raise exception 'Migration 22 FAILED: % is missing.', v_fn using errcode = 'P0001';
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(r, v_fn, 'execute') then
        raise exception 'Migration 22 FAILED: % can execute the internal helper %.', r, v_fn using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  foreach v_fn in array array[
    'public.apply_stock_movement(uuid,integer,text,numeric,numeric,text,uuid)',
    'public.record_supplies_used(uuid,jsonb)'
  ] loop
    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 22 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- The supplies step: one shared path (lock, "already recorded" refusal,
  -- validation, cost snapshot, stock change, marker).
  select prosrc into v_src from pg_proc
  where oid = 'public.record_supplies_used(uuid,jsonb)'::regprocedure;
  if v_src !~ 'public\.parse_supply_list\(p_supplies\)'
     or v_src !~ 'public\.apply_stock_movement\('
     or v_src !~ 'pg_advisory_xact_lock'
     or v_src !~ 'Los insumos de esta consulta ya estaban registrados'
     or v_src !~ 'supplies_recorded_at = now\(\)'
     or strpos(v_src, 'ya estaban registrados') > strpos(v_src, 'public.apply_stock_movement(') then
    raise exception 'Migration 22 FAILED: record_supplies_used must lock, refuse a second recording, record the parsed supplies through apply_stock_movement() and stamp supplies_recorded_at.'
      using errcode = 'P0001';
  end if;

  -- finalize: doctor only, finalize -> charge -> supplies step.
  select prosrc into v_src from pg_proc
  where oid = 'public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff'
     or v_src !~ 'public\.finalize_consultation\(p_appointment_id\)'
     or v_src !~ 'public\.record_payment\(p_appointment_id, p_status, p_amount, p_method, p_note\)'
     or strpos(v_src, 'public.finalize_consultation(') > strpos(v_src, 'public.record_payment(')
     or strpos(v_src, 'public.record_payment(') > strpos(v_src, 'public.record_supplies_used(')
     or v_src ~ 'apply_stock_movement' then
    raise exception 'Migration 22 FAILED: finalize_consultation_with_payment must check is_staff(), finalize, charge, then run the shared record_supplies_used().'
      using errcode = 'P0001';
  end if;

  select pg_get_function_arguments('public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)'::regprocedure)
    into v_src;
  if v_src !~ 'p_supplies jsonb DEFAULT NULL::jsonb' then
    raise exception 'Migration 22 FAILED: p_supplies must default to null ("step skipped"), got %.', v_src using errcode = 'P0001';
  end if;

  -- Record later: doctor only, finalized consultations only, same shared path.
  select prosrc into v_src from pg_proc
  where oid = 'public.record_consultation_supplies(uuid,jsonb)'::regprocedure;
  if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff'
     or v_src !~ 'finalized_at is not null'
     or v_src !~ 'public\.record_supplies_used\(' or v_src ~ 'apply_stock_movement' then
    raise exception 'Migration 22 FAILED: record_consultation_supplies must check is_staff(), require a finalized note and use record_supplies_used().'
      using errcode = 'P0001';
  end if;

  -- The marker column and its guard.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_notes'
      and column_name = 'supplies_recorded_at' and column_default is null
  ) then
    raise exception 'Migration 22 FAILED: clinical_notes.supplies_recorded_at is missing or still has a default.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'public.clinical_notes'::regclass
      and tg.tgname = 'clinical_notes_guard_supplies_marker'
      and not tg.tgisinternal and tg.tgenabled <> 'D'
  ) then
    raise exception 'Migration 22 FAILED: trigger clinical_notes_guard_supplies_marker is missing or disabled.'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc
    where oid = 'public.get_procedure_profit(timestamptz,timestamptz)'::regprocedure
      and 'unrecorded_consultations' = any (proargnames)
  ) then
    raise exception 'Migration 22 FAILED: get_procedure_profit does not report unrecorded_consultations.'
      using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.adjust_stock(uuid,integer,text,numeric,text)'::regprocedure;
  if v_src !~ '\mis_business_staff\(' or v_src ~ '\mis_staff\('
     or v_src !~ 'public\.apply_stock_movement\(' or v_src !~ 'Solo las compras llevan costo' then
    raise exception 'Migration 22 FAILED: adjust_stock must check is_business_staff(), refuse costs outside purchases and use apply_stock_movement().'
      using errcode = 'P0001';
  end if;

  foreach v_fn in array array[
    'public.set_service_supplies(uuid,jsonb)',
    'public.get_procedure_profit(timestamptz,timestamptz)'
  ] loop
    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
    if v_src !~ '\mis_business_staff\(' or v_src ~ '\mis_staff\(' then
      raise exception 'Migration 22 FAILED: % must check is_business_staff().', v_fn using errcode = 'P0001';
    end if;
  end loop;

  -- 4. Behavior: stock never goes negative, cost rules hold. Runs on a
  --    throwaway item inside a sub-transaction that is always rolled back.
  begin
    insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, is_active)
    values ('MIGRATION-22-GATE item', 'Otro', 2, 0, 'piezas', true)
    returning id into v_item;

    -- More than the stock.
    v_state := null;
    begin
      perform public.apply_stock_movement(v_item, -3, 'use', null, null, null, null);
    exception when others then v_state := sqlstate;
    end;
    if v_state is distinct from 'P0001' then
      raise exception 'Migration 22 FAILED: using 3 of 2 units was not refused (got %).', coalesce(v_state, 'no error')
        using errcode = 'P0001';
    end if;

    -- From an empty item.
    perform public.apply_stock_movement(v_item, -2, 'use', null, null, null, null);
    v_state := null;
    begin
      perform public.apply_stock_movement(v_item, -1, 'use', null, null, null, null);
    exception when others then v_state := sqlstate;
    end;
    if v_state is distinct from 'P0001'
       or (select stock_quantity from public.inventory where id = v_item) <> 0 then
      raise exception 'Migration 22 FAILED: a use with no stock left was not refused.' using errcode = 'P0001';
    end if;

    -- The table refuses a cost on a manual adjustment or on a use that is not
    -- linked to a consultation, and a purchase without a cost.
    select a.id into v_appt from public.appointments a limit 1;
    for c in
      select * from unnest(array['adjustment with cost', 'unlinked use with cost', 'purchase without cost',
                                 'adjustment linked to a consultation'])
    loop
      v_state := null;
      begin
        if c = 'adjustment with cost' then
          insert into public.inventory_movements (item_id, type, quantity, unit_cost, total_cost)
          values (v_item, 'adjustment', 1, 10, 10);
        elsif c = 'unlinked use with cost' then
          insert into public.inventory_movements (item_id, type, quantity, unit_cost, total_cost)
          values (v_item, 'use', -1, 10, 10);
        elsif c = 'purchase without cost' then
          insert into public.inventory_movements (item_id, type, quantity)
          values (v_item, 'purchase', 1);
        elsif v_appt is not null then
          insert into public.inventory_movements (item_id, type, quantity, appointment_id)
          values (v_item, 'adjustment', 1, v_appt);
        else
          v_state := '23514';
        end if;
      exception when check_violation then v_state := '23514';
      end;
      if v_state is distinct from '23514' then
        raise exception 'Migration 22 FAILED: inventory_movements accepted a %.', c using errcode = 'P0001';
      end if;
    end loop;

    -- A direct change of the supplies marker is refused (on any existing note).
    select cn.id into v_note from public.clinical_notes cn limit 1;
    if v_note is not null then
      v_state := null;
      begin
        update public.clinical_notes
           set supplies_recorded_at = case when supplies_recorded_at is null then now() end
         where id = v_note;
      exception when others then v_state := sqlstate;
      end;
      if v_state is distinct from '42501' then
        raise exception 'Migration 22 FAILED: a direct change of clinical_notes.supplies_recorded_at was not refused (got %).',
          coalesce(v_state, 'no error') using errcode = 'P0001';
      end if;
    end if;

    raise exception using errcode = 'P0001', message = 'MIGRATION_22_GATE_ROLLBACK';
  exception when others then
    if sqlerrm <> 'MIGRATION_22_GATE_ROLLBACK' then
      raise;
    end if;
  end;

  -- 5. The ledger still matches the stock of every item.
  select count(*) into v_bad
  from public.inventory i
  where coalesce(i.stock_quantity, 0) <> coalesce(
    (select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id), 0);

  if v_bad > 0 then
    raise exception 'Migration 22 FAILED: % item(s) have a stock_quantity that does not match the sum of their movements.', v_bad
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 22 PASSED: service_supplies is business-staff only and audited; finalize_consultation_with_payment() and record_consultation_supplies() record the supplies used through one shared path with a server-side cost snapshot and mark the consultation (clinical_notes.supplies_recorded_at, guarded); stock never goes negative; manual movements carry no cost; get_procedure_profit() reports each procedure, and its consultations without recorded supplies, without patient data.';
end $$;
