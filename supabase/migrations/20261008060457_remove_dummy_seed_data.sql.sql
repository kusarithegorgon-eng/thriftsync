/*
# Remove All Dummy / Seed Data

## What gets deleted:
- All listings (16 dummy listings)
- All boutiques (4 dummy boutiques)
- All bids (13 dummy bids)
- All reviews (9 dummy reviews)
- All vouchers (6 dummy vouchers) and their redemptions
- All dummy profiles (IDs prefixed a1000000 / b1000000)
- All locker handoffs (should be 0)

## What is KEPT (reference data, not dummy):
- cebu_barangays: 20 real Cebu barangay/municipality coordinates
- cebu_districts: 21 real Cebu district definitions
- locker_locations: 5 real partner locker locations
- Real user profiles (with actual auth.users entries)
- Schema, policies, functions, indexes — all untouched
*/

-- Delete in dependency order (child tables first)
DELETE FROM bids;
DELETE FROM reviews;
DELETE FROM voucher_redemptions;
DELETE FROM vouchers;
DELETE FROM listings;
DELETE FROM boutiques;
DELETE FROM locker_handoffs;
DELETE FROM itineraries;

-- Delete only dummy profiles (those without a real auth.users entry)
-- Real users who signed up through the app are preserved
DELETE FROM profiles
WHERE id NOT IN (SELECT id FROM auth.users);
