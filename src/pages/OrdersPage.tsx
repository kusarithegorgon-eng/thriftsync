import { useEffect, useState } from 'react';
import { Package, Truck, CheckCircle, CheckCircle2, Clock, KeyRound, Star } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Order, type Listing, type Boutique, type LockerHandoff, type LockerLocation } from '@/lib/supabase';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';

type OrderWithDetails = Order & {
  listings: Pick<Listing, 'id' | 'title' | 'images'> | null;
  boutiques: Pick<Boutique, 'id' | 'name' | 'slug'> | null;
};

export function OrdersPage() {
  const { navigate } = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deliveryActionId, setDeliveryActionId] = useState<string | null>(null);
  const [deliveryErrors, setDeliveryErrors] = useState<Record<string, string>>({});
  const [lockerPins, setLockerPins] = useState<Record<string, string>>({});
  const [pinGeneratingOrderId, setPinGeneratingOrderId] = useState<string | null>(null);
  const [lockerHandoffs, setLockerHandoffs] = useState<Record<string, LockerHandoff>>({});
  const [lockerLocations, setLockerLocations] = useState<Record<string, LockerLocation>>({});
  const [reviewedOrderIds, setReviewedOrderIds] = useState<string[]>([]);
  const [reviewRatings, setReviewRatings] = useState<Record<string, { accuracy: number; communication: number; punctuality: number }>>({});
  const [reviewBodies, setReviewBodies] = useState<Record<string, string>>({});
  const [reviewSubmittingId, setReviewSubmittingId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('orders')
        .select('*, listings(id, title, images), boutiques(id, name, slug)')
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
  }, [user, authLoading]);

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
                    <OrderStatusBadge status={order.status} />
                    <span className="text-xs text-ink-400">{formatTimeAgo(order.created_at)}</span>
                  </div>
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
                <StatusStep icon={<Truck className="w-3.5 h-3.5" />} label={order.delivery_method === 'locker' ? 'At locker' : 'Shipped'} active={['shipped', 'delivered', 'completed'].includes(order.status)} />
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
              {order.status === 'shipped' && order.delivery_method !== 'locker' && (
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

function OrderStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    escrow_held: { label: 'In Escrow', className: 'bg-gold-50 text-gold-700 border border-gold-200' },
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
