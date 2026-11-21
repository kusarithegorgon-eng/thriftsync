import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, Package, DollarSign, Eye, Gavel, Plus, ArrowRight, Clock, Truck, Share2, KeyRound, ArrowLeftRight, Store, Pencil, Star, Camera } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Listing, type Boutique, type Order, type Profile, type DeliveryJobEvent } from '@/lib/supabase';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';
import { SellerLiveAuctionBiddersModal } from '@/components/SellerLiveAuctionBiddersModal';
import { SellerProfileEditor } from '@/components/SellerProfileEditor';
import { LockerQrScanner } from '@/components/LockerQrScanner';

const SELLER_ORDER_PAGE_SIZE = 10;

type SellerOrder = Order & {
  listings: Pick<Listing, 'title'> | null;
  profiles: Pick<Profile, 'display_name'> | null;
};
type SellerCourierPickupInfo = {
  pickup_code: string;
  courier_name: string;
  tracking_code: string;
  delivery_status: string;
};
type SellerCourierProgress = {
  courier_id: string;
  status: string;
  tracking_code: string;
  events: Pick<DeliveryJobEvent, 'id' | 'event_type' | 'created_at'>[];
};
type SellerManagedCourier = {
  courier_id: string;
  display_name: string;
  account_role: Profile['role'];
  account_status: Profile['account_status'];
  is_active: boolean;
  created_at: string;
};

export function DashboardPage() {
  const { navigate } = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [orderPage, setOrderPage] = useState(0);
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderLoadError, setOrderLoadError] = useState<string | null>(null);
  const [gmvTotal, setGmvTotal] = useState(0);
  const [salesSummaryError, setSalesSummaryError] = useState<string | null>(null);
  const [reviewedBuyerOrderIds, setReviewedBuyerOrderIds] = useState<string[]>([]);
  const [buyerReviewRatings, setBuyerReviewRatings] = useState<Record<string, number>>({});
  const [buyerReviewBodies, setBuyerReviewBodies] = useState<Record<string, string>>({});
  const [buyerReviewErrors, setBuyerReviewErrors] = useState<Record<string, string>>({});
  const [buyerReviewSubmittingId, setBuyerReviewSubmittingId] = useState<string | null>(null);
  const [lockerQrScannerOpen, setLockerQrScannerOpen] = useState(false);
  const [lockerQrMessage, setLockerQrMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingNumbers, setTrackingNumbers] = useState<Record<string, string>>({});
  const [lockerPins, setLockerPins] = useState<Record<string, string>>({});
  const [orderActionLoading, setOrderActionLoading] = useState<string | null>(null);
  const [orderActionErrors, setOrderActionErrors] = useState<Record<string, string>>({});
  const [courierPickupInfos, setCourierPickupInfos] = useState<Record<string, SellerCourierPickupInfo>>({});
  const [courierDeliveryProgress, setCourierDeliveryProgress] = useState<Record<string, SellerCourierProgress>>({});
  const [courierInfoError, setCourierInfoError] = useState<string | null>(null);
  const [sellerCouriers, setSellerCouriers] = useState<SellerManagedCourier[]>([]);
  const [courierManagementLoading, setCourierManagementLoading] = useState(false);
  const [courierManagementError, setCourierManagementError] = useState<string | null>(null);
  const [courierManagementMessage, setCourierManagementMessage] = useState<string | null>(null);
  const [courierInviteLoading, setCourierInviteLoading] = useState(false);
  const [courierInviteName, setCourierInviteName] = useState('');
  const [courierInviteEmail, setCourierInviteEmail] = useState('');
  const [selectedCourierIds, setSelectedCourierIds] = useState<Record<string, string>>({});
  const [courierAssignmentRefresh, setCourierAssignmentRefresh] = useState(0);
  const [selectedAuction, setSelectedAuction] = useState<Listing | null>(null);
  const [barterUpdatingId, setBarterUpdatingId] = useState<string | null>(null);
  const [barterErrors, setBarterErrors] = useState<Record<string, string>>({});
  const [auctionActionErrors, setAuctionActionErrors] = useState<Record<string, string>>({});
  const [moderationUpdates, setModerationUpdates] = useState<Record<string, {
    action: string; notes: string | null; hide_until: string | null;
  }>>({});
  const [moderationNoticeError, setModerationNoticeError] = useState<string | null>(null);
  const [editingSellerProfile, setEditingSellerProfile] = useState(false);

  const loadSellerCouriers = useCallback(async () => {
    if (!user) {
      setSellerCouriers([]);
      setCourierManagementLoading(false);
      return;
    }

    setCourierManagementLoading(true);
    const { data, error } = await supabase.rpc('seller_list_couriers');
    if (error) {
      setCourierManagementError(`Could not load your drivers: ${error.message}`);
    } else {
      setSellerCouriers((data as SellerManagedCourier[]) || []);
      setCourierManagementError(null);
    }
    setCourierManagementLoading(false);
  }, [user]);

  useEffect(() => {
    if (boutique) void loadSellerCouriers();
  }, [boutique, loadSellerCouriers]);

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: boutiqueData } = await supabase
        .from('boutiques')
        .select('*')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      setBoutique(boutiqueData as Boutique);

      if (boutiqueData) {
        const { data: listingData } = await supabase
          .from('listings')
          .select('*')
          .eq('boutique_id', (boutiqueData as Boutique).id)
          .order('created_at', { ascending: false });
        const sellerListings = (listingData as Listing[]) || [];
        setListings(sellerListings);
        const listingIds = sellerListings.map((listing) => listing.id);
        if (listingIds.length > 0) {
          const { data: actionData, error: actionError } = await supabase
            .from('moderation_actions')
            .select('listing_id, action, notes, hide_until')
            .in('listing_id', listingIds)
            .in('action', ['warning', 'correction_request', 'temporary_hide', 'restore', 'temporary_hide_expired'])
            .order('created_at', { ascending: false });
          if (actionError) {
            setModerationNoticeError(`Could not load moderator updates: ${actionError.message}`);
          } else {
            const latestUpdates: Record<string, { action: string; notes: string | null; hide_until: string | null }> = {};
            (actionData || []).forEach((action) => {
              if (action.listing_id && !latestUpdates[action.listing_id]) {
                latestUpdates[action.listing_id] = {
                  action: action.action,
                  notes: action.notes,
                  hide_until: action.hide_until,
                };
              }
            });
            setModerationUpdates(latestUpdates);
            setModerationNoticeError(null);
          }
        } else {
          setModerationUpdates({});
        }

        const { data: summary, error: summaryError } = await supabase.rpc('seller_dashboard_summary');
        if (summaryError) setSalesSummaryError(`Could not load sales totals: ${summaryError.message}`);
        else setGmvTotal(Number(summary?.[0]?.gross_sales || 0));
      }

      setLoading(false);
    }
    if (!authLoading) load();
  }, [user, authLoading]);

  useEffect(() => {
    let active = true;
    async function loadSellerOrders() {
      if (!boutique) return;
      setOrderLoading(true);
      setOrderLoadError(null);
      let query = supabase
        .from('orders')
        .select('*, listings(title), profiles(display_name)', { count: 'exact' })
        .eq('boutique_id', boutique.id)
        .order('created_at', { ascending: false })
        .range(orderPage * SELLER_ORDER_PAGE_SIZE, (orderPage + 1) * SELLER_ORDER_PAGE_SIZE - 1);
      if (orderStatusFilter !== 'all') query = query.eq('status', orderStatusFilter);
      const { data, error, count } = await query;
      if (!active) return;
      if (error) {
        setOrderLoadError(`Could not load seller transaction history: ${error.message}`);
        setOrders([]);
        setOrderCount(0);
        setOrderLoading(false);
        return;
      }

      const loadedOrders = (data as SellerOrder[]) || [];
      setOrders(loadedOrders);
      setCourierPickupInfos({});
      setCourierDeliveryProgress({});
      setCourierInfoError(null);
      const allCourierOrders = loadedOrders.filter((order) => order.delivery_method === 'courier');
      if (allCourierOrders.length > 0) {
        const { data: jobData, error: jobError } = await supabase
          .from('delivery_jobs')
          .select('id, order_id, courier_id, status, tracking_code')
          .in('order_id', allCourierOrders.map((order) => order.id));
        if (!active) return;
        if (jobError) {
          setCourierInfoError(`Could not load courier progress: ${jobError.message}`);
        } else {
          const jobs = (jobData || []) as {
            id: string; order_id: string; courier_id: string; status: string; tracking_code: string;
          }[];
          const { data: eventData, error: eventError } = jobs.length > 0
            ? await supabase
              .from('delivery_job_events')
              .select('id, delivery_job_id, event_type, created_at')
              .in('delivery_job_id', jobs.map((job) => job.id))
              .order('created_at', { ascending: true })
            : { data: [], error: null };
          if (!active) return;
          if (eventError) {
            setCourierInfoError(`Could not load courier event history: ${eventError.message}`);
          }
          const eventsByJob = new Map<string, SellerCourierProgress['events']>();
          (eventData || []).forEach((event) => {
            const events = eventsByJob.get(event.delivery_job_id) || [];
            events.push(event as SellerCourierProgress['events'][number]);
            eventsByJob.set(event.delivery_job_id, events);
          });
          const progress: Record<string, SellerCourierProgress> = {};
          jobs.forEach((job) => {
            progress[job.order_id] = {
              courier_id: job.courier_id,
              status: job.status,
              tracking_code: job.tracking_code,
              events: eventsByJob.get(job.id) || [],
            };
          });
          setCourierDeliveryProgress(progress);
        }
      }
      const courierOrders = loadedOrders.filter((order) =>
        order.delivery_method === 'courier' && order.status === 'escrow_held');
      if (courierOrders.length > 0) {
        const pickupResults = await Promise.all(courierOrders.map(async (order) => {
          const result = await supabase.rpc('get_seller_delivery_pickup_code', { p_order_id: order.id });
          return { orderId: order.id, ...result };
        }));
        if (!active) return;
        const pickupInfos: Record<string, SellerCourierPickupInfo> = {};
        for (const result of pickupResults) {
          if (result.error) {
            setCourierInfoError(`Could not load courier pickup details: ${result.error.message}`);
            break;
          }
          const info = (result.data as SellerCourierPickupInfo[] | null)?.[0];
          if (info) pickupInfos[result.orderId] = info;
        }
        setCourierPickupInfos(pickupInfos);
      }
      setOrderCount(count || 0);
      if (loadedOrders.length > 0) {
        const { data: reviewData, error: reviewError } = await supabase
          .from('buyer_reviews')
          .select('order_id')
          .in('order_id', loadedOrders.map((order) => order.id));
        if (!active) return;
        if (reviewError) {
          setOrderLoadError(`Could not load buyer feedback status: ${reviewError.message}`);
        } else {
          setReviewedBuyerOrderIds((reviewData || []).map((review) => review.order_id));
        }
      } else {
        setReviewedBuyerOrderIds([]);
      }
      setOrderLoading(false);
    }
    void loadSellerOrders();
    return () => { active = false; };
  }, [boutique, courierAssignmentRefresh, orderPage, orderStatusFilter]);

  async function inviteCourier(event: React.FormEvent) {
    event.preventDefault();
    setCourierInviteLoading(true);
    setCourierManagementError(null);
    setCourierManagementMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('invite-courier', {
        body: { displayName: courierInviteName, email: courierInviteEmail },
      });
      if (error) throw new Error(error.message);
      setCourierManagementMessage(data?.message || 'Driver invitation sent.');
      setCourierInviteName('');
      setCourierInviteEmail('');
      await loadSellerCouriers();
    } catch (error) {
      setCourierManagementError(error instanceof Error ? error.message : 'Could not invite this driver.');
    } finally {
      setCourierInviteLoading(false);
    }
  }

  async function linkExistingCourier() {
    setCourierInviteLoading(true);
    setCourierManagementError(null);
    setCourierManagementMessage(null);
    try {
      const { error } = await supabase.rpc('seller_link_existing_courier', {
        p_email: courierInviteEmail,
      });
      if (error) throw new Error(error.message);
      setCourierManagementMessage('Existing driver account linked to your boutique.');
      setCourierInviteEmail('');
      await loadSellerCouriers();
    } catch (error) {
      setCourierManagementError(error instanceof Error ? error.message : 'Could not link this courier account.');
    } finally {
      setCourierInviteLoading(false);
    }
  }

  async function toggleCourierActive(courier: SellerManagedCourier) {
    setCourierManagementError(null);
    setCourierManagementMessage(null);
    const { error } = await supabase.rpc('seller_set_courier_active', {
      p_courier_id: courier.courier_id,
      p_is_active: !courier.is_active,
    });
    if (error) {
      setCourierManagementError(error.message);
    } else {
      setCourierManagementMessage(courier.is_active ? 'Driver paused.' : 'Driver reactivated.');
      await loadSellerCouriers();
    }
  }

  async function assignSellerCourier(order: SellerOrder) {
    const courierId = selectedCourierIds[order.id] || courierDeliveryProgress[order.id]?.courier_id;
    if (!courierId) {
      setOrderActionErrors((current) => ({ ...current, [order.id]: 'Choose one of your active drivers.' }));
      return;
    }
    setOrderActionLoading(order.id);
    setOrderActionErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      const { error } = await supabase.rpc('seller_assign_delivery_courier', {
        p_order_id: order.id,
        p_courier_id: courierId,
      });
      if (error) throw new Error(error.message);
      setCourierAssignmentRefresh((current) => current + 1);
    } catch (error) {
      setOrderActionErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not assign this driver.',
      }));
    } finally {
      setOrderActionLoading(null);
    }
  }

  async function markOrderShipped(order: SellerOrder) {
    const trackingNumber = trackingNumbers[order.id]?.trim();
    if (!trackingNumber) {
      setOrderActionErrors((current) => ({ ...current, [order.id]: 'Enter a tracking number.' }));
      return;
    }
    setOrderActionLoading(order.id);
    setOrderActionErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      const { error } = await supabase.rpc('mark_order_shipped', {
        p_order_id: order.id,
        p_tracking_number: trackingNumber,
      });
      if (error) throw error;
      setOrders((current) => current.map((item) => item.id === order.id
        ? { ...item, status: 'shipped', tracking_number: trackingNumber }
        : item));
    } catch (error) {
      setOrderActionErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not update this order.',
      }));
    } finally {
      setOrderActionLoading(null);
    }
  }

  async function markLockerOrderDroppedOff(order: SellerOrder) {
    const pin = lockerPins[order.id]?.trim();
    if (!pin || !/^\d{6}$/.test(pin)) {
      setOrderActionErrors((current) => ({ ...current, [order.id]: 'Enter the buyer’s 6-digit locker PIN.' }));
      return;
    }

    setOrderActionLoading(order.id);
    setOrderActionErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      const { data, error } = await supabase.rpc('mark_order_locker_dropped_off', {
        p_order_id: order.id,
        p_pin_code: pin,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not record locker drop-off.');
      setOrders((current) => current.map((item) => item.id === order.id
        ? { ...item, status: 'shipped' }
        : item));
      setLockerPins((current) => ({ ...current, [order.id]: '' }));
    } catch (error) {
      setOrderActionErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not record locker drop-off.',
      }));
    } finally {
      setOrderActionLoading(null);
    }
  }

  async function submitBuyerReview(order: SellerOrder) {
    setBuyerReviewSubmittingId(order.id);
    setBuyerReviewErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      const { error } = await supabase.rpc('submit_buyer_review', {
        p_order_id: order.id,
        p_rating: buyerReviewRatings[order.id] || 5,
        p_body: buyerReviewBodies[order.id] || '',
      });
      if (error) throw error;
      setReviewedBuyerOrderIds((current) => [...current, order.id]);
    } catch (error) {
      setBuyerReviewErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not submit buyer feedback.',
      }));
    } finally {
      setBuyerReviewSubmittingId(null);
    }
  }

  const handleLockerQrScan = useCallback(async (value: string) => {
    setLockerQrMessage(null);
    let payload: unknown;
    try {
      payload = JSON.parse(value);
    } catch {
      setLockerQrMessage('That QR code is not a ThriftSync locker drop-off code.');
      setLockerQrScannerOpen(false);
      return;
    }
    if (!payload || typeof payload !== 'object') {
      setLockerQrMessage('That QR code is not a ThriftSync locker drop-off code.');
      setLockerQrScannerOpen(false);
      return;
    }
    const code = payload as Record<string, unknown>;
    if (
      code.type !== 'thrift-locker-dropoff'
      || typeof code.orderId !== 'string'
      || typeof code.pin !== 'string'
      || !/^\d{6}$/.test(code.pin)
    ) {
      setLockerQrMessage('That QR code is incomplete or invalid.');
      setLockerQrScannerOpen(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('mark_order_locker_dropped_off', {
        p_order_id: code.orderId,
        p_pin_code: code.pin,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not confirm locker drop-off.');
      setOrders((current) => current.map((order) => order.id === code.orderId
        ? { ...order, status: 'shipped' }
        : order));
      setLockerQrMessage(result.message || 'Locker drop-off confirmed.');
    } catch (error) {
      setLockerQrMessage(error instanceof Error ? error.message : 'Could not confirm locker drop-off.');
    } finally {
      setLockerQrScannerOpen(false);
    }
  }, []);

  async function toggleBarterAvailability(listing: Listing) {
    setBarterUpdatingId(listing.id);
    setBarterErrors((current) => ({ ...current, [listing.id]: '' }));
    try {
      const { error } = await supabase
        .from('listings')
        .update({ barter_enabled: !listing.barter_enabled })
        .eq('id', listing.id);
      if (error) throw error;
      setListings((current) => current.map((item) => item.id === listing.id
        ? { ...item, barter_enabled: !item.barter_enabled }
        : item));
    } catch (error) {
      setBarterErrors((current) => ({
        ...current,
        [listing.id]: error instanceof Error ? error.message : 'Could not update barter availability.',
      }));
    } finally {
      setBarterUpdatingId(null);
    }
  }

  async function cancelAuctionListing(listing: Listing) {
    setAuctionActionErrors((current) => ({ ...current, [listing.id]: '' }));
    try {
      const { data, error } = await supabase.rpc('cancel_auction_listing', {
        p_listing_id: listing.id,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not cancel this auction.');
      setListings((current) => current.map((item) => item.id === listing.id
        ? { ...item, status: 'draft' }
        : item));
    } catch (error) {
      setAuctionActionErrors((current) => ({
        ...current,
        [listing.id]: error instanceof Error ? error.message : 'Could not cancel this auction.',
      }));
    }
  }

  function shareListing(listing: Listing, platform: 'facebook' | 'x') {
    if (!boutique) return;
    const listingUrl = `${window.location.origin}${window.location.pathname}#/listing/${encodeURIComponent(listing.id)}`;
    const encodedUrl = encodeURIComponent(listingUrl);
    const shareUrl = platform === 'facebook'
      ? `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`
      : `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${listing.title} from ${boutique.name}`)}&url=${encodedUrl}`;

    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }

  if (!authLoading && !user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <p className="text-ink-500 mb-4">Sign in to access your seller dashboard.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="h-8 w-48 skeleton rounded mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
        </div>
        <div className="h-64 skeleton rounded-2xl" />
      </div>
    );
  }

  if (!boutique) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <Package className="w-12 h-12 text-ink-300 mx-auto mb-4" />
        <h1 className="font-serif text-xl font-bold text-ink-900 mb-2">No boutique yet</h1>
        <p className="text-sm text-ink-500 mb-6">Create your storefront to start selling on ThriftSync.</p>
        <button onClick={() => navigate({ name: 'sell' })} className="btn-primary inline-flex items-center gap-2">
          Open a Boutique <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const activeListings = listings.filter((l) => l.status === 'active');
  const soldListings = listings.filter((l) => l.status === 'sold' || l.status === 'exchanged');
  const totalViews = listings.reduce((sum, l) => sum + (l.views || 0), 0);
  const gmv = gmvTotal;
  const conversionRate = totalViews > 0 ? ((soldListings.length / totalViews) * 100).toFixed(1) : '0';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">{boutique.name}</h1>
          <p className="text-sm text-ink-500">{boutique.tagline || 'Seller Dashboard'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            type="button"
            onClick={() => setEditingSellerProfile(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Pencil className="h-4 w-4" /> Edit seller profile
          </button>
          <button onClick={() => navigate({ name: 'sell' })} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Listing
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<DollarSign className="w-5 h-5" />} label="GMV" value={formatPrice(gmv)} color="sage" />
        <StatCard icon={<Package className="w-5 h-5" />} label="Active Listings" value={String(activeListings.length)} color="ink" />
        <StatCard icon={<Eye className="w-5 h-5" />} label="Total Views" value={String(totalViews)} color="gold" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Conversion Rate" value={`${conversionRate}%`} color="terracotta" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Listings table */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-ink-100">
              <h2 className="text-sm font-medium text-ink-900">Your Listings</h2>
            </div>
            <div className="divide-y divide-ink-100">
              {listings.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-sm text-ink-500 mb-3">No listings yet</p>
                  <button onClick={() => navigate({ name: 'sell' })} className="btn-secondary">Create your first listing</button>
                </div>
              ) : (
                <>
                {moderationNoticeError && (
                  <p role="alert" className="px-3 py-2 text-xs text-terracotta-700">
                    {moderationNoticeError}
                  </p>
                )}
                {listings.map((listing) => (
                  <div key={listing.id} className="p-3 flex items-center gap-3 hover:bg-ink-50 transition-colors">
                    <div className="w-12 h-14 rounded-lg overflow-hidden bg-ink-100 shrink-0">
                      {listing.images && listing.images[0] && (
                        <img src={listing.images[0]} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => navigate({ name: 'listing', id: listing.id })}
                        className="text-sm font-medium text-ink-900 hover:text-terracotta-600 transition-colors text-left line-clamp-1"
                      >
                        {listing.title}
                      </button>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={cn(
                          'badge text-[10px]',
                          listing.status === 'active' ? 'bg-sage-50 text-sage-700' : 'bg-ink-100 text-ink-500'
                        )}>
                          {listing.status}
                        </span>
                        {listing.listing_type === 'auction' && (
                          <span className="badge bg-terracotta-50 text-terracotta-600 text-[10px]">
                            <Gavel className="w-2.5 h-2.5" /> Auction
                          </span>
                        )}
                        <span className="text-[10px] text-ink-400 flex items-center gap-0.5">
                          <Eye className="w-2.5 h-2.5" />{listing.views}
                        </span>
                      </div>
                      {listing.moderation_note && (
                        <p className="mt-1 line-clamp-2 text-[10px] text-terracotta-700">
                          Moderator update: {listing.moderation_note}
                        </p>
                      )}
                      {moderationUpdates[listing.id] && (
                        <p className="mt-1 line-clamp-2 text-[10px] text-terracotta-700">
                          {moderationUpdates[listing.id].action.replace(/_/g, ' ')}
                          {moderationUpdates[listing.id].notes && `: ${moderationUpdates[listing.id].notes}`}
                          {moderationUpdates[listing.id].hide_until
                            && ` · Until ${new Date(moderationUpdates[listing.id].hide_until!).toLocaleString()}`}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="text-sm font-semibold text-ink-900">{formatPrice(Number(listing.price))}</p>
                      {!['sold', 'exchanged', 'reserved', 'pending_auction_payment'].includes(listing.status) && (
                        <button
                          type="button"
                          onClick={() => navigate({ name: 'sell', listingId: listing.id })}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                        >
                          <Pencil className="h-3 w-3" /> Edit listing
                        </button>
                      )}
                      {listing.status === 'active' && (
                        <div className="flex items-center gap-1">
                          {listing.listing_type === 'auction' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setSelectedAuction(listing)}
                                aria-label={`View live bidders for ${listing.title}`}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-terracotta-700 hover:bg-terracotta-50"
                              >
                                <Gavel className="h-3 w-3" /> Live bidders
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const message = listing.auction_mode === 'ENGLISH'
                                    ? 'Cancel this English auction? This is only allowed before the first bid.'
                                    : 'Cancel this Dutch auction before a buyer claims it?';
                                  if (window.confirm(message)) {
                                    void cancelAuctionListing(listing);
                                  }
                                }}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-ink-600 hover:bg-ink-100"
                              >
                                Cancel auction
                              </button>
                            </>
                          )}
                          {listing.listing_type === 'fixed' && (
                            <button
                              type="button"
                              onClick={() => void toggleBarterAvailability(listing)}
                              disabled={barterUpdatingId === listing.id}
                              aria-label={`${listing.barter_enabled ? 'Disable' : 'Enable'} barter for ${listing.title}`}
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium hover:bg-sage-50',
                                listing.barter_enabled ? 'text-sage-700' : 'text-ink-600',
                              )}
                            >
                              <ArrowLeftRight className="h-3 w-3" />
                              {barterUpdatingId === listing.id ? 'Saving…' : listing.barter_enabled ? 'Barter on' : 'Enable barter'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => shareListing(listing, 'facebook')}
                            title="Share on Facebook"
                            aria-label={`Share ${listing.title} on Facebook`}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                          >
                            <Share2 className="h-3 w-3" /> Facebook
                          </button>
                          <button
                            type="button"
                            onClick={() => shareListing(listing, 'x')}
                            title="Share on X"
                            aria-label={`Share ${listing.title} on X`}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-900"
                          >
                            <Share2 className="h-3 w-3" /> X
                          </button>
                        </div>
                      )}
                      {barterErrors[listing.id] && (
                        <p role="alert" className="max-w-40 text-right text-[10px] text-terracotta-600">
                          {barterErrors[listing.id]}
                        </p>
                      )}
                      {auctionActionErrors[listing.id] && (
                        <p role="alert" className="max-w-40 text-right text-[10px] text-terracotta-600">
                          {auctionActionErrors[listing.id]}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Seller transaction history */}
        <div className="lg:col-span-1">
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 p-4">
              <div>
                <h2 className="text-sm font-medium text-ink-900">Transaction History</h2>
                <p className="text-xs text-ink-500">{orderCount} total orders</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Filter seller transactions by status"
                  value={orderStatusFilter}
                  onChange={(event) => {
                    setOrderStatusFilter(event.target.value);
                    setOrderPage(0);
                  }}
                  className="input-field w-auto py-1.5 text-xs"
                >
                  <option value="all">All statuses</option>
                  {['pending_payment', 'payment_expired', 'escrow_held', 'shipped', 'delivered', 'completed', 'disputed', 'refunded'].map((status) => (
                    <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setLockerQrMessage(null);
                    setLockerQrScannerOpen(true);
                  }}
                  className="btn-secondary inline-flex items-center gap-1 px-2 py-1.5 text-xs"
                >
                  <Camera className="h-3.5 w-3.5" /> Scan QR
                </button>
              </div>
            </div>
            {boutique && (
              <section className="border-b border-ink-100 bg-ink-50/50 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-medium text-ink-900">Your delivery drivers</h3>
                  <p className="mt-1 text-xs text-ink-500">
                    Invite a new driver or link an existing courier account. Only your active drivers can be assigned to your orders.
                  </p>
                </div>
                <form onSubmit={(event) => void inviteCourier(event)} className="grid gap-2 sm:grid-cols-2">
                  <input
                    value={courierInviteName}
                    onChange={(event) => setCourierInviteName(event.target.value)}
                    placeholder="Driver's name"
                    aria-label="Driver name"
                    minLength={2}
                    maxLength={80}
                    required
                    className="input-field text-xs"
                  />
                  <input
                    type="email"
                    value={courierInviteEmail}
                    onChange={(event) => setCourierInviteEmail(event.target.value)}
                    placeholder="Driver's email"
                    aria-label="Driver email"
                    maxLength={254}
                    required
                    className="input-field text-xs"
                  />
                  <button
                    type="submit"
                    disabled={courierInviteLoading || courierManagementLoading}
                    className="btn-primary text-xs"
                  >
                    {courierInviteLoading ? 'Sending invite…' : 'Invite a new driver'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void linkExistingCourier()}
                    disabled={courierInviteLoading || courierManagementLoading || !courierInviteEmail.trim()}
                    className="btn-secondary text-xs"
                  >
                    Link existing courier by email
                  </button>
                </form>
                {courierManagementError && (
                  <p role="alert" className="mt-3 rounded-lg bg-terracotta-50 p-2 text-xs text-terracotta-700">
                    {courierManagementError}
                  </p>
                )}
                {courierManagementMessage && (
                  <p role="status" className="mt-3 rounded-lg bg-sage-50 p-2 text-xs text-sage-700">
                    {courierManagementMessage}
                  </p>
                )}
                <div className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-100 bg-white">
                  {courierManagementLoading ? (
                    <p className="p-3 text-xs text-ink-500">Loading drivers…</p>
                  ) : sellerCouriers.length === 0 ? (
                    <p className="p-3 text-xs text-ink-500">No drivers are linked to your boutique yet.</p>
                  ) : sellerCouriers.map((courier) => (
                    <div key={courier.courier_id} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink-800">{courier.display_name || 'Unnamed driver'}</p>
                        <p className="text-[10px] text-ink-500">
                          {courier.account_role === 'courier' && courier.account_status === 'active'
                            ? courier.is_active ? 'Ready for assignments' : 'Paused'
                            : 'Account unavailable'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleCourierActive(courier)}
                        disabled={courier.account_role !== 'courier' || courier.account_status !== 'active'}
                        className="btn-secondary shrink-0 px-2 py-1 text-[10px]"
                      >
                        {courier.is_active ? 'Pause' : 'Reactivate'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
            {orderLoadError && <p role="alert" className="border-b border-terracotta-100 bg-terracotta-50 p-3 text-xs text-terracotta-700">{orderLoadError}</p>}
            {courierInfoError && <p role="alert" className="border-b border-terracotta-100 bg-terracotta-50 p-3 text-xs text-terracotta-700">{courierInfoError}</p>}
            {salesSummaryError && <p role="alert" className="border-b border-terracotta-100 bg-terracotta-50 p-3 text-xs text-terracotta-700">{salesSummaryError}</p>}
            {lockerQrMessage && <p role="status" className="border-b border-sage-100 bg-sage-50 p-3 text-xs text-sage-700">{lockerQrMessage}</p>}
            <div className="divide-y divide-ink-100">
              {orderLoading ? (
                <div className="p-6 text-center text-xs text-ink-500">Loading transactions…</div>
              ) : orders.length === 0 ? (
                <div className="p-6 text-center">
                  <Clock className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  <p className="text-xs text-ink-500">{orderCount === 0 ? 'No orders match this filter.' : 'No more transactions on this page.'}</p>
                </div>
              ) : (
                orders.map((order) => (
                  <div key={order.id} className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-ink-900">{formatPrice(Number(order.amount))}</p>
                      <span className={cn(
                        'badge text-[10px]',
                        order.status === 'escrow_held' ? 'bg-gold-50 text-gold-700' :
                        order.status === 'completed' ? 'bg-sage-50 text-sage-700' :
                        'bg-ink-50 text-ink-600'
                      )}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-ink-600 truncate">
                      {order.listings?.title || 'Item'}
                    </p>
                    <p className="text-xs text-ink-600 truncate">
                      Buyer: {order.profiles?.display_name || `Buyer ${order.buyer_id.slice(0, 8)}`}
                    </p>
                    {order.payment_is_simulated && (
                      <p className="mt-1 text-[10px] font-medium text-gold-700">
                        GCash demo — no payment collected
                      </p>
                    )}
                    {order.payment_method === 'cash_on_delivery' && (
                      <p className="mt-1 text-[10px] font-medium text-blue-700">
                        {order.delivery_method === 'courier'
                          ? `The assigned courier collects ${formatPrice(Number(order.amount))} from the buyer.`
                          : `Collect ${formatPrice(Number(order.amount))} when the buyer receives the item.`}
                      </p>
                    )}
                    <p className="text-xs text-ink-400">{formatTimeAgo(order.created_at)}</p>
                    {order.status === 'escrow_held' && order.delivery_method === 'locker' && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void markLockerOrderDroppedOff(order);
                        }}
                        className="mt-3 space-y-2"
                      >
                        <p className="text-xs text-ink-500">Enter the buyer’s PIN or scan their QR code after placing the item in the selected locker.</p>
                        <div className="flex gap-2">
                          <input
                            value={lockerPins[order.id] || ''}
                            onChange={(event) => setLockerPins((current) => ({ ...current, [order.id]: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                            placeholder="6-digit PIN"
                            aria-label="Buyer locker handoff PIN"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            required
                            className="input-field min-w-0 flex-1 text-xs font-mono"
                          />
                          <button
                            type="submit"
                            disabled={orderActionLoading === order.id}
                            className="btn-secondary shrink-0 px-2 text-xs inline-flex items-center gap-1"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            {orderActionLoading === order.id ? 'Saving…' : 'Confirm drop-off'}
                          </button>
                        </div>
                        {orderActionErrors[order.id] && (
                          <p role="alert" className="text-xs text-terracotta-600">{orderActionErrors[order.id]}</p>
                        )}
                      </form>
                    )}
                    {order.delivery_method === 'courier' && (
                      <div className="mt-3 rounded-lg border border-sage-200 bg-sage-50 p-3">
                        <p className="text-xs font-medium text-sage-900">
                          Delivery progress: {courierDeliveryProgress[order.id]?.status.replace(/_/g, ' ') || 'waiting for driver assignment'}
                        </p>
                        {order.status === 'escrow_held'
                          && (!courierDeliveryProgress[order.id]
                            || ['assigned', 'accepted', 'cancelled'].includes(courierDeliveryProgress[order.id].status)) && (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void assignSellerCourier(order);
                            }}
                            className="mt-2 flex flex-col gap-2 sm:flex-row"
                          >
                            <select
                              aria-label={`Driver for ${order.listings?.title || 'order'}`}
                              value={selectedCourierIds[order.id] || courierDeliveryProgress[order.id]?.courier_id || ''}
                              onChange={(event) => setSelectedCourierIds((current) => ({
                                ...current,
                                [order.id]: event.target.value,
                              }))}
                              required
                              className="input-field min-w-0 flex-1 text-xs"
                            >
                              <option value="">Choose one of your drivers</option>
                              {sellerCouriers
                                .filter((courier) => courier.account_role === 'courier'
                                  && courier.account_status === 'active'
                                  && courier.is_active)
                                .map((courier) => (
                                  <option key={courier.courier_id} value={courier.courier_id}>
                                    {courier.display_name}
                                  </option>
                                ))}
                            </select>
                            <button
                              type="submit"
                              disabled={orderActionLoading === order.id || !sellerCouriers.some((courier) =>
                                courier.account_role === 'courier'
                                && courier.account_status === 'active'
                                && courier.is_active)}
                              className="btn-primary shrink-0 text-xs"
                            >
                              {orderActionLoading === order.id
                                ? 'Assigning…'
                                : courierDeliveryProgress[order.id] ? 'Change driver' : 'Assign driver'}
                            </button>
                          </form>
                        )}
                        {order.status === 'escrow_held' && !courierDeliveryProgress[order.id]
                          && !sellerCouriers.some((courier) => courier.account_role === 'courier'
                            && courier.account_status === 'active'
                            && courier.is_active) && (
                          <p className="mt-2 text-xs text-sage-800">Invite or link an active driver above to assign this delivery.</p>
                        )}
                        {orderActionErrors[order.id] && (
                          <p role="alert" className="mt-2 text-xs text-terracotta-700">{orderActionErrors[order.id]}</p>
                        )}
                        {courierDeliveryProgress[order.id]?.tracking_code && (
                          <p className="mt-1 font-mono text-[10px] text-sage-700">
                            Tracking: {courierDeliveryProgress[order.id].tracking_code}
                          </p>
                        )}
                        {courierDeliveryProgress[order.id]?.events.length > 0 && (
                          <ol className="mt-2 space-y-1 border-t border-sage-200 pt-2">
                            {courierDeliveryProgress[order.id].events.map((event) => (
                              <li key={event.id} className="text-[10px] text-sage-800">
                                {event.event_type.replace(/_/g, ' ')} · {new Date(event.created_at).toLocaleString()}
                              </li>
                            ))}
                          </ol>
                        )}
                        {courierPickupInfos[order.id] ? (
                          <div className="mt-2 border-t border-sage-200 pt-2">
                            <p className="text-xs font-medium text-sage-900">
                              Driver assigned: {courierPickupInfos[order.id].courier_name}
                            </p>
                            <p className="mt-1 text-xs text-sage-800">
                              Give the courier this pickup code in person when handing over the parcel:
                              <span className="ml-1 font-mono font-bold tracking-wider">{courierPickupInfos[order.id].pickup_code}</span>
                            </p>
                          </div>
                        ) : order.status === 'escrow_held' && !courierDeliveryProgress[order.id] ? (
                          <p className="mt-2 text-xs text-sage-800">Waiting for you to assign one of your active drivers.</p>
                        ) : null}
                      </div>
                    )}
                    {order.status === 'escrow_held' && order.delivery_method !== 'locker' && order.delivery_method !== 'courier' && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void markOrderShipped(order);
                        }}
                        className="mt-3 space-y-2"
                      >
                        <div className="flex gap-2">
                          <input
                            value={trackingNumbers[order.id] || ''}
                            onChange={(event) => setTrackingNumbers((current) => ({ ...current, [order.id]: event.target.value }))}
                            placeholder="Tracking number"
                            aria-label="Shipment tracking number"
                            maxLength={200}
                            required
                            className="input-field min-w-0 flex-1 text-xs"
                          />
                          <button
                            type="submit"
                            disabled={orderActionLoading === order.id}
                            className="btn-secondary shrink-0 px-2 text-xs inline-flex items-center gap-1"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            {orderActionLoading === order.id ? 'Saving…' : 'Mark shipped'}
                          </button>
                        </div>
                        {orderActionErrors[order.id] && (
                          <p role="alert" className="text-xs text-terracotta-600">{orderActionErrors[order.id]}</p>
                        )}
                      </form>
                    )}
                    {order.status === 'completed' && (
                      <div className="mt-3 border-t border-ink-100 pt-3">
                        {reviewedBuyerOrderIds.includes(order.id) ? (
                          <p className="text-xs text-sage-700">Buyer feedback submitted for this completed order.</p>
                        ) : (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitBuyerReview(order);
                            }}
                            className="space-y-2"
                          >
                            <div>
                              <p className="text-xs font-medium text-ink-800">Rate this buyer</p>
                              <p className="text-[10px] text-ink-500">Only available after a completed order.</p>
                            </div>
                            <div className="flex" role="group" aria-label="Buyer rating">
                              {[1, 2, 3, 4, 5].map((rating) => (
                                <button
                                  key={rating}
                                  type="button"
                                  onClick={() => setBuyerReviewRatings((current) => ({ ...current, [order.id]: rating }))}
                                  aria-label={`${rating} stars for buyer`}
                                  className="p-0.5"
                                >
                                  <Star className={`h-4 w-4 ${rating <= (buyerReviewRatings[order.id] || 5) ? 'fill-gold-500 text-gold-500' : 'text-ink-200'}`} />
                                </button>
                              ))}
                            </div>
                            <textarea
                              value={buyerReviewBodies[order.id] || ''}
                              onChange={(event) => setBuyerReviewBodies((current) => ({ ...current, [order.id]: event.target.value }))}
                              maxLength={2000}
                              placeholder="Optional feedback about the transaction"
                              className="input-field min-h-16 resize-y text-xs"
                            />
                            {buyerReviewErrors[order.id] && <p role="alert" className="text-xs text-terracotta-600">{buyerReviewErrors[order.id]}</p>}
                            <button type="submit" disabled={buyerReviewSubmittingId === order.id} className="btn-secondary text-xs">
                              {buyerReviewSubmittingId === order.id ? 'Submitting…' : 'Submit buyer rating'}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            {orderCount > SELLER_ORDER_PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-ink-100 p-3">
                <button
                  type="button"
                  onClick={() => setOrderPage((page) => Math.max(0, page - 1))}
                  disabled={orderPage === 0 || orderLoading}
                  className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="text-xs text-ink-500">Page {orderPage + 1} of {Math.ceil(orderCount / SELLER_ORDER_PAGE_SIZE)}</span>
                <button
                  type="button"
                  onClick={() => setOrderPage((page) => page + 1)}
                  disabled={(orderPage + 1) * SELLER_ORDER_PAGE_SIZE >= orderCount || orderLoading}
                  className="btn-secondary px-2 py-1 text-xs disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="card p-4 mt-4">
            <h3 className="text-sm font-medium text-ink-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <button onClick={() => navigate({ name: 'sell' })} className="w-full flex items-center gap-2 p-2.5 rounded-lg hover:bg-ink-50 transition-colors text-sm text-ink-700">
                <Plus className="w-4 h-4" /> Add new product
              </button>
              <button onClick={() => navigate({ name: 'boutique', slug: boutique.slug })} className="w-full flex items-center gap-2 p-2.5 rounded-lg hover:bg-ink-50 transition-colors text-sm text-ink-700">
                <Eye className="w-4 h-4" /> View your boutique
              </button>
              <button onClick={() => setEditingSellerProfile(true)} className="w-full flex items-center gap-2 p-2.5 rounded-lg hover:bg-ink-50 transition-colors text-sm text-ink-700">
                <Store className="w-4 h-4" /> Edit seller profile
              </button>
              <button onClick={() => navigate({ name: 'orders' })} className="w-full flex items-center gap-2 p-2.5 rounded-lg hover:bg-ink-50 transition-colors text-sm text-ink-700">
                <Package className="w-4 h-4" /> View my purchases
              </button>
            </div>
          </div>
        </div>
      </div>
      {editingSellerProfile && user && profile && boutique.seller_id === user.id && (
        <SellerProfileEditor
          userId={user.id}
          profile={profile}
          boutique={boutique}
          onClose={() => setEditingSellerProfile(false)}
          onBoutiqueSaved={setBoutique}
        />
      )}
      {selectedAuction && (
        <SellerLiveAuctionBiddersModal
          open={Boolean(selectedAuction)}
          listingId={selectedAuction.id}
          listingTitle={selectedAuction.title}
          onClose={() => setSelectedAuction(null)}
        />
      )}
      {lockerQrScannerOpen && (
        <LockerQrScanner onScan={handleLockerQrScan} onClose={() => setLockerQrScannerOpen(false)} />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: 'sage' | 'ink' | 'gold' | 'terracotta' }) {
  const colors = {
    sage: 'bg-sage-50 text-sage-700',
    ink: 'bg-ink-100 text-ink-700',
    gold: 'bg-gold-50 text-gold-700',
    terracotta: 'bg-terracotta-50 text-terracotta-700',
  };
  return (
    <div className="card p-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colors[color])}>
        {icon}
      </div>
      <p className="font-serif text-xl font-bold text-ink-900">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}
