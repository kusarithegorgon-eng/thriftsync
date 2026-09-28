import { useState } from 'react';
import { Shield, Check, ArrowLeft, Leaf, Truck, Tag, X, AlertCircle } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { supabase, type Voucher } from '@/lib/supabase';
import { formatPrice } from '@/lib/utils';

export function CheckoutPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const { items, total, clearCart, appliedVoucher, discountAmount, setAppliedVoucher, finalTotal } = useCart();
  const [step, setStep] = useState<'shipping' | 'review' | 'complete'>('shipping');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState('United States');
  const [processing, setProcessing] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherLoading, setVoucherLoading] = useState(false);

  const hasAuctionItems = items.some((i) => i.listing.listing_type === 'auction');
  const boutiqueIds = items.map((i) => i.listing.boutique_id).filter(Boolean) as string[];
  const categories = items.map((i) => i.listing.category).filter(Boolean) as string[];

  async function handleApplyVoucher(e: React.FormEvent) {
    e.preventDefault();
    if (!voucherCode.trim()) return;
    setVoucherError(null);
    setVoucherLoading(true);

    if (!user) {
      navigate({ name: 'auth' });
      return;
    }

    const { data, error } = await supabase.rpc('validate_voucher', {
      p_code: voucherCode.trim(),
      p_cart_total: total,
      p_has_auction_items: hasAuctionItems,
      p_boutique_ids: boutiqueIds,
      p_categories: categories,
    });

    if (error) {
      setVoucherError('Could not validate code. Please try again.');
      setVoucherLoading(false);
      return;
    }

    const result = data as any;
    if (!result || !result.valid) {
      setVoucherError(result?.message || 'Invalid code');
      setVoucherLoading(false);
      return;
    }

    const { data: voucherData } = await supabase
      .from('vouchers')
      .select('*')
      .eq('code', result.code)
      .maybeSingle();

    if (voucherData) {
      setAppliedVoucher(voucherData as Voucher, Number(result.discount_amount));
    }
    setVoucherCode('');
    setVoucherLoading(false);
  }

  function handleRemoveVoucher() {
    setAppliedVoucher(null, 0);
  }

  async function handlePlaceOrder() {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }
    setProcessing(true);

    const fullAddress = `${name}, ${address}, ${city} ${zip}, ${country}`;

    for (const item of items) {
      await supabase.from('orders').insert({
        buyer_id: user.id,
        listing_id: item.listing.id,
        boutique_id: item.listing.boutique_id,
        amount: Number(item.listing.price),
        status: 'escrow_held',
        shipping_address: fullAddress,
      });

      await supabase
        .from('listings')
        .update({ status: 'sold' })
        .eq('id', item.listing.id);
    }

    if (appliedVoucher) {
      await supabase.rpc('redeem_voucher', {
        p_code: appliedVoucher.code,
        p_user_id: user.id,
        p_cart_total: total,
      });
    }

    clearCart();
    setProcessing(false);
    setStep('complete');
  }

  if (items.length === 0 && step !== 'complete') {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <p className="text-ink-500 mb-4">Your cart is empty.</p>
        <button onClick={() => navigate({ name: 'browse' })} className="btn-primary">Browse Collection</button>
      </div>
    );
  }

  if (step === 'complete') {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sage-100 mb-4">
          <Check className="w-8 h-8 text-sage-600" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Order Placed Successfully</h1>
        <p className="text-sm text-ink-500 mb-6">
          Your payment is held in escrow and will be released to the seller once you confirm delivery.
        </p>
        <div className="card p-4 max-w-md mx-auto mb-6 text-left">
          <div className="flex items-center gap-2 text-sm text-ink-600 mb-2">
            <Shield className="w-4 h-4 text-sage-600" /> Escrow Active
          </div>
          <p className="text-xs text-ink-500">
            Funds are securely held until you receive your items. You'll have 7 days after delivery to raise any disputes.
          </p>
        </div>
        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate({ name: 'orders' })} className="btn-primary">View Orders</button>
          <button onClick={() => navigate({ name: 'browse' })} className="btn-secondary">Continue Shopping</button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <button onClick={() => navigate({ name: 'cart' })} className="flex items-center gap-1 text-sm text-ink-500 hover:text-ink-900 mb-4 transition-colors">
        <ArrowLeft className="w-4 h-4" /> Back to cart
      </button>

      <h1 className="font-serif text-2xl font-bold text-ink-900 mb-6">Checkout</h1>

      <div className="flex items-center gap-2 mb-8">
        <StepDot active={step === 'shipping'} done={step === 'review'} label="Shipping" />
        <div className="flex-1 h-px bg-ink-200" />
        <StepDot active={step === 'review'} done={false} label="Review" />
        <div className="flex-1 h-px bg-ink-200" />
        <StepDot active={false} done={false} label="Complete" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {step === 'shipping' && (
            <div className="card p-6 animate-slide-down">
              <h2 className="text-sm font-medium text-ink-900 mb-4">Shipping Address</h2>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-ink-700 mb-1.5 block">Full Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-field" required />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-700 mb-1.5 block">Street Address</label>
                  <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="input-field" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1.5 block">City</label>
                    <input type="text" value={city} onChange={(e) => setCity(e.target.value)} className="input-field" required />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1.5 block">ZIP / Postal Code</label>
                    <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} className="input-field" required />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-ink-700 mb-1.5 block">Country</label>
                  <select value={country} onChange={(e) => setCountry(e.target.value)} className="input-field">
                    <option>United States</option>
                    <option>Canada</option>
                    <option>United Kingdom</option>
                    <option>Australia</option>
                  </select>
                </div>
              </div>

              {/* Voucher input */}
              <div className="mt-5 pt-5 border-t border-ink-100">
                <label className="text-xs font-medium text-ink-700 mb-1.5 block flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5" /> Promo Code
                </label>
                {appliedVoucher ? (
                  <div className="flex items-center justify-between p-3 bg-sage-50 rounded-lg border border-sage-200">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-sage-600" />
                      <div>
                        <p className="text-sm font-medium text-sage-800">{appliedVoucher.code}</p>
                        <p className="text-xs text-sage-600">
                          {appliedVoucher.discount_type === 'PERCENTAGE'
                            ? `${appliedVoucher.discount_value}% off`
                            : `$${appliedVoucher.discount_value} off`}
                          {appliedVoucher.description ? ` — ${appliedVoucher.description}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-sage-700">-{formatPrice(discountAmount)}</span>
                      <button onClick={handleRemoveVoucher} className="p-1 rounded hover:bg-sage-100 transition-colors">
                        <X className="w-4 h-4 text-sage-600" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleApplyVoucher} className="flex gap-2">
                    <input
                      type="text"
                      value={voucherCode}
                      onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                      placeholder="Enter promo code"
                      className="input-field flex-1 uppercase tracking-wide"
                    />
                    <button type="submit" disabled={voucherLoading || !voucherCode.trim()} className="btn-secondary px-4">
                      {voucherLoading ? '...' : 'Apply'}
                    </button>
                  </form>
                )}
                {voucherError && (
                  <p className="text-xs text-terracotta-600 flex items-center gap-1 mt-2">
                    <AlertCircle className="w-3 h-3" />{voucherError}
                  </p>
                )}
                <p className="text-xs text-ink-400 mt-2">Try: WELCOME10, VINTAGE15, SAVE25, APPAREL10</p>
              </div>

              <div className="flex gap-2 mt-4">
                <div className="flex items-center gap-1.5 text-xs text-ink-500">
                  <Truck className="w-3.5 h-3.5" /> Free tracked shipping
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ink-500">
                  <Leaf className="w-3.5 h-3.5" /> Carbon offset included
                </div>
              </div>

              <button
                onClick={() => {
                  if (name && address && city && zip) setStep('review');
                }}
                className="w-full btn-primary mt-5 py-3"
              >
                Continue to Review
              </button>
            </div>
          )}

          {step === 'review' && (
            <div className="card p-6 animate-slide-down">
              <h2 className="text-sm font-medium text-ink-900 mb-4">Review Your Order</h2>

              <div className="space-y-3 mb-4">
                {items.map((item) => (
                  <div key={item.listing.id} className="flex gap-3 pb-3 border-b border-ink-100 last:border-0">
                    <div className="w-16 h-20 rounded-lg overflow-hidden bg-ink-100 shrink-0">
                      {item.listing.images && item.listing.images[0] && (
                        <img src={item.listing.images[0]} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-ink-900 line-clamp-1">{item.listing.title}</p>
                      {item.listing.boutiques && <p className="text-xs text-ink-500">{item.listing.boutiques.name}</p>}
                      <p className="text-sm font-semibold text-ink-900 mt-1">{formatPrice(Number(item.listing.price))}</p>
                    </div>
                  </div>
                ))}
              </div>

              {appliedVoucher && (
                <div className="flex items-center justify-between p-2.5 bg-sage-50 rounded-lg mb-3">
                  <span className="text-sm text-sage-700 flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5" /> {appliedVoucher.code}
                  </span>
                  <span className="text-sm font-semibold text-sage-700">-{formatPrice(discountAmount)}</span>
                </div>
              )}

              <div className="bg-ink-50 rounded-lg p-3 mb-4 text-sm">
                <p className="text-xs font-medium text-ink-700 mb-1">Ship to:</p>
                <p className="text-xs text-ink-600">{name}, {address}, {city} {zip}, {country}</p>
              </div>

              <div className="flex items-center gap-2 mb-4 p-3 bg-sage-50 rounded-lg">
                <Shield className="w-5 h-5 text-sage-600 shrink-0" />
                <p className="text-xs text-sage-800">
                  Your payment of <strong>{formatPrice(finalTotal)}</strong> will be held in escrow and released to sellers only after you confirm delivery.
                </p>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setStep('shipping')} className="btn-secondary flex-1">Edit</button>
                <button onClick={handlePlaceOrder} disabled={processing} className="btn-terracotta flex-1 py-3">
                  {processing ? 'Processing...' : `Place Order — ${formatPrice(finalTotal)}`}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <div className="card p-5 sticky top-20">
            <h2 className="text-sm font-medium text-ink-900 mb-4">Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-ink-600">
                <span>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                <span>{formatPrice(total)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sage-600">
                  <span>Discount</span>
                  <span>-{formatPrice(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-ink-600">
                <span>Shipping</span>
                <span className="text-sage-600">Free</span>
              </div>
              <div className="border-t border-ink-100 pt-2 mt-2 flex justify-between font-semibold text-ink-900">
                <span>Total</span>
                <span className="font-serif text-lg">{formatPrice(finalTotal)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${active ? 'bg-ink-900 text-cream' : done ? 'bg-sage-500 text-white' : 'bg-ink-100 text-ink-400'}`}>
        {done ? <Check className="w-3.5 h-3.5" /> : label.charAt(0)}
      </div>
      <span className={`text-xs font-medium ${active ? 'text-ink-900' : 'text-ink-400'}`}>{label}</span>
    </div>
  );
}
