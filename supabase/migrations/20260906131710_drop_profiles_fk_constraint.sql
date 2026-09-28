/*
# Allow standalone profiles for demo data

## Changes
- Remove FK constraint from profiles.id to auth.users so demo profiles can be inserted without real auth users.
- The trigger on auth.users still inserts into profiles on signup, so auth integration remains intact.
*/

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- Also drop FKs that reference profiles(id) and recreate them as CASCADE
-- boutiques.seller_id references profiles
ALTER TABLE boutiques DROP CONSTRAINT IF EXISTS boutiques_seller_id_fkey;
ALTER TABLE boutiques ADD CONSTRAINT boutiques_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- bids.bidder_id references profiles
ALTER TABLE bids DROP CONSTRAINT IF EXISTS bids_bidder_id_fkey;
ALTER TABLE bids ADD CONSTRAINT bids_bidder_id_fkey
  FOREIGN KEY (bidder_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- orders.buyer_id references profiles
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_buyer_id_fkey;
ALTER TABLE orders ADD CONSTRAINT orders_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- messages.sender_id references profiles
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_sender_id_fkey
  FOREIGN KEY (sender_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- messages.receiver_id references profiles
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_receiver_id_fkey;
ALTER TABLE messages ADD CONSTRAINT messages_receiver_id_fkey
  FOREIGN KEY (receiver_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- wishlists.user_id references profiles
ALTER TABLE wishlists DROP CONSTRAINT IF EXISTS wishlists_user_id_fkey;
ALTER TABLE wishlists ADD CONSTRAINT wishlists_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- reviews.reviewer_id references profiles
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_reviewer_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE CASCADE;