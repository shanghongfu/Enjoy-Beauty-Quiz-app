-- Add exam settings columns to libraries table
-- Run this in Supabase SQL Editor as a single block.
--
-- The app saves the following fields from "Edit Library > Exam Settings":
--   exam_duration        => 考试时长（分钟）
--   exam_question_count  => 每场考试题数
--   exam_pass_rate       => 及格率（%）
--
-- These columns are nullable. Leaving them NULL means "use default".

ALTER TABLE public.libraries
  ADD COLUMN IF NOT EXISTS exam_duration integer,
  ADD COLUMN IF NOT EXISTS exam_question_count integer,
  ADD COLUMN IF NOT EXISTS exam_pass_rate integer;

-- Refresh PostgREST schema cache so the new columns are visible immediately.
NOTIFY pgrst, 'reload schema';
