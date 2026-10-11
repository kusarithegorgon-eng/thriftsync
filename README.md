# ThriftSync

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-bahr8krs)

## Run ThriftSync with Supabase

The frontend connects directly to Supabase for authentication, database
queries, storage, and Edge Functions. No local MariaDB server or API is needed.

1. Apply the SQL files in [`supabase/migrations`](./supabase/migrations) in
   timestamp order. For an existing project whose earlier migrations are
   already applied, apply the new
   [`checkout migration`](./supabase/migrations/20261011000000_add_atomic_checkout.sql)
   and [`auction migration`](./supabase/migrations/20261011010000_complete_auction_modes.sql)
   and [`bulk moderation migration`](./supabase/migrations/20261011020000_add_bulk_listing_moderation.sql)
   in the Supabase SQL Editor.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from your Supabase project's API settings. The
   publishable/anon key is intended for frontend use; never put a service-role
   key in the Vite environment.
3. Deploy the `auction-ops` Edge Function in `supabase/functions/auction-ops`
   and set its Supabase secrets as required by that function. Redeploy it after
   updating the function source.
4. Install Node.js 20 or later, run `npm install`, then run `npm run dev`.
   Open the local URL printed by Vite, usually `http://localhost:5173`.

Create accounts through the app's Sign Up page. To grant an account
administrator access, update its `profiles.role` to `admin` in the Supabase
Dashboard after signing up. Sellers can choose English auctions, where buyers
place ascending bids, or Dutch auctions, where the price descends until a
buyer claims the item.

The Privacy Notice and Terms of Use contain marked legal-business and contact
placeholders. Replace them with verified details and have the notices reviewed
for your business before making the marketplace publicly available.
