const API_BASE = import.meta.env.VITE_API_URL || '/api';
const TOKEN_KEY = 'thriftsync-mariadb-token';
const listeners = new Set<(event: string, session: Session | null) => void>();

type SessionUser = { id: string; email: string };
type Session = { access_token: string; user: SessionUser };
type ApiError = { message: string; code?: string };
type Filter = { column: string; operator: string; value: unknown };

function getToken() {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
}

export function getAccessToken() {
  return getToken();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new Error('Cannot reach the MariaDB API. Start the backend server and check its database connection.');
  }

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || `MariaDB API request failed (${response.status})`);
  }
  return result as T;
}

class TableQuery<T = Record<string, unknown>> implements PromiseLike<{ data: T | T[] | null; error: ApiError | null }> {
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private columns = '*';
  private values: unknown;
  private filters: Filter[] = [];
  private orderBy: { column: string; ascending: boolean }[] = [];
  private maxRows: number | undefined;
  private maybeSingleResult = false;

  constructor(private readonly table: string) {}

  select(columns = '*') {
    this.columns = columns;
    return this;
  }

  insert(values: unknown) {
    this.operation = 'insert';
    this.values = values;
    return this;
  }

  update(values: unknown) {
    this.operation = 'update';
    this.values = values;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ column, operator: 'neq', value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ column, operator: 'in', value });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.filters.push({ column, operator: `not.${operator}`, value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ column: '$or', operator: 'or', value: expression });
    return this;
  }

  order(column: string, options: { ascending?: boolean } = {}) {
    this.orderBy.push({ column, ascending: options.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.maxRows = count;
    return this;
  }

  maybeSingle(): Promise<{ data: T | null; error: ApiError | null }> {
    this.maybeSingleResult = true;
    return this.execute() as Promise<{ data: T | null; error: ApiError | null }>;
  }

  single(): Promise<{ data: T | null; error: ApiError | null }> {
    this.maybeSingleResult = true;
    return this.execute() as Promise<{ data: T | null; error: ApiError | null }>;
  }

  then<TResult1 = { data: T[] | null; error: ApiError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: ApiError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(
      ({ data, error }) => onfulfilled?.({
        data: data === null ? null : Array.isArray(data) ? data as T[] : [data as T],
        error,
      }) as TResult1,
      onrejected,
    );
  }

  private async execute(): Promise<{ data: T | T[] | null; error: ApiError | null }> {
    try {
      const result = await request<{ data: T | T[] | null }>('/data', {
        method: 'POST',
        body: JSON.stringify({
          table: this.table,
          operation: this.operation,
          columns: this.columns,
          values: this.values,
          filters: this.filters,
          order: this.orderBy,
          limit: this.maxRows,
        }),
      });
      let data = result.data;
      if (this.maybeSingleResult && Array.isArray(data)) data = data[0] ?? null;
      return { data, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : 'Database request failed' },
      };
    }
  }
}

async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(`/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function rpc(
  name: 'approve_listing' | 'reject_listing',
  args: Record<string, unknown>,
): Promise<{ data: { success: boolean; message: string }[]; error: ApiError | null }>;
function rpc(name: 'generate_handoff_pin', args: Record<string, unknown>): Promise<{ data: HandoffPinResult[]; error: ApiError | null }>;
function rpc(name: 'confirm_handoff_pickup', args: Record<string, unknown>): Promise<{ data: { success: boolean; message: string }[]; error: ApiError | null }>;
function rpc(name: 'validate_voucher', args: Record<string, unknown>): Promise<{ data: VoucherValidationResult[]; error: ApiError | null }>;
function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<{ data: T; error: ApiError | null }>;
async function rpc<T = unknown>(name: string, args: Record<string, unknown> = {}) {
  const result = await request<{ data: T; error: ApiError | null }>(`/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: JSON.stringify(args),
  });
  return { data: result.data, error: result.error };
}

function saveSession(session: Session | null, event: string) {
  if (typeof localStorage !== 'undefined') {
    if (session) localStorage.setItem(TOKEN_KEY, session.access_token);
    else localStorage.removeItem(TOKEN_KEY);
  }
  listeners.forEach((listener) => listener(event, session));
}

export const supabase = {
  from<T extends keyof TableRows>(table: T): TableQuery<TableRows[T]> {
    return new TableQuery<TableRows[T]>(table);
  },
  rpc,
  auth: {
    async signUp(credentials: {
      email: string;
      password: string;
      options?: { data?: Record<string, unknown> };
    }) {
      try {
        const result = await authRequest<{ session: Session; user: SessionUser }>('sign-up', credentials);
        saveSession(result.session, 'SIGNED_IN');
        return { data: { user: result.user, session: result.session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: { message: error instanceof Error ? error.message : 'Sign up failed' } };
      }
    },
    async signInWithPassword(credentials: { email: string; password: string }) {
      try {
        const result = await authRequest<{ session: Session; user: SessionUser }>('sign-in', credentials);
        saveSession(result.session, 'SIGNED_IN');
        return { data: { user: result.user, session: result.session }, error: null };
      } catch (error) {
        return { data: { user: null, session: null }, error: { message: error instanceof Error ? error.message : 'Sign in failed' } };
      }
    },
    async getSession() {
      try {
        if (!getToken()) return { data: { session: null }, error: null };
        const result = await authRequest<{ session: Session | null }>('session');
        if (!result.session) saveSession(null, 'SIGNED_OUT');
        return { data: result, error: null };
      } catch (error) {
        return { data: { session: null }, error: { message: error instanceof Error ? error.message : 'Session request failed' } };
      }
    },
    onAuthStateChange(callback: (event: string, session: Session | null) => void) {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    async signOut() {
      saveSession(null, 'SIGNED_OUT');
      return { error: null };
    },
  },
};

export type Profile = {
  id: string; role: 'buyer' | 'seller' | 'admin'; display_name: string;
  avatar_url: string | null; bio: string | null; default_lat: number | null;
  default_lng: number | null; default_barangay: string | null; created_at: string;
};
export type Boutique = {
  id: string; seller_id: string; name: string; slug: string; tagline: string | null;
  bio: string | null; banner_url: string | null; logo_url: string | null;
  location: string | null; lat: number | null; lng: number | null;
  barangay: string | null; pickup_available: boolean; courier_delivery: boolean;
  policies: string | null; rating_avg: number; rating_count: number; created_at: string;
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
  auction_start_price: number | null; reserve_price: number | null; increment_step: number | null;
  decrement_rate: number | null; decrement_interval_minutes: number;
  current_dutch_price: number | null; dutch_floor_price: number | null;
  status: 'active' | 'sold' | 'draft'; moderation_status: 'pending_review' | 'approved' | 'rejected';
  moderation_note: string | null; moderated_by: string | null; moderated_at: string | null;
  sku: string | null; coa_verified: boolean; views: number; created_at: string;
};
export type Bid = { id: string; listing_id: string; bidder_id: string; amount: number; is_winning: boolean; created_at: string };
export type Order = {
  id: string; buyer_id: string; listing_id: string; boutique_id: string; amount: number;
  status: 'escrow_held' | 'shipped' | 'delivered' | 'completed' | 'disputed' | 'refunded';
  shipping_address: string | null; tracking_number: string | null; created_at: string;
};
export type Review = { id: string; boutique_id: string; reviewer_id: string; rating: number; body: string | null; created_at: string };
export type ListingWithBoutique = Listing & { boutiques: Pick<Boutique, 'id' | 'name' | 'slug' | 'logo_url'> | null };
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
export type TransportMode = 'walking' | 'driving' | 'jeepney';
export type ItineraryStop = { boutique_id: string; stop_order: number; boutique_name: string; lat: number; lng: number };
export type Itinerary = { id: string; user_id: string; name: string; stops: ItineraryStop[]; transport_mode: TransportMode; total_distance_km: number; total_time_minutes: number; status: 'planned' | 'active' | 'completed'; scheduled_date: string | null; created_at: string };
export type LockerLocation = { id: string; partner_name: string; address: string; barangay: string | null; city_municipality: string; lat: number; lng: number; district_id: string | null; operating_hours: Record<string, string>; capacity_total: number; capacity_available: number; is_active: boolean; contact_phone: string | null; created_at: string };
export type LockerHandoff = { id: string; locker_location_id: string; order_id: string | null; user_id: string; pin_code: string; status: string; drop_off_window_start: string | null; drop_off_window_end: string | null; dropped_off_at: string | null; picked_up_at: string | null; created_at: string };
export type HandoffPinResult = { handoff_id: string; pin_code: string; locker_name: string; expires_at: string };
export type RouteSegment = { from_lat: number; from_lng: number; to_lat: number; to_lng: number; distance_km: number; time_minutes: number };
export type OptimizedRoute = { ordered_stops: ItineraryStop[]; segments: RouteSegment[]; total_distance_km: number; total_time_minutes: number };

type TableRows = {
  profiles: Profile;
  boutiques: Boutique;
  listings: ListingWithBoutique;
  bids: Bid;
  orders: Order & {
    listings?: Pick<Listing, 'id' | 'title' | 'images'>;
    boutiques?: Pick<Boutique, 'id' | 'name' | 'slug'>;
  };
  messages: { id: string; listing_id: string; sender_id: string; receiver_id: string; body: string; created_at: string };
  wishlists: { id: string; user_id: string; listing_id: string; created_at: string; listings?: ListingWithBoutique };
  reviews: Review;
  cebu_districts: CebuDistrict;
  cebu_barangays: CebuBarangay;
  itineraries: Itinerary;
  locker_locations: LockerLocation;
  locker_handoffs: LockerHandoff;
  vouchers: Voucher;
  voucher_redemptions: VoucherRedemption;
  trade_offers: TradeOffer;
  trade_items: TradeItem;
  trade_events: TradeEvent;
  trade_inventory_locks: { id: string; trade_offer_id: string; listing_id: string; lock_status: 'ACTIVE' | 'RELEASED'; locked_at: string; released_at: string | null };
  trade_shipments: TradeShipment;
};
