-- ============================================================
-- ThriftSync — SQLite Schema (all tables, full project)
-- ============================================================
-- Postgres → SQLite translation notes:
--   uuid         → TEXT (default: lower(hex(randomblob(16))))
--   timestamptz  → TEXT (ISO-8601 datetime strings)
--   now()        → datetime('now')
--   numeric      → REAL
--   boolean      → INTEGER (0 = false, 1 = true)
--   text[]       → TEXT (JSON-encoded array)
--   jsonb        → TEXT (JSON string)
--   RLS / policies / auth.uid() → omitted (SQLite has no RLS;
--                    enforce access control in your app layer)
--   gen_random_uuid() → lower(hex(randomblob(16)))
--   interval '72 hours' → datetime('now','+72 hours')
--   Partial unique index → SQLite supports WHERE on CREATE UNIQUE INDEX
--   Stored functions (plpgsql) → converted to SQLite triggers
-- ============================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------
-- 1. profiles
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id            TEXT PRIMARY KEY,                       -- was: uuid REFERENCES auth.users(id)
  role          TEXT NOT NULL DEFAULT 'buyer'
                CHECK (role IN ('buyer','seller','admin')),
  display_name  TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  bio           TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 2. boutiques
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS boutiques (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  seller_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  tagline       TEXT,
  bio           TEXT,
  banner_url    TEXT,
  logo_url      TEXT,
  location      TEXT,
  policies      TEXT,
  rating_avg    REAL NOT NULL DEFAULT 0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 3. listings
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  boutique_id     TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  price           REAL NOT NULL DEFAULT 0,
  era             TEXT,
  category        TEXT,
  condition_grade TEXT CHECK (condition_grade IN ('Mint','Excellent','Good','Fair','Distressed')),
  material        TEXT,
  images          TEXT NOT NULL DEFAULT '[]',           -- JSON array of URLs
  listing_type    TEXT NOT NULL DEFAULT 'fixed'
                  CHECK (listing_type IN ('fixed','auction')),
  auction_end_at  TEXT,
  reserve_price   REAL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','sold','draft')),
  sku             TEXT UNIQUE,
  coa_verified    INTEGER NOT NULL DEFAULT 0,           -- boolean 0/1
  views           INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 4. bids
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS bids (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  bidder_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount      REAL NOT NULL,
  is_winning  INTEGER NOT NULL DEFAULT 0,               -- boolean 0/1
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 5. orders
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  buyer_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id        TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  boutique_id       TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  amount            REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'escrow_held'
                   CHECK (status IN ('escrow_held','shipped','delivered','completed','disputed','refunded')),
  shipping_address  TEXT,
  tracking_number   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 6. messages
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  listing_id   TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  sender_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 7. wishlists
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS wishlists (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, listing_id)
);

-- --------------------------------------------------------
-- 8. reviews
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  boutique_id  TEXT NOT NULL REFERENCES boutiques(id) ON DELETE CASCADE,
  reviewer_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating       INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  body         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 9. trade_offers  (peer-to-peer bartering)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_offers (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  initiator_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING','COUNTERED','ACCEPTED','REJECTED','SHIPPED_BY_PARTY_A','SHIPPED_BY_PARTY_B','COMPLETED','DISPUTED')),
  cash_top_up   REAL NOT NULL DEFAULT 0 CHECK (cash_top_up >= 0),
  expires_at    TEXT NOT NULL DEFAULT (datetime('now','+72 hours')),
  accepted_at   TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (initiator_id <> recipient_id)
);

-- --------------------------------------------------------
-- 10. trade_items
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_items (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trade_offer_id  TEXT NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  listing_id      TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  side            TEXT NOT NULL CHECK (side IN ('OFFERED','REQUESTED')),
  title_snapshot  TEXT NOT NULL,
  price_snapshot  REAL NOT NULL DEFAULT 0 CHECK (price_snapshot >= 0),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (trade_offer_id, listing_id)
);

-- --------------------------------------------------------
-- 11. trade_events
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_events (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trade_offer_id  TEXT NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  actor_id        TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL
                  CHECK (event_type IN ('CREATED','COUNTERED','ACCEPTED','REJECTED','EXPIRED','LOCKED','SHIPPED','DELIVERED','DISPUTED','COMPLETED')),
  from_status     TEXT,
  to_status       TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',            -- JSON string
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- --------------------------------------------------------
-- 12. trade_inventory_locks
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_inventory_locks (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trade_offer_id  TEXT NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  listing_id      TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  lock_status     TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (lock_status IN ('ACTIVE','RELEASED')),
  channels        TEXT NOT NULL DEFAULT '{"etsy":"LOCKED","shopify":"LOCKED","depop":"LOCKED","in_store":"LOCKED"}',
  locked_at       TEXT NOT NULL DEFAULT (datetime('now')),
  released_at     TEXT,
  UNIQUE (trade_offer_id, listing_id)
);

-- --------------------------------------------------------
-- 13. trade_shipments
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS trade_shipments (
  id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  trade_offer_id     TEXT NOT NULL REFERENCES trade_offers(id) ON DELETE CASCADE,
  party              TEXT NOT NULL CHECK (party IN ('A','B')),
  sender_id          TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_id       TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tracking_number    TEXT,
  label_url          TEXT,
  shipped_at         TEXT,
  delivered_at       TEXT,
  inspection_ends_at TEXT,
  status             TEXT NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','LABEL_CREATED','SHIPPED','DELIVERED','INSPECTION','CLEARED','DISPUTED')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (trade_offer_id, party)
);

-- --------------------------------------------------------
-- 14. vouchers  (promo code & discount engine)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS vouchers (
  id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code              TEXT UNIQUE NOT NULL COLLATE NOCASE,  -- case-insensitive
  description       TEXT,
  discount_type      TEXT NOT NULL DEFAULT 'PERCENTAGE'
                    CHECK (discount_type IN ('PERCENTAGE','FIXED_AMOUNT')),
  discount_value    REAL NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  scope             TEXT NOT NULL DEFAULT 'PLATFORM'
                    CHECK (scope IN ('PLATFORM','BOUTIQUE','CATEGORY')),
  boutique_id       TEXT REFERENCES boutiques(id) ON DELETE CASCADE,
  category          TEXT,
  auction_eligible  INTEGER NOT NULL DEFAULT 0,           -- boolean 0/1
  min_spend         REAL NOT NULL DEFAULT 0 CHECK (min_spend >= 0),
  max_uses          INTEGER CHECK (max_uses IS NULL OR max_uses >= 0),
  max_uses_per_user INTEGER NOT NULL DEFAULT 1 CHECK (max_uses_per_user >= 1),
  is_single_use     INTEGER NOT NULL DEFAULT 0,          -- boolean 0/1
  trigger_type      TEXT NOT NULL DEFAULT 'MANUAL'
                    CHECK (trigger_type IN ('MANUAL','CART_ABANDONMENT','NEW_USER_WELCOME')),
  expires_at        TEXT,
  status            TEXT NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','PAUSED','EXPIRED','REVOKED')),
  uses              INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  created_by        TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (scope = 'BOUTIQUE' AND boutique_id IS NOT NULL) OR
    (scope = 'CATEGORY' AND category IS NOT NULL) OR
    (scope = 'PLATFORM')
  ),
  CHECK (
    (discount_type = 'PERCENTAGE' AND discount_value <= 100) OR
    (discount_type = 'FIXED_AMOUNT')
  )
);

-- --------------------------------------------------------
-- 15. voucher_redemptions
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  voucher_id              TEXT NOT NULL REFERENCES vouchers(id) ON DELETE CASCADE,
  user_id                 TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  order_id                TEXT REFERENCES orders(id) ON DELETE SET NULL,
  cart_total_at_redemption REAL NOT NULL DEFAULT 0,
  discount_amount          REAL NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  redeemed_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES
-- ============================================================

-- Core marketplace
CREATE INDEX IF NOT EXISTS idx_listings_boutique_id  ON listings(boutique_id);
CREATE INDEX IF NOT EXISTS idx_listings_status      ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_category     ON listings(category);
CREATE INDEX IF NOT EXISTS idx_listings_era          ON listings(era);
CREATE INDEX IF NOT EXISTS idx_listings_listing_type ON listings(listing_type);
CREATE INDEX IF NOT EXISTS idx_bids_listing_id       ON bids(listing_id);
CREATE INDEX IF NOT EXISTS idx_bids_bidder_id        ON bids(bidder_id);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_id       ON orders(buyer_id);
CREATE INDEX IF NOT EXISTS idx_orders_boutique_id    ON orders(boutique_id);
CREATE INDEX IF NOT EXISTS idx_messages_listing_id  ON messages(listing_id);
CREATE INDEX IF NOT EXISTS idx_wishlists_user_id    ON wishlists(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_boutique_id  ON reviews(boutique_id);

-- Trade module
CREATE INDEX IF NOT EXISTS idx_trade_offers_initiator     ON trade_offers(initiator_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_recipient     ON trade_offers(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_offers_status_expiry ON trade_offers(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_trade_items_trade          ON trade_items(trade_offer_id);
CREATE INDEX IF NOT EXISTS idx_trade_items_listing        ON trade_items(listing_id);
CREATE INDEX IF NOT EXISTS idx_trade_events_trade         ON trade_events(trade_offer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_shipments_trade      ON trade_shipments(trade_offer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_trade_lock_per_listing
  ON trade_inventory_locks(listing_id) WHERE lock_status = 'ACTIVE';

-- Voucher module
CREATE INDEX IF NOT EXISTS idx_vouchers_code        ON vouchers(code);
CREATE INDEX IF NOT EXISTS idx_vouchers_status     ON vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_boutique   ON vouchers(boutique_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_scope      ON vouchers(scope);
CREATE INDEX IF NOT EXISTS idx_redemptions_voucher ON voucher_redemptions(voucher_id);
CREATE INDEX IF NOT EXISTS idx_redemptions_user    ON voucher_redemptions(user_id);

-- ============================================================
-- TRIGGERS  (replacing Postgres stored functions)
-- ============================================================

-- Auto-update updated_at on trade_offers
CREATE TRIGGER IF NOT EXISTS trg_trade_offers_updated_at
AFTER UPDATE ON trade_offers
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE trade_offers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Auto-update updated_at on vouchers
CREATE TRIGGER IF NOT EXISTS trg_vouchers_updated_at
AFTER UPDATE ON vouchers
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE vouchers SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ============================================================
-- ATOMIC VOUCHER REDEMPTION (app-level SQL pattern)
-- ============================================================
-- SQLite has no stored functions, so run this in a transaction
-- from your app code. The conditional UPDATE + changes() check
-- is the SQLite equivalent of the Postgres
-- "UPDATE ... WHERE uses < max_uses; IF NOT FOUND" pattern:
--
--   BEGIN;
--   UPDATE vouchers
--     SET uses = uses + 1, updated_at = datetime('now')
--     WHERE upper(code) = upper(:code)
--       AND status = 'ACTIVE'
--       AND (expires_at IS NULL OR expires_at > datetime('now'))
--       AND (max_uses IS NULL OR uses < max_uses);
--   -- If sqlite3_changes() == 0 → code is invalid/expired/exhausted
--   -- Otherwise insert the redemption:
--   INSERT INTO voucher_redemptions (voucher_id, user_id, order_id,
--     cart_total_at_redemption, discount_amount)
--     SELECT id, :user_id, :order_id, :cart_total, :discount
--     FROM vouchers WHERE upper(code) = upper(:code);
--   COMMIT;
--
-- For validation-only (no redemption), just SELECT with the
-- same WHERE conditions and check the result.

-- ============================================================
-- DEMO SEED DATA
-- ============================================================
INSERT OR IGNORE INTO vouchers (code, description, discount_type, discount_value, scope, auction_eligible, min_spend, max_uses, max_uses_per_user, is_single_use, trigger_type, status)
VALUES
  ('WELCOME10',  '10% off your first order',           'PERCENTAGE',   10, 'PLATFORM', 0, 0,   1000, 1, 1, 'NEW_USER_WELCOME',  'ACTIVE'),
  ('VINTAGE15',  '15% off orders over $200',           'PERCENTAGE',   15, 'PLATFORM', 0, 200, 500, 1, 0, 'MANUAL',            'ACTIVE'),
  ('SAVE25',     '$25 off any order',                  'FIXED_AMOUNT', 25, 'PLATFORM', 0, 100, 200, 1, 0, 'MANUAL',            'ACTIVE'),
  ('CARTSAVE',   'Cart abandonment recovery - $10 off','FIXED_AMOUNT', 10, 'PLATFORM', 0, 50,  100, 1, 1, 'CART_ABANDONMENT',  'ACTIVE'),
  ('APPAREL10',  '10% off all apparel',                'PERCENTAGE',   10, 'CATEGORY', 0, 0,   300, 1, 0, 'MANUAL',            'ACTIVE');
