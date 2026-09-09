/* Diagnose why admin Word import fails: check data presence + RLS policies + current role */
SELECT '① libraries 行数' AS label, COUNT(*)::text AS value FROM public.libraries
UNION ALL
SELECT '② questions 行数', COUNT(*)::text FROM public.questions
UNION ALL
SELECT '③ libraries RLS 策略', COALESCE(string_agg(policyname || ':' || cmd, ' | '), '无策略')
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'libraries'
UNION ALL
SELECT '④ questions RLS 策略', COALESCE(string_agg(policyname || ':' || cmd, ' | '), '无策略')
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'questions'
UNION ALL
SELECT '⑤ 当前 JWT role', COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'null')
UNION ALL
SELECT '⑥ libraries 表 RLS 启用', relrowsecurity::text FROM pg_class WHERE relname = 'libraries' AND relnamespace = 'public'::regnamespace
UNION ALL
SELECT '⑦ questions 表 RLS 启用', relrowsecurity::text FROM pg_class WHERE relname = 'questions' AND relnamespace = 'public'::regnamespace;
