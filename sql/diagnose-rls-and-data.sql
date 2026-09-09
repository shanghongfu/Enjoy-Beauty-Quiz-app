-- ============================================================
-- Diagnostic: Check actual database state and RLS configuration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Libraries table record count and sample
SELECT '=== LIBRARIES ===' as info;
SELECT id, name, created_at FROM public.libraries ORDER BY created_at LIMIT 20;

-- 2. Questions table: count per library
SELECT '=== QUESTIONS PER LIBRARY ===' as info;
SELECT library_id, COUNT(*) as question_count
FROM public.questions
GROUP BY library_id
ORDER BY question_count DESC
LIMIT 20;

-- 3. Total questions
SELECT '=== TOTAL QUESTIONS ===' as info, COUNT(*) as total FROM public.questions;

-- 4. RLS status on all app tables
SELECT '=== RLS STATUS ===' as info,
       schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('libraries', 'questions', 'stats', 'users')
ORDER BY tablename;

-- 5. All RLS policies on app tables
SELECT '=== RLS POLICIES ===' as info,
       tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('libraries', 'questions', 'stats', 'users')
ORDER BY tablename, policyname;

-- 6. Grants on app tables
SELECT '=== TABLE GRANTS ===' as info,
       table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('libraries', 'questions', 'stats', 'users')
ORDER BY table_name, grantee;

-- 7. Test: Can anon select questions? (This is what the app does)
SELECT '=== ANON CAN READ QUESTIONS? ===' as info,
       (SELECT COUNT(*) FROM public.questions) as count_for_anon;
