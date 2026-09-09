/* Add language column to questions table */

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'questions'
      AND column_name = 'language'
  ) THEN
    ALTER TABLE public.questions ADD COLUMN language text DEFAULT 'en';
  END IF;
END
$$;

UPDATE public.questions
SET language = COALESCE(language, 'en')
WHERE language IS NULL;

ALTER TABLE public.questions ALTER COLUMN language SET NOT NULL;
ALTER TABLE public.questions ALTER COLUMN language SET DEFAULT 'en';
