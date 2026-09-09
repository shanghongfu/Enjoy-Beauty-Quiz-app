/* Check if admin user's JWT app_metadata.role is correctly set in auth.users */
SELECT 
  au.email,
  au.raw_app_meta_data,
  au.raw_app_meta_data ->> 'role' AS role_from_text,
  jsonb_typeof(au.raw_app_meta_data) AS metadata_type,
  pu.role AS public_users_role
FROM auth.users au
LEFT JOIN public.users pu ON pu.id = au.id
WHERE pu.role = 'admin' OR au.email LIKE '%admin%'
ORDER BY au.created_at DESC
LIMIT 5;
