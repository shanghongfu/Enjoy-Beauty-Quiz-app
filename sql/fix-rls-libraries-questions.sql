-- Fix RLS policies for libraries / questions / stats tables.
-- The old policies likely checked auth.jwt() ->> 'role', which always returns 'authenticated'.
-- We now check auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'.
-- Run this in Supabase SQL Editor as a single block.

-- Helper: is the current JWT an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- ========== libraries ==========
ALTER TABLE public.libraries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS libraries_select_authenticated ON public.libraries;
DROP POLICY IF EXISTS libraries_admin_all ON public.libraries;

CREATE POLICY libraries_select_authenticated
  ON public.libraries
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY libraries_admin_all
  ON public.libraries
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ========== questions ==========
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS questions_select_authenticated ON public.questions;
DROP POLICY IF EXISTS questions_admin_all ON public.questions;

CREATE POLICY questions_select_authenticated
  ON public.questions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY questions_admin_all
  ON public.questions
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ========== stats (for completeness; admin writes, own user reads) ==========
ALTER TABLE public.stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stats_select_own ON public.stats;
DROP POLICY IF EXISTS stats_admin_all ON public.stats;

CREATE POLICY stats_select_own
  ON public.stats
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY stats_admin_all
  ON public.stats
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
