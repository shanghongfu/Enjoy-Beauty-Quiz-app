-- ============================================================
-- Fix: permission denied for table questions/libraries/users
-- Root cause: CREATE POLICY does NOT grant table-level permissions.
-- PostgreSQL requires explicit GRANT for each role (anon, authenticated).
-- Run this in Supabase SQL Editor (SQL tab).
-- ============================================================

-- libraries: anon reads, authenticated writes
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.libraries TO anon, authenticated;
GRANT ALL ON public.libraries TO authenticated;

-- questions: anon reads, authenticated writes
GRANT SELECT ON public.questions TO anon, authenticated;
GRANT ALL ON public.questions TO authenticated;

-- users: authenticated reads/writes (profile is personal)
GRANT SELECT ON public.users TO authenticated;
GRANT ALL ON public.users TO authenticated;

-- stats: authenticated reads/writes
GRANT SELECT ON public.stats TO authenticated;
GRANT ALL ON public.stats TO authenticated;

-- Verify: run this to confirm current grant state
-- SELECT grantee, privilege_type, table_name
--   FROM information_schema.table_privileges
--  WHERE table_schema = 'public'
--    AND table_name IN ('libraries', 'questions', 'users', 'stats')
--  ORDER BY table_name, grantee;
