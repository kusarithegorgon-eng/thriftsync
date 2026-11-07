import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export type Profile = {
  id: string; role: 'buyer' | 'seller' | 'admin'; display_name: string;
  avatar_url: string | null; bio: string | null; default_lat: number | null;
  default_lng: number | null; default_barangay: string | null; is_banned: boolean;
  created_at: string;
};
export type Boutique = {
  id: string; seller_id: string; name: string; slug: string; tagline: string | null;
  bio: string | null; banner_url: string | null; logo_url: string | null;
  location: string | null; lat: number | null; lng: number | null;
  barangay: string | null; pickup_available: boolean; courier_delivery: boolean;
  policies: string | null; rating_avg: number; rating_count: number;
  operating_hours: Record<string, string>; seller_rating_avg: number;
  seller_rating_count: number; created_at: string;
};
export type ImageAngle = 'front' | 'back' | 'left' | 'right' | 'detail' | 'flaw' | 'tag' | 'other';
export type ImageMetadata = { url: string; angle: ImageAngle; is_flaw: boolean; caption?: string };
export type AuctionMode = 'ENGLISH' | 'DUTCH';
export type Listing = {
  id: string; boutique_id: string; title: string; description: string | null; price: number;
  era: string | null; category: string | null;
  condition_grade: 'Mint' | 'Excellent' | 'Good' | 'Fair' | 'Distressed' | null;
  material: string | null; images: string[]; image_metadata: ImageMetadata[] | null;
  listing_type: 'fixed' | 'auction'; auction_mode: AuctionMode; auction_end_at: string | null;
  auction_start_at: string | null; auction_duration_days: number | null;
  auction_start_price: number | null; reserve_price: number | null; increment_step: number | null;
  decrement_rate: number | null; decrement_interval_minutes: number;
  current_dutch_price: number | null; dutch_floor_price: number | null;
  status: 'active' | 'sold' | 'draft'; moderation_status: 'pending_review' | 'approved' | 'rejected';
  moderation_note: string | null; moderated_by: string | null; moderated_at: string | null;
  sku: string | null; coa_verified: boolean; views: number; created_at: string;
};
export type Bid = { id: string; listing_id: string; bidder_id: string; amount: number; is_winning: boolean; created_at: string };
export type PublicBid = { id: string; listing_id: string; bidder_label: string; amount: number; is_winning: boolean; created_at: string };
export type SellerAuctionBid = {
  id: string; listing_id: string; bidder_id: string; display_name: string; avatar_url: string | null;
  profile_url: string; feedback_score: number | null; amount: number; is_winning: boolean; created_at: string;
};
export type ReportCategory = 'illegal_item' | 'counterfeit_item' | 'stolen_goods' | 'misleading_location' | 'abusive_content' | 'product_fraud';
export type ReportStatus = 'pending' | 'under_review' | 'resolved_refunded' | 'resolved_dismissed';
export type Report = {
  id: string; reporter_id: string; reported_user_id: string; listing_id: string | null; order_id: string | null;
  category: ReportCategory; description: string | null; evidence_urls: string[]; status: ReportStatus;
  admin_notes: string | null; created_at: string;
};
export type GeneralReportCategory = Exclude<ReportCategory, 'illegal_item' | 'product_fraud'>;
export type GeneralReport = {
  id: string; reporter_id: string; reported_user_id: string; listing_id: string | null;
  violation_category: GeneralReportCategory; description: string; evidence_paths: string[];
  status: 'pending' | 'under_review' | 'resolved' | 'dismissed'; admin_notes: string | null; created_at: string;
};
export type AdminAuditLog = {
  id: string; report_id: string | null; actor_id: string | null; action: string; details: Record<string, unknown> | null; created_at: string;
};
export type Order = {
  id: string; buyer_id: string; listing_id: string; boutique_id: string; amount: number;
  status: 'escrow_held' | 'shipped' | 'delivered' | 'completed' | 'disputed' | 'refunded' | 'in_escrow';
  shipping_address: string | null; tracking_number: string | null; delivery_method: 'courier' | 'pickup' | 'locker';
  locker_location_id: string | null; created_at: string;
};
export type Review = { id: string; boutique_id: string; reviewer_id: string; rating: number; body: string | null; created_at: string };
export type ListingWithBoutique = Listing & { boutiques: Pick<Boutique, 'id' | 'name' | 'slug' | 'logo_url' | 'seller_id' | 'seller_rating_avg' | 'seller_rating_count'> | null };
export type BoutiqueWithListings = Boutique & { listings: Listing[] };
export type TradeStatus = 'PENDING' | 'COUNTERED' | 'ACCEPTED' | 'REJECTED' | 'SHIPPED_BY_PARTY_A' | 'SHIPPED_BY_PARTY_B' | 'COMPLETED' | 'DISPUTED';
export type TradeOffer = { id: string; initiator_id: string; recipient_id: string; status: TradeStatus; cash_top_up: number; expires_at: string; accepted_at: string | null; completed_at: string | null; created_at: string; updated_at: string };
export type TradeItem = { id: string; trade_offer_id: string; listing_id: string; side: 'OFFERED' | 'REQUESTED'; title_snapshot: string; price_snapshot: number; created_at: string };
export type TradeEvent = { id: string; trade_offer_id: string; actor_id: string | null; event_type: string; from_status: string | null; to_status: string | null; metadata: Record<string, unknown>; created_at: string };
export type TradeShipment = { id: string; trade_offer_id: string; party: 'A' | 'B'; sender_id: string; recipient_id: string; tracking_number: string | null; label_url: string | null; shipped_at: string | null; delivered_at: string | null; inspection_ends_at: string | null; status: string; created_at: string };
export type TradeOfferWithItems = TradeOffer & { trade_items: TradeItem[]; trade_shipments: TradeShipment[] };
export type VoucherScope = 'PLATFORM' | 'BOUTIQUE' | 'CATEGORY';
export type VoucherDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
export type VoucherStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'REVOKED';
export type VoucherTrigger = 'MANUAL' | 'CART_ABANDONMENT' | 'NEW_USER_WELCOME';
export type Voucher = { id: string; code: string; description: string | null; discount_type: VoucherDiscountType; discount_value: number; scope: VoucherScope; boutique_id: string | null; category: string | null; auction_eligible: boolean; min_spend: number; max_uses: number | null; max_uses_per_user: number; is_single_use: boolean; trigger_type: VoucherTrigger; expires_at: string | null; status: VoucherStatus; uses: number; created_by: string | null; created_at: string; updated_at: string };
export type VoucherRedemption = { id: string; voucher_id: string; user_id: string; order_id: string | null; cart_total_at_redemption: number; discount_amount: number; redeemed_at: string };
export type VoucherValidationResult = { valid: boolean; code: string | null; discount_type: VoucherDiscountType | null; discount_value: number; discount_amount: number; scope: VoucherScope | null; message: string };
export type CebuBarangay = { id: string; name: string; city_municipality: string; lat: number; lng: number; is_metro_cebu: boolean };
export type GeofenceResult = { within_cebu: boolean; nearest_barangay: CebuBarangay | null; message: string };
export type BidResult = { success: boolean; min_next_bid: number | null; message: string; new_current_bid: number | null };
export type CebuDistrict = { id: string; name: string; city_municipality: string; center_lat: number; center_lng: number; radius_km: number; is_metro: boolean };
export type TransportMode = 'walking' | 'driving' | 'motorbike' | 'jeepney';
export type ItineraryStop = {
  boutique_id: string; stop_order: number; boutique_name: string; lat: number; lng: number;
  operating_hours?: Record<string, string>;
};
export type Itinerary = { id: string; user_id: string; name: string; stops: ItineraryStop[]; transport_mode: TransportMode; total_distance_km: number; total_time_minutes: number; status: 'planned' | 'active' | 'completed'; scheduled_date: string | null; created_at: string };
export type ThriftCrawlRoute = Omit<Itinerary, 'status'>;
export type Conversation = {
  id: string; listing_id: string; buyer_id: string; seller_id: string;
  created_at: string; updated_at: string;
};
export type Message = {
  id: string; conversation_id: string | null; listing_id: string;
  sender_id: string; receiver_id: string; body: string; created_at: string;
};
export type SellerReview = {
  id: string; order_id: string; seller_id: string; reviewer_id: string;
  accuracy_rating: number; communication_rating: number; punctuality_rating: number;
  body: string | null; created_at: string;
};
export type LockerLocation = { id: string; partner_name: string; address: string; barangay: string | null; city_municipality: string; lat: number; lng: number; district_id: string | null; operating_hours: Record<string, string>; capacity_total: number; capacity_available: number; is_active: boolean; contact_phone: string | null; created_at: string };
export type LockerHandoff = { id: string; locker_location_id: string; order_id: string | null; user_id: string; pin_code: string; status: string; drop_off_window_start: string | null; drop_off_window_end: string | null; dropped_off_at: string | null; picked_up_at: string | null; created_at: string };
export type HandoffPinResult = { handoff_id: string; pin_code: string; locker_name: string; expires_at: string };
export type RouteSegment = { from_lat: number; from_lng: number; to_lat: number; to_lng: number; distance_km: number; time_minutes: number };
export type OptimizedRoute = { ordered_stops: ItineraryStop[]; segments: RouteSegment[]; total_distance_km: number; total_time_minutes: number };
