import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  storageKey: 'thriftsync-auth',
  },
});

export type Profile = {
  id: string;
  role: 'buyer' | 'seller' | 'admin';
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  default_lat: number | null;
  default_lng: number | null;
  default_barangay: string | null;
  created_at: string;
};

export type Boutique = {
  id: string;
  seller_id: string;
  name: string;
  slug: string;
  tagline: string | null;
  bio: string | null;
  banner_url: string | null;
  logo_url: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  barangay: string | null;
  pickup_available: boolean;
  courier_delivery: boolean;
  policies: string | null;
  rating_avg: number;
  rating_count: number;
  created_at: string;
};

export type ImageAngle = 'front' | 'back' | 'left' | 'right' | 'detail' | 'flaw' | 'tag' | 'other';

export type ImageMetadata = {
  url: string;
  angle: ImageAngle;
  is_flaw: boolean;
  caption?: string;
};

export type AuctionMode = 'ENGLISH' | 'DUTCH';

export type Listing = {
  id: string;
  boutique_id: string;
  title: string;
  description: string | null;
  price: number;
  era: string | null;
  category: string | null;
  condition_grade: 'Mint' | 'Excellent' | 'Good' | 'Fair' | 'Distressed' | null;
  material: string | null;
  images: string[];
  image_metadata: ImageMetadata[] | null;
  listing_type: 'fixed' | 'auction';
  auction_mode: AuctionMode;
  auction_end_at: string | null;
  auction_start_price: number | null;
  reserve_price: number | null;
  increment_step: number | null;
  decrement_rate: number | null;
  decrement_interval_minutes: number;
  current_dutch_price: number | null;
  dutch_floor_price: number | null;
  status: 'active' | 'sold' | 'draft';
  sku: string | null;
  coa_verified: boolean;
  views: number;
  created_at: string;
};

export type Bid = {
  id: string;
  listing_id: string;
  bidder_id: string;
  amount: number;
  is_winning: boolean;
  created_at: string;
};

export type Order = {
  id: string;
  buyer_id: string;
  listing_id: string;
  boutique_id: string;
  amount: number;
  status: 'escrow_held' | 'shipped' | 'delivered' | 'completed' | 'disputed' | 'refunded';
  shipping_address: string | null;
  tracking_number: string | null;
  created_at: string;
};

export type Review = {
  id: string;
  boutique_id: string;
  reviewer_id: string;
  rating: number;
  body: string | null;
  created_at: string;
};

export type ListingWithBoutique = Listing & {
  boutiques: Pick<Boutique, 'id' | 'name' | 'slug' | 'logo_url'> | null;
};

export type BoutiqueWithListings = Boutique & {
  listings: Listing[];
};

export type TradeStatus = 'PENDING' | 'COUNTERED' | 'ACCEPTED' | 'REJECTED' | 'SHIPPED_BY_PARTY_A' | 'SHIPPED_BY_PARTY_B' | 'COMPLETED' | 'DISPUTED';

export type TradeOffer = {
  id: string;
  initiator_id: string;
  recipient_id: string;
  status: TradeStatus;
  cash_top_up: number;
  expires_at: string;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TradeItem = {
  id: string;
  trade_offer_id: string;
  listing_id: string;
  side: 'OFFERED' | 'REQUESTED';
  title_snapshot: string;
  price_snapshot: number;
  created_at: string;
};

export type TradeEvent = {
  id: string;
  trade_offer_id: string;
  actor_id: string | null;
  event_type: 'CREATED' | 'COUNTERED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'LOCKED' | 'SHIPPED' | 'DELIVERED' | 'DISPUTED' | 'COMPLETED';
  from_status: string | null;
  to_status: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TradeShipment = {
  id: string;
  trade_offer_id: string;
  party: 'A' | 'B';
  sender_id: string;
  recipient_id: string;
  tracking_number: string | null;
  label_url: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  inspection_ends_at: string | null;
  status: 'PENDING' | 'LABEL_CREATED' | 'SHIPPED' | 'DELIVERED' | 'INSPECTION' | 'CLEARED' | 'DISPUTED';
  created_at: string;
};

export type TradeOfferWithItems = TradeOffer & {
  trade_items: TradeItem[];
  trade_shipments: TradeShipment[];
};

export type VoucherScope = 'PLATFORM' | 'BOUTIQUE' | 'CATEGORY';
export type VoucherDiscountType = 'PERCENTAGE' | 'FIXED_AMOUNT';
export type VoucherStatus = 'ACTIVE' | 'PAUSED' | 'EXPIRED' | 'REVOKED';
export type VoucherTrigger = 'MANUAL' | 'CART_ABANDONMENT' | 'NEW_USER_WELCOME';

export type Voucher = {
  id: string;
  code: string;
  description: string | null;
  discount_type: VoucherDiscountType;
  discount_value: number;
  scope: VoucherScope;
  boutique_id: string | null;
  category: string | null;
  auction_eligible: boolean;
  min_spend: number;
  max_uses: number | null;
  max_uses_per_user: number;
  is_single_use: boolean;
  trigger_type: VoucherTrigger;
  expires_at: string | null;
  status: VoucherStatus;
  uses: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VoucherRedemption = {
  id: string;
  voucher_id: string;
  user_id: string;
  order_id: string | null;
  cart_total_at_redemption: number;
  discount_amount: number;
  redeemed_at: string;
};

export type VoucherValidationResult = {
  valid: boolean;
  code: string | null;
  discount_type: VoucherDiscountType | null;
  discount_value: number;
  discount_amount: number;
  scope: VoucherScope | null;
  message: string;
};

export type CebuBarangay = {
  id: string;
  name: string;
  city_municipality: string;
  lat: number;
  lng: number;
  is_metro_cebu: boolean;
};

export type GeofenceResult = {
  within_cebu: boolean;
  nearest_barangay: CebuBarangay | null;
  message: string;
};

export type BidResult = {
  success: boolean;
  min_next_bid: number | null;
  message: string;
  new_current_bid: number | null;
};
