-- Fix: libraries stored as nested JSON string inside text[] due to Supabase RPC parameter handling.
-- Supabase RPC sends JS arrays as JSON; PostgreSQL text[] parameter receives the JSON
-- string as a single array element. This script:
-- 1. Cleans existing corrupted student.library values.
-- 2. Updates create_student to accept p_libraries as JSON text and convert internally.

-- 1. Clean corrupted libraries values.
-- If a student's libraries looks like {"[lib_xxx]"} or {"[lib_xxx,lib_yyy]"},
-- parse the JSON string and store the inner IDs as a proper text array.
DO $$
DECLARE
  r public.users%ROWTYPE;
  raw_arr text[];
  inner_json text;
  parsed jsonb;
  clean_ids text[];
BEGIN
  FOR r IN SELECT * FROM public.users WHERE role = 'student' AND libraries IS NOT NULL LOOP
    raw_arr := r.libraries;
    -- Only fix cases where the array has exactly one element that looks like a JSON array
    IF array_length(raw_arr, 1) = 1 AND raw_arr[1] LIKE '[%' THEN
      inner_json := raw_arr[1];
      BEGIN
        parsed := inner_json::jsonb;
        IF jsonb_typeof(parsed) = 'array' THEN
          clean_ids := ARRAY(SELECT jsonb_array_elements_text(parsed));
          UPDATE public.users SET libraries = COALESCE(clean_ids, '{}'::text[])
          WHERE id = r.id;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- Leave untouched if parsing fails
        NULL;
      END;
    END IF;
  END LOOP;
END $$;

-- 2. Recreate create_student with p_libraries as JSON text parameter.
DROP FUNCTION IF EXISTS public.create_student(text, text, text, text, text[], timestamptz);
DROP FUNCTION IF EXISTS public.create_student(text, text, text, text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.create_student(
  p_username text,
  p_password text,
  p_name text DEFAULT NULL,
  p_avatar text DEFAULT '📚',
  p_libraries text DEFAULT '[]',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_catalog
AS $$
DECLARE
  v_email      text;
  v_uid        uuid;
  v_name       text;
  v_avatar     text;
  v_existing   uuid;
  v_libraries  text[];
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_username IS NULL OR length(trim(p_username)) < 2 THEN
    RAISE EXCEPTION 'Username too short';
  END IF;
  IF p_password IS NULL OR length(p_password) < 4 THEN
    RAISE EXCEPTION 'Password must be at least 4 characters';
  END IF;

  v_email  := regexp_replace(lower(p_username), '[^a-z0-9._-]', '_', 'g') || '@quiz.local';
  v_name   := COALESCE(nullif(p_name, ''), p_username);
  v_avatar := COALESCE(nullif(p_avatar, ''), '📚');

  -- Parse JSON array of library ids into a proper PostgreSQL text[]
  BEGIN
    v_libraries := ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_libraries::jsonb, '[]'::jsonb)));
  EXCEPTION WHEN OTHERS THEN
    v_libraries := '{}'::text[];
  END;

  SELECT id INTO v_existing FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_existing IS NULL THEN
    v_uid := gen_random_uuid();

    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      v_email,
      crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('name', v_name, 'avatar', v_avatar),
      now(), now(),
      '', '', '', ''
    );

    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      v_uid, v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email', v_email, now(), now(), now()
    );
  ELSE
    v_uid := v_existing;

    UPDATE auth.users
    SET encrypted_password = crypt(p_password, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        updated_at         = now(),
        raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                             || jsonb_build_object('name', v_name, 'avatar', v_avatar)
    WHERE id = v_uid;
  END IF;

  INSERT INTO public.users (
    id, username, name, avatar, role, libraries, enabled, expires_at, password
  ) VALUES (
    v_uid, p_username, v_name, v_avatar, 'student',
    COALESCE(v_libraries, '{}'::text[]),
    true, p_expires_at, p_password
  )
  ON CONFLICT (id) DO UPDATE SET
    username    = EXCLUDED.username,
    name        = EXCLUDED.name,
    avatar      = EXCLUDED.avatar,
    role        = 'student',
    libraries   = EXCLUDED.libraries,
    enabled     = true,
    expires_at  = EXCLUDED.expires_at,
    password    = EXCLUDED.password;

  RETURN v_uid;
END;
$$;
