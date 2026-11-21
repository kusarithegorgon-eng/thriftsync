import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Package, Truck, CheckCircle, CheckCircle2, Clock, KeyRound, Star, Gavel, MessageCircle } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { DeliveryChatDrawer } from '@/components/DeliveryChatDrawer';
import { DeliveryProofImage } from '@/components/DeliveryProofImage';
import {
  supabase,
  type Order,
  type Listing,
  type Boutique,
  type LockerHandoff,
  type LockerLocation,
  type DeliveryJobEvent,
} from '@/lib/supabase';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';
import { cancelPaymongoCheckout, confirmPaymongoCheckout, createAuctionPaymongoCheckout } from '@/lib/paymongo';

type OrderWithDetails = Order & {
  listings: Pick<Listing, 'id' | 'title' | 'images' | 'listing_type'> | null;
  boutiques: Pick<Boutique, 'id' | 'name' | 'slug'> | null;
};
type BuyerCourierProgress = {
  delivery_job_id: string;
  status: string;
  tracking_code: string;
  delivery_proof_path: string | null;
  delivery_code: string | null;
  events: Pick<DeliveryJobEvent, 'id' | 'event_type' | 'created_at'>[];
};

const AUCTION_PAYMENT_SESSION_KEY = 'thriftsync-auction-payment-session';

export function OrdersPage() {
  const { navigate } = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deliveryRealtimeWarning, setDeliveryRealtimeWarning] = useState<string | null>(null);
  const [deliveryRefresh, setDeliveryRefresh] = useState(0);
  const [deliveryActionId, setDeliveryActionId] = useState<string | null>(null);
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string>>({});
  const [lockerPins, setLockerPins] = useState<Record<string, string>>({});
  const [pinGeneratingOrderId, setPinGeneratingOrderId] = useState<string | null>(null);
  const [lockerHandoffs, setLockerHandoffs] = useState<Record<string, LockerHandoff>>({});
  const [lockerLocations, setLockerLocations] = useState<Record<string, LockerLocation>>({});
  const [courierProgress, setCourierProgress] = useState<Record<string, BuyerCourierProgress>>({});
  const [reviewedOrderIds, setReviewedOrderIds] = useState<string[]>([]);
  const [reviewRatings, setReviewRatings] = useState<Record<string, { accuracy: number; communication: number; punctuality: number }>>({});
  const [reviewBodies, setReviewBodies] = useState<Record<string, string>>({});
  const [reviewSubmittingId, setReviewSubmittingId] = useState<string | null>(null);
  const [auctionPaymentLoadingId, setAuctionPaymentLoadingId] = useState<string | null>(null);
  const [auctionPaymentErrors, setAuctionPaymentErrors] = useState<Record<string, string>>({});
  const auctionPaymentReturnHandled = useRef(false);

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('orders')
        .select('*, listings(id, title, images, listing_type), boutiques(id, name, slug)')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });

      if (error) {
        setLoadError(`Could not load your orders: ${error.message}`);
        setLoading(false);
        return;
      }
      setOrders((data as OrderWithDetails[]) || []);
      const orderIds = (data || []).map((order) => order.id);
      if (orderIds.length > 0) {
        const courierOrderIds = ((data || []) as OrderWithDetails[])
          .filter((order) => order.delivery_method === 'courier')
          .map((order) => order.id);
        if (courierOrderIds.length > 0) {
          const { data: jobData, error: jobError } = await supabase
            .from('delivery_jobs')
            .select('id, order_id, status, tracking_code, delivery_proof_path')
            .in('order_id', courierOrderIds);
          if (jobError) {
            setLoadError(`Could not load courier tracking: ${jobError.message}`);
          } else {
            const jobs = (jobData || []) as {
              id: string; order_id: string; status: string; tracking_code: string; delivery_proof_path: string | null;
            }[];
            const { data: eventData, error: eventError } = jobs.length > 0
              ? await supabase
                .from('delivery_job_events')
                .select('id, delivery_job_id, event_type, created_at')
                .in('delivery_job_id', jobs.map((job) => job.id))
                .order('created_at', { ascending: true })
              : { data: [], error: null };
            if (eventError) {
              setLoadError(`Could not load courier delivery history: ${eventError.message}`);
            }
            const eventsByJob = new Map<string, BuyerCourierProgress['events']>();
            (eventData || []).forEach((event) => {
              const events = eventsByJob.get(event.delivery_job_id) || [];
              events.push(event as BuyerCourierProgress['events'][number]);
              eventsByJob.set(event.delivery_job_id, events);
            });
            const codeResults = await Promise.all(jobs.map(async (job) => {
              const order = ((data || []) as OrderWithDetails[]).find((item) => item.id === job.order_id);
              if (order?.status !== 'shipped') return { orderId: job.order_id, deliveryCode: null, error: null };
              const result = await supabase.rpc('get_buyer_delivery_code', { p_order_id: job.order_id });
              return {
                orderId: job.order_id,
                deliveryCode: (result.data as { delivery_code: string }[] | null)?.[0]?.delivery_code || null,
                error: result.error,
              };
            }));
            const codeError = codeResults.find((result) => result.error)?.error;
            if (codeError) setLoadError(`Could not load your courier delivery code: ${codeError.message}`);
            const progress: Record<string, BuyerCourierProgress> = {};
            jobs.forEach((job) => {
              progress[job.order_id] = {
                delivery_job_id: job.id,
                status: job.status,
                tracking_code: job.tracking_code,
                delivery_proof_path: job.delivery_proof_path,
                delivery_code: codeResults.find((result) => result.orderId === job.order_id)?.deliveryCode || null,
                events: eventsByJob.get(job.id) || [],
              };
            });
            setCourierProgress(progress);
          }
        } else {
          setCourierProgress({});
        }
        const { data: reviews, error: reviewsError } = await supabase
          .from('seller_reviews')
          .select('order_id')
          .in('order_id', orderIds);
        if (reviewsError) {
          setLoadError(`Could not load your seller reviews: ${reviewsError.message}`);
        } else {
          setReviewedOrderIds((reviews || []).map((review) => review.order_id));
        }
        const { data: handoffData, error: handoffError } = await supabase
          .from('locker_handoffs')
          .select('*')
          .in('order_id', orderIds);
        if (handoffError) {
          setLoadError(`Could not load locker handoff details: ${handoffError.message}`);
        }
        const handoffMap: Record<string, LockerHandoff> = {};
        (handoffData as LockerHandoff[] || []).forEach((handoff) => {
          if (handoff.order_id) handoffMap[handoff.order_id] = handoff;
        });
        setLockerHandoffs(handoffMap);

        const lockerIds = [...new Set(Object.values(handoffMap).map((handoff) => handoff.locker_location_id))];
        if (lockerIds.length > 0) {
          const { data: lockerData, error: lockerError } = await supabase
            .from('locker_locations')
            .select('*')
            .in('id', lockerIds);
          if (lockerError) {
            setLoadError(`Could not load locker locations: ${lockerError.message}`);
          }
          const locationMap: Record<string, LockerLocation> = {};
          (lockerData as LockerLocation[] || []).forEach((locker) => { locationMap[locker.id] = locker; });
          setLockerLocations(locationMap);
        }
      }
      setLoading(false);
    }
    if (!authLoading) load();
  }, [user, authLoading, deliveryRefresh]);

  useEffect(() => {
    if (!user || authLoading) return undefined;

    const channel = supabase
      .channel(`buyer-delivery-progress-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'delivery_jobs',
      }, () => { setDeliveryRefresh((current) => current + 1); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setDeliveryRealtimeWarning('Live delivery updates are unavailable. Refresh My Orders to check for changes.');
        } else if (status === 'SUBSCRIBED') {
          setDeliveryRealtimeWarning(null);
        }
      });

    return () => { void supabase.removeChannel(channel); };
  }, [authLoading, user]);

  useEffect(() => {
    if (!user || auctionPaymentReturnHandled.current) return;
    const query = new URLSearchParams(window.location.hash.split('?')[1] || '');
    const paymentStatus = query.get('auction_payment');
    if (paymentStatus !== 'success' && paymentStatus !== 'cancel') return;

    auctionPaymentReturnHandled.current = true;
    let session: { order_id: string; checkout_session_id: string } | null = null;
    try {
      const saved = sessionStorage.getItem(AUCTION_PAYMENT_SESSION_KEY);
      session = saved ? JSON.parse(saved) as { order_id: string; checkout_session_id: string } : null;
    } catch {
      session = null;
    }

    if (!session?.order_id || !session.checkout_session_id) {
      setLoadError('Could not verify the auction payment session. Open My Orders and refresh the order status.');
      return;
    }

    void (async () => {
      setAuctionPaymentErrors((current) => ({ ...current, [session!.order_id]: '' }));
      try {
        if (paymentStatus === 'cancel') {
          const result = await cancelPaymongoCheckout(session.checkout_session_id);
          if (result.order_already_created && result.order_ids?.includes(session.order_id)) {
            setOrders((current) => current.map((order) => order.id === session!.order_id
              ? { ...order, status: 'escrow_held', payment_method: 'paymongo', payment_due_at: null, paid_at: new Date().toISOString() }
              : order));
          } else {
            setAuctionPaymentErrors((current) => ({
              ...current,
              [session!.order_id]: 'Payment was cancelled. You can try again before the deadline.',
            }));
          }
          sessionStorage.removeItem(AUCTION_PAYMENT_SESSION_KEY);
          return;
        }

        const result = await confirmPaymongoCheckout(session.checkout_session_id);
        sessionStorage.removeItem(AUCTION_PAYMENT_SESSION_KEY);
        setOrders((current) => current.map((order) => result.order_ids?.includes(order.id)
          ? { ...order, status: 'escrow_held', payment_method: 'paymongo', payment_due_at: null, paid_at: new Date().toISOString() }
          : order));
      } catch (error) {
        setAuctionPaymentErrors((current) => ({
          ...current,
          [session!.order_id]: error instanceof Error ? error.message : 'Could not verify the auction payment.',
        }));
      }
    })();
  }, [user]);

  async function payAuctionOrder(order: OrderWithDetails) {
    setAuctionPaymentLoadingId(order.id);
    setAuctionPaymentErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}#/orders`;
      const checkout = await createAuctionPaymongoCheckout({
        order_id: order.id,
        success_url: `${returnUrl}?auction_payment=success`,
        cancel_url: `${returnUrl}?auction_payment=cancel`,
      });
      sessionStorage.setItem(AUCTION_PAYMENT_SESSION_KEY, JSON.stringify({
        order_id: order.id,
        checkout_session_id: checkout.checkout_session_id,
      }));
      window.location.assign(checkout.checkout_url);
    } catch (error) {
      setAuctionPaymentErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not start auction payment.',
      }));
      setAuctionPaymentLoadingId(null);
    }
  }

  async function confirmDelivery(orderId: string) {
    setDeliveryActionId(orderId);
    setDeliveryErrors((current) => ({ ...current, [orderId]: '' }));
    try {
      const { error } = await supabase.rpc('confirm_order_delivered', { p_order_id: orderId });
      if (error) throw error;
      setOrders((current) => current.map((order) => order.id === orderId
        ? { ...order, status: 'delivered' }
        : order));
    } catch (error) {
      setDeliveryErrors((current) => ({
        ...current,
        [orderId]: error instanceof Error ? error.message : 'Could not confirm delivery.',
      }));
    } finally {
      setDeliveryActionId(null);
    }
  }

  async function submitSellerReview(order: OrderWithDetails) {
    const ratings = reviewRatings[order.id] || { accuracy: 5, communication: 5, punctuality: 5 };
    setReviewSubmittingId(order.id);
    setDeliveryErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      if (order.status === 'delivered') {
        const { data, error } = await supabase.rpc('complete_order', { p_order_id: order.id });
        if (error) throw error;
        const result = data?.[0];
        if (!result?.success) throw new Error(result?.message || 'Could not complete the order.');
      }

      const { error } = await supabase.rpc('submit_seller_review', {
        p_order_id: order.id,
        p_accuracy_rating: ratings.accuracy,
        p_communication_rating: ratings.communication,
        p_punctuality_rating: ratings.punctuality,
        p_body: reviewBodies[order.id]?.trim() || null,
      });
      if (error) throw error;
      setReviewedOrderIds((current) => [...current, order.id]);
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: 'completed' } : item));
    } catch (error) {
      setDeliveryErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not submit the seller review.',
      }));
    } finally {
      setReviewSubmittingId(null);
    }
  }

  async function confirmLockerPickup(orderId: string) {
    const pin = lockerPins[orderId]?.trim();
    if (!pin || !/^\d{6}$/.test(pin)) {
      setDeliveryErrors((current) => ({ ...current, [orderId]: 'Enter the 6-digit PIN shown for this order.' }));
      return;
    }
    setDeliveryActionId(orderId);
    setDeliveryErrors((current) => ({ ...current, [orderId]: '' }));
    try {
      const { data, error } = await supabase.rpc('confirm_order_locker_pickup', {
        p_order_id: orderId,
        p_pin_code: pin,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not confirm locker pickup.');
      setOrders((current) => current.map((order) => order.id === orderId
        ? { ...order, status: 'delivered' }
        : order));
      setLockerHandoffs((current) => ({
        ...current,
        [orderId]: { ...current[orderId], status: 'PICKED_UP', picked_up_at: new Date().toISOString() },
      }));
      setLockerPins((current) => ({ ...current, [orderId]: '' }));
    } catch (error) {
      setDeliveryErrors((current) => ({
        ...current,
        [orderId]: error instanceof Error ? error.message : 'Could not confirm locker pickup.',
      }));
    } finally {
      setDeliveryActionId(null);
    }
  }

  async function regenerateLockerPin(order: OrderWithDetails) {
    if (!order.locker_location_id || order.status !== 'escrow_held') return;
    if (!user) return;
    const lockerLocationId = order.locker_location_id;
    const userId = user.id;
    setPinGeneratingOrderId(order.id);
    setDeliveryErrors((current) => ({ ...current, [order.id]: '' }));
    try {
      const { data, error } = await supabase.rpc('generate_handoff_pin', {
        p_locker_location_id: lockerLocationId,
        p_order_id: order.id,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error('Could not generate a new locker PIN.');
      setLockerHandoffs((current) => ({
        ...current,
        [order.id]: {
          id: result.handoff_id,
          locker_location_id: lockerLocationId,
          order_id: order.id,
          user_id: userId,
          pin_code: result.pin_code,
          status: 'PENDING',
          drop_off_window_start: new Date().toISOString(),
          drop_off_window_end: result.expires_at,
          dropped_off_at: null,
          picked_up_at: null,
          created_at: new Date().toISOString(),
        },
      }));
    } catch (error) {
      setDeliveryErrors((current) => ({
        ...current,
        [order.id]: error instanceof Error ? error.message : 'Could not generate a new locker PIN.',
      }));
    } finally {
      setPinGeneratingOrderId(null);
    }
  }

  if (!authLoading && !user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <p className="text-ink-500 mb-4">Sign in to view your orders.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <h1 className="font-serif text-2xl font-bold text-ink-900 mb-1">My Orders</h1>
      <p className="text-sm text-ink-500 mb-6">
        {loading ? 'Loading...' : `${orders.length} order${orders.length !== 1 ? 's' : ''}`}
      </p>
      {loadError && (
        <p role="alert" className="mb-4 rounded-lg border border-terracotta-200 bg-terracotta-50 p-3 text-sm text-terracotta-700">
          {loadError}
        </p>
      )}
      {deliveryRealtimeWarning && (
        <p role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {deliveryRealtimeWarning}
        </p>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="flex gap-4">
                <div className="w-16 h-20 skeleton rounded-lg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/2 skeleton rounded" />
                  <div className="h-3 w-1/4 skeleton rounded" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20">
          <Package className="w-12 h-12 text-ink-300 mx-auto mb-4" />
          <p className="text-ink-500 mb-2">No orders yet</p>
          <button onClick={() => navigate({ name: 'browse' })} className="btn-secondary">Browse Collection</button>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const handoff = lockerHandoffs[order.id];
            const handoffWindowExpired = !!handoff
              && ['PENDING', 'DROPPED_OFF'].includes(handoff.status)
              && !!handoff.drop_off_window_end
              && new Date(handoff.drop_off_window_end) <= new Date();
            const pendingPinExpired = handoff?.status === 'PENDING'
              && handoffWindowExpired;
            return (
            <div key={order.id} className="card p-4">
              <div className="flex gap-4">
                <div className="w-16 h-20 rounded-lg overflow-hidden bg-ink-100 shrink-0">
                  {order.listings?.images && order.listings.images[0] && (
                    <img src={order.listings.images[0]} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => order.listings && navigate({ name: 'listing', id: order.listings.id })}
                    className="text-sm font-medium text-ink-900 hover:text-terracotta-600 transition-colors text-left line-clamp-1"
                  >
                    {order.listings?.title || 'Item'}
                  </button>
                  {order.boutiques && (
                    <button
                      onClick={() => navigate({ name: 'boutique', slug: order.boutiques!.slug })}
                      className="text-xs text-ink-500 hover:text-ink-900 transition-colors"
                    >
                      {order.boutiques.name}
                    </button>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <OrderStatusBadge status={order.status} paymentMethod={order.payment_method} />
                    <span className="text-xs text-ink-400">{formatTimeAgo(order.created_at)}</span>
                  </div>
                  {order.listings?.listing_type === 'auction' && order.status === 'escrow_held' && (
                    <div className="mt-3 rounded-lg border border-sage-200 bg-sage-50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-sage-800">
                        <Gavel className="h-3.5 w-3.5" /> You won this auction
                      </p>
                      <p className="mt-1 text-xs text-sage-700">
                        Your order is ready. Message the seller to arrange delivery or pickup; shipping and locker updates will appear here.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate({ name: 'messages', listingId: order.listing_id })}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sage-800 hover:text-sage-900"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> Contact seller
                      </button>
                    </div>
                  )}
                  {order.listings?.listing_type === 'auction' && order.status === 'pending_payment' && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs font-semibold text-amber-900">Payment required to secure your win</p>
                      <p className="mt-1 text-xs text-amber-800">
                        Pay {formatPrice(Number(order.amount))} by {order.payment_due_at
                          ? new Date(order.payment_due_at).toLocaleString()
                          : 'the 24-hour deadline'}.
                        If unpaid, this order expires and the seller may relist the item.
                      </p>
                      <button
                        type="button"
                        onClick={() => void payAuctionOrder(order)}
                        disabled={auctionPaymentLoadingId === order.id}
                        className="btn-primary mt-2 text-xs"
                      >
                        {auctionPaymentLoadingId === order.id ? 'Opening PayMongo…' : 'Pay with PayMongo'}
                      </button>
                      {auctionPaymentErrors[order.id] && (
                        <p role="alert" className="mt-2 text-xs text-terracotta-700">{auctionPaymentErrors[order.id]}</p>
                      )}
                    </div>
                  )}
                  {order.listings?.listing_type === 'auction' && order.status === 'payment_expired' && (
                    <p className="mt-3 rounded-lg border border-ink-200 bg-ink-50 p-3 text-xs text-ink-600">
                      The 24-hour auction payment window expired. The seller may relist this item.
                    </p>
                  )}
                  {order.payment_is_simulated && (
                    <p className="mt-2 text-xs font-medium text-gold-700">
                      GCash demo only — no payment was collected.
                    </p>
                  )}
                  {order.payment_method === 'cash_on_delivery' && (
                    <p className="mt-2 text-xs font-medium text-ink-600">
                      Pay {formatPrice(Number(order.amount))} directly to {order.delivery_method === 'courier' ? 'the assigned courier' : 'the seller or courier'} when you receive the item. No online payment was collected.
                    </p>
                  )}
                  {order.delivery_method === 'courier' && (
                    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 p-3">
                      <p className="text-xs font-semibold text-sky-900">
                        Courier delivery: {courierProgress[order.id]?.status?.replace(/_/g, ' ') || 'waiting for courier assignment'}
                      </p>
                      {courierProgress[order.id]?.tracking_code && (
                        <p className="mt-1 font-mono text-xs text-sky-800">
                          Tracking: {courierProgress[order.id].tracking_code}
                        </p>
                      )}
                      {courierProgress[order.id]?.delivery_code && (
                        <p className="mt-2 text-xs text-sky-900">
                          When your parcel arrives, share this code with the courier to confirm handoff:
                          <span className="ml-1 font-mono font-bold tracking-wider">{courierProgress[order.id].delivery_code}</span>
                        </p>
                      )}
                      {order.status === 'shipped' && !courierProgress[order.id]?.delivery_code && (
                        <p className="mt-1 text-xs text-sky-800">The courier has your parcel. Your delivery code will appear here when the delivery is underway.</p>
                      )}
                      {courierProgress[order.id]?.events.length > 0 && (
                        <ol className="mt-3 space-y-1 border-t border-sky-200 pt-2">
                          {courierProgress[order.id].events.map((event) => (
                            <li key={event.id} className="text-[11px] text-sky-900">
                              <span className="font-medium">{event.event_type.replace(/_/g, ' ')}</span>
                              <span className="ml-2 text-sky-700">{new Date(event.created_at).toLocaleString()}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {courierProgress[order.id]?.delivery_proof_path && (
                        <DeliveryProofImage path={courierProgress[order.id].delivery_proof_path!} />
                      )}
                      {courierProgress[order.id]?.delivery_job_id && (
                        <DeliveryChatDrawer
                          deliveryJobId={courierProgress[order.id].delivery_job_id}
                          status={courierProgress[order.id].status}
                        />
                      )}
                    </div>
                  )}
                  {order.delivery_method === 'locker' && (
                    <div className="mt-3 rounded-lg bg-ink-50 p-3">
                      <p className="text-xs font-medium text-ink-800">
                        Locker: {lockerLocations[order.locker_location_id || '']?.partner_name || 'Partner locker'}
                      </p>
                      {lockerLocations[order.locker_location_id || '']?.address && (
                        <p className="text-xs text-ink-500">
                          {lockerLocations[order.locker_location_id || ''].address}, {lockerLocations[order.locker_location_id || ''].city_municipality}
                        </p>
                      )}
                      {handoff && ['PENDING', 'DROPPED_OFF'].includes(handoff.status) && !handoffWindowExpired && (
                        <p className="mt-2 text-xs text-ink-600">
                          Give this PIN to the seller for drop-off, then use it to confirm pickup:
                          <span className="ml-1 font-mono font-bold tracking-wider text-ink-900">{handoff.pin_code}</span>
                        </p>
                      )}
                      {handoff?.status === 'PENDING' && !handoffWindowExpired && (
                        <div className="mt-3 flex items-center gap-3">
                          <QRCodeSVG
                            value={JSON.stringify({
                              type: 'thrift-locker-dropoff',
                              orderId: order.id,
                              pin: handoff.pin_code,
                            })}
                            size={112}
                            level="M"
                            title="Locker drop-off QR code"
                          />
                          <p className="max-w-xs text-xs text-ink-500">
                            Show this code to the seller to record the locker drop-off. Keep it private; it can authorize the seller’s drop-off step.
                          </p>
                        </div>
                      )}
                      {handoff?.drop_off_window_end && ['PENDING', 'DROPPED_OFF'].includes(handoff.status) && !handoffWindowExpired && (
                        <p className="mt-1 text-[10px] text-ink-400">
                          PIN expires {new Date(handoff.drop_off_window_end).toLocaleString()}
                        </p>
                      )}
                      {handoff?.status === 'PENDING' && !pendingPinExpired && (
                        <p className="mt-1 text-xs text-gold-700">Waiting for the seller to drop off the item.</p>
                      )}
                      {handoff?.status === 'DROPPED_OFF' && !handoffWindowExpired && (
                        <p className="mt-1 text-xs text-sage-700">Your item is ready for pickup.</p>
                      )}
                      {(handoff?.status === 'EXPIRED' || pendingPinExpired) && order.status === 'escrow_held' && (
                        <div className="mt-2">
                          <p className="text-xs text-terracotta-600 mb-2">The drop-off PIN expired before the seller recorded the deposit.</p>
                          <button
                            type="button"
                            onClick={() => void regenerateLockerPin(order)}
                            disabled={pinGeneratingOrderId === order.id}
                            className="btn-secondary text-xs"
                          >
                            {pinGeneratingOrderId === order.id ? 'Generating…' : 'Generate a new PIN'}
                          </button>
                        </div>
                      )}
                      {(handoff?.status === 'EXPIRED' || handoffWindowExpired) && order.status === 'shipped' && (
                        <p className="mt-2 text-xs text-terracotta-600">The pickup window expired. Contact the seller to arrange retrieval or a new pickup.</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-serif text-lg font-bold text-ink-900">{formatPrice(Number(order.amount))}</p>
                  {order.tracking_number && (
                    <p className="text-xs text-ink-400 font-mono mt-1">{order.tracking_number}</p>
                  )}
                </div>
              </div>

              {/* Status timeline */}
              <div className="flex items-center gap-1 mt-4 pt-3 border-t border-ink-100">
                <StatusStep icon={<CheckCircle className="w-3.5 h-3.5" />} label="Ordered" active={true} />
                <div className="flex-1 h-px bg-ink-200" />
                <StatusStep icon={<Clock className="w-3.5 h-3.5" />} label="Escrow" active={['escrow_held', 'shipped', 'delivered', 'completed'].includes(order.status)} />
                <div className="flex-1 h-px bg-ink-200" />
                <StatusStep icon={<Truck className="w-3.5 h-3.5" />} label={order.delivery_method === 'locker' ? 'At locker' : order.delivery_method === 'courier' ? 'Courier' : 'Shipped'} active={['shipped', 'delivered', 'completed'].includes(order.status)} />
                <div className="flex-1 h-px bg-ink-200" />
                <StatusStep icon={<CheckCircle className="w-3.5 h-3.5" />} label={order.delivery_method === 'locker' ? 'Picked up' : 'Delivered'} active={['delivered', 'completed'].includes(order.status)} />
              </div>
              {order.status === 'shipped' && order.delivery_method === 'locker' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void confirmLockerPickup(order.id);
                  }}
                  className="mt-3 flex flex-col items-end gap-2"
                >
                  {deliveryErrors[order.id] && (
                    <p role="alert" className="text-xs text-terracotta-600">{deliveryErrors[order.id]}</p>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={lockerPins[order.id] || ''}
                      onChange={(event) => setLockerPins((current) => ({ ...current, [order.id]: event.target.value.replace(/\D/g, '').slice(0, 6) }))}
                      placeholder="6-digit PIN"
                      aria-label="Locker pickup PIN"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      className="input-field w-32 text-sm font-mono"
                    />
                    <button
                      type="submit"
                      disabled={deliveryActionId === order.id}
                      className="btn-primary inline-flex items-center gap-2 text-sm"
                    >
                      <KeyRound className="w-4 h-4" />
                      {deliveryActionId === order.id ? 'Confirming…' : 'Confirm locker pickup'}
                    </button>
                  </div>
                </form>
              )}
              {order.status === 'shipped' && order.delivery_method !== 'locker' && order.delivery_method !== 'courier' && (
                <div className="mt-3 flex flex-col items-end gap-2">
                  {deliveryErrors[order.id] && (
                    <p role="alert" className="text-xs text-terracotta-600">{deliveryErrors[order.id]}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void confirmDelivery(order.id)}
                    disabled={deliveryActionId === order.id}
                    className="btn-primary inline-flex items-center gap-2 text-sm"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {deliveryActionId === order.id ? 'Confirming…' : 'Confirm delivery'}
                  </button>
                </div>
              )}
              {['delivered', 'completed'].includes(order.status) && (
                <div className="mt-4 border-t border-ink-100 pt-4">
                  {reviewedOrderIds.includes(order.id) ? (
                    <p className="inline-flex items-center gap-1 text-xs text-sage-700">
                      <CheckCircle2 className="h-4 w-4" /> Seller feedback submitted for this completed order.
                    </p>
                  ) : (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitSellerReview(order);
                      }}
                      className="space-y-3"
                    >
                      <div>
                        <h3 className="text-sm font-medium text-ink-900">Rate your seller</h3>
                        <p className="text-xs text-ink-500">Verified completed orders only. Your ratings help the Cebu vintage community.</p>
                      </div>
                      {([
                        ['accuracy', 'Item accuracy & authenticity'],
                        ['communication', 'Communication speed'],
                        ['punctuality', 'Locker drop-off punctuality'],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-ink-600">{label}</span>
                          <div className="flex" role="group" aria-label={label}>
                            {[1, 2, 3, 4, 5].map((rating) => (
                              <button
                                key={rating}
                                type="button"
                                onClick={() => setReviewRatings((current) => ({
                                  ...current,
                                  [order.id]: { ...(current[order.id] || { accuracy: 5, communication: 5, punctuality: 5 }), [key]: rating },
                                }))}
                                aria-label={`${rating} stars for ${label}`}
                                className="p-0.5"
                              >
                                <Star className={`h-4 w-4 ${rating <= (reviewRatings[order.id]?.[key] || 5) ? 'fill-gold-500 text-gold-500' : 'text-ink-200'}`} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                      <textarea
                        value={reviewBodies[order.id] || ''}
                        onChange={(event) => setReviewBodies((current) => ({ ...current, [order.id]: event.target.value }))}
                        maxLength={2000}
                        placeholder="Optional feedback about your order"
                        className="input-field min-h-[72px] resize-y text-sm"
                      />
                      {deliveryErrors[order.id] && <p role="alert" className="text-xs text-terracotta-600">{deliveryErrors[order.id]}</p>}
                      <button type="submit" disabled={reviewSubmittingId === order.id} className="btn-primary text-xs">
                        {reviewSubmittingId === order.id ? 'Submitting…' : 'Complete order & submit review'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
          })}
        </div>
      )}
    </div>
  );
}

function OrderStatusBadge({ status, paymentMethod }: { status: string; paymentMethod: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending_payment: { label: 'Payment Required', className: 'bg-amber-50 text-amber-800 border border-amber-200' },
    payment_expired: { label: 'Payment Expired', className: 'bg-ink-100 text-ink-600 border border-ink-200' },
    escrow_held: paymentMethod === 'cash_on_delivery'
      ? { label: 'Pay on receipt', className: 'bg-blue-50 text-blue-700 border border-blue-200' }
      : { label: 'In Escrow', className: 'bg-gold-50 text-gold-700 border border-gold-200' },
    shipped: { label: 'Shipped', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
    delivered: { label: 'Delivered', className: 'bg-sage-50 text-sage-700 border border-sage-200' },
    completed: { label: 'Completed', className: 'bg-sage-100 text-sage-800 border border-sage-300' },
    disputed: { label: 'Disputed', className: 'bg-terracotta-50 text-terracotta-700 border border-terracotta-200' },
    refunded: { label: 'Refunded', className: 'bg-ink-100 text-ink-600 border border-ink-200' },
  };
  const c = config[status] || config.escrow_held;
  return <span className={cn('badge', c.className)}>{c.label}</span>;
}

function StatusStep({ icon, label, active }: { icon: React.ReactNode; label: string; active: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div className={cn('w-6 h-6 rounded-full flex items-center justify-center', active ? 'bg-sage-500 text-white' : 'bg-ink-100 text-ink-300')}>
        {icon}
      </div>
      <span className={cn('text-[10px]', active ? 'text-ink-700 font-medium' : 'text-ink-400')}>{label}</span>
    </div>
  );
}
