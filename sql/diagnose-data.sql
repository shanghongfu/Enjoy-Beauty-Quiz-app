-- Diagnostic: see what libraries and questions are actually in Supabase.
-- Run this in Supabase SQL Editor.

SELECT 'libraries' AS table_name, COUNT(*) AS row_count FROM public.libraries
UNION ALL
SELECT 'questions', COUNT(*) FROM public.questions
UNION ALL
SELECT 'students', COUNT(*) FROM public.users WHERE role = 'student';

-- List libraries with question counts
SELECT 
  l.id,
  l.name,
  COUNT(q.id) AS question_count
FROM public.libraries l
LEFT JOIN public.questions q ON q.library_id = l.id
GROUP BY l.id, l.name
ORDER BY l.name;

-- Sample a few questions to verify language tags
SELECT id, library_id, language, LEFT(text, 60) AS text_preview
FROM public.questions
ORDER BY created_at DESC
LIMIT 10;

-- Students and their assigned libraries
SELECT id, username, name, libraries
FROM public.users
WHERE role = 'student';