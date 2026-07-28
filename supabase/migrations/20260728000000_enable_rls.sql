-- Row level security: desired end state for all public tables.
--
-- Verified against the live database on 2026-07-28. RLS was already enabled on
-- every table, and the ownership policies on trips, feedback, devices and
-- calculation_events were already correct. This file records that state so it
-- is version controlled and auditable, and closes three gaps found in review.
--
-- The calculate-trip edge function connects with the service role, which
-- bypasses RLS entirely. Nothing here affects it.
--
-- The client touches exactly two tables directly, verified against the app
-- source: it SELECTs `trips` and INSERTs `feedback`. Nothing else.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- RLS switches. Already enabled in production; here so a fresh database
-- (staging, local, a restored backup) starts correct rather than open.
-- ---------------------------------------------------------------------------
alter table public.trips                   enable row level security;
alter table public.feedback                enable row level security;
alter table public.devices                 enable row level security;
alter table public.calculation_events      enable row level security;
alter table public.route_cache             enable row level security;
alter table public.city_profiles           enable row level security;
alter table public.transport_profiles      enable row level security;
alter table public.recommendation_versions enable row level security;

-- corridor_stats is read by the edge function's fallback path but was not
-- present in the public schema when this was written. Guarded so a missing
-- table cannot fail the migration; see the note in SECURITY.md.
do $$
begin
  if to_regclass('public.corridor_stats') is not null then
    execute 'alter table public.corridor_stats enable row level security';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Ownership policies. These already exist in production with these exact
-- names; recreating them is a no-op that keeps the definitions in the repo.
--
-- Note the roles: production has these on `public`, which covers anon and
-- authenticated. That is safe here because auth.uid() is null for anon, so
-- every comparison below yields no rows. Kept as-is to match production.
-- ---------------------------------------------------------------------------
drop policy if exists "trips_select_own" on public.trips;
create policy "trips_select_own"
  on public.trips for select
  using (auth.uid() = device_id);

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own"
  on public.feedback for insert
  with check (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and t.device_id = auth.uid()
    )
  );

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own"
  on public.feedback for select
  using (
    exists (
      select 1 from public.trips t
      where t.id = trip_id and t.device_id = auth.uid()
    )
  );

drop policy if exists "devices_select_own" on public.devices;
create policy "devices_select_own"
  on public.devices for select
  using (auth.uid() = id);

drop policy if exists "devices_insert_own" on public.devices;
create policy "devices_insert_own"
  on public.devices for insert
  with check (auth.uid() = id);

drop policy if exists "devices_update_own" on public.devices;
create policy "devices_update_own"
  on public.devices for update
  using (auth.uid() = id);

drop policy if exists "calculation_events_select_own" on public.calculation_events;
create policy "calculation_events_select_own"
  on public.calculation_events for select
  using (auth.uid() = device_id);

-- ---------------------------------------------------------------------------
-- HARDENING - the three gaps found in review.
--
-- Each drop is independent. If you would rather keep one, delete that
-- statement; nothing else depends on it.
-- ---------------------------------------------------------------------------

-- 1. Clients can currently insert their own trips. Nothing in the app does
--    this - trips are written by the edge function under the service role.
--    Left in place, a user can fabricate trip rows attributed to themselves,
--    polluting their own history and any analytics aggregated from trips.
drop policy if exists "trips_insert_own" on public.trips;

-- 2. Same for analytics events: clients can insert calculation_events with
--    their own device_id. The app never does. Left in place, the events table
--    cannot be trusted as a measurement source.
drop policy if exists "calculation_events_insert_own" on public.calculation_events;

-- 3. These three tables are readable by anyone with the anon key
--    (USING (true)). They hold the tuning that drives the recommendation:
--    rush-hour windows, weather sensitivity, buffer configuration. No client
--    code reads them - only the edge function does, via the service role - so
--    exposing them buys nothing and publishes how the engine is calibrated.
drop policy if exists "city_profiles_read_all"           on public.city_profiles;
drop policy if exists "transport_profiles_read_all"      on public.transport_profiles;
drop policy if exists "recommendation_versions_read_all" on public.recommendation_versions;
