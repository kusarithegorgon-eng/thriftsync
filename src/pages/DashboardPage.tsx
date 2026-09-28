import { useEffect, useState } from 'react';
import { TrendingUp, Package, DollarSign, Eye, Gavel, Plus, ArrowRight, Clock } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Listing, type Boutique, type Order } from '@/lib/supabase';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';

export function DashboardPage() {
  const { navigate } = useRouter();
  const { user, profile, loading: authLoading } = useAuth();
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

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
          .select('*')
          .eq('boutique_id', (boutiqueData as Boutique).id)
          .order('created_at', { ascending: false })
          .limit(10);
        setOrders((orderData as Order[]) || []);
      }

      setLoading(false);
    }
    if (!authLoading) load();
  }, [user, authLoading]);

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
                    <p className="text-sm font-semibold text-ink-900 shrink-0">{formatPrice(Number(listing.price))}</p>
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
                    <p className="text-xs text-ink-400">{formatTimeAgo(order.created_at)}</p>
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
                <Plus className="w-4 h-4" /> Add new listing
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
