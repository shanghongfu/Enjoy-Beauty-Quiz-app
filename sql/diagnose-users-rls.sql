/* Diagnose public.users RLS + column types + actual student library values */
SELECT '① users 表 RLS 是否启用' AS label,
       relrowsecurity::text AS value
FROM pg_class WHERE relname = 'users' AND relnamespace = 'public'::regnamespace
UNION ALL
SELECT '② users.libraries 列类型',
       data_type || '/' || udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'libraries'
UNION ALL
SELECT '③ users 表 RLS 策略',
       COALESCE(string_agg(policyname || ': ' || cmd || ' → ' || qual, ' | '), '无策略')
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
UNION ALL
SELECT '④ 每个学生的 libraries 原始值',
       string_agg(username || '=[' || COALESCE(libraries::text,'') || ']', ' | ')
FROM public.users WHERE role = 'student';
