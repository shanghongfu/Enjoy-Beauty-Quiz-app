/* 一条跑完，直接出 4 行结论。整段贴进 Supabase SQL Editor 运行。 */

SELECT '① 题库id清单' AS 项目,
       (SELECT string_agg(id, ' | ' ORDER BY name) FROM public.libraries) AS 值
UNION ALL
SELECT '② 学生分配',
       (SELECT string_agg(username || '=[' || COALESCE(libraries::text,'') || ']', ' | ')
        FROM public.users WHERE role = 'student')
UNION ALL
SELECT '③ libraries.id 列类型',
       (SELECT data_type || '/' || udt_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='libraries' AND column_name='id')
UNION ALL
SELECT '④ users.libraries 列类型',
       (SELECT data_type || '/' || udt_name
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='users' AND column_name='libraries');
