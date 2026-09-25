-- =============================================================================
-- 15 - One patient record per phone number
-- =============================================================================
-- A patient's identity is their phone. current_patient_id() matches the
-- verified phone claim with normalize_phone() and, when several records share
-- the same number, silently picks the OLDEST one:
--
--   order by p.created_at asc nulls last limit 1
--
-- Every other record with that phone is then unreachable from the patient
-- portal: its appointments, prescriptions and files never show up, and the
-- patient cannot exercise ARCO rights over it. Duplicates already exist in the
-- data (e.g. two test patients share +525512345678).
--
-- This migration makes the database refuse a second record for the same
-- canonical phone. normalize_phone() is IMMUTABLE, so it can back a unique
-- expression index, and it already collapses '+52 1 55...', '52155...' and
-- '+5255...' into one canonical form - the same comparison the RLS helper uses.
--
-- It NEVER deletes or modifies data. If duplicates exist it stops and lists
-- them; a person must decide which record to keep and merge the rest first.
--
-- Rows with no phone (NULL or empty, e.g. anonymized patients) are unaffected:
-- normalize_phone() returns NULL for them and NULLs never collide.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Gate: refuse to continue while duplicates exist
-- -----------------------------------------------------------------------------
do $$
declare
  v_groups integer;
  v_list   text;
begin
  select count(*),
         string_agg(d.rows, E'\n' order by d.canonical)
    into v_groups, v_list
  from (
    select public.normalize_phone(p.phone) as canonical,
           string_agg(
             format('  id=%s | name=%s | phone=%s | created_at=%s',
                    p.id,
                    coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), '(no name)'),
                    p.phone,
                    coalesce(p.created_at::text, '(unknown)')),
             E'\n' order by p.created_at nulls last, p.id) as rows
    from public.patients p
    where public.normalize_phone(p.phone) is not null
    group by public.normalize_phone(p.phone)
    having count(*) > 1
  ) d;

  if v_groups > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        E'Migration 15 ABORTED: %s phone number(s) are shared by more than one patient record. Nothing was changed.\n'
        'The patient portal only ever reaches the OLDEST record of each group (current_patient_id()), so the others are unreachable.\n'
        'Duplicates, grouped by phone (oldest first):\n%s\n'
        'Fix: for each group, decide which record to keep, move the appointments, clinical notes, prescriptions, files and consents of the others to it (or correct their phone if they are different people), then run this migration again. This migration never deletes or edits data.',
        v_groups, v_list),
      hint = 'Find them again with: select id, first_name, last_name, phone, created_at from public.patients where public.normalize_phone(phone) in (select public.normalize_phone(phone) from public.patients group by 1 having count(*) > 1) order by public.normalize_phone(phone), created_at;';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Unique index on the canonical phone
-- -----------------------------------------------------------------------------
-- Not CONCURRENTLY: that cannot run inside the SQL editor's transaction, and
-- public.patients is small enough for a brief write lock.
--
-- If normalize_phone() is ever redefined, rebuild the index in the same
-- change:  reindex index public.patients_phone_normalized_key;
create unique index if not exists patients_phone_normalized_key
  on public.patients (public.normalize_phone(phone));

comment on index public.patients_phone_normalized_key is
  'One patient record per canonical phone (normalize_phone). Keeps current_patient_id() unambiguous.';

-- Postgres evaluates an index expression with the privileges of the role that
-- writes the row. Staff create and edit patients directly as `authenticated`
-- (RLS policy patients_staff_all), so that role needs EXECUTE on the function
-- or every such write would fail with "permission denied for function
-- normalize_phone". It is a pure formatting function and reveals nothing.
-- anon still has no grant: it never writes to public.patients directly.
grant execute on function public.normalize_phone(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Go/no-go gate
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'patients_phone_normalized_key'
      and i.indrelid = 'public.patients'::regclass
      and i.indisunique
      and i.indisvalid
      and pg_get_indexdef(i.indexrelid) ilike '%normalize_phone(phone)%'
  ) then
    raise exception 'Migration 15 FAILED: the unique index on normalize_phone(phone) is missing or invalid.'
      using errcode = 'P0001';
  end if;

  if (select provolatile from pg_proc where oid = 'public.normalize_phone(text)'::regprocedure) <> 'i' then
    raise exception 'Migration 15 FAILED: normalize_phone(text) is no longer IMMUTABLE.'
      using errcode = 'P0001';
  end if;

  if not has_function_privilege('authenticated', 'public.normalize_phone(text)', 'execute') then
    raise exception 'Migration 15 FAILED: authenticated cannot execute normalize_phone(text); staff patient writes would fail.'
      using errcode = 'P0001';
  end if;

  raise notice 'Migration 15 PASSED: public.patients now allows only one record per canonical phone number.';
end $$;
