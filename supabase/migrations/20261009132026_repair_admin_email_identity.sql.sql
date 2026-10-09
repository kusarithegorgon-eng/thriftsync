/*
# Repair Admin Email Identity

## Overview
Repairs the dedicated admin account created for listing moderation by adding the
email identity record required by Supabase password authentication.

## Modified Data
- `auth.identities`: adds the missing email provider identity for
  `admin@thriftsync.ph` when it does not already exist.

## Security
- No permissions or authentication rules are weakened.
- The identity is linked only to the existing admin auth user.
- The operation is idempotent and will not create duplicate identities.
*/

INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, id)
SELECT u.id::text,
       u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email',
       now(),
       now(),
       gen_random_uuid()
FROM auth.users u
WHERE u.email = 'admin@thriftsync.ph'
  AND NOT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = u.id
      AND i.provider = 'email'
  );
