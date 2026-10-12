-- =============================================================================
-- 26 - Finance data for the admin without identifiers; Security Advisor fixes
-- =============================================================================
-- Problem this file fixes:
--   1. Migration 18 opened public.payments to the admin (is_business_staff())
--      so Finanzas could show amounts and services. The PostgREST embed of the
--      patient's name already came back empty for an admin, but the admin could
--      still read payments.patient_id, payments.appointment_id and the free
--      text payments.note through the API. Those ids are pseudonymous but
--      linkable: anyone who later gains a second source (an export, a
--      screenshot of the agenda) can tie "Hilos Tensores, $5,500" to a person.
--   2. The Supabase Security Advisor reported SECURITY DEFINER functions that
--      anon or authenticated can execute. Three trigger functions
--      (appointments_set_updated_by, handle_new_user,
--      profiles_block_role_escalation) never had their default EXECUTE grants
--      revoked, and finalize_consultation(uuid) is still client-callable
--      although the app only finalizes through
--      finalize_consultation_with_payment().
--
-- Design:
--   * payments_select_staff is restored to its migration 17 body: the table
--     is readable directly ONLY by clinical staff (is_staff(), the doctor).
--     The doctor's Finanzas, the consultation and the agenda keep reading
--     payments exactly as before. Grants on the table are unchanged
--     (authenticated: SELECT; writes only through record_payment()).
--   * public.get_finance_payments(p_from, p_to) is the admin's (and any
--     business staff's) way in: SECURITY DEFINER, pinned search_path,
--     is_business_staff() checked inside, executable by authenticated only.
--     It returns ONLY what Finanzas needs, one row per payment recorded in
--     [p_from, p_to):
--       id              the payment's own uuid, an opaque row key (React key,
--                       stable paging). The admin cannot read payments, so it
--                       resolves to nothing;
--       created_at      when the charge was recorded;
--       status          'paid' or 'courtesy';
--       method          cash / card / transfer, null for a courtesy;
--       amount_charged  the money received (0 for a courtesy);
--       list_price      the catalog price at the time (courtesies add it to
--                       "Valor no cobrado");
--       service_name    the service's name, null if the service is gone.
--     Never patient_id, appointment_id, note or created_by. Rows are ordered
--     by (created_at, id) and the browser pages them with .range() like any
--     other read (fetchAllRows), so nothing is cut at PostgREST's max_rows.
--   * Trigger functions: EXECUTE is revoked from public, anon,
--     authenticated and service_role on EVERY function in public that
--     returns trigger
--     (looked up in pg_proc, so new ones are covered when this file is
--     re-run). Postgres checks EXECUTE only when a trigger is created, never
--     when it fires, so every trigger keeps working.
--   * finalize_consultation(uuid): EXECUTE revoked from public, anon and
--     authenticated. finalize_consultation_with_payment() (migration 22)
--     calls it as its owner (SECURITY DEFINER), so "Finalizar Consulta" keeps
--     working; the doctor-only check inside still reads the caller's JWT.
--   * The gate enforces the triage BY SIGNATURE (a new overload is not
--     covered by an old name): the only SECURITY DEFINER functions in public
--     that anon may execute are get_availability(), get_clinic_schedule() and
--     get_clinic_mode(); authenticated may execute only the reviewed list in
--     the gate. Each guarded RPC must contain its guard as CODE ("if not
--     public.is_staff() then raise", "if not public.is_business_staff() then
--     raise", or the current_patient_id() null check): comments and string
--     literals are stripped before matching. Anything else makes the gate
--     fail and the whole file roll back.
--
-- Note for maintainers: re-running migration 17 or 18 recreates
-- payments_select_staff with their bodies (18 reopens it to the admin), and
-- re-running 09 or 20 re-grants finalize_consultation(uuid) to
-- authenticated. Run this file again afterwards. Migration 18's gate
-- whitelists the policies and functions that used is_business_staff() at the
-- time; re-running it after migration 22 already reports newer ones (see the
-- note in migration 22), and get_finance_payments() is one more.
--
-- Idempotent and re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- payments: direct reads for the doctor only (migration 17 body, verbatim)
-- -----------------------------------------------------------------------------
drop policy if exists "payments_select_staff" on public.payments;
create policy "payments_select_staff"
  on public.payments for select to authenticated
  using (public.is_staff());

-- -----------------------------------------------------------------------------
-- get_finance_payments - the payments of a range, without identifiers
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

  return query
  select p.id,
         p.created_at,
         p.status,
         p.method,
         p.amount_charged,
         p.list_price,
         s.name::text
  from public.payments p
  left join public.services s on s.id = p.service_id
  where p.created_at >= p_from
    and p.created_at < p_to
  order by p.created_at, p.id;
end;
$$;

comment on function public.get_finance_payments(timestamptz, timestamptz) is
  'Finanzas for business staff: date, status, method, amount, list price and service name of each payment in [p_from, p_to). Never the patient, the appointment or the note.';

revoke all on function public.get_finance_payments(timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.get_finance_payments(timestamptz, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Security Advisor: trigger functions are not callable through the API
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Security Advisor: finalize_consultation only through
-- finalize_consultation_with_payment
-- -----------------------------------------------------------------------------
revoke all on function public.finalize_consultation(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn    text;
  v_src   text;
  v_clean text;
  v_bad   text;
  v_state text;
  v_cols  text[];
  v_ok    boolean;
  v_rec   record;
begin
  -- 1. payments: RLS on, one SELECT policy, doctor only.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'payments' and c.relrowsecurity
  ) then
    raise exception 'Migration 26 FAILED: RLS is off on public.payments.' using errcode = 'P0001';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'payments') <> 1
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'payments'
         and policyname = 'payments_select_staff' and cmd = 'SELECT'
         and roles = array['authenticated']::name[]
         and qual ~ '\mis_staff\(' and qual !~ 'is_business_staff'
         and with_check is null
     ) then
    raise exception 'Migration 26 FAILED: payments must have exactly one policy, payments_select_staff, SELECT for authenticated using is_staff() only.'
      using errcode = 'P0001';
  end if;

  if has_table_privilege('anon', 'public.payments', 'select')
     or has_table_privilege('authenticated', 'public.payments', 'insert')
     or has_table_privilege('authenticated', 'public.payments', 'update')
     or has_table_privilege('authenticated', 'public.payments', 'delete')
     or not has_table_privilege('authenticated', 'public.payments', 'select') then
    raise exception 'Migration 26 FAILED: payments grants changed (expected authenticated SELECT only, nothing for anon).'
      using errcode = 'P0001';
  end if;

  -- 2. get_finance_payments: definer, pinned path, business staff, no ids.
  v_fn := 'public.get_finance_payments(timestamptz,timestamptz)';
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure(v_fn)
      and prosecdef
      and exists (select 1 from unnest(proconfig) cfg where cfg like 'search_path=%')
  ) then
    raise exception 'Migration 26 FAILED: % is missing or not SECURITY DEFINER with a pinned search_path.', v_fn
      using errcode = 'P0001';
  end if;

  select prosrc,
         array(select a.name
               from unnest(proargnames, proargmodes) as a(name, mode)
               where a.mode = 't'
               order by a.name)
    into v_src, v_cols
  from pg_proc where oid = v_fn::regprocedure;

  -- Code only: no comments, no string literals, lower case, single spaces.
  v_clean := regexp_replace(
               lower(regexp_replace(v_src,
                     $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')),
               '\s+', ' ', 'g');

  if v_clean !~ 'if not public\.is_business_staff\(\) then raise' or v_clean ~ '\mis_staff\(' then
    raise exception 'Migration 26 FAILED: % must refuse callers that are not business staff.', v_fn using errcode = 'P0001';
  end if;
  if v_clean ~ '(patient|appointment|note|created_by)' then
    raise exception 'Migration 26 FAILED: % reads patient, appointment or note data.', v_fn using errcode = 'P0001';
  end if;
  if v_cols is distinct from array['amount_charged', 'created_at', 'id', 'list_price', 'method', 'service_name', 'status']::text[] then
    raise exception 'Migration 26 FAILED: % returns columns %, expected id, created_at, status, method, amount_charged, list_price, service_name.',
      v_fn, v_cols using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'Migration 26 FAILED: authenticated cannot execute %.', v_fn using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'Migration 26 FAILED: anon or service_role can execute %.', v_fn using errcode = 'P0001';
  end if;

  -- A caller that is not business staff (here: the SQL editor, no JWT) is refused.
  v_state := null;
  begin
    perform * from public.get_finance_payments(now() - interval '1 day', now());
  exception when insufficient_privilege then v_state := '42501';
  end;
  if v_state is distinct from '42501' then
    raise exception 'Migration 26 FAILED: get_finance_payments() answered a caller that is not business staff.'
      using errcode = 'P0001';
  end if;

  -- 3. No trigger function in public is executable by anon, authenticated or
  --    service_role.
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
    raise exception 'Migration 26 FAILED: trigger functions executable through the API: %.', v_bad
      using errcode = 'P0001';
  end if;

  -- 4. finalize_consultation: only through finalize_consultation_with_payment.
  if has_function_privilege('anon', 'public.finalize_consultation(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.finalize_consultation(uuid)', 'execute') then
    raise exception 'Migration 26 FAILED: finalize_consultation(uuid) is still executable by anon or authenticated.'
      using errcode = 'P0001';
  end if;

  select p.prosrc into v_src
  from pg_proc p
  where p.oid = to_regprocedure('public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)')
    and p.prosecdef
    and has_function_privilege(p.proowner, 'public.finalize_consultation(uuid)', 'execute');
  v_clean := regexp_replace(
               lower(regexp_replace(coalesce(v_src, ''),
                     $re$--[^\n]*|/\*([^*]|\*+[^*/])*\*+/|'([^']|'')*'$re$, ' ', 'g')),
               '\s+', ' ', 'g');
  if v_src is null
     or v_clean !~ 'perform public\.finalize_consultation\(p_appointment_id\)'
     or v_clean !~ 'if not public\.is_staff\(\) then raise' then
    raise exception 'Migration 26 FAILED: finalize_consultation_with_payment() must be SECURITY DEFINER, refuse non-doctors and call finalize_consultation() as an owner that can execute it.'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('authenticated', 'public.finalize_consultation_with_payment(uuid,text,numeric,text,text,jsonb)', 'execute') then
    raise exception 'Migration 26 FAILED: authenticated cannot execute finalize_consultation_with_payment().'
      using errcode = 'P0001';
  end if;

  -- 5. The SECURITY DEFINER surface matches the reviewed list. Functions
  --    are matched by SIGNATURE (oid), never by name, so a new overload
  --    cannot slip in. The guard must be real code: comments and string
  --    literals are stripped from the body before matching, and staff RPCs
  --    need an actual "if not public.<guard>() then raise".
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
        -- Migration 30 (staff_record_past_visit): listed here too so a re-run of this file still passes.
        ('public.staff_record_past_visit(uuid,uuid,timestamptz,text,numeric,text,text)', 'staff'),
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
      raise exception 'Migration 26 FAILED: unreviewed SECURITY DEFINER function executable by anon or authenticated: %. Nothing was changed.', v_rec.sig
        using errcode = 'P0001';
    end if;

    if v_rec.anon_x and v_rec.kind <> 'public' then
      raise exception 'Migration 26 FAILED: anon can execute %.', v_rec.sig using errcode = 'P0001';
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
      raise exception 'Migration 26 FAILED: % (%) has no internal % guard in its code.', v_rec.sig, v_rec.kind, v_rec.kind
        using errcode = 'P0001';
    end if;
  end loop;

  raise notice 'Migration 26 PASSED: payments is readable directly only by the doctor (is_staff()); get_finance_payments() gives business staff date, status, method, amount, list price and service name with no patient, appointment or note; no trigger function is executable by anon, authenticated or service_role; finalize_consultation() is reachable only through finalize_consultation_with_payment(); every SECURITY DEFINER function anon or authenticated can execute is on the reviewed list by signature, and each guarded one has its role or patient check in code (comments and strings ignored).';
end $$;
