import { useEffect, useState } from 'react';
import { TrendingUp, Package, DollarSign, Eye, Gavel, Plus, ArrowRight, Clock, Truck, Share2, KeyRound } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Listing, type Boutique, type Order } from '@/lib/supabase';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';

type SellerOrder = Order & { listings: Pick<Listing, 'title'> | null };

export function DashboardPage() {
  const { navigate } = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingNumbers, setTrackingNumbers] = useState<Record<string, string>>({});
  const [lockerPins, setLockerPins] = useState<Record<string, string>>({});
  const [orderActionLoading, setOrderActionLoading] = useState<string | null>(null);
  const [orderActionErrors, setOrderActionErrors] = useState<Record<string, string>>({});

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
        setListings((listingData as Listing[]) || []);

        const { data: orderData } = await supabase
          .from('orders')
          .select('*, listings(title)')
          .eq('boutique_id', (boutiqueData as Boutique).id)
          .order('created_at', { ascending: false })
          .limit(10);
        setOrders((orderData as SellerOrder[]) || []);
      }

      setLoading(false);
    }
    if (!authLoading) load();
  }, [user, authLoading]);

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
  const soldListings = listings.filter((l) => l.status === 'sold');
  const totalViews = listings.reduce((sum, l) => sum + (l.views || 0), 0);
  const gmv = orders.reduce((sum, o) => sum + Number(o.amount), 0);
  const conversionRate = totalViews > 0 ? ((soldListings.length / totalViews) * 100).toFixed(1) : '0';

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">{boutique.name}</h1>
          <p className="text-sm text-ink-500">{boutique.tagline || 'Seller Dashboard'}</p>
        </div>
        <button onClick={() => navigate({ name: 'sell' })} className="btn-primary flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" /> New Listing
        </button>
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
                listings.map((listing) => (
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
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <p className="text-sm font-semibold text-ink-900">{formatPrice(Number(listing.price))}</p>
                      {listing.status === 'active' && (
                        <div className="flex items-center gap-1">
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
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent orders */}
        <div className="lg:col-span-1">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-ink-100">
              <h2 className="text-sm font-medium text-ink-900">Recent Orders</h2>
            </div>
            <div className="divide-y divide-ink-100">
              {orders.length === 0 ? (
                <div className="p-6 text-center">
                  <Clock className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  <p className="text-xs text-ink-500">No orders yet</p>
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
                    <p className="text-xs text-ink-400">{formatTimeAgo(order.created_at)}</p>
                    {order.status === 'escrow_held' && order.delivery_method === 'locker' && (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void markLockerOrderDroppedOff(order);
                        }}
                        className="mt-3 space-y-2"
                      >
                        <p className="text-xs text-ink-500">Enter the PIN provided by the buyer after you place the item in the selected locker.</p>
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
                    {order.status === 'escrow_held' && order.delivery_method !== 'locker' && (
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
                  </div>
                ))
              )}
            </div>
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
              <button onClick={() => navigate({ name: 'orders' })} className="w-full flex items-center gap-2 p-2.5 rounded-lg hover:bg-ink-50 transition-colors text-sm text-ink-700">
                <Package className="w-4 h-4" /> View all orders
              </button>
            </div>
          </div>
        </div>
      </div>
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
