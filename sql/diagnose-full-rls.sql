-- 完整诊断（修复版）
-- 复制以下全部到 Supabase SQL Editor 运行

-- 1. Libraries 表
SELECT id, name, created_at FROM public.libraries ORDER BY created_at LIMIT 20;

-- 2. Questions 按 library 分布
SELECT library_id, COUNT(*) as cnt 
FROM public.questions 
GROUP BY library_id 
ORDER BY cnt DESC;

-- 3. questions 表前5条样本
SELECT id, library_id, LEFT(text, 50) as text_preview, language, correct_index
FROM public.questions 
ORDER BY created_at DESC
LIMIT 5;

-- 4. RLS 开关状态（正确字段名）
SELECT tablename, rowsecurity
FROM pg_tables 
WHERE schemaname='public' 
AND tablename IN ('libraries','questions','stats','users');

-- 5. 所有 RLS 策略
SELECT 
  schemaname, tablename, policyname, 
  cmd, permissive, roles, qual, with_check
FROM pg_policies 
WHERE schemaname='public' 
AND tablename IN ('libraries','questions','stats','users');

-- 6. 表级 grants（关键！）
SELECT 
  table_schema, table_name, grantee, 
  privilege_type, is_grantable
FROM information_schema.table_privileges 
WHERE table_schema='public' 
AND table_name IN ('libraries','questions','stats','users')
ORDER BY table_name, grantee;

-- 7. stats 表
SELECT * FROM public.stats LIMIT 5;

-- 8. users 表（先看有哪些列）
SELECT * FROM public.users ORDER BY created_at DESC LIMIT 5;
