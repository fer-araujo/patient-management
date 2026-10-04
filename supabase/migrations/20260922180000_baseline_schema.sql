-- =============================================================================
-- 01 - Baseline schema (schema of record)
-- =============================================================================
-- Declares every table the application relies on, using CREATE TABLE IF NOT
-- EXISTS so it is a no-op against the already provisioned remote database and
-- a full bootstrap against an empty one.
--
-- Nothing here drops or recreates an existing object. Column additions on
-- pre-existing tables are handled with ADD COLUMN IF NOT EXISTS so the file
-- stays re-runnable.
-- =============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- -----------------------------------------------------------------------------
-- patients
-- Identity is the phone number. There is deliberately NO link to auth.users:
-- a clinical record can exist before the person ever signs in.
-- -----------------------------------------------------------------------------
create table if not exists public.patients (
  id                  uuid primary key default gen_random_uuid(),
  first_name          text,
  last_name           text,
  phone               text,
  email               text,
  created_at          timestamptz default now(),
  gender              text,
  status              text,
  dob                 date,
  blood_type          text,
  allergies           text,
  chronic_conditions  text,
  notes               text,
  referred_by         text
);

-- -----------------------------------------------------------------------------
-- profiles - one row per auth user, carries the authorization role
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  role        text default 'patient' check (role in ('doctor', 'patient', 'admin')),
  first_name  text,
  last_name   text,
  avatar_url  text,
  created_at  timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- services - public catalog
-- -----------------------------------------------------------------------------
create table if not exists public.services (
  id             uuid primary key default gen_random_uuid(),
  name           text,
  category       text,
  description    text,
  duration_mins  integer default 45,
  price          numeric,
  is_active      boolean default true,
  created_at     timestamptz default now(),
  care_guide     text
);

-- -----------------------------------------------------------------------------
-- inventory - internal stock control
-- -----------------------------------------------------------------------------
create table if not exists public.inventory (
  id                 uuid primary key default gen_random_uuid(),
  name               text,
  category           text,
  stock_quantity     integer,
  min_alert_level    integer,
  unit_measure       text,
  last_restock_date  date,
  is_active          boolean default true
);

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid references public.patients (id) on delete cascade,
  service_id  uuid references public.services (id) on delete restrict,
  start_time  timestamptz,
  status      text default 'pending'
              check (status in ('pending', 'confirmed', 'completed', 'cancelled', 'rejected')),
  created_at  timestamptz default now(),
  cancel_reason text,
  updated_by  text default 'system'
);

-- -----------------------------------------------------------------------------
-- blocked_slots - doctor unavailability
-- -----------------------------------------------------------------------------
create table if not exists public.blocked_slots (
  id          uuid primary key default gen_random_uuid(),
  start_time  timestamptz,
  end_time    timestamptz,
  reason      text check (reason in ('comida', 'junta', 'personal', 'vacaciones')),
  created_at  timestamptz default now(),
  constraint blocked_slots_end_after_start check (end_time > start_time)
);

-- -----------------------------------------------------------------------------
-- patient_files - metadata for objects in the clinical_records bucket
-- -----------------------------------------------------------------------------
create table if not exists public.patient_files (
  id           uuid primary key default gen_random_uuid(),
  patient_id   uuid references public.patients (id) on delete cascade,
  file_url     text,
  file_name    text,
  file_type    text,
  uploaded_by  text check (uploaded_by in ('doctor', 'patient')),
  created_at   timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- prescriptions
-- -----------------------------------------------------------------------------
create table if not exists public.prescriptions (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments (id) on delete cascade,
  patient_id      uuid references public.patients (id) on delete cascade,
  medications     jsonb default '[]'::jsonb,
  created_at      timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- clinical_notes - SOAP notes
-- -----------------------------------------------------------------------------
create table if not exists public.clinical_notes (
  id              uuid primary key default gen_random_uuid(),
  appointment_id  uuid references public.appointments (id),
  patient_id      uuid references public.patients (id),
  subjective      text,
  objective       text,
  analysis        text,
  plan            text,
  created_at      timestamptz default now()
);

-- -----------------------------------------------------------------------------
-- clinic_settings - weekly opening hours
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_settings (
  id          uuid primary key default gen_random_uuid(),
  doctor_id   uuid references auth.users (id),
  start_time  text,
  end_time    text,
  updated_at  timestamptz default now(),
  schedule    jsonb
);

-- -----------------------------------------------------------------------------
-- Indexes that the new RLS predicates and booking RPCs depend on.
-- -----------------------------------------------------------------------------
create index if not exists patients_phone_idx           on public.patients (phone);
create index if not exists appointments_patient_id_idx  on public.appointments (patient_id);
create index if not exists appointments_start_time_idx  on public.appointments (start_time);
create index if not exists blocked_slots_start_time_idx on public.blocked_slots (start_time);
create index if not exists clinical_notes_patient_idx   on public.clinical_notes (patient_id);
create index if not exists prescriptions_patient_idx    on public.prescriptions (patient_id);
create index if not exists patient_files_patient_idx    on public.patient_files (patient_id);

-- -----------------------------------------------------------------------------
-- Row Level Security is enabled on every table. The policies themselves live in
-- migration 04; enabling RLS without policies denies everything, so migrations
-- 02 through 04 must be applied in the same session as this file.
-- -----------------------------------------------------------------------------
alter table public.patients       enable row level security;
alter table public.profiles       enable row level security;
alter table public.services       enable row level security;
alter table public.inventory      enable row level security;
alter table public.appointments   enable row level security;
alter table public.blocked_slots  enable row level security;
alter table public.patient_files  enable row level security;
alter table public.prescriptions  enable row level security;
alter table public.clinical_notes enable row level security;
alter table public.clinic_settings enable row level security;

-- Private bucket for clinical documents. Idempotent.
insert into storage.buckets (id, name, public)
values ('clinical_records', 'clinical_records', false)
on conflict (id) do nothing;
