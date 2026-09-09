-- Fix public.users RLS so admin can update student libraries.
-- Students can only read their own profile; admin can CRUD all profiles.
-- Run this in Supabase SQL Editor as a single block.

-- Ensure helper exists (also created by fix-rls-libraries-questions.sql)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Clean up existing policies to avoid conflicts
DROP POLICY IF EXISTS users_admin_all ON public.users;
DROP POLICY IF EXISTS users_select_self ON public.users;

-- Admin: full access to all user profiles
CREATE POLICY users_admin_all
  ON public.users
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Students: read only their own row
CREATE POLICY users_select_self
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());
