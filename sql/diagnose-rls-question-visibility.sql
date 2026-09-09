-- ================================================
-- DIAGNOSE: RLS policies blocking question visibility
-- ================================================

-- 1. What anon can see
SELECT 'ANON sees in questions' AS ctx, COUNT(*)::text AS qty FROM public.questions;

-- 2. All question counts by library (no RLS, via service role / direct SQL)
SELECT
  l.id,
  l.name,
  COUNT(q.id) AS qty
FROM public.libraries l
LEFT JOIN public.questions q ON q.library_id = l.id
GROUP BY l.id, l.name
ORDER BY l.name;

-- 3. Check RLS policies on questions
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  cmd,
  roles,
  qual::text AS using_expression,
  with_check::text AS check_expression
FROM pg_policies
WHERE tablename IN ('questions', 'libraries', 'users');

-- 4. Are RLS policies actually enabled?
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled,
  relowner::regrole AS owner
FROM pg_class
WHERE relname IN ('questions', 'libraries', 'users');

-- 5. Full questions table (no RLS) - raw counts
SELECT
  library_id,
  COUNT(*) AS qty,
  SUBSTRING(text, 1, 40) AS sample_text
FROM public.questions
GROUP BY library_id
ORDER BY COUNT(*) DESC;

-- 6. Check if any question rows have NULL library_id
SELECT
  COUNT(*) FILTER (WHERE library_id IS NULL) AS null_library_id,
  COUNT(*) FILTER (WHERE library_id IS NOT NULL) AS valid_library_id,
  COUNT(*) AS total
FROM public.questions;
