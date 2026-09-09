-- ================================================
-- DIAGNOSE RLS question visibility
-- ================================================

-- 1. admin user profile
SELECT id, username, role, libraries FROM public.users WHERE username = 'admin';

-- 2. ALL questions in DB (no RLS via SQL Editor)
SELECT library_id, COUNT(*) AS qty
FROM public.questions
GROUP BY library_id
ORDER BY COUNT(*) DESC;

-- 3. Are there any NULL library_id rows?
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE library_id IS NULL) AS null_lib_id,
  COUNT(*) FILTER (WHERE library_id IS NOT NULL) AS valid_lib_id
FROM public.questions;

-- 4. Questions with library_id in text[] format (libraries is text[])
SELECT COUNT(*) AS visible_questions
FROM public.questions
WHERE library_id = ANY(
  ARRAY['lib_1788523600243','lib_1788525795766','lib_1788528512723']
);

-- 5. RLS policies on questions
SELECT policyname, cmd, permissive, roles, qual::text
FROM pg_policies
WHERE tablename = 'questions';

-- 6. RLS policies on libraries
SELECT policyname, cmd, permissive, roles, qual::text
FROM pg_policies
WHERE tablename = 'libraries';

-- 7. Check if RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname IN ('questions', 'libraries', 'users');

-- 8. Sample questions with their actual library_id strings
SELECT id, library_id, LEFT(text, 50) AS sample
FROM public.questions
LIMIT 10;
