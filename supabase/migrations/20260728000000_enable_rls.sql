-- Row level security for all public tables.
--
-- Context: the calculate-trip edge function connects with the service role,
-- which bypasses RLS entirely, so none of this affects it. These policies only
-- constrain what the mobile client can reach with its anon key.
--
-- The client touches exactly two tables directly (verified against the app
-- source): it SELECTs `trips` and INSERTs `feedback`. Every other table is
-- written only by the edge function, so RLS is enabled with no client policies,
-- which denies anon/authenticated access outright.
--
-- Anonymous sign-in issues a JWT with role `authenticated`, so policies target
-- that role. auth.uid() is the anon user id, stored as trips.device_id.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- trips: a user may read only their own. No client writes - the edge function
-- inserts with the service role.
-- ---------------------------------------------------------------------------
alter table public.trips enable row level security;

drop policy if exists "trips_select_own" on public.trips;
create policy "trips_select_own"
  on public.trips
  for select
  to authenticated
  using (device_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- feedback: a user may submit feedback only for a trip they own. The ownership
-- check is done here rather than trusted from the client.
-- ---------------------------------------------------------------------------
alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own_trip" on public.feedback;
create policy "feedback_insert_own_trip"
  on public.feedback
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.trips t
      where t.id = trip_id
        and t.device_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- devices: the client never queries this. Reading your own row is harmless and
-- useful for debugging; everything else is denied.
-- ---------------------------------------------------------------------------
alter table public.devices enable row level security;

drop policy if exists "devices_select_own" on public.devices;
create policy "devices_select_own"
  on public.devices
  for select
  to authenticated
  using (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- calculation_events: analytics, written by the edge function only. No client
-- access of any kind.
-- ---------------------------------------------------------------------------
alter table public.calculation_events enable row level security;

-- ---------------------------------------------------------------------------
-- Service-role-only tables. RLS on with no policies = no client access.
--
-- route_cache matters most: without RLS a client could write cache rows and
-- poison the ETAs other users are served.
-- ---------------------------------------------------------------------------
alter table public.route_cache             enable row level security;
alter table public.corridor_stats          enable row level security;
alter table public.city_profiles           enable row level security;
alter table public.transport_profiles      enable row level security;
alter table public.recommendation_versions enable row level security;
