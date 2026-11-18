# ThriftSync

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-bahr8krs)

## Run ThriftSync with Supabase

The frontend connects directly to Supabase for authentication, database
queries, storage, and Edge Functions. No local MariaDB server or API is needed.

1. Apply the SQL files in [`supabase/migrations`](./supabase/migrations) in
   timestamp order. For an existing project whose earlier migrations are
   already applied, apply the new
   [`checkout migration`](./supabase/migrations/20261011000000_add_atomic_checkout.sql),
   [`auction migration`](./supabase/migrations/20261011010000_complete_auction_modes.sql),
   [`bulk moderation migration`](./supabase/migrations/20261011020000_add_bulk_listing_moderation.sql),
   [`bid error fix`](./supabase/migrations/20261013000000_fix_place_bid_message_ambiguity.sql),
   [`order fulfillment migration`](./supabase/migrations/20261013010000_add_order_fulfillment_flow.sql),
   [`marketplace trust features`](./supabase/migrations/20261107000000_add_marketplace_trust_and_live_features.sql),
   [`checkout payment metadata`](./supabase/migrations/20261108000000_add_checkout_payment_metadata.sql),
   [`auction settlement and winner notifications`](./supabase/migrations/20261118000000_settle_ended_english_auctions.sql),
   [`one-to-one barter workflow`](./supabase/migrations/20261118110000_complete_one_to_one_barter.sql),
   [`barter messaging`](./supabase/migrations/20261118130000_add_trade_conversations.sql),
   [`cash-on-delivery payment method`](./supabase/migrations/20261118140000_add_cash_on_delivery_payment_method.sql),
   and any later migrations in timestamp order in the Supabase SQL Editor.
2. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` from your Supabase project's API settings. The
   publishable/anon key is intended for frontend use; never put a service-role
   key in the Vite environment. Set `VITE_PAYMONGO_PUBLIC_KEY` for the client
   and `PAYMONGO_SECRET_KEY` only on the server (never with a `VITE_` prefix).
   This project uses Vite, so the public PayMongo key is `VITE_PAYMONGO_PUBLIC_KEY`,
   not `NEXT_PUBLIC_PAYMONGO_PUBLIC_KEY`. Also set the three `VITE_EMAILJS_*`
   values for the Contact Us form using a separate
   `VITE_EMAILJS_CONTACT_TEMPLATE_ID`. Configure that EmailJS template with
   `name`, `email`, `title`, and `message` variables, and set the recipient to
   your support inbox rather than a value supplied by the form. Seller order
   emails require a separate transaction template configured with a dynamic
   `{{to_email}}` recipient and the buyer/order variables described below.
3. In Supabase Dashboard, open Authentication settings and enable email
   confirmations. In the Confirm signup email template, include Supabase's
   `{{ .Token }}` value so users receive an eight-digit one-time code. The EmailJS template
   ID is separate from Supabase Auth and cannot verify accounts.
4. Deploy the `auction-ops` Edge Function in `supabase/functions/auction-ops`
   and set its Supabase secrets as required by that function. Redeploy it after
   updating the function source. Deploy `supabase/functions/thrift-crawl` for
   server-calculated Cebu arrival estimates and boutique-hours alerts. Deploy
   `supabase/functions/paymongo-checkout` the same way, apply
   [`paymongo_checkouts`](./supabase/migrations/20261031000000_add_paymongo_checkouts.sql),
   and set the PayMongo secret with
   `npx supabase secrets set PAYMONGO_SECRET_KEY=sk_test_...` so the secret never
   ships in the Vite bundle. Checkout then redirects buyers to PayMongo Hosted
   Checkout and only creates the marketplace order after PayMongo reports the
   session as paid. Checkout offers **GCash online** or **Pay on receipt** for
   courier delivery and boutique pickup. Pay-on-receipt orders require the buyer
   to pay the seller or courier at handoff; the app does not collect or verify
   that cash payment. To test the
   simulated, non-payment GCash flow, set `VITE_GCASH_SIMULATION_ENABLED=true`
   locally with a `pk_test_` public key and set
   `GCASH_SIMULATION_ENABLED=true` and a test-only `sk_test_` secret only in a
   development Supabase project. After changing Edge Function code or these
   secrets, redeploy the function with
   `npx supabase functions deploy paymongo-checkout`. Confirm the project
   linked for deployment is the same development project configured by
   `VITE_SUPABASE_URL`; do not enable simulated checkout on production. The
   demo is preselected at checkout when those local settings are active, never
   asks for GCash credentials or collects money, and marks resulting orders as
   simulated. The Edge Function also requires a server-side `sk_test_` key.
   Do not enable it in production.

   Seller order emails are sent by the `paymongo-checkout` Edge Function after
   checkout. Create a dedicated EmailJS transaction template (do not reuse a
   signup/MFA or Contact Us template) with `{{to_email}}` as the recipient and
   `{{buyer_name}}`, `{{buyer_email}}`, `{{boutique_name}}`, `{{order_items}}`,
   `{{order_ids}}`, `{{order_total}}`, `{{delivery_methods}}`, and
   `{{payment_notice}}` in its content.
   Set `EMAILJS_SERVICE_ID`, `EMAILJS_ORDER_TEMPLATE_ID`, and
   `EMAILJS_PUBLIC_KEY` as Supabase secrets. Email failure is reported after
   checkout; the buyer and item still appear in the seller dashboard.
5. Install Node.js 20 or later, run `npm install`, then run `npm run dev`.
   Open the local URL printed by Vite, usually `http://localhost:5173`.

To load sample marketplace data, run [`supabase/seed_demo_data.sql`](./supabase/seed_demo_data.sql)
in the Supabase SQL Editor after applying the migrations. The script is safe to
rerun; it creates clearly labeled demo profiles, boutiques, eight product
listings, and three completed demo orders. The five unsold listings appear in
the marketplace; demo orders remain subject to the app's existing order access
policies.

### Demo the partner locker handoff

Use a development/demo Supabase project and apply
[`20261014000000_connect_locker_checkout_and_fulfillment.sql`](./supabase/migrations/20261014000000_connect_locker_checkout_and_fulfillment.sql)
first. Create two separate ThriftSync accounts: one with the `buyer` profile
role and one with the `seller` profile role. In
[`supabase/seed_demo_locker_flow.sql`](./supabase/seed_demo_locker_flow.sql),
replace the two example email values at the top with those account emails, then
run the script in the Supabase SQL Editor.

The script adds one clearly labeled demo order and a pending locker handoff to
those accounts. Sign in as the buyer and open **My Orders** to see the locker
address and demo PIN `482915`. Sign in as the seller and open the seller
dashboard, enter that PIN under the demo order, and confirm the drop-off. Return
to the buyer account; the order will be ready for locker pickup. Enter the same
PIN in **My Orders** to confirm pickup and finish the status flow. This is a UI
workflow demo only: it does not charge a payment method or connect to physical
locker hardware. The SQL seed is intentionally not a reset script; it will not
reopen or overwrite the demo order after you progress it.

### What the Thrift Crawl Planner is for

The planner is a separate, optional tool for mapping an in-person shopping trip
between boutiques. Buyers can plan which shops to visit; sellers can use it as
shoppers to plan visits to other boutiques. Add at least two boutiques, choose
walking, driving, motorbike, or jeepney travel, set a departure time, review the
estimated arrival times and operating-hours alerts, and sign in to save it.
Sellers manage weekly boutique hours from the Sell page. Use **Use my location**
to include your current position as the route origin; the planner will select
the nearest chosen boutique as the first stop. To use Google Maps Routes for
street routing and automatic stop-order optimization, enable the Routes API in
Google Cloud, configure billing, and set `GOOGLE_MAPS_API_KEY` as a
`thrift-crawl` Supabase Edge Function secret (never as a `VITE_` variable).
For example, set it with `npx supabase secrets set GOOGLE_MAPS_API_KEY=your-key`
and redeploy the `thrift-crawl` function. Restrict the key to the Routes API.
The provider reorders intermediate stops
based on route efficiency and returns street geometry and leg estimates; Google
charges waypoint optimization at the Compute Routes Pro rate. Without this
secret, the planner continues to use OpenStreetMap street/foot routing in the
existing stop order. A configured Google API error is shown instead of silently
switching providers. Live traffic is not included; jeepney travel time is
approximate and does not represent an official jeepney route. If routing is
unavailable, the planner hides the route line and labels its local fallback
estimates rather than drawing a misleading straight line.
**Get directions there** opens Google Maps for turn-by-turn routing to the first
stop and shares your selected current coordinates with Google Maps. Your current
location is not stored in a saved itinerary. The planner does not plan a seller's
delivery route or change listing, order, or locker status. Locker pickup and
order fulfillment are handled from checkout, the buyer's **My Orders**, and the
seller dashboard instead.

### Trust, ratings, auctions, and messages

The latest marketplace trust migration adds seller-only realtime bidder details
and anonymized public bid labels, private image evidence for general violation
reports, and seller ratings that can only be submitted after the buyer
completes a verified order. Buyers can start listing-specific conversations;
participants receive new messages over Supabase Realtime. Both the chat UI and
the database reject external payment links, phone numbers, and off-escrow
settlement attempts. Apply the migration before deploying the frontend and
redeploy the `thrift-crawl` Edge Function when its ETA handler changes.

Create accounts through the app's Sign Up page. To grant an account
administrator access, update its `profiles.role` to `admin` in the Supabase
Dashboard after signing up. Sellers can choose English auctions, where buyers
place ascending bids, or Dutch auctions, where the price descends until a
buyer claims the item.
English auctions are settled automatically after their end time. The highest
eligible bid (including the reserve-price check) becomes an order, and the winner
receives an in-app notification linking them to **My Orders** to contact the
seller and follow delivery or pickup. Settlement runs every minute using
Supabase's `pg_cron` extension.

For barter, sellers enable **Accept barter offers** on a fixed-price listing.
Another seller can offer one of their own barter-enabled listings; offers have
a 72-hour response window and do not reserve items while pending. Acceptance
atomically reserves both listings. Each seller arranges the handover with the
other and confirms receipt in **My Trades**; both confirmations complete the
exchange and mark the listings as exchanged. Active accepted trade locks block
checkout, bids, and listing removal until both parties confirm.

The Privacy Notice and Terms of Use contain marked legal-business and contact
placeholders. Replace them with verified details and have the notices reviewed
for your business before making the marketplace publicly available.
