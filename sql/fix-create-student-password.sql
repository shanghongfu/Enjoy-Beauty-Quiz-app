-- Fix: public.users.password is NOT NULL, so create_student must populate it.
-- Run this in Supabase SQL Editor as a single block.

DROP FUNCTION IF EXISTS public.create_student(text, text, text, text, text[], timestamptz);
DROP FUNCTION IF EXISTS public.reset_student_password(text, text);

CREATE OR REPLACE FUNCTION public.create_student(
  p_username text,
  p_password text,
  p_name text DEFAULT NULL,
  p_avatar text DEFAULT '📚',
  p_libraries text[] DEFAULT '{}',
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_catalog
AS $$
DECLARE
  v_email    text;
  v_uid      uuid;
  v_name     text;
  v_avatar   text;
  v_existing uuid;
BEGIN
  -- Only admins may call this
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  -- Basic validation
  IF p_username IS NULL OR length(trim(p_username)) < 2 THEN
    RAISE EXCEPTION 'Username too short';
  END IF;
  IF p_password IS NULL OR length(p_password) < 4 THEN
    RAISE EXCEPTION 'Password must be at least 4 characters';
  END IF;

  v_email  := regexp_replace(lower(p_username), '[^a-z0-9._-]', '_', 'g') || '@quiz.local';
  v_name   := COALESCE(nullif(p_name, ''), p_username);
  v_avatar := COALESCE(nullif(p_avatar, ''), '📚');

  -- Does this auth user already exist?
  SELECT id INTO v_existing FROM auth.users WHERE email = v_email LIMIT 1;

  IF v_existing IS NULL THEN
    v_uid := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
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
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_uid,
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email',
      v_email,
      now(),
      now(),
      now()
    );
  ELSE
    v_uid := v_existing;

    UPDATE auth.users
    SET
      encrypted_password = crypt(p_password, gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      updated_at         = now(),
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb)
                           || jsonb_build_object('name', v_name, 'avatar', v_avatar)
    WHERE id = v_uid;
  END IF;

  -- Upsert public profile, now including password
  INSERT INTO public.users (
    id,
    username,
    name,
    avatar,
    role,
    libraries,
    enabled,
    expires_at,
    password
  ) VALUES (
    v_uid,
    p_username,
    v_name,
    v_avatar,
    'student',
    COALESCE(p_libraries, '{}'),
    true,
    p_expires_at,
    p_password
  )
  ON CONFLICT (id) DO UPDATE SET
    username   = EXCLUDED.username,
    name       = EXCLUDED.name,
    avatar     = EXCLUDED.avatar,
    role       = 'student',
    libraries  = EXCLUDED.libraries,
    enabled    = true,
    expires_at = EXCLUDED.expires_at,
    password   = EXCLUDED.password;

  RETURN v_uid;
END;
$$;


-- Keep reset_student_password in sync so public.users.password is also updated.
CREATE OR REPLACE FUNCTION public.reset_student_password(
  p_email text,
  p_password text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_catalog
AS $$
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Admin only';
  END IF;

  IF p_password IS NULL OR length(p_password) < 4 THEN
    RAISE EXCEPTION 'Password must be at least 4 characters';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at         = now()
  WHERE email = p_email;

  UPDATE public.users
  SET password = p_password
  WHERE id = (SELECT id FROM auth.users WHERE email = p_email LIMIT 1);
END;
$$;
