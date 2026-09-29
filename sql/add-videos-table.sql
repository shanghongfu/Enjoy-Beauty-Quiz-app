-- ============================================================
-- Add `videos` table: subject-categorized MP4 hosting (Bunny Stream)
-- Run this in Supabase Dashboard → SQL Editor → Run.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.videos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id    text NOT NULL REFERENCES public.libraries(id) ON DELETE CASCADE,
  title         text NOT NULL,
  bunny_video_id text NOT NULL,
  week_label    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  uploaded_by   uuid
);

CREATE INDEX IF NOT EXISTS idx_videos_library  ON public.videos(library_id);
CREATE INDEX IF NOT EXISTS idx_videos_created  ON public.videos(created_at DESC);

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

-- Admin (public.is_admin()) gets full CRUD
DROP POLICY IF EXISTS videos_admin_all ON public.videos;
CREATE POLICY videos_admin_all ON public.videos
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Student: can only SELECT videos whose library is assigned to them.
-- users.libraries is a text[]; compare the scalar library_id against that
-- array per user row via EXISTS + library_id = ANY(u.libraries).
DROP POLICY IF EXISTS videos_student_select ON public.videos;
CREATE POLICY videos_student_select ON public.videos
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND library_id = ANY(u.libraries)
    )
  );

-- Reload PostgREST schema cache so the new table is immediately queryable
NOTIFY pgrst, 'reload schema';
