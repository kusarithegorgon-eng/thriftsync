-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Oct 09, 2026 at 03:50 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `thrifysync`
--

-- --------------------------------------------------------

--
-- Table structure for table `bids`
--

CREATE TABLE `bids` (
  `id` char(36) NOT NULL,
  `listing_id` char(36) NOT NULL,
  `bidder_id` char(36) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `is_winning` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `boutiques`
--

CREATE TABLE `boutiques` (
  `id` char(36) NOT NULL,
  `seller_id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `tagline` text DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `banner_url` text DEFAULT NULL,
  `logo_url` text DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `policies` text DEFAULT NULL,
  `rating_avg` decimal(10,2) NOT NULL DEFAULT 0.00,
  `rating_count` int(11) NOT NULL DEFAULT 0,
  `lat` double DEFAULT NULL,
  `lng` double DEFAULT NULL,
  `barangay` varchar(120) DEFAULT NULL,
  `pickup_available` tinyint(1) NOT NULL DEFAULT 0,
  `courier_delivery` tinyint(1) NOT NULL DEFAULT 1,
  `district_id` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `cebu_barangays`
--

CREATE TABLE `cebu_barangays` (
  `id` char(36) NOT NULL,
  `name` varchar(120) NOT NULL,
  `city_municipality` varchar(120) NOT NULL,
  `lat` double NOT NULL,
  `lng` double NOT NULL,
  `is_metro_cebu` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `cebu_barangays`
--

INSERT INTO `cebu_barangays` (`id`, `name`, `city_municipality`, `lat`, `lng`, `is_metro_cebu`) VALUES
('ca74d597-c3e7-11f1-8819-00e04c7df4d5', 'Lahug', 'Cebu City', 10.3389, 123.9033, 1),
('ca74d92b-c3e7-11f1-8819-00e04c7df4d5', 'Guadalupe', 'Cebu City', 10.3156, 123.8833, 1),
('ca74d9f1-c3e7-11f1-8819-00e04c7df4d5', 'Banilad', 'Cebu City', 10.3392, 123.9133, 1),
('ca74dab6-c3e7-11f1-8819-00e04c7df4d5', 'Capitol Site', 'Cebu City', 10.3167, 123.8856, 1),
('ca74db3b-c3e7-11f1-8819-00e04c7df4d5', 'Kamputhaw', 'Cebu City', 10.3258, 123.8983, 1),
('ca74dbc3-c3e7-11f1-8819-00e04c7df4d5', 'Mabolo', 'Cebu City', 10.3183, 123.905, 1),
('ca74dc35-c3e7-11f1-8819-00e04c7df4d5', 'Pardo', 'Cebu City', 10.2983, 123.8683, 1),
('ca74dca6-c3e7-11f1-8819-00e04c7df4d5', 'Talisay', 'Cebu City', 10.2633, 123.8417, 1),
('ca74dd21-c3e7-11f1-8819-00e04c7df4d5', 'Mandaue City Proper', 'Mandaue City', 10.33, 123.93, 1),
('ca74dd93-c3e7-11f1-8819-00e04c7df4d5', 'Banilad', 'Mandaue City', 10.34, 123.92, 1),
('ca74de05-c3e7-11f1-8819-00e04c7df4d5', 'Maguikay', 'Mandaue City', 10.325, 123.935, 1),
('ca74de77-c3e7-11f1-8819-00e04c7df4d5', 'Lapu-Lapu City Proper', 'Lapu-Lapu City', 10.305, 124.005, 1),
('ca74deef-c3e7-11f1-8819-00e04c7df4d5', 'Mactan', 'Lapu-Lapu City', 10.29, 124.015, 1),
('ca74df66-c3e7-11f1-8819-00e04c7df4d5', 'Maribago', 'Lapu-Lapu City', 10.285, 124, 1),
('ca74dfdf-c3e7-11f1-8819-00e04c7df4d5', 'Talisay City Proper', 'Talisay City', 10.25, 123.85, 1),
('ca74e057-c3e7-11f1-8819-00e04c7df4d5', 'Minglanilla Proper', 'Minglanilla', 10.24, 123.79, 1),
('ca74e0d1-c3e7-11f1-8819-00e04c7df4d5', 'Naga City Proper', 'Naga City', 10.21, 123.76, 1),
('ca74e14a-c3e7-11f1-8819-00e04c7df4d5', 'Danao City Proper', 'Danao City', 10.56, 124, 0),
('ca74e1bb-c3e7-11f1-8819-00e04c7df4d5', 'Carcar City Proper', 'Carcar City', 10.12, 123.64, 0),
('ca74e231-c3e7-11f1-8819-00e04c7df4d5', 'Toledo City Proper', 'Toledo City', 10.39, 123.64, 0);

-- --------------------------------------------------------

--
-- Table structure for table `cebu_districts`
--

CREATE TABLE `cebu_districts` (
  `id` char(36) NOT NULL,
  `name` varchar(120) NOT NULL,
  `city_municipality` varchar(120) NOT NULL,
  `center_lat` double NOT NULL,
  `center_lng` double NOT NULL,
  `radius_km` double NOT NULL DEFAULT 2,
  `is_metro` tinyint(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `cebu_districts`
--

INSERT INTO `cebu_districts` (`id`, `name`, `city_municipality`, `center_lat`, `center_lng`, `radius_km`, `is_metro`) VALUES
('ca71bb33-c3e7-11f1-8819-00e04c7df4d5', 'IT Park', 'Cebu City', 10.33, 123.905, 1.5, 1),
('ca71beb4-c3e7-11f1-8819-00e04c7df4d5', 'Lahug', 'Cebu City', 10.3389, 123.9033, 2, 1),
('ca71d370-c3e7-11f1-8819-00e04c7df4d5', 'Guadalupe', 'Cebu City', 10.3156, 123.8833, 2.5, 1),
('ca71d43c-c3e7-11f1-8819-00e04c7df4d5', 'Mabolo', 'Cebu City', 10.3183, 123.905, 2, 1),
('ca71d4cc-c3e7-11f1-8819-00e04c7df4d5', 'Banilad', 'Cebu City', 10.3392, 123.9133, 2.5, 1),
('ca71d55b-c3e7-11f1-8819-00e04c7df4d5', 'Capitol Site', 'Cebu City', 10.3167, 123.8856, 1.5, 1),
('ca71d5d5-c3e7-11f1-8819-00e04c7df4d5', 'Kamputhaw', 'Cebu City', 10.3258, 123.8983, 1.5, 1),
('ca71d691-c3e7-11f1-8819-00e04c7df4d5', 'Pardo', 'Cebu City', 10.2983, 123.8683, 3, 1),
('ca71d70b-c3e7-11f1-8819-00e04c7df4d5', 'Downtown Colon', 'Cebu City', 10.2933, 123.9, 2, 1),
('ca71d780-c3e7-11f1-8819-00e04c7df4d5', 'Mandaue City Proper', 'Mandaue City', 10.33, 123.93, 3, 1),
('ca71d7fa-c3e7-11f1-8819-00e04c7df4d5', 'Banilad Mandaue', 'Mandaue City', 10.34, 123.92, 2.5, 1),
('ca71d870-c3e7-11f1-8819-00e04c7df4d5', 'Maguikay', 'Mandaue City', 10.325, 123.935, 2, 1),
('ca71d8e5-c3e7-11f1-8819-00e04c7df4d5', 'Lapu-Lapu City Proper', 'Lapu-Lapu City', 10.305, 124.005, 3, 1),
('ca71d95e-c3e7-11f1-8819-00e04c7df4d5', 'Mactan', 'Lapu-Lapu City', 10.29, 124.015, 4, 1),
('ca71d9d7-c3e7-11f1-8819-00e04c7df4d5', 'Maribago', 'Lapu-Lapu City', 10.285, 124, 3, 1),
('ca71da53-c3e7-11f1-8819-00e04c7df4d5', 'Talisay City Proper', 'Talisay City', 10.25, 123.85, 3, 1),
('ca71dad0-c3e7-11f1-8819-00e04c7df4d5', 'Minglanilla', 'Minglanilla', 10.24, 123.79, 4, 1),
('ca71db51-c3e7-11f1-8819-00e04c7df4d5', 'Naga City', 'Naga City', 10.21, 123.76, 4, 1),
('ca71dbcd-c3e7-11f1-8819-00e04c7df4d5', 'Danao City', 'Danao City', 10.56, 124, 5, 0),
('ca71dc42-c3e7-11f1-8819-00e04c7df4d5', 'Carcar City', 'Carcar City', 10.12, 123.64, 5, 0),
('ca71dcbe-c3e7-11f1-8819-00e04c7df4d5', 'Toledo City', 'Toledo City', 10.39, 123.64, 5, 0);

-- --------------------------------------------------------

--
-- Table structure for table `itineraries`
--

CREATE TABLE `itineraries` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `stops` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_array() CHECK (json_valid(`stops`)),
  `transport_mode` enum('walking','driving','jeepney') NOT NULL DEFAULT 'driving',
  `total_distance_km` decimal(10,2) NOT NULL DEFAULT 0.00,
  `total_time_minutes` int(11) NOT NULL DEFAULT 0,
  `status` enum('planned','active','completed') NOT NULL DEFAULT 'planned',
  `scheduled_date` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `listings`
--

CREATE TABLE `listings` (
  `id` char(36) NOT NULL,
  `boutique_id` char(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(12,2) NOT NULL DEFAULT 0.00,
  `era` varchar(120) DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `condition_grade` enum('Mint','Excellent','Good','Fair','Distressed') DEFAULT NULL,
  `material` varchar(255) DEFAULT NULL,
  `images` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_array() CHECK (json_valid(`images`)),
  `image_metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_array() CHECK (json_valid(`image_metadata`)),
  `listing_type` enum('fixed','auction') NOT NULL DEFAULT 'fixed',
  `auction_mode` enum('ENGLISH','DUTCH') NOT NULL DEFAULT 'ENGLISH',
  `auction_end_at` datetime DEFAULT NULL,
  `reserve_price` decimal(12,2) DEFAULT NULL,
  `increment_step` decimal(12,2) DEFAULT NULL,
  `decrement_rate` decimal(12,4) DEFAULT NULL,
  `decrement_interval_minutes` int(11) NOT NULL DEFAULT 60,
  `current_dutch_price` decimal(12,2) DEFAULT NULL,
  `dutch_floor_price` decimal(12,2) DEFAULT NULL,
  `auction_start_price` decimal(12,2) DEFAULT NULL,
  `status` enum('active','sold','draft') NOT NULL DEFAULT 'active',
  `moderation_status` enum('pending_review','approved','rejected') NOT NULL DEFAULT 'pending_review',
  `moderation_note` text DEFAULT NULL,
  `moderated_by` char(36) DEFAULT NULL,
  `moderated_at` datetime DEFAULT NULL,
  `sku` varchar(120) DEFAULT NULL,
  `coa_verified` tinyint(1) NOT NULL DEFAULT 0,
  `views` int(11) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `locker_handoffs`
--

CREATE TABLE `locker_handoffs` (
  `id` char(36) NOT NULL,
  `locker_location_id` char(36) NOT NULL,
  `order_id` char(36) DEFAULT NULL,
  `user_id` char(36) NOT NULL,
  `pin_code` varchar(6) NOT NULL,
  `status` enum('PENDING','DROPPED_OFF','PICKED_UP','EXPIRED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `drop_off_window_start` datetime DEFAULT NULL,
  `drop_off_window_end` datetime DEFAULT NULL,
  `dropped_off_at` datetime DEFAULT NULL,
  `picked_up_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `locker_locations`
--

CREATE TABLE `locker_locations` (
  `id` char(36) NOT NULL,
  `partner_name` varchar(255) NOT NULL,
  `address` text NOT NULL,
  `barangay` varchar(120) DEFAULT NULL,
  `city_municipality` varchar(120) NOT NULL,
  `lat` double NOT NULL,
  `lng` double NOT NULL,
  `district_id` char(36) DEFAULT NULL,
  `operating_hours` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_object() CHECK (json_valid(`operating_hours`)),
  `capacity_total` int(11) NOT NULL DEFAULT 12,
  `capacity_available` int(11) NOT NULL DEFAULT 12,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `contact_phone` varchar(80) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `messages`
--

CREATE TABLE `messages` (
  `id` char(36) NOT NULL,
  `listing_id` char(36) NOT NULL,
  `sender_id` char(36) NOT NULL,
  `receiver_id` char(36) NOT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` char(36) NOT NULL,
  `buyer_id` char(36) NOT NULL,
  `listing_id` char(36) NOT NULL,
  `boutique_id` char(36) NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `status` enum('escrow_held','shipped','delivered','completed','disputed','refunded') NOT NULL DEFAULT 'escrow_held',
  `shipping_address` text DEFAULT NULL,
  `tracking_number` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `profiles`
--

CREATE TABLE `profiles` (
  `id` char(36) NOT NULL,
  `role` enum('buyer','seller','admin') NOT NULL DEFAULT 'buyer',
  `display_name` varchar(255) NOT NULL DEFAULT '',
  `avatar_url` text DEFAULT NULL,
  `bio` text DEFAULT NULL,
  `default_lat` double DEFAULT NULL,
  `default_lng` double DEFAULT NULL,
  `default_barangay` varchar(120) DEFAULT NULL,
  `district_id` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `reviews`
--

CREATE TABLE `reviews` (
  `id` char(36) NOT NULL,
  `boutique_id` char(36) NOT NULL,
  `reviewer_id` char(36) NOT NULL,
  `rating` int(11) NOT NULL,
  `body` text DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `trade_events`
--

CREATE TABLE `trade_events` (
  `id` char(36) NOT NULL,
  `trade_offer_id` char(36) NOT NULL,
  `actor_id` char(36) DEFAULT NULL,
  `event_type` enum('CREATED','COUNTERED','ACCEPTED','REJECTED','EXPIRED','LOCKED','SHIPPED','DELIVERED','DISPUTED','COMPLETED') NOT NULL,
  `from_status` varchar(80) DEFAULT NULL,
  `to_status` varchar(80) DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_object() CHECK (json_valid(`metadata`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trade_inventory_locks`
--

CREATE TABLE `trade_inventory_locks` (
  `id` char(36) NOT NULL,
  `trade_offer_id` char(36) NOT NULL,
  `listing_id` char(36) NOT NULL,
  `lock_status` enum('ACTIVE','RELEASED') NOT NULL DEFAULT 'ACTIVE',
  `channels` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT json_object('etsy','LOCKED','shopify','LOCKED','depop','LOCKED','in_store','LOCKED') CHECK (json_valid(`channels`)),
  `active_listing_id` char(36) GENERATED ALWAYS AS (case when `lock_status` = 'ACTIVE' then `listing_id` else NULL end) STORED,
  `locked_at` datetime NOT NULL DEFAULT current_timestamp(),
  `released_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trade_items`
--

CREATE TABLE `trade_items` (
  `id` char(36) NOT NULL,
  `trade_offer_id` char(36) NOT NULL,
  `listing_id` char(36) NOT NULL,
  `side` enum('OFFERED','REQUESTED') NOT NULL,
  `title_snapshot` varchar(255) NOT NULL,
  `price_snapshot` decimal(12,2) NOT NULL DEFAULT 0.00,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `trade_offers`
--

CREATE TABLE `trade_offers` (
  `id` char(36) NOT NULL,
  `initiator_id` char(36) NOT NULL,
  `recipient_id` char(36) NOT NULL,
  `status` enum('PENDING','COUNTERED','ACCEPTED','REJECTED','SHIPPED_BY_PARTY_A','SHIPPED_BY_PARTY_B','COMPLETED','DISPUTED') NOT NULL DEFAULT 'PENDING',
  `cash_top_up` decimal(12,2) NOT NULL DEFAULT 0.00,
  `expires_at` datetime NOT NULL DEFAULT (current_timestamp() + interval 72 hour),
  `accepted_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `trade_shipments`
--

CREATE TABLE `trade_shipments` (
  `id` char(36) NOT NULL,
  `trade_offer_id` char(36) NOT NULL,
  `party` enum('A','B') NOT NULL,
  `sender_id` char(36) NOT NULL,
  `recipient_id` char(36) NOT NULL,
  `tracking_number` varchar(255) DEFAULT NULL,
  `label_url` text DEFAULT NULL,
  `shipped_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `inspection_ends_at` datetime DEFAULT NULL,
  `status` enum('PENDING','LABEL_CREATED','SHIPPED','DELIVERED','INSPECTION','CLEARED','DISPUTED') NOT NULL DEFAULT 'PENDING',
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vouchers`
--

CREATE TABLE `vouchers` (
  `id` char(36) NOT NULL,
  `code` varchar(120) NOT NULL,
  `description` text DEFAULT NULL,
  `discount_type` enum('PERCENTAGE','FIXED_AMOUNT') NOT NULL DEFAULT 'PERCENTAGE',
  `discount_value` decimal(12,2) NOT NULL DEFAULT 0.00,
  `scope` enum('PLATFORM','BOUTIQUE','CATEGORY') NOT NULL DEFAULT 'PLATFORM',
  `boutique_id` char(36) DEFAULT NULL,
  `category` varchar(120) DEFAULT NULL,
  `auction_eligible` tinyint(1) NOT NULL DEFAULT 0,
  `min_spend` decimal(12,2) NOT NULL DEFAULT 0.00,
  `max_uses` int(11) DEFAULT NULL,
  `max_uses_per_user` int(11) NOT NULL DEFAULT 1,
  `is_single_use` tinyint(1) NOT NULL DEFAULT 0,
  `trigger_type` enum('MANUAL','CART_ABANDONMENT','NEW_USER_WELCOME') NOT NULL DEFAULT 'MANUAL',
  `expires_at` datetime DEFAULT NULL,
  `status` enum('ACTIVE','PAUSED','EXPIRED','REVOKED') NOT NULL DEFAULT 'ACTIVE',
  `uses` int(11) NOT NULL DEFAULT 0,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `voucher_redemptions`
--

CREATE TABLE `voucher_redemptions` (
  `id` char(36) NOT NULL,
  `voucher_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `order_id` char(36) DEFAULT NULL,
  `cart_total_at_redemption` decimal(12,2) NOT NULL DEFAULT 0.00,
  `discount_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `redeemed_at` datetime NOT NULL DEFAULT current_timestamp()
) ;

-- --------------------------------------------------------

--
-- Table structure for table `wishlists`
--

CREATE TABLE `wishlists` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `listing_id` char(36) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `bids`
--
ALTER TABLE `bids`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_bids_listing_id` (`listing_id`),
  ADD KEY `idx_bids_bidder_id` (`bidder_id`);

--
-- Indexes for table `boutiques`
--
ALTER TABLE `boutiques`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_boutiques_slug` (`slug`),
  ADD KEY `idx_boutiques_seller` (`seller_id`),
  ADD KEY `idx_boutiques_district` (`district_id`);

--
-- Indexes for table `cebu_barangays`
--
ALTER TABLE `cebu_barangays`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_cebu_barangay_name_city` (`name`,`city_municipality`),
  ADD KEY `idx_cebu_barangays_city` (`city_municipality`),
  ADD KEY `idx_cebu_barangays_metro` (`is_metro_cebu`);

--
-- Indexes for table `cebu_districts`
--
ALTER TABLE `cebu_districts`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_cebu_district_name_city` (`name`,`city_municipality`),
  ADD KEY `idx_cebu_districts_city` (`city_municipality`),
  ADD KEY `idx_cebu_districts_metro` (`is_metro`);

--
-- Indexes for table `itineraries`
--
ALTER TABLE `itineraries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_itineraries_user` (`user_id`);

--
-- Indexes for table `listings`
--
ALTER TABLE `listings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_listings_sku` (`sku`),
  ADD KEY `idx_listings_boutique_id` (`boutique_id`),
  ADD KEY `idx_listings_status` (`status`),
  ADD KEY `idx_listings_category` (`category`),
  ADD KEY `idx_listings_era` (`era`),
  ADD KEY `idx_listings_listing_type` (`listing_type`),
  ADD KEY `idx_listings_auction_mode` (`auction_mode`),
  ADD KEY `idx_listings_moderation` (`moderation_status`),
  ADD KEY `idx_listings_moderated_by` (`moderated_by`);

--
-- Indexes for table `locker_handoffs`
--
ALTER TABLE `locker_handoffs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_locker_handoffs_user` (`user_id`),
  ADD KEY `idx_locker_handoffs_locker` (`locker_location_id`),
  ADD KEY `idx_locker_handoffs_status` (`status`),
  ADD KEY `fk_locker_handoffs_order` (`order_id`);

--
-- Indexes for table `locker_locations`
--
ALTER TABLE `locker_locations`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_locker_locations_active` (`is_active`),
  ADD KEY `idx_locker_locations_district` (`district_id`);

--
-- Indexes for table `messages`
--
ALTER TABLE `messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_messages_listing_id` (`listing_id`),
  ADD KEY `idx_messages_sender` (`sender_id`),
  ADD KEY `idx_messages_receiver` (`receiver_id`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_orders_buyer_id` (`buyer_id`),
  ADD KEY `idx_orders_boutique_id` (`boutique_id`),
  ADD KEY `idx_orders_listing_id` (`listing_id`);

--
-- Indexes for table `profiles`
--
ALTER TABLE `profiles`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_profiles_district` (`district_id`);

--
-- Indexes for table `reviews`
--
ALTER TABLE `reviews`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_reviews_boutique_id` (`boutique_id`),
  ADD KEY `idx_reviews_reviewer_id` (`reviewer_id`);

--
-- Indexes for table `trade_events`
--
ALTER TABLE `trade_events`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_trade_events_trade` (`trade_offer_id`,`created_at`),
  ADD KEY `fk_trade_events_actor` (`actor_id`);

--
-- Indexes for table `trade_inventory_locks`
--
ALTER TABLE `trade_inventory_locks`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_trade_lock_offer_listing` (`trade_offer_id`,`listing_id`),
  ADD UNIQUE KEY `uq_active_trade_lock_per_listing` (`active_listing_id`),
  ADD KEY `fk_trade_locks_listing` (`listing_id`);

--
-- Indexes for table `trade_items`
--
ALTER TABLE `trade_items`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_trade_items_offer_listing` (`trade_offer_id`,`listing_id`),
  ADD KEY `idx_trade_items_listing` (`listing_id`);

--
-- Indexes for table `trade_offers`
--
ALTER TABLE `trade_offers`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_trade_offers_initiator` (`initiator_id`,`created_at`),
  ADD KEY `idx_trade_offers_recipient` (`recipient_id`,`created_at`),
  ADD KEY `idx_trade_offers_status_expiry` (`status`,`expires_at`);

--
-- Indexes for table `trade_shipments`
--
ALTER TABLE `trade_shipments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_trade_shipments_offer_party` (`trade_offer_id`,`party`),
  ADD KEY `idx_trade_shipments_trade` (`trade_offer_id`),
  ADD KEY `fk_trade_shipments_sender` (`sender_id`),
  ADD KEY `fk_trade_shipments_recipient` (`recipient_id`);

--
-- Indexes for table `vouchers`
--
ALTER TABLE `vouchers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_vouchers_code` (`code`),
  ADD KEY `idx_vouchers_status` (`status`),
  ADD KEY `idx_vouchers_boutique` (`boutique_id`),
  ADD KEY `idx_vouchers_scope` (`scope`),
  ADD KEY `fk_vouchers_creator` (`created_by`);

--
-- Indexes for table `voucher_redemptions`
--
ALTER TABLE `voucher_redemptions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_redemptions_voucher` (`voucher_id`),
  ADD KEY `idx_redemptions_user` (`user_id`),
  ADD KEY `fk_redemptions_order` (`order_id`);

--
-- Indexes for table `wishlists`
--
ALTER TABLE `wishlists`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_wishlists_user_listing` (`user_id`,`listing_id`),
  ADD KEY `idx_wishlists_user_id` (`user_id`),
  ADD KEY `idx_wishlists_listing_id` (`listing_id`);

--
-- Constraints for dumped tables
--

--
-- Constraints for table `bids`
--
ALTER TABLE `bids`
  ADD CONSTRAINT `fk_bids_bidder` FOREIGN KEY (`bidder_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_bids_listing` FOREIGN KEY (`listing_id`) REFERENCES `listings` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `boutiques`
--
ALTER TABLE `boutiques`
  ADD CONSTRAINT `fk_boutiques_district` FOREIGN KEY (`district_id`) REFERENCES `cebu_districts` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_boutiques_seller` FOREIGN KEY (`seller_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `itineraries`
--
ALTER TABLE `itineraries`
  ADD CONSTRAINT `fk_itineraries_user` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `listings`
--
ALTER TABLE `listings`
  ADD CONSTRAINT `fk_listings_boutique` FOREIGN KEY (`boutique_id`) REFERENCES `boutiques` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_listings_moderated_by` FOREIGN KEY (`moderated_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `locker_handoffs`
--
ALTER TABLE `locker_handoffs`
  ADD CONSTRAINT `fk_locker_handoffs_location` FOREIGN KEY (`locker_location_id`) REFERENCES `locker_locations` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_locker_handoffs_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_locker_handoffs_user` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `locker_locations`
--
ALTER TABLE `locker_locations`
  ADD CONSTRAINT `fk_locker_locations_district` FOREIGN KEY (`district_id`) REFERENCES `cebu_districts` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `messages`
--
ALTER TABLE `messages`
  ADD CONSTRAINT `fk_messages_listing` FOREIGN KEY (`listing_id`) REFERENCES `listings` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_messages_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_messages_sender` FOREIGN KEY (`sender_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `orders`
--
ALTER TABLE `orders`
  ADD CONSTRAINT `fk_orders_boutique` FOREIGN KEY (`boutique_id`) REFERENCES `boutiques` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_orders_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_orders_listing` FOREIGN KEY (`listing_id`) REFERENCES `listings` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `profiles`
--
ALTER TABLE `profiles`
  ADD CONSTRAINT `fk_profiles_district` FOREIGN KEY (`district_id`) REFERENCES `cebu_districts` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `reviews`
--
ALTER TABLE `reviews`
  ADD CONSTRAINT `fk_reviews_boutique` FOREIGN KEY (`boutique_id`) REFERENCES `boutiques` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_reviews_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `trade_events`
--
ALTER TABLE `trade_events`
  ADD CONSTRAINT `fk_trade_events_actor` FOREIGN KEY (`actor_id`) REFERENCES `profiles` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_trade_events_offer` FOREIGN KEY (`trade_offer_id`) REFERENCES `trade_offers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `trade_inventory_locks`
--
ALTER TABLE `trade_inventory_locks`
  ADD CONSTRAINT `fk_trade_locks_listing` FOREIGN KEY (`listing_id`) REFERENCES `listings` (`id`),
  ADD CONSTRAINT `fk_trade_locks_offer` FOREIGN KEY (`trade_offer_id`) REFERENCES `trade_offers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `trade_items`
--
ALTER TABLE `trade_items`
  ADD CONSTRAINT `fk_trade_items_listing` FOREIGN KEY (`listing_id`) REFERENCES `listings` (`id`),
  ADD CONSTRAINT `fk_trade_items_offer` FOREIGN KEY (`trade_offer_id`) REFERENCES `trade_offers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `trade_offers`
--
ALTER TABLE `trade_offers`
  ADD CONSTRAINT `fk_trade_offers_initiator` FOREIGN KEY (`initiator_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_trade_offers_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `trade_shipments`
--
ALTER TABLE `trade_shipments`
  ADD CONSTRAINT `fk_trade_shipments_offer` FOREIGN KEY (`trade_offer_id`) REFERENCES `trade_offers` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_trade_shipments_recipient` FOREIGN KEY (`recipient_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_trade_shipments_sender` FOREIGN KEY (`sender_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `vouchers`
--
ALTER TABLE `vouchers`
  ADD CONSTRAINT `fk_vouchers_boutique` FOREIGN KEY (`boutique_id`) REFERENCES `boutiques` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_vouchers_creator` FOREIGN KEY (`created_by`) REFERENCES `profiles` (`id`) ON DELETE SET NULL;

--
-- Constraints for table `voucher_redemptions`
--
ALTER TABLE `voucher_redemptions`
  ADD CONSTRAINT `fk_redemptions_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_redemptions_user` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_redemptions_voucher` FOREIGN KEY (`voucher_id`) REFERENCES `vouchers` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `wishlists`
--
ALTER TABLE `wishlists`
  ADD CONSTRAINT `fk_wishlists_listing` FOREIGN KEY (`listing_id`) REFERENCES `listings` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_wishlists_user` FOREIGN KEY (`user_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
