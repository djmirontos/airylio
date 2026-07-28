-- Read-only audit of row level security. Run in the Supabase SQL editor.
-- Changes nothing; only reports current state.
--
-- WHAT TO LOOK FOR
--   Section 1: rls_enabled must be true for trips, feedback, devices,
--              calculation_events. Any false there is a live data leak.
--   Section 2: every table above needs at least one policy. A table with RLS
--              enabled and zero policies denies all access to anon/authenticated
--              (the edge function still works - it uses the service role).
--   Section 3: any policy whose USING clause is `true` is world-readable.

-- 1. Is RLS switched on?
select
  c.relname                              as table_name,
  c.relrowsecurity                       as rls_enabled,
  c.relforcerowsecurity                  as rls_forced,
  (select count(*) from pg_policies p
     where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relrowsecurity asc, c.relname;

-- 2. What do the policies actually say?
select
  tablename,
  policyname,
  cmd          as command,
  roles,
  qual         as using_expression,
  with_check   as with_check_expression
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- 3. Policies that permit unrestricted access.
select
  tablename,
  policyname,
  cmd,
  qual as using_expression
from pg_policies
where schemaname = 'public'
  and (qual is null or btrim(qual) = 'true')
order by tablename;

-- 4. Columns the policies need to exist. Confirms the assumptions in
--    migrations/0001_enable_rls.sql before it is applied.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'trips'              and column_name = 'device_id') or
    (table_name = 'devices'            and column_name = 'id')        or
    (table_name = 'calculation_events' and column_name = 'device_id') or
    (table_name = 'feedback'           and column_name in ('trip_id', 'device_id'))
  )
order by table_name, column_name;
