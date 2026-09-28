import { Trash2, ShoppingBag, ArrowRight, Shield } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useCart } from '@/lib/cart';
import { formatPrice } from '@/lib/utils';

export function CartPage() {
  const { navigate } = useRouter();
  const { items, removeFromCart, total, clearCart } = useCart();

  if (items.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ink-100 mb-4">
          <ShoppingBag className="w-8 h-8 text-ink-400" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Your cart is empty</h1>
        <p className="text-sm text-ink-500 mb-6">Discover unique vintage pieces from independent boutiques.</p>
        <button onClick={() => navigate({ name: 'browse' })} className="btn-primary inline-flex items-center gap-2">
          Browse Collection <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <h1 className="font-serif text-2xl font-bold text-ink-900 mb-6">Shopping Cart</h1>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Items */}
        <div className="lg:col-span-2 space-y-3">
          {items.map((item) => (
            <div key={item.listing.id} className="card p-4 flex gap-4">
              <div className="w-24 h-28 rounded-lg overflow-hidden bg-ink-100 shrink-0">
                {item.listing.images && item.listing.images.length > 0 ? (
                  <img src={item.listing.images[0]} alt={item.listing.title} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => navigate({ name: 'listing', id: item.listing.id })}
                  className="text-sm font-medium text-ink-900 hover:text-terracotta-600 transition-colors text-left line-clamp-2"
                >
                  {item.listing.title}
                </button>
                {item.listing.boutiques && (
                  <p className="text-xs text-ink-500 mt-0.5">{item.listing.boutiques.name}</p>
                )}
                <p className="text-lg font-semibold text-ink-900 mt-2">{formatPrice(Number(item.listing.price))}</p>
                <button
                  onClick={() => removeFromCart(item.listing.id)}
                  className="text-xs text-ink-400 hover:text-terracotta-600 transition-colors flex items-center gap-1 mt-2"
                >
                  <Trash2 className="w-3 h-3" /> Remove
                </button>
              </div>
            </div>
          ))}

          <button onClick={clearCart} className="text-xs text-ink-400 hover:text-terracotta-600 transition-colors">
            Clear cart
          </button>
        </div>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="card p-5 sticky top-20">
            <h2 className="text-sm font-medium text-ink-900 mb-4">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-ink-600">
                <span>Subtotal ({items.length} items)</span>
                <span>{formatPrice(total)}</span>
              </div>
              <div className="flex justify-between text-ink-600">
                <span>Shipping</span>
                <span className="text-sage-600">Free</span>
              </div>
              <div className="flex justify-between text-ink-600">
                <span>Platform fee</span>
                <span>$0</span>
              </div>
              <div className="border-t border-ink-100 pt-2 mt-2 flex justify-between font-semibold text-ink-900">
                <span>Total</span>
                <span className="font-serif text-lg">{formatPrice(total)}</span>
              </div>
            </div>

            <button
              onClick={() => navigate({ name: 'checkout' })}
              className="w-full btn-primary mt-4 py-3 flex items-center justify-center gap-2"
            >
              Proceed to Checkout <ArrowRight className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 mt-3 text-xs text-ink-400 justify-center">
              <Shield className="w-3.5 h-3.5" /> Escrow-protected transaction
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
