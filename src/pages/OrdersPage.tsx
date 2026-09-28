import { useEffect, useState } from 'react';
import { Package, Truck, CheckCircle, Clock, AlertCircle, ArrowRight } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Order, type Listing, type Boutique } from '@/lib/supabase';
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

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('orders')
        .select('*, listings(id, title, images), boutiques(id, name, slug)')
        .eq('buyer_id', user.id)
        .order('created_at', { ascending: false });

      setOrders((data as OrderWithDetails[]) || []);
      setLoading(false);
    }
    if (!authLoading) load();
  }, [user, authLoading]);

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
          {orders.map((order) => (
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
                <StatusStep icon={<Truck className="w-3.5 h-3.5" />} label="Shipped" active={['shipped', 'delivered', 'completed'].includes(order.status)} />
                <div className="flex-1 h-px bg-ink-200" />
                <StatusStep icon={<CheckCircle className="w-3.5 h-3.5" />} label="Delivered" active={['delivered', 'completed'].includes(order.status)} />
              </div>
            </div>
          ))}
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
