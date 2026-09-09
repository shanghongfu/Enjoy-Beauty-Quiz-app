/* Full diagnostic: libraries, questions, users RLS, student assignments */
SELECT '① libraries 行数' AS label, COUNT(*)::text AS value FROM public.libraries
UNION ALL
SELECT '② questions 行数', COUNT(*)::text FROM public.questions
UNION ALL
SELECT '③ 各题库题目数', string_agg(name || ':' || cnt, ' | ')
FROM (SELECT l.name, COUNT(q.id) AS cnt FROM public.libraries l LEFT JOIN public.questions q ON q.library_id = l.id GROUP BY l.id, l.name) t
UNION ALL
SELECT '④ users 表 RLS 启用', relrowsecurity::text FROM pg_class WHERE relname = 'users' AND relnamespace = 'public'::regnamespace
UNION ALL
SELECT '⑤ users.libraries 列类型', data_type || '/' || udt_name
FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'libraries'
UNION ALL
SELECT '⑥ users 表 RLS 策略', COALESCE(string_agg(policyname || ':' || cmd, ' | '), '无策略')
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
UNION ALL
SELECT '⑦ 学生账号及分配的 libraries', string_agg(username || '=[' || COALESCE(libraries::text,'') || ']', ' | ')
FROM public.users WHERE role = 'student';
