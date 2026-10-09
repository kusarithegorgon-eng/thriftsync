-- ThriftSync schema adapted for MySQL 8.0.16+ / phpMyAdmin.
-- Select the existing `thriftsync` database before running this script.
-- UUID values are CHAR(36); generate them in your application (or with UUID()).
-- MySQL has no Supabase Auth or PostgreSQL RLS. Enforce authorization in your backend.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS cebu_districts (
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  city_municipality VARCHAR(120) NOT NULL,
  center_lat DOUBLE NOT NULL,
  center_lng DOUBLE NOT NULL,
  radius_km DOUBLE NOT NULL DEFAULT 2.0,
  is_metro BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cebu_district_name_city (name, city_municipality),
  KEY idx_cebu_districts_city (city_municipality),
  KEY idx_cebu_districts_metro (is_metro)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cebu_barangays (
  id CHAR(36) NOT NULL,
  name VARCHAR(120) NOT NULL,
  city_municipality VARCHAR(120) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  is_metro_cebu BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cebu_barangay_name_city (name, city_municipality),
  KEY idx_cebu_barangays_city (city_municipality),
  KEY idx_cebu_barangays_metro (is_metro_cebu)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS profiles (
  id CHAR(36) NOT NULL,
  role ENUM('buyer', 'seller', 'admin') NOT NULL DEFAULT 'buyer',
  display_name VARCHAR(255) NOT NULL DEFAULT '',
  avatar_url TEXT NULL,
  bio TEXT NULL,
  default_lat DOUBLE NULL,
  default_lng DOUBLE NULL,
  default_barangay VARCHAR(120) NULL,
  district_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_profiles_district (district_id),
  CONSTRAINT fk_profiles_district FOREIGN KEY (district_id)
    REFERENCES cebu_districts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS boutiques (
  id CHAR(36) NOT NULL,
  seller_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  tagline TEXT NULL,
  bio TEXT NULL,
  banner_url TEXT NULL,
  logo_url TEXT NULL,
  location VARCHAR(255) NULL,
  policies TEXT NULL,
  rating_avg DECIMAL(10,2) NOT NULL DEFAULT 0,
  rating_count INT NOT NULL DEFAULT 0,
  lat DOUBLE NULL,
  lng DOUBLE NULL,
  barangay VARCHAR(120) NULL,
  pickup_available BOOLEAN NOT NULL DEFAULT FALSE,
  courier_delivery BOOLEAN NOT NULL DEFAULT TRUE,
  district_id CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_boutiques_slug (slug),
  KEY idx_boutiques_seller (seller_id),
  KEY idx_boutiques_district (district_id),
  CONSTRAINT fk_boutiques_seller FOREIGN KEY (seller_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_boutiques_district FOREIGN KEY (district_id)
    REFERENCES cebu_districts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS listings (
  id CHAR(36) NOT NULL,
  boutique_id CHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  era VARCHAR(120) NULL,
  category VARCHAR(120) NULL,
  condition_grade ENUM('Mint', 'Excellent', 'Good', 'Fair', 'Distressed') NULL,
  material VARCHAR(255) NULL,
  images JSON NOT NULL DEFAULT (JSON_ARRAY()),
  image_metadata JSON NOT NULL DEFAULT (JSON_ARRAY()),
  listing_type ENUM('fixed', 'auction') NOT NULL DEFAULT 'fixed',
  auction_mode ENUM('ENGLISH', 'DUTCH') NOT NULL DEFAULT 'ENGLISH',
  auction_end_at DATETIME NULL,
  reserve_price DECIMAL(12,2) NULL,
  increment_step DECIMAL(12,2) NULL,
  decrement_rate DECIMAL(12,4) NULL,
  decrement_interval_minutes INT NOT NULL DEFAULT 60,
  current_dutch_price DECIMAL(12,2) NULL,
  dutch_floor_price DECIMAL(12,2) NULL,
  auction_start_price DECIMAL(12,2) NULL,
  status ENUM('active', 'sold', 'draft') NOT NULL DEFAULT 'active',
  moderation_status ENUM('pending_review', 'approved', 'rejected') NOT NULL DEFAULT 'pending_review',
  moderation_note TEXT NULL,
  moderated_by CHAR(36) NULL,
  moderated_at DATETIME NULL,
  sku VARCHAR(120) NULL,
  coa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  views INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_listings_sku (sku),
  KEY idx_listings_boutique_id (boutique_id),
  KEY idx_listings_status (status),
  KEY idx_listings_category (category),
  KEY idx_listings_era (era),
  KEY idx_listings_listing_type (listing_type),
  KEY idx_listings_auction_mode (auction_mode),
  KEY idx_listings_moderation (moderation_status),
  KEY idx_listings_moderated_by (moderated_by),
  CONSTRAINT fk_listings_boutique FOREIGN KEY (boutique_id)
    REFERENCES boutiques (id) ON DELETE CASCADE,
  CONSTRAINT fk_listings_moderated_by FOREIGN KEY (moderated_by)
    REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT chk_listings_increment_step CHECK (increment_step IS NULL OR increment_step > 0),
  CONSTRAINT chk_listings_decrement_rate CHECK (decrement_rate IS NULL OR decrement_rate > 0),
  CONSTRAINT chk_listings_decrement_interval CHECK (decrement_interval_minutes > 0),
  CONSTRAINT chk_listings_dutch_floor CHECK (dutch_floor_price IS NULL OR dutch_floor_price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bids (
  id CHAR(36) NOT NULL,
  listing_id CHAR(36) NOT NULL,
  bidder_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  is_winning BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bids_listing_id (listing_id),
  KEY idx_bids_bidder_id (bidder_id),
  CONSTRAINT fk_bids_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE,
  CONSTRAINT fk_bids_bidder FOREIGN KEY (bidder_id)
    REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id CHAR(36) NOT NULL,
  buyer_id CHAR(36) NOT NULL,
  listing_id CHAR(36) NOT NULL,
  boutique_id CHAR(36) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  status ENUM('escrow_held', 'shipped', 'delivered', 'completed', 'disputed', 'refunded')
    NOT NULL DEFAULT 'escrow_held',
  shipping_address TEXT NULL,
  tracking_number VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_buyer_id (buyer_id),
  KEY idx_orders_boutique_id (boutique_id),
  KEY idx_orders_listing_id (listing_id),
  CONSTRAINT fk_orders_buyer FOREIGN KEY (buyer_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_boutique FOREIGN KEY (boutique_id)
    REFERENCES boutiques (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id CHAR(36) NOT NULL,
  listing_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  receiver_id CHAR(36) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_messages_listing_id (listing_id),
  KEY idx_messages_sender (sender_id),
  KEY idx_messages_receiver (receiver_id),
  CONSTRAINT fk_messages_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_receiver FOREIGN KEY (receiver_id)
    REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wishlists (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  listing_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wishlists_user_listing (user_id, listing_id),
  KEY idx_wishlists_user_id (user_id),
  KEY idx_wishlists_listing_id (listing_id),
  CONSTRAINT fk_wishlists_user FOREIGN KEY (user_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_wishlists_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id CHAR(36) NOT NULL,
  boutique_id CHAR(36) NOT NULL,
  reviewer_id CHAR(36) NOT NULL,
  rating INT NOT NULL,
  body TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_reviews_boutique_id (boutique_id),
  KEY idx_reviews_reviewer_id (reviewer_id),
  CONSTRAINT fk_reviews_boutique FOREIGN KEY (boutique_id)
    REFERENCES boutiques (id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS itineraries (
  id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  stops JSON NOT NULL DEFAULT (JSON_ARRAY()),
  transport_mode ENUM('walking', 'driving', 'jeepney') NOT NULL DEFAULT 'driving',
  total_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_time_minutes INT NOT NULL DEFAULT 0,
  status ENUM('planned', 'active', 'completed') NOT NULL DEFAULT 'planned',
  scheduled_date DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_itineraries_user (user_id),
  CONSTRAINT fk_itineraries_user FOREIGN KEY (user_id)
    REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS locker_locations (
  id CHAR(36) NOT NULL,
  partner_name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  barangay VARCHAR(120) NULL,
  city_municipality VARCHAR(120) NOT NULL,
  lat DOUBLE NOT NULL,
  lng DOUBLE NOT NULL,
  district_id CHAR(36) NULL,
  operating_hours JSON NOT NULL DEFAULT (JSON_OBJECT()),
  capacity_total INT NOT NULL DEFAULT 12,
  capacity_available INT NOT NULL DEFAULT 12,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  contact_phone VARCHAR(80) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_locker_locations_active (is_active),
  KEY idx_locker_locations_district (district_id),
  CONSTRAINT fk_locker_locations_district FOREIGN KEY (district_id)
    REFERENCES cebu_districts (id) ON DELETE SET NULL,
  CONSTRAINT chk_locker_capacity_total CHECK (capacity_total > 0),
  CONSTRAINT chk_locker_capacity_available CHECK (capacity_available >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS locker_handoffs (
  id CHAR(36) NOT NULL,
  locker_location_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  user_id CHAR(36) NOT NULL,
  pin_code VARCHAR(6) NOT NULL,
  status ENUM('PENDING', 'DROPPED_OFF', 'PICKED_UP', 'EXPIRED', 'CANCELLED')
    NOT NULL DEFAULT 'PENDING',
  drop_off_window_start DATETIME NULL,
  drop_off_window_end DATETIME NULL,
  dropped_off_at DATETIME NULL,
  picked_up_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_locker_handoffs_user (user_id),
  KEY idx_locker_handoffs_locker (locker_location_id),
  KEY idx_locker_handoffs_status (status),
  CONSTRAINT fk_locker_handoffs_location FOREIGN KEY (locker_location_id)
    REFERENCES locker_locations (id) ON DELETE CASCADE,
  CONSTRAINT fk_locker_handoffs_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_locker_handoffs_user FOREIGN KEY (user_id)
    REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vouchers (
  id CHAR(36) NOT NULL,
  code VARCHAR(120) NOT NULL,
  description TEXT NULL,
  discount_type ENUM('PERCENTAGE', 'FIXED_AMOUNT') NOT NULL DEFAULT 'PERCENTAGE',
  discount_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  scope ENUM('PLATFORM', 'BOUTIQUE', 'CATEGORY') NOT NULL DEFAULT 'PLATFORM',
  boutique_id CHAR(36) NULL,
  category VARCHAR(120) NULL,
  auction_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  min_spend DECIMAL(12,2) NOT NULL DEFAULT 0,
  max_uses INT NULL,
  max_uses_per_user INT NOT NULL DEFAULT 1,
  is_single_use BOOLEAN NOT NULL DEFAULT FALSE,
  trigger_type ENUM('MANUAL', 'CART_ABANDONMENT', 'NEW_USER_WELCOME') NOT NULL DEFAULT 'MANUAL',
  expires_at DATETIME NULL,
  status ENUM('ACTIVE', 'PAUSED', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
  uses INT NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vouchers_code (code),
  KEY idx_vouchers_status (status),
  KEY idx_vouchers_boutique (boutique_id),
  KEY idx_vouchers_scope (scope),
  CONSTRAINT fk_vouchers_boutique FOREIGN KEY (boutique_id)
    REFERENCES boutiques (id) ON DELETE CASCADE,
  CONSTRAINT fk_vouchers_creator FOREIGN KEY (created_by)
    REFERENCES profiles (id) ON DELETE SET NULL,
  CONSTRAINT chk_vouchers_discount_value CHECK (discount_value >= 0),
  CONSTRAINT chk_vouchers_min_spend CHECK (min_spend >= 0),
  CONSTRAINT chk_vouchers_max_uses CHECK (max_uses IS NULL OR max_uses >= 0),
  CONSTRAINT chk_vouchers_uses CHECK (uses >= 0),
  CONSTRAINT chk_vouchers_per_user CHECK (max_uses_per_user >= 1),
  CONSTRAINT chk_vouchers_scope_fields CHECK (
    (scope = 'BOUTIQUE' AND boutique_id IS NOT NULL) OR
    (scope = 'CATEGORY' AND category IS NOT NULL) OR
    scope = 'PLATFORM'
  ),
  CONSTRAINT chk_vouchers_percent CHECK (
    discount_type <> 'PERCENTAGE' OR discount_value <= 100
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id CHAR(36) NOT NULL,
  voucher_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  cart_total_at_redemption DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  redeemed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_redemptions_voucher (voucher_id),
  KEY idx_redemptions_user (user_id),
  CONSTRAINT fk_redemptions_voucher FOREIGN KEY (voucher_id)
    REFERENCES vouchers (id) ON DELETE CASCADE,
  CONSTRAINT fk_redemptions_user FOREIGN KEY (user_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_redemptions_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT chk_redemptions_discount CHECK (discount_amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_offers (
  id CHAR(36) NOT NULL,
  initiator_id CHAR(36) NOT NULL,
  recipient_id CHAR(36) NOT NULL,
  status ENUM('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'SHIPPED_BY_PARTY_A',
    'SHIPPED_BY_PARTY_B', 'COMPLETED', 'DISPUTED') NOT NULL DEFAULT 'PENDING',
  cash_top_up DECIMAL(12,2) NOT NULL DEFAULT 0,
  expires_at DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 72 HOUR),
  accepted_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trade_offers_initiator (initiator_id, created_at),
  KEY idx_trade_offers_recipient (recipient_id, created_at),
  KEY idx_trade_offers_status_expiry (status, expires_at),
  CONSTRAINT fk_trade_offers_initiator FOREIGN KEY (initiator_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_offers_recipient FOREIGN KEY (recipient_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT chk_trade_offer_different_parties CHECK (initiator_id <> recipient_id),
  CONSTRAINT chk_trade_offer_cash CHECK (cash_top_up >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_items (
  id CHAR(36) NOT NULL,
  trade_offer_id CHAR(36) NOT NULL,
  listing_id CHAR(36) NOT NULL,
  side ENUM('OFFERED', 'REQUESTED') NOT NULL,
  title_snapshot VARCHAR(255) NOT NULL,
  price_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trade_items_offer_listing (trade_offer_id, listing_id),
  KEY idx_trade_items_listing (listing_id),
  CONSTRAINT fk_trade_items_offer FOREIGN KEY (trade_offer_id)
    REFERENCES trade_offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_items_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT,
  CONSTRAINT chk_trade_item_price CHECK (price_snapshot >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_events (
  id CHAR(36) NOT NULL,
  trade_offer_id CHAR(36) NOT NULL,
  actor_id CHAR(36) NULL,
  event_type ENUM('CREATED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'LOCKED',
    'SHIPPED', 'DELIVERED', 'DISPUTED', 'COMPLETED') NOT NULL,
  from_status VARCHAR(80) NULL,
  to_status VARCHAR(80) NULL,
  metadata JSON NOT NULL DEFAULT (JSON_OBJECT()),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trade_events_trade (trade_offer_id, created_at),
  CONSTRAINT fk_trade_events_offer FOREIGN KEY (trade_offer_id)
    REFERENCES trade_offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_events_actor FOREIGN KEY (actor_id)
    REFERENCES profiles (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_inventory_locks (
  id CHAR(36) NOT NULL,
  trade_offer_id CHAR(36) NOT NULL,
  listing_id CHAR(36) NOT NULL,
  lock_status ENUM('ACTIVE', 'RELEASED') NOT NULL DEFAULT 'ACTIVE',
  channels JSON NOT NULL DEFAULT (
    JSON_OBJECT('etsy', 'LOCKED', 'shopify', 'LOCKED', 'depop', 'LOCKED', 'in_store', 'LOCKED')
  ),
  active_listing_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN lock_status = 'ACTIVE' THEN listing_id ELSE NULL END
  ) STORED,
  locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trade_lock_offer_listing (trade_offer_id, listing_id),
  UNIQUE KEY uq_active_trade_lock_per_listing (active_listing_id),
  CONSTRAINT fk_trade_locks_offer FOREIGN KEY (trade_offer_id)
    REFERENCES trade_offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_locks_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trade_shipments (
  id CHAR(36) NOT NULL,
  trade_offer_id CHAR(36) NOT NULL,
  party ENUM('A', 'B') NOT NULL,
  sender_id CHAR(36) NOT NULL,
  recipient_id CHAR(36) NOT NULL,
  tracking_number VARCHAR(255) NULL,
  label_url TEXT NULL,
  shipped_at DATETIME NULL,
  delivered_at DATETIME NULL,
  inspection_ends_at DATETIME NULL,
  status ENUM('PENDING', 'LABEL_CREATED', 'SHIPPED', 'DELIVERED', 'INSPECTION', 'CLEARED', 'DISPUTED')
    NOT NULL DEFAULT 'PENDING',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trade_shipments_offer_party (trade_offer_id, party),
  KEY idx_trade_shipments_trade (trade_offer_id),
  CONSTRAINT fk_trade_shipments_offer FOREIGN KEY (trade_offer_id)
    REFERENCES trade_offers (id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_shipments_sender FOREIGN KEY (sender_id)
    REFERENCES profiles (id) ON DELETE CASCADE,
  CONSTRAINT fk_trade_shipments_recipient FOREIGN KEY (recipient_id)
    REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed Cebu reference districts. UUIDs are generated by MySQL.
INSERT INTO cebu_districts (id, name, city_municipality, center_lat, center_lng, radius_km, is_metro)
VALUES
  (UUID(), 'IT Park', 'Cebu City', 10.3300, 123.9050, 1.5, TRUE),
  (UUID(), 'Lahug', 'Cebu City', 10.3389, 123.9033, 2.0, TRUE),
  (UUID(), 'Guadalupe', 'Cebu City', 10.3156, 123.8833, 2.5, TRUE),
  (UUID(), 'Mabolo', 'Cebu City', 10.3183, 123.9050, 2.0, TRUE),
  (UUID(), 'Banilad', 'Cebu City', 10.3392, 123.9133, 2.5, TRUE),
  (UUID(), 'Capitol Site', 'Cebu City', 10.3167, 123.8856, 1.5, TRUE),
  (UUID(), 'Kamputhaw', 'Cebu City', 10.3258, 123.8983, 1.5, TRUE),
  (UUID(), 'Pardo', 'Cebu City', 10.2983, 123.8683, 3.0, TRUE),
  (UUID(), 'Downtown Colon', 'Cebu City', 10.2933, 123.9000, 2.0, TRUE),
  (UUID(), 'Mandaue City Proper', 'Mandaue City', 10.3300, 123.9300, 3.0, TRUE),
  (UUID(), 'Banilad Mandaue', 'Mandaue City', 10.3400, 123.9200, 2.5, TRUE),
  (UUID(), 'Maguikay', 'Mandaue City', 10.3250, 123.9350, 2.0, TRUE),
  (UUID(), 'Lapu-Lapu City Proper', 'Lapu-Lapu City', 10.3050, 124.0050, 3.0, TRUE),
  (UUID(), 'Mactan', 'Lapu-Lapu City', 10.2900, 124.0150, 4.0, TRUE),
  (UUID(), 'Maribago', 'Lapu-Lapu City', 10.2850, 124.0000, 3.0, TRUE),
  (UUID(), 'Talisay City Proper', 'Talisay City', 10.2500, 123.8500, 3.0, TRUE),
  (UUID(), 'Minglanilla', 'Minglanilla', 10.2400, 123.7900, 4.0, TRUE),
  (UUID(), 'Naga City', 'Naga City', 10.2100, 123.7600, 4.0, TRUE),
  (UUID(), 'Danao City', 'Danao City', 10.5600, 124.0000, 5.0, FALSE),
  (UUID(), 'Carcar City', 'Carcar City', 10.1200, 123.6400, 5.0, FALSE),
  (UUID(), 'Toledo City', 'Toledo City', 10.3900, 123.6400, 5.0, FALSE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO cebu_barangays (id, name, city_municipality, lat, lng, is_metro_cebu)
VALUES
  (UUID(), 'Lahug', 'Cebu City', 10.3389, 123.9033, TRUE),
  (UUID(), 'Guadalupe', 'Cebu City', 10.3156, 123.8833, TRUE),
  (UUID(), 'Banilad', 'Cebu City', 10.3392, 123.9133, TRUE),
  (UUID(), 'Capitol Site', 'Cebu City', 10.3167, 123.8856, TRUE),
  (UUID(), 'Kamputhaw', 'Cebu City', 10.3258, 123.8983, TRUE),
  (UUID(), 'Mabolo', 'Cebu City', 10.3183, 123.9050, TRUE),
  (UUID(), 'Pardo', 'Cebu City', 10.2983, 123.8683, TRUE),
  (UUID(), 'Talisay', 'Cebu City', 10.2633, 123.8417, TRUE),
  (UUID(), 'Mandaue City Proper', 'Mandaue City', 10.3300, 123.9300, TRUE),
  (UUID(), 'Banilad', 'Mandaue City', 10.3400, 123.9200, TRUE),
  (UUID(), 'Maguikay', 'Mandaue City', 10.3250, 123.9350, TRUE),
  (UUID(), 'Lapu-Lapu City Proper', 'Lapu-Lapu City', 10.3050, 124.0050, TRUE),
  (UUID(), 'Mactan', 'Lapu-Lapu City', 10.2900, 124.0150, TRUE),
  (UUID(), 'Maribago', 'Lapu-Lapu City', 10.2850, 124.0000, TRUE),
  (UUID(), 'Talisay City Proper', 'Talisay City', 10.2500, 123.8500, TRUE),
  (UUID(), 'Minglanilla Proper', 'Minglanilla', 10.2400, 123.7900, TRUE),
  (UUID(), 'Naga City Proper', 'Naga City', 10.2100, 123.7600, TRUE),
  (UUID(), 'Danao City Proper', 'Danao City', 10.5600, 124.0000, FALSE),
  (UUID(), 'Carcar City Proper', 'Carcar City', 10.1200, 123.6400, FALSE),
  (UUID(), 'Toledo City Proper', 'Toledo City', 10.3900, 123.6400, FALSE)
ON DUPLICATE KEY UPDATE name = VALUES(name);
