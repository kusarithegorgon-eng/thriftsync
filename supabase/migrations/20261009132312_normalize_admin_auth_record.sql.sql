/*
# Normalize Admin Auth Record

## Overview
Normalizes the manually created admin account to the same shape as a normal
Supabase email/password account. This repairs password login without changing
the admin user's email, password, or profile role.

## Modified Data
- `auth.users`: fills standard empty token fields and email-user metadata.
- `auth.identities`: fills the standard email identity metadata.

## Security
- No permissions are broadened.
- The account remains a confirmed email/password user.
- The profile role remains `admin` and is not user-editable through the app.
*/

UPDATE auth.users
SET confirmation_token = COALESCE(confirmation_token, ''),
    recovery_token = COALESCE(recovery_token, ''),
    email_change_token_new = COALESCE(email_change_token_new, ''),
    email_change = COALESCE(email_change, ''),
    email_change_token_current = COALESCE(email_change_token_current, ''),
    phone_change = COALESCE(phone_change, ''),
    phone_change_token = COALESCE(phone_change_token, ''),
    reauthentication_token = COALESCE(reauthentication_token, ''),
    raw_user_meta_data = jsonb_build_object(
      'sub', id::text,
      'role', 'admin',
      'email', email,
      'display_name', 'Admin',
      'email_verified', true,
      'phone_verified', false
    ),
    updated_at = now()
WHERE email = 'admin@thriftsync.ph';

UPDATE auth.identities
SET identity_data = jsonb_build_object(
      'sub', user_id::text,
      'role', 'admin',
      'email', 'admin@thriftsync.ph',
      'display_name', 'Admin',
      'email_verified', false,
      'phone_verified', false
    ),
    updated_at = now()
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@thriftsync.ph')
  AND provider = 'email';
