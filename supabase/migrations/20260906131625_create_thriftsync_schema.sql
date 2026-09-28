/*
# ThriftSync Marketplace Schema

## Overview
Creates the complete database schema for ThriftSync, a multi-vendor vintage and second-hand marketplace.
Supports buyer/seller/admin roles, boutique storefronts, 1-of-1 listings, auctions with bidding,
orders with escrow, messaging, wishlists, and reviews.

## New Tables
1. profiles - Extends auth.users with marketplace fields (role, display_name, avatar, bio)
2. boutiques - Vendor storefronts owned by sellers
3. listings - 1-of-1 unique items with era, category, condition, auction support
4. bids - Auction bids on listings
5. orders - Transactions between buyers and sellers with escrow status
6. messages - Buyer-seller communication tied to listings
7. wishlists - Saved items per user
8. reviews - Boutique reviews by buyers

## Security
- RLS enabled on all tables
- Public read for profiles, boutiques, listings, bids, reviews
- Owner-scoped writes for boutiques, listings, wishlists
- Participant-scoped for messages and orders

## Indexes
- Optimized for common queries: listings by boutique/status/category/era, bids by listing, orders by buyer/boutique
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer', 'seller', 'admin')),
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  bio text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read profiles" ON profiles;
CREATE POLICY "Public read profiles" ON profiles FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Users insert own profile" ON profiles;
CREATE POLICY "Users insert own profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users update own profile" ON profiles;
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Boutiques table
CREATE TABLE IF NOT EXISTS boutiques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  tagline text,
  bio text,
  banner_url text,
  logo_url text,
  location text,
  policies text,
  rating_avg numeric DEFAULT 0,
  rating_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE boutiques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read boutiques" ON boutiques;
CREATE POLICY "Public read boutiques" ON boutiques FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Sellers insert own boutique" ON boutiques;
CREATE POLICY "Sellers insert own boutique" ON boutiques FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "Sellers update own boutique" ON boutiques;
CREATE POLICY "Sellers update own boutique" ON boutiques FOR UPDATE
  TO authenticated USING (auth.uid() = seller_id) WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "Sellers delete own boutique" ON boutiques;
CREATE POLICY "Sellers delete own boutique" ON boutiques FOR DELETE
  TO authenticated USING (auth.uid() = seller_id);

-- Listings table
CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id uuid NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  era text,
  category text,
  condition_grade text CHECK (condition_grade IN ('Mint', 'Excellent', 'Good', 'Fair', 'Distressed')),
  material text,
  images text[] DEFAULT '{}',
  listing_type text NOT NULL DEFAULT 'fixed' CHECK (listing_type IN ('fixed', 'auction')),
  auction_end_at timestamptz,
  reserve_price numeric,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'draft')),
  sku text UNIQUE,
  coa_verified boolean DEFAULT false,
  views int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active listings" ON listings;
CREATE POLICY "Public read active listings" ON listings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Boutique owners insert listings" ON listings;
CREATE POLICY "Boutique owners insert listings" ON listings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = boutique_id AND boutiques.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "Boutique owners update listings" ON listings;
CREATE POLICY "Boutique owners update listings" ON listings FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = boutique_id AND boutiques.seller_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = boutique_id AND boutiques.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "Boutique owners delete listings" ON listings;
CREATE POLICY "Boutique owners delete listings" ON listings FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = boutique_id AND boutiques.seller_id = auth.uid())
  );

-- Bids table
CREATE TABLE IF NOT EXISTS bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  bidder_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  is_winning boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bids ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read bids" ON bids;
CREATE POLICY "Public read bids" ON bids FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated place bids" ON bids;
CREATE POLICY "Authenticated place bids" ON bids FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = bidder_id);

DROP POLICY IF EXISTS "Bidders update own bids" ON bids;
CREATE POLICY "Bidders update own bids" ON bids FOR UPDATE
  TO authenticated USING (auth.uid() = bidder_id) WITH CHECK (auth.uid() = bidder_id);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  boutique_id uuid NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'escrow_held' CHECK (status IN ('escrow_held', 'shipped', 'delivered', 'completed', 'disputed', 'refunded')),
  shipping_address text,
  tracking_number text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Buyers read own orders" ON orders;
CREATE POLICY "Buyers read own orders" ON orders FOR SELECT
  TO authenticated USING (
    auth.uid() = buyer_id OR
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = orders.boutique_id AND boutiques.seller_id = auth.uid())
  );

DROP POLICY IF EXISTS "Buyers create orders" ON orders;
CREATE POLICY "Buyers create orders" ON orders FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = buyer_id);

DROP POLICY IF EXISTS "Buyers and sellers update orders" ON orders;
CREATE POLICY "Buyers and sellers update orders" ON orders FOR UPDATE
  TO authenticated USING (
    auth.uid() = buyer_id OR
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = orders.boutique_id AND boutiques.seller_id = auth.uid())
  ) WITH CHECK (
    auth.uid() = buyer_id OR
    EXISTS (SELECT 1 FROM boutiques WHERE boutiques.id = orders.boutique_id AND boutiques.seller_id = auth.uid())
  );

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Participants read messages" ON messages;
CREATE POLICY "Participants read messages" ON messages FOR SELECT
  TO authenticated USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

DROP POLICY IF EXISTS "Authenticated send messages" ON messages;
CREATE POLICY "Authenticated send messages" ON messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = sender_id);

-- Wishlists table
CREATE TABLE IF NOT EXISTS wishlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, listing_id)
);

ALTER TABLE wishlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own wishlist" ON wishlists;
CREATE POLICY "Users read own wishlist" ON wishlists FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users add to wishlist" ON wishlists;
CREATE POLICY "Users add to wishlist" ON wishlists FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users remove from wishlist" ON wishlists;
CREATE POLICY "Users remove from wishlist" ON wishlists FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boutique_id uuid NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read reviews" ON reviews;
CREATE POLICY "Public read reviews" ON reviews FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated create reviews" ON reviews;
CREATE POLICY "Authenticated create reviews" ON reviews FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = reviewer_id);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_listings_boutique_id ON listings(boutique_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_category ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_era ON listings(era);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_bids_listing_id ON bids(listing_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder_id ON bids(bidder_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_boutique_id ON orders(boutique_id);
CREATE INDEX IF NOT EXISTS idx_messages_listing_id ON messages(listing_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_user_id ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_boutique_id ON reviews(boutique_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();