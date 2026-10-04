-- =============================================================================
-- Inventory check - paste into the Supabase SQL editor and run as-is
-- =============================================================================
-- Proves, against the real migration 16 objects, that:
--   * adjust_stock() applies a DELTA to the latest stock, so a change made from
--     a stale screen adds up instead of overwriting (no lost update);
--   * stock can never go negative;
--   * a direct UPDATE of inventory.stock_quantity is refused, while other
--     columns (e.g. name) can still be edited directly;
--   * only a purchase stamps last_restock_date, and it records total and unit
--     cost;
--   * the ledger is read-only through the API and always sums to the stock;
--   * anon cannot call adjust_stock().
--
-- SAFETY
--   * Everything runs inside BEGIN ... ROLLBACK. The throwaway staff user, the
--     test item and its movements are never committed, pass or fail.
--   * The script refuses to run if an enabled trigger on a touched table looks
--     like an outbound HTTP call.
--
-- Expected output: a single notice that starts with "INVENTORY CHECK PASSED".
-- Any "INVENTORY CHECK FAILED: ..." error names the exact rule that broke.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. No outbound side effects
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where not t.tgisinternal
      and t.tgenabled <> 'D'
      and t.tgrelid in (
        'public.inventory'::regclass, 'public.inventory_movements'::regclass,
        'public.profiles'::regclass, 'auth.users'::regclass)
      and (n.nspname in ('supabase_functions', 'net')
           or p.prosrc ilike '%http_request%'
           or p.prosrc ilike '%net.http%')
  ) then
    raise exception 'INVENTORY CHECK ABORTED: an enabled trigger on a test table makes HTTP calls. Nothing was changed.';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Fixtures (as the SQL editor's owner role, no request context)
-- -----------------------------------------------------------------------------
do $$
declare
  v_user  uuid := gen_random_uuid();
  v_item  uuid;
  v_moves integer;
begin
  insert into auth.users (id, instance_id, aud, role, phone, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          null, 'inventory-check-staff-' || v_user || '@example.invalid', '{}'::jsonb, '{}'::jsonb, now(), now());

  update public.profiles set role = 'doctor' where id = v_user;

  insert into public.inventory (name, category, stock_quantity, min_alert_level, unit_measure, last_restock_date, is_active)
  values ('INVENTORY-CHECK item', 'Otro', 10, 2, 'piezas', null, true)
  returning id into v_item;

  -- The insert trigger records the initial stock as a movement.
  select count(*) into v_moves
  from public.inventory_movements
  where item_id = v_item and type = 'adjustment' and quantity = 10 and note = 'Inventario inicial';
  if v_moves <> 1 then
    raise exception 'INVENTORY CHECK FAILED: creating an item with stock 10 recorded % "Inventario inicial" movements, expected 1.', v_moves;
  end if;

  perform set_config('inventory_check.user', v_user::text, true);
  perform set_config('inventory_check.item', v_item::text, true);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Staff session (authenticated doctor)
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('inventory_check.user'),
    'role', 'authenticated')::text, true);
end $$;
set local role authenticated;

do $$
declare
  v_item     uuid := current_setting('inventory_check.item')::uuid;
  v_stale    integer;
  v_stock    integer;
  v_restock  date;
  v_refused  boolean;
  v_rows     integer;
  v_unit     numeric;
  v_total    numeric;
  v_sum      integer;
begin
  if not public.is_staff() then
    raise exception 'INVENTORY CHECK FAILED: the throwaway doctor is not staff.';
  end if;

  -- 2a. Delta, not absolute: a screen that read 10, while another screen adds
  --     5, then removes 1 -> 14 (the old absolute write would have saved 9).
  select stock_quantity into v_stale from public.inventory where id = v_item;
  perform public.adjust_stock(v_item, 5, 'adjustment');
  v_stock := public.adjust_stock(v_item, -1, 'adjustment');
  if v_stale <> 10 or v_stock <> 14 then
    raise exception 'INVENTORY CHECK FAILED: stale read % then +5 and -1 gave %, expected 14.', v_stale, v_stock;
  end if;

  -- Non-purchase changes never stamp the restock date.
  select last_restock_date into v_restock from public.inventory where id = v_item;
  if v_restock is not null then
    raise exception 'INVENTORY CHECK FAILED: an adjustment set last_restock_date to %.', v_restock;
  end if;

  -- 2b. Negative stock is refused and nothing changes.
  v_refused := false;
  begin
    perform public.adjust_stock(v_item, -15, 'use');
  exception when others then
    v_refused := sqlerrm like 'No hay suficiente stock%';
  end;
  select stock_quantity into v_stock from public.inventory where id = v_item;
  if not v_refused or v_stock <> 14 then
    raise exception 'INVENTORY CHECK FAILED: removing 15 of 14 was not refused cleanly (stock now %).', v_stock;
  end if;

  -- 2c. Direct stock writes are refused; other columns still edit directly.
  v_refused := false;
  begin
    update public.inventory set stock_quantity = 999 where id = v_item;
  exception when insufficient_privilege then v_refused := true;
  end;
  select stock_quantity into v_stock from public.inventory where id = v_item;
  if not v_refused or v_stock <> 14 then
    raise exception 'INVENTORY CHECK FAILED: a direct UPDATE of stock_quantity was not refused (stock now %).', v_stock;
  end if;

  update public.inventory set name = 'INVENTORY-CHECK renamed' where id = v_item;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'INVENTORY CHECK FAILED: staff could not rename the item directly.';
  end if;

  -- 2d. A purchase stamps the restock date and records the costs.
  v_stock := public.adjust_stock(v_item, 4, 'purchase', 100, 'Proveedor de prueba');
  select last_restock_date into v_restock from public.inventory where id = v_item;
  if v_stock <> 18 or v_restock is distinct from (now() at time zone 'America/Monterrey')::date then
    raise exception 'INVENTORY CHECK FAILED: purchase gave stock % and restock date %, expected 18 and today.', v_stock, v_restock;
  end if;

  select unit_cost, total_cost into v_unit, v_total
  from public.inventory_movements
  where item_id = v_item and type = 'purchase';
  if v_unit is distinct from 25.00 or v_total is distinct from 100.00 then
    raise exception 'INVENTORY CHECK FAILED: purchase recorded unit_cost % / total_cost %, expected 25.00 / 100.00.', v_unit, v_total;
  end if;

  -- A purchase that removes units or has no cost is refused.
  v_refused := false;
  begin
    perform public.adjust_stock(v_item, 2, 'purchase', null);
  exception when others then v_refused := true;
  end;
  if not v_refused then
    raise exception 'INVENTORY CHECK FAILED: a purchase without a total cost was accepted.';
  end if;

  -- 2e. The ledger is read-only through the API.
  v_refused := false;
  begin
    insert into public.inventory_movements (item_id, type, quantity) values (v_item, 'adjustment', 1);
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'INVENTORY CHECK FAILED: staff inserted a movement directly.';
  end if;

  v_refused := false;
  begin
    update public.inventory_movements set quantity = 1000 where item_id = v_item;
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'INVENTORY CHECK FAILED: staff updated a movement.';
  end if;

  v_refused := false;
  begin
    delete from public.inventory_movements where item_id = v_item;
  exception when insufficient_privilege then v_refused := true;
  end;
  if not v_refused then
    raise exception 'INVENTORY CHECK FAILED: staff deleted a movement.';
  end if;

  -- 2f. Ledger = stock.
  select coalesce(sum(quantity), 0) into v_sum from public.inventory_movements where item_id = v_item;
  select stock_quantity into v_stock from public.inventory where id = v_item;
  if v_sum <> v_stock then
    raise exception 'INVENTORY CHECK FAILED: ledger sums to % but stock is %.', v_sum, v_stock;
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- 3. anon cannot call adjust_stock()
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
end $$;
set local role anon;

do $$
declare
  v_denied boolean := false;
begin
  begin
    perform public.adjust_stock(current_setting('inventory_check.item')::uuid, 1, 'adjustment');
  exception
    when insufficient_privilege then v_denied := true;
    when others then v_denied := false;
  end;
  if not v_denied then
    raise exception 'INVENTORY CHECK FAILED: anon can execute adjust_stock().';
  end if;
end $$;

reset role;

-- -----------------------------------------------------------------------------
-- Result
-- -----------------------------------------------------------------------------
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  raise notice 'INVENTORY CHECK PASSED: stock changes are deltas, never negative, never written directly, purchases record cost and restock date, and the ledger is append-only and matches stock. All test data was rolled back.';
end $$;

rollback;
