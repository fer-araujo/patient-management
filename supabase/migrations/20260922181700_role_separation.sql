-- =============================================================================
-- 18 - Separate the doctor and admin roles
-- =============================================================================
-- Problem this file fixes:
--   public.is_staff() returned true for BOTH 'doctor' and 'admin', and it gates
--   nearly every clinical policy and SECURITY DEFINER RPC. An 'admin' account
--   (future administrative staff) would therefore read every patient's
--   identity, appointments, SOAP notes, prescriptions, files, ARCO requests,
--   consents and the audit log, and could finalize consultations.
--
-- Design:
--   * public.is_staff() now means CLINICAL staff: profiles.role = 'doctor'
--     only. Every existing clinical policy and RPC that calls it excludes
--     'admin' automatically, with no change to those objects.
--   * public.is_business_staff() is new: profiles.role in ('doctor', 'admin').
--     'doctor' is a superset of 'admin'; one role column is enough.
--   * ONLY the business surface (Administracion: Catalogo, Inventario,
--     Finanzas) switches to is_business_staff():
--       - services: services_staff_all (catalog writes, inactive services)
--       - inventory: inventory_staff_all
--       - inventory_movements: inventory_movements_select_staff
--       - payments: payments_select_staff (Finanzas reads amounts and service)
--       - adjust_stock(): its internal permission check
--     Policy names are kept so the gates of migrations 04, 16 and 17 still
--     find them.
--   * register_me() refuses ANY clinic staff account (doctor or admin) that
--     tries to register itself as a patient, as it did before this file; it
--     switches to is_business_staff() so the admin keeps being refused.
--   * Everything else stays doctor-only, including record_payment() (called
--     from consultations and the agenda, which an admin cannot reach),
--     finalize_consultation(), resolve_arco_request(), anonymize_patient(),
--     the clinical_records storage bucket, clinic_settings, blocked_slots,
--     other users' profiles, and role changes (profiles_block_role_escalation).
--   * Finanzas for an admin: payments.patient_id is a bare uuid and patients is
--     not readable, so a PostgREST embed "patients ( first_name, last_name )"
--     resolves to null (no error) and no name is shown. The frontend does not
--     even request the embed for an admin.
--
-- PRECONDITION: at least one profile holds role 'doctor'. Applying this file
-- when the only staff account is an 'admin' would lock the clinic out of its
-- clinical data, so the pre-flight block below aborts in that case.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pre-flight: a doctor must exist
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.profiles where role = 'doctor') then
    raise exception using
      errcode = 'P0001',
      message = 'Migration 18 ABORTED: no profile has role doctor. After this file only a doctor can read clinical data, so the clinic would be locked out. Nothing was changed. Promote the doctor''s profile first (see migration 03).';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- is_staff - clinical staff: the doctor only
-- -----------------------------------------------------------------------------
-- Must stay SECURITY DEFINER: the profiles policies call it, and a SECURITY
-- INVOKER function would re-enter those same policies and recurse.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'doctor'
  );
$$;

comment on function public.is_staff() is
  'Clinical staff: true only when the caller''s profiles.role is doctor. Gates patients, appointments, clinical records, ARCO, consents and the audit log.';

-- -----------------------------------------------------------------------------
-- is_business_staff - business administration: doctor or admin
-- -----------------------------------------------------------------------------
create or replace function public.is_business_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('doctor', 'admin')
  );
$$;

comment on function public.is_business_staff() is
  'Business staff: true when the caller''s profiles.role is doctor or admin. Gates only the catalog, inventory and finance data.';

-- Same grant shape as migration 02: authenticated only, service_role untouched
-- (it bypasses RLS, and triggers running under it may still call the helpers).
revoke all on function public.is_staff()          from public, anon, authenticated;
revoke all on function public.is_business_staff() from public, anon, authenticated;

grant execute on function public.is_staff()          to authenticated;
grant execute on function public.is_business_staff() to authenticated;

-- -----------------------------------------------------------------------------
-- Business policies: doctor or admin
-- -----------------------------------------------------------------------------
drop policy if exists "services_staff_all" on public.services;
create policy "services_staff_all"
  on public.services for all to authenticated
  using (public.is_business_staff())
  with check (public.is_business_staff());

drop policy if exists "inventory_staff_all" on public.inventory;
create policy "inventory_staff_all"
  on public.inventory for all to authenticated
  using (public.is_business_staff())
  with check (public.is_business_staff());

drop policy if exists "inventory_movements_select_staff" on public.inventory_movements;
create policy "inventory_movements_select_staff"
  on public.inventory_movements for select to authenticated
  using (public.is_business_staff());

drop policy if exists "payments_select_staff" on public.payments;
create policy "payments_select_staff"
  on public.payments for select to authenticated
  using (public.is_business_staff());

-- -----------------------------------------------------------------------------
-- adjust_stock - same body as migration 16, business staff may call it
-- -----------------------------------------------------------------------------
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
-- register_me - same body as migration 13, still refuses every staff account
-- -----------------------------------------------------------------------------
create or replace function public.register_me(
  p_first_name             text,
  p_last_name              text,
  p_email                  text,
  p_referred_by            text,
  p_dob_year               integer,
  p_privacy_notice_version text,
  p_user_agent             text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone      text := public.normalize_phone(auth.jwt() ->> 'phone');
  v_first_name text := nullif(btrim(coalesce(p_first_name, '')), '');
  v_patient_id uuid;
begin
  if v_phone is null or length(v_phone) < 10 then
    raise exception 'No pudimos verificar tu número de teléfono. Vuelve a ingresarlo para continuar.'
      using errcode = 'P0001';
  end if;

  -- Doctor AND admin: no clinic staff account may become a patient record.
  if public.is_business_staff() then
    raise exception 'Las cuentas del personal de la clínica no pueden registrarse como pacientes.'
      using errcode = 'P0001';
  end if;

  perform public.assert_current_notice_version(p_privacy_notice_version);

  -- Serialize concurrent registrations of the SAME phone, so a double submit
  -- cannot create two records. Other phones are not blocked.
  perform pg_advisory_xact_lock(hashtextextended('register_me:' || v_phone, 0));

  v_patient_id := public.current_patient_id();

  if v_patient_id is null then
    if v_first_name is null then
      raise exception 'Escribe tu nombre para continuar.' using errcode = 'P0001';
    end if;

    if p_dob_year is not null
       and (p_dob_year < 1900 or p_dob_year > extract(year from now())::int) then
      raise exception 'El año de nacimiento no es válido.' using errcode = 'P0001';
    end if;

    -- Abuse ceiling: rolling-window cap on brand new clinical records.
    perform public.assert_new_patient_quota();

    insert into public.patients (
      first_name, last_name, phone, email, dob, status, referred_by
    )
    values (
      v_first_name,
      coalesce(nullif(btrim(coalesce(p_last_name, '')), ''), 'Sin apellido'),
      public.format_phone_e164(v_phone),
      nullif(btrim(coalesce(p_email, '')), ''),
      case when p_dob_year is null then null else make_date(p_dob_year, 1, 1) end,
      'active',
      nullif(btrim(coalesce(p_referred_by, '')), '')
    )
    returning id into v_patient_id;
  end if;

  if not public.has_current_consent(v_patient_id) then
    insert into public.consents (patient_id, document, version, user_agent)
    values (
      v_patient_id,
      'aviso_privacidad',
      p_privacy_notice_version,
      left(nullif(btrim(coalesce(p_user_agent, '')), ''), 512)
    );
  end if;

  return v_patient_id;
end;
$$;

revoke all on function public.register_me(text, text, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.register_me(text, text, text, text, integer, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn       text;
  v_src      text;
  v_tbl      text;
  v_pol      text;
  v_bad      text;
  v_clinical text[] := array[
    'patients', 'appointments', 'clinical_notes', 'clinical_note_addenda',
    'prescriptions', 'patient_files', 'arco_requests', 'consents', 'audit_log',
    'profiles', 'clinic_settings', 'blocked_slots'
  ];
  v_business text[] := array[
    'services.services_staff_all',
    'inventory.inventory_staff_all',
    'inventory_movements.inventory_movements_select_staff',
    'payments.payments_select_staff'
  ];
  v_doctor_rpcs text[] := array[
    'public.record_payment(uuid,text,numeric,text,text)',
    'public.finalize_consultation(uuid)',
    'public.resolve_arco_request(uuid,text,text)',
    'public.anonymize_patient(uuid)',
    'public.profiles_block_role_escalation()'
  ];
begin
  -- 1. Both helpers: SECURITY DEFINER, pinned search_path, the right role set.
  foreach v_fn in array array['public.is_staff()', 'public.is_business_staff()'] loop
    if not exists (
      select 1 from pg_proc
      where oid = v_fn::regprocedure
        and prosecdef
        and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
    ) then
      raise exception 'Migration 18 FAILED: % is not SECURITY DEFINER with a pinned search_path.', v_fn
        using errcode = 'P0001';
    end if;

    if not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'Migration 18 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
    end if;
    if has_function_privilege('anon', v_fn, 'execute') then
      raise exception 'Migration 18 FAILED: anon can execute %.', v_fn using errcode = 'P0001';
    end if;
  end loop;

  select prosrc into v_src from pg_proc where oid = 'public.is_staff()'::regprocedure;
  if v_src !~ '''doctor''' or v_src ~ '''admin''' then
    raise exception 'Migration 18 FAILED: is_staff() must be true for role doctor ONLY.' using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc where oid = 'public.is_business_staff()'::regprocedure;
  if v_src !~ '''doctor''' or v_src !~ '''admin''' or v_src ~ '''patient''' then
    raise exception 'Migration 18 FAILED: is_business_staff() must be true for roles doctor and admin only.'
      using errcode = 'P0001';
  end if;

  -- 2. Clinical tables: no policy may use the business helper.
  select string_agg(format('%s.%s', tablename, policyname), ', ')
    into v_bad
  from pg_policies
  where schemaname = 'public'
    and tablename = any (v_clinical)
    and (coalesce(qual, '') ilike '%is_business_staff%'
         or coalesce(with_check, '') ilike '%is_business_staff%');
  if v_bad is not null then
    raise exception 'Migration 18 FAILED: clinical policies let admin in: %.', v_bad using errcode = 'P0001';
  end if;

  -- Each clinical table keeps a doctor policy.
  foreach v_tbl in array v_clinical loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = v_tbl
        and (coalesce(qual, '') ~ '\mis_staff\(' or coalesce(with_check, '') ~ '\mis_staff\(')
    ) then
      raise exception 'Migration 18 FAILED: % has no doctor (is_staff) policy.', v_tbl using errcode = 'P0001';
    end if;
  end loop;

  select string_agg(policyname, ', ')
    into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual, '') ilike '%is_business_staff%'
         or coalesce(with_check, '') ilike '%is_business_staff%');
  if v_bad is not null then
    raise exception 'Migration 18 FAILED: storage policies let admin in: %.', v_bad using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'clinical_records_staff_all'
      and qual ~ '\mis_staff\(' and with_check ~ '\mis_staff\('
  ) then
    raise exception 'Migration 18 FAILED: clinical_records_staff_all is missing or not doctor-only.' using errcode = 'P0001';
  end if;

  -- 3. Business policies: business helper, never the clinical one.
  foreach v_pol in array v_business loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = split_part(v_pol, '.', 1)
        and policyname = split_part(v_pol, '.', 2)
        and qual ~ '\mis_business_staff\('
        and qual !~ '\mis_staff\('
        and (with_check is null
             or (with_check ~ '\mis_business_staff\(' and with_check !~ '\mis_staff\('))
    ) then
      raise exception 'Migration 18 FAILED: business policy % is missing or not open to admin.', v_pol
        using errcode = 'P0001';
    end if;
  end loop;

  -- Whitelist: no other policy anywhere uses the business helper.
  select string_agg(format('%s.%s.%s', schemaname, tablename, policyname), ', ')
    into v_bad
  from pg_policies
  where (coalesce(qual, '') ilike '%is_business_staff%'
         or coalesce(with_check, '') ilike '%is_business_staff%')
    and format('%s.%s', tablename, policyname) <> all (v_business);
  if v_bad is not null then
    raise exception 'Migration 18 FAILED: unexpected policies use is_business_staff(): %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 4. RPC bodies.
  foreach v_fn in array v_doctor_rpcs loop
    select prosrc into v_src from pg_proc where oid = v_fn::regprocedure;
    if v_src !~ '\mis_staff\(' or v_src ~ 'is_business_staff' then
      raise exception 'Migration 18 FAILED: % must check is_staff() (doctor only).', v_fn using errcode = 'P0001';
    end if;
  end loop;

  select prosrc into v_src from pg_proc
  where oid = 'public.adjust_stock(uuid,integer,text,numeric,text)'::regprocedure;
  if v_src !~ '\mis_business_staff\(' or v_src ~ '\mis_staff\(' then
    raise exception 'Migration 18 FAILED: adjust_stock must check is_business_staff().' using errcode = 'P0001';
  end if;

  select prosrc into v_src from pg_proc
  where oid = 'public.register_me(text,text,text,text,integer,text,text)'::regprocedure;
  if v_src !~ '\mis_business_staff\(' then
    raise exception 'Migration 18 FAILED: register_me must refuse every staff account (is_business_staff).'
      using errcode = 'P0001';
  end if;

  -- Whitelist: no other function body uses the business helper.
  select string_agg(p.oid::regprocedure::text, ', ')
    into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosrc ~ '\mis_business_staff\('
    and p.proname not in ('adjust_stock', 'register_me');
  if v_bad is not null then
    raise exception 'Migration 18 FAILED: unexpected functions use is_business_staff(): %.', v_bad
      using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.profiles where role = 'doctor') then
    raise exception 'Migration 18 FAILED: no profile has role doctor.' using errcode = 'P0001';
  end if;

  raise notice 'Migration 18 PASSED: is_staff() is doctor-only and guards every clinical table, the clinical_records bucket and every clinical RPC; is_business_staff() (doctor or admin) guards only services, inventory, inventory_movements, payments (read) and adjust_stock().';
end $$;
