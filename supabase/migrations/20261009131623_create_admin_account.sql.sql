/*
# Create Admin Account

Creates a dedicated admin user with:
- Email: admin@thriftsync.ph
- Password: admin123
- Profile role: admin

This account can approve/reject listings through the Admin Moderation page.
*/

DO $$
DECLARE
  v_user_id uuid;
  v_existing uuid;
BEGIN
  -- Check if admin user already exists
  SELECT id INTO v_existing FROM auth.users WHERE email = 'admin@thriftsync.ph';

  IF v_existing IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      created_at,
      updated_at,
      raw_app_meta_data,
      raw_user_meta_data,
      email_change_confirm_status
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      'admin@thriftsync.ph',
      crypt('admin123', gen_salt('bf')),
      now(),
      now(),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"display_name":"Admin"}',
      0
    );
  ELSE
    v_user_id := v_existing;
    -- Update password in case it was changed
    UPDATE auth.users SET encrypted_password = crypt('admin123', gen_salt('bf')), updated_at = now()
    WHERE id = v_user_id;
  END IF;

  -- Create or update admin profile
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (v_user_id, 'Admin', 'admin')
  ON CONFLICT (id) DO UPDATE SET role = 'admin', display_name = 'Admin';
END $$;
