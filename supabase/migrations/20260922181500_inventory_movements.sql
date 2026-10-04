-- =============================================================================
-- 16 - Inventory movements ledger (Phase 4)
-- =============================================================================
-- Problems this file fixes:
--   1. Lost updates. The app wrote an ABSOLUTE stock value computed in the
--      browser, so two quick +/- clicks or two open tabs overwrote each other.
--   2. last_restock_date was stamped on every change, even when stock went DOWN.
--   3. There was no record of what was bought, when, or for how much, so the
--      Phase 5 finance view (income - supply spending) had no expense source.
--
-- Design:
--   * public.inventory_movements is an append-only ledger. Every stock change
--     is one signed row (+ in / - out). Purchases carry their total and unit
--     cost, which is what Phase 5 sums as supply spending.
--   * public.adjust_stock() is the ONLY way to change stock. It applies the
--     delta with a single atomic UPDATE (no read-then-write, so concurrent
--     calls add up instead of overwriting), refuses negative stock, stamps
--     last_restock_date only for purchases, and writes the movement in the
--     same transaction.
--   * A BEFORE UPDATE trigger on public.inventory refuses any stock_quantity
--     change that does not come from inside adjust_stock() (a transaction-local
--     flag the RPC sets and clears around its own UPDATE). Edits to name,
--     category, alert level, unit and is_active keep working as before.
--   * Creating an item may still set an initial stock; an AFTER INSERT trigger
--     records it as an 'adjustment' movement ("Inventario inicial").
--   * Existing items are backfilled with one "Inventario inicial" movement for
--     their current stock, so from now on the sum of the ledger equals
--     stock_quantity for every item. The gate below asserts it.
--   * The ledger is read-only through the API: staff can SELECT it, and rows
--     are written only by adjust_stock() and the insert trigger (both SECURITY
--     DEFINER). A direct INSERT would let a movement exist without a stock
--     change, breaking "ledger = stock" and letting fake costs into Phase 5.
--   * The ledger itself is the audit trail (created_by, created_at,
--     append-only), so it is not wired to public.audit_log, which is reserved
--     for clinical data.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Gate: refuse to continue while an item has negative stock
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
  v_list  text;
begin
  select count(*),
         string_agg(format('  id=%s | name=%s | stock_quantity=%s', i.id, coalesce(i.name, '(no name)'), i.stock_quantity),
                    E'\n' order by i.name)
    into v_count, v_list
  from public.inventory i
  where i.stock_quantity < 0;

  if v_count > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        E'Migration 16 ABORTED: %s inventory item(s) have negative stock. Nothing was changed.\n%s\n'
        'Fix: set a correct stock_quantity (0 or more) for each item, then run this migration again.',
        v_count, v_list);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- inventory: stock can never go below zero
-- -----------------------------------------------------------------------------
alter table public.inventory drop constraint if exists inventory_stock_quantity_check;
alter table public.inventory add constraint inventory_stock_quantity_check
  check (stock_quantity >= 0);

-- -----------------------------------------------------------------------------
-- inventory_movements
-- -----------------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.inventory (id) on delete restrict,
  type        text not null,
  quantity    integer not null,
  unit_cost   numeric(12,2),
  total_cost  numeric(12,2),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

alter table public.inventory_movements drop constraint if exists inventory_movements_type_check;
alter table public.inventory_movements add constraint inventory_movements_type_check
  check (type in ('purchase', 'use', 'adjustment'));

alter table public.inventory_movements drop constraint if exists inventory_movements_quantity_check;
alter table public.inventory_movements add constraint inventory_movements_quantity_check
  check (quantity <> 0);

alter table public.inventory_movements drop constraint if exists inventory_movements_cost_check;
alter table public.inventory_movements add constraint inventory_movements_cost_check
  check (
    (total_cost is null or total_cost >= 0)
    and (unit_cost is null or unit_cost >= 0)
    and (type <> 'purchase' or (quantity > 0 and total_cost is not null))
  );

alter table public.inventory_movements drop constraint if exists inventory_movements_note_check;
alter table public.inventory_movements add constraint inventory_movements_note_check
  check (note is null or length(note) <= 500);

create index if not exists inventory_movements_item_created_idx
  on public.inventory_movements (item_id, created_at desc);
create index if not exists inventory_movements_type_created_idx
  on public.inventory_movements (type, created_at);

comment on table public.inventory_movements is
  'Append-only stock ledger. quantity is signed (+ in / - out). Written only by adjust_stock() and the inventory insert trigger.';

-- -----------------------------------------------------------------------------
-- Privileges and RLS: read-only through the API
-- -----------------------------------------------------------------------------
alter table public.inventory_movements enable row level security;

revoke all on public.inventory_movements from public, anon, authenticated, service_role;
grant select on public.inventory_movements to authenticated;

drop policy if exists "inventory_movements_select_staff" on public.inventory_movements;
create policy "inventory_movements_select_staff"
  on public.inventory_movements for select to authenticated
  using (public.is_staff());

-- Append-only for every role, including the table owner (migration 08 helper).
drop trigger if exists inventory_movements_block_update_delete on public.inventory_movements;
create trigger inventory_movements_block_update_delete
  before update or delete on public.inventory_movements
  for each row execute function public.reject_append_only_mutation();

drop trigger if exists inventory_movements_block_truncate on public.inventory_movements;
create trigger inventory_movements_block_truncate
  before truncate on public.inventory_movements
  for each statement execute function public.reject_append_only_mutation();

-- -----------------------------------------------------------------------------
-- Backfill: one "Inventario inicial" movement per existing item
-- -----------------------------------------------------------------------------
-- Only for items that have no movement yet, so a re-run adds nothing.
insert into public.inventory_movements (item_id, type, quantity, note, created_by)
select i.id, 'adjustment', i.stock_quantity, 'Inventario inicial', null
from public.inventory i
where coalesce(i.stock_quantity, 0) <> 0
  and not exists (select 1 from public.inventory_movements m where m.item_id = i.id);

-- -----------------------------------------------------------------------------
-- Guard: stock_quantity changes only through adjust_stock()
-- -----------------------------------------------------------------------------
-- adjust_stock() sets the transaction-local setting app.inventory_ledger to
-- 'on' right before its UPDATE and clears it right after. PostgREST cannot set
-- arbitrary settings from a request, so an API caller cannot fake it.
--
-- Maintenance from the SQL editor (e.g. correcting a count) should go through
-- the ledger too. If a raw fix is ever unavoidable, run it in one transaction
-- after: select set_config('app.inventory_ledger', 'on', true);
create or replace function public.guard_inventory_stock()
returns trigger
language plpgsql
set search_path = pg_temp
as $$
begin
  if coalesce(current_setting('app.inventory_ledger', true), '') <> 'on' then
    raise exception 'El stock solo se puede cambiar registrando un movimiento (compra, uso o ajuste).'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_inventory_stock() from public, anon, authenticated;

drop trigger if exists inventory_guard_stock on public.inventory;
create trigger inventory_guard_stock
  before update on public.inventory
  for each row
  when (new.stock_quantity is distinct from old.stock_quantity)
  execute function public.guard_inventory_stock();

-- -----------------------------------------------------------------------------
-- Initial stock on create becomes a movement
-- -----------------------------------------------------------------------------
create or replace function public.record_initial_stock()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(new.stock_quantity, 0) > 0 then
    insert into public.inventory_movements (item_id, type, quantity, note)
    values (new.id, 'adjustment', new.stock_quantity, 'Inventario inicial');
  end if;
  return null;
end;
$$;

revoke all on function public.record_initial_stock() from public, anon, authenticated;

drop trigger if exists inventory_record_initial_stock on public.inventory;
create trigger inventory_record_initial_stock
  after insert on public.inventory
  for each row execute function public.record_initial_stock();

-- -----------------------------------------------------------------------------
-- adjust_stock - the only way to change stock
-- -----------------------------------------------------------------------------
-- p_delta is signed: + adds units, - removes them.
--   purchase   -> p_delta > 0 and p_total_cost >= 0 (unit_cost = total / delta);
--                 stamps last_restock_date (clinic calendar day).
--   use        -> p_delta < 0, no cost.
--   adjustment -> any non-zero p_delta, no cost (manual corrections, +/-).
-- Returns the new stock.
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
  v_note      text := nullif(btrim(coalesce(p_note, '')), '');
  v_new_stock integer;
  v_current   integer;
  v_active    boolean;
begin
  if not public.is_staff() then
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

  insert into public.inventory_movements (item_id, type, quantity, unit_cost, total_cost, note)
  values (
    p_item_id,
    p_type,
    p_delta,
    case when p_type = 'purchase' then round(p_total_cost / p_delta, 2) end,
    case when p_type = 'purchase' then p_total_cost end,
    v_note
  );

  return v_new_stock;
end;
$$;

revoke all on function public.adjust_stock(uuid, integer, text, numeric, text) from public, anon, authenticated, service_role;
grant execute on function public.adjust_stock(uuid, integer, text, numeric, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  r      text;
  v_priv text;
  t      text;
  v_bad  integer;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'inventory_movements' and c.relrowsecurity
  ) then
    raise exception 'Migration 16 FAILED: inventory_movements is missing or RLS is off.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_movements'
      and policyname = 'inventory_movements_select_staff' and cmd = 'SELECT'
  ) then
    raise exception 'Migration 16 FAILED: policy inventory_movements_select_staff is missing.' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_movements' and cmd <> 'SELECT'
  ) then
    raise exception 'Migration 16 FAILED: inventory_movements has a non-SELECT policy; the ledger must be read-only through the API.'
      using errcode = 'P0001';
  end if;

  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach v_priv in array array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege(r, 'public.inventory_movements', v_priv) then
        raise exception 'Migration 16 FAILED: role % holds % on inventory_movements.', r, v_priv
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon', 'public.inventory_movements', 'SELECT') then
    raise exception 'Migration 16 FAILED: anon can SELECT inventory_movements.' using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', 'public.adjust_stock(uuid,integer,text,numeric,text)', 'execute') then
    raise exception 'Migration 16 FAILED: authenticated cannot execute adjust_stock.' using errcode = 'P0001';
  end if;

  if has_function_privilege('anon', 'public.adjust_stock(uuid,integer,text,numeric,text)', 'execute') then
    raise exception 'Migration 16 FAILED: anon can execute adjust_stock.' using errcode = 'P0001';
  end if;

  if not (select prosecdef from pg_proc where oid = 'public.adjust_stock(uuid,integer,text,numeric,text)'::regprocedure) then
    raise exception 'Migration 16 FAILED: adjust_stock is not SECURITY DEFINER.' using errcode = 'P0001';
  end if;

  foreach t in array array['inventory_guard_stock', 'inventory_record_initial_stock'] loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = 'public.inventory'::regclass and tg.tgname = t
        and not tg.tgisinternal and tg.tgenabled <> 'D'
    ) then
      raise exception 'Migration 16 FAILED: trigger % is missing or disabled on inventory.', t using errcode = 'P0001';
    end if;
  end loop;

  foreach t in array array['inventory_movements_block_update_delete', 'inventory_movements_block_truncate'] loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = 'public.inventory_movements'::regclass and tg.tgname = t
        and not tg.tgisinternal and tg.tgenabled <> 'D'
    ) then
      raise exception 'Migration 16 FAILED: append-only trigger % is missing on inventory_movements.', t
        using errcode = 'P0001';
    end if;
  end loop;

  select count(*) into v_bad
  from public.inventory i
  where coalesce(i.stock_quantity, 0) <> coalesce(
    (select sum(m.quantity) from public.inventory_movements m where m.item_id = i.id), 0);

  if v_bad > 0 then
    raise exception 'Migration 16 FAILED: % item(s) have a stock_quantity that does not match the sum of their movements.', v_bad
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 16 PASSED: stock changes only through adjust_stock(), every change is in the append-only inventory_movements ledger, and the ledger matches current stock.';
end $$;
