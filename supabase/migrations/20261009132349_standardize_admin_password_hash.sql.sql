/*
# Standardize Admin Password Hash

## Overview
Regenerates the admin account password hash using the standard bcrypt cost used
by the existing Supabase email accounts. The password remains `admin123`.

## Modified Data
- `auth.users.encrypted_password`: replaces the low-cost hash with a standard
  bcrypt hash.

## Security
- The plaintext password is used only inside the database hash operation and
  is not stored as plaintext.
- No account permissions are changed.
*/

UPDATE auth.users
SET encrypted_password = crypt('admin123', gen_salt('bf', 10)),
    updated_at = now()
WHERE email = 'admin@thriftsync.ph';
