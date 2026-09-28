import { useEffect, useState } from 'react';
import { Gavel, Heart, BadgeCheck, Eye, Clock, MapPin, MessageCircle, ArrowLeft, Shield, Truck, Leaf, ChevronRight, AlertCircle } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { supabase, type Listing, type Boutique, type Bid, type Review, type ListingWithBoutique } from '@/lib/supabase';
import { formatPrice, formatPriceDetailed, formatCountdown, isAuctionActive, formatTimeAgo, cn } from '@/lib/utils';
import { ListingCard } from '@/components/ListingCard';

export function ListingDetailPage({ listingId }: { listingId: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const { addToCart } = useCart();

  const [listing, setListing] = useState<Listing | null>(null);
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [relatedListings, setRelatedListings] = useState<any[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState(0);
  const [bidAmount, setBidAmount] = useState('');
  const [bidError, setBidError] = useState<string | null>(null);
  const [bidSuccess, setBidSuccess] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [messageBody, setMessageBody] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: listingData } = await supabase
        .from('listings')
        .select('*')
        .eq('id', listingId)
        .maybeSingle();

      if (!listingData) {
        setLoading(false);
        return;
      }

      setListing(listingData as Listing);

      // Increment views
      await supabase
        .from('listings')
        .update({ views: (listingData as Listing).views + 1 })
        .eq('id', listingId);

      // Load boutique
      const { data: boutiqueData } = await supabase
        .from('boutiques')
        .select('*')
        .eq('id', (listingData as Listing).boutique_id)
        .maybeSingle();
      setBoutique(boutiqueData as Boutique);

      // Load bids
      const { data: bidsData } = await supabase
        .from('bids')
        .select('*')
        .eq('listing_id', listingId)
        .order('amount', { ascending: false });
      setBids((bidsData as Bid[]) || []);

      // Load related listings
      const { data: related } = await supabase
        .from('listings')
        .select('*, boutiques(id, name, slug, logo_url)')
        .eq('status', 'active')
        .neq('id', listingId)
        .or(`category.eq.${(listingData as Listing).category},era.eq.${(listingData as Listing).era}`)
        .limit(4);
      setRelatedListings(related || []);

      // Load reviews for this boutique
      const { data: reviewData } = await supabase
        .from('reviews')
        .select('*')
        .eq('boutique_id', (listingData as Listing).boutique_id)
        .order('created_at', { ascending: false })
        .limit(3);
      setReviews((reviewData as Review[]) || []);

      setLoading(false);
    }
    load();
  }, [listingId]);

  useEffect(() => {
    if (listing?.auction_end_at && listing.listing_type === 'auction') {
      const update = () => setTimeLeft(formatCountdown(listing.auction_end_at!));
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [listing]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          <div className="aspect-[4/5] skeleton rounded-2xl" />
          <div className="space-y-4">
            <div className="h-6 w-1/4 skeleton rounded" />
            <div className="h-8 w-3/4 skeleton rounded" />
            <div className="h-6 w-1/3 skeleton rounded" />
            <div className="h-32 w-full skeleton rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <p className="text-ink-500 mb-4">This listing could not be found.</p>
        <button onClick={() => navigate({ name: 'browse' })} className="btn-primary">Back to Browse</button>
      </div>
    );
  }

  const isAuction = listing.listing_type === 'auction';
  const auctionActive = isAuctionActive(listing);
  const currentBid = bids.length > 0 ? Number(bids[0].amount) : Number(listing.price);
  const minNextBid = currentBid + Math.max(5, Math.ceil(currentBid * 0.05));
  const images = listing.images || [];

  async function handleBid(e: React.FormEvent) {
    e.preventDefault();
    setBidError(null);
    setBidSuccess(false);

    if (!user) {
      navigate({ name: 'auth' });
      return;
    }

    const amount = parseFloat(bidAmount);
    if (isNaN(amount) || amount < minNextBid) {
      setBidError(`Minimum bid is ${formatPriceDetailed(minNextBid)}`);
      return;
    }

    // Unmark previous winning bids
    await supabase
      .from('bids')
      .update({ is_winning: false })
      .eq('listing_id', listingId);

    const { error } = await supabase
      .from('bids')
      .insert({
        listing_id: listingId,
        bidder_id: user.id,
        amount,
        is_winning: true,
      });

    if (error) {
      setBidError(error.message);
      return;
    }

    setBidSuccess(true);
    setBidAmount('');
    // Reload bids
    const { data: newBids } = await supabase
      .from('bids')
      .select('*')
      .eq('listing_id', listingId)
      .order('amount', { ascending: false });
    setBids((newBids as Bid[]) || []);
  }

  async function handleBuyNow() {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }

    // Create order with escrow
    const { error } = await supabase
      .from('orders')
      .insert({
        buyer_id: user.id,
        listing_id: listing!.id,
        boutique_id: listing!.boutique_id,
        amount: Number(listing!.price),
        status: 'escrow_held',
        shipping_address: 'Pending',
      });

    if (!error) {
      // Mark listing as sold
      await supabase
        .from('listings')
        .update({ status: 'sold' })
        .eq('id', listing!.id);
      navigate({ name: 'orders' });
    }
  }

  function handleAddToCart() {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }
    addToCart({ ...listing, boutiques: boutique ? { id: boutique.id, name: boutique.name, slug: boutique.slug, logo_url: boutique.logo_url } : null } as ListingWithBoutique);
    navigate({ name: 'cart' });
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !boutique) return;
    await supabase.from('messages').insert({
      listing_id: listingId,
      sender_id: user.id,
      receiver_id: boutique.seller_id,
      body: messageBody,
    });
    setMessageBody('');
    setShowMessageForm(false);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-ink-500 mb-6">
        <button onClick={() => navigate({ name: 'home' })} className="hover:text-ink-900">Home</button>
        <ChevronRight className="w-3 h-3" />
        <button onClick={() => navigate({ name: 'browse' })} className="hover:text-ink-900">Browse</button>
        {listing.category && (
          <>
            <ChevronRight className="w-3 h-3" />
            <button onClick={() => navigate({ name: 'browse', category: listing.category! })} className="hover:text-ink-900">{listing.category}</button>
          </>
        )}
        <ChevronRight className="w-3 h-3" />
        <span className="text-ink-700 truncate max-w-[200px]">{listing.title}</span>
      </div>

      <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
        {/* Images */}
        <div>
          <div className="aspect-[4/5] rounded-2xl overflow-hidden bg-ink-100 mb-3">
            {images.length > 0 ? (
              <img src={images[selectedImage]} alt={listing.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink-300">
                <Gavel className="w-16 h-16" />
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={cn(
                    'w-20 h-24 rounded-lg overflow-hidden shrink-0 border-2 transition-colors',
                    selectedImage === i ? 'border-ink-900' : 'border-transparent'
                  )}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          {/* Boutique link */}
          {boutique && (
            <button
              onClick={() => navigate({ name: 'boutique', slug: boutique.slug })}
              className="flex items-center gap-2 mb-4 group"
            >
              {boutique.logo_url ? (
                <img src={boutique.logo_url} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-sage-500 flex items-center justify-center text-cream text-xs font-bold">
                  {boutique.name.charAt(0)}
                </div>
              )}
              <div className="text-left">
                <p className="text-sm font-medium text-ink-900 group-hover:text-terracotta-600 transition-colors">{boutique.name}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gold-600 font-medium">★ {Number(boutique.rating_avg).toFixed(1)}</span>
                  <span className="text-xs text-ink-400">({boutique.rating_count} reviews)</span>
                  {boutique.location && (
                    <span className="text-xs text-ink-400 flex items-center gap-0.5">
                      <MapPin className="w-3 h-3" />{boutique.location}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )}

          {/* Title and badges */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 leading-tight">{listing.title}</h1>
            <button className="p-2 rounded-lg hover:bg-ink-100 transition-colors shrink-0">
              <Heart className="w-5 h-5 text-ink-600" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            {isAuction && (
              <span className="badge bg-terracotta-50 text-terracotta-700 border border-terracotta-200">
                <Gavel className="w-3 h-3" /> Live Auction
              </span>
            )}
            {listing.coa_verified && (
              <span className="badge bg-sage-50 text-sage-700 border border-sage-200">
                <BadgeCheck className="w-3 h-3" /> Certificate of Authenticity
              </span>
            )}
            {listing.condition_grade && (
              <span className="badge bg-ink-50 text-ink-700 border border-ink-200">
                {listing.condition_grade} Condition
              </span>
            )}
            {listing.sku && (
              <span className="text-xs text-ink-400 font-mono">SKU: {listing.sku}</span>
            )}
          </div>

          {/* Price / Bid section */}
          <div className="card p-5 mb-5">
            {isAuction ? (
              <>
                <div className="flex items-end justify-between mb-4">
                  <div>
                    <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">
                      {bids.length > 0 ? 'Current Bid' : 'Starting Bid'}
                    </p>
                    <p className="font-serif text-3xl font-bold text-ink-900">{formatPrice(currentBid)}</p>
                    <p className="text-xs text-ink-500 mt-1">
                      {bids.length} bid{bids.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className={cn(
                    'text-right',
                    auctionActive ? '' : 'opacity-50'
                  )}>
                    <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Time Left</p>
                    <p className={cn(
                      'font-mono text-lg font-semibold',
                      auctionActive && timeLeft.includes('h') && !timeLeft.startsWith('0') ? 'text-ink-900' : auctionActive ? 'text-terracotta-600' : 'text-ink-500'
                    )}>
                      {auctionActive ? timeLeft : 'Auction Ended'}
                    </p>
                    {auctionActive && (
                      <p className="text-[10px] text-ink-400 mt-0.5 flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" /> Soft-close enabled
                      </p>
                    )}
                  </div>
                </div>

                {auctionActive && (
                  <form onSubmit={handleBid} className="space-y-3">
                    <div>
                      <label className="text-xs text-ink-500 mb-1 block">
                        Minimum bid: <span className="font-medium text-ink-900">{formatPriceDetailed(minNextBid)}</span>
                      </label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 text-sm">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                            placeholder={minNextBid.toFixed(2)}
                            className="input-field pl-7"
                          />
                        </div>
                        <button type="submit" className="btn-terracotta px-6">Place Bid</button>
                      </div>
                    </div>
                    {bidError && (
                      <p className="text-xs text-terracotta-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />{bidError}
                      </p>
                    )}
                    {bidSuccess && (
                      <p className="text-xs text-sage-600 flex items-center gap-1">
                        <BadgeCheck className="w-3 h-3" /> Bid placed successfully!
                      </p>
                    )}
                  </form>
                )}

                {listing.reserve_price && (
                  <p className="text-xs text-ink-500 mt-3">
                    {currentBid >= Number(listing.reserve_price)
                      ? 'Reserve price met'
                      : 'Reserve price not yet met'}
                  </p>
                )}
              </>
            ) : (
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Price</p>
                  <p className="font-serif text-3xl font-bold text-ink-900">{formatPrice(Number(listing.price))}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleAddToCart} className="btn-secondary">Add to Cart</button>
                  <button onClick={handleBuyNow} className="btn-primary">Buy Now</button>
                </div>
              </div>
            )}
          </div>

          {/* Trust badges */}
          <div className="grid grid-cols-3 gap-2 mb-5">
            <TrustItem icon={<Shield className="w-4 h-4" />} label="Escrow" />
            <TrustItem icon={<Truck className="w-4 h-4" />} label="Tracked Shipping" />
            <TrustItem icon={<Leaf className="w-4 h-4" />} label="Carbon Offset" />
          </div>

          {/* Description */}
          <div className="mb-5">
            <h3 className="text-sm font-medium text-ink-900 mb-2">Description</h3>
            <p className="text-sm text-ink-600 leading-relaxed">{listing.description}</p>
          </div>

          {/* Specs */}
          <div className="card p-4 mb-5">
            <h3 className="text-sm font-medium text-ink-900 mb-3">Item Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <SpecRow label="Era" value={listing.era} />
              <SpecRow label="Category" value={listing.category} />
              <SpecRow label="Material" value={listing.material} />
              <SpecRow label="Condition" value={listing.condition_grade} />
              <SpecRow label="Listing Type" value={isAuction ? 'Auction' : 'Fixed Price'} />
              <SpecRow label="SKU" value={listing.sku} />
            </div>
          </div>

          {/* Message seller */}
          <div className="mb-5">
            {showMessageForm ? (
              <form onSubmit={handleSendMessage} className="card p-4 space-y-3 animate-slide-down">
                <h3 className="text-sm font-medium text-ink-900">Ask about this item</h3>
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Ask the seller a question about this item..."
                  className="input-field min-h-[80px] resize-none"
                  required
                />
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary">Send Message</button>
                  <button type="button" onClick={() => setShowMessageForm(false)} className="btn-secondary">Cancel</button>
                </div>
              </form>
            ) : (
              <button
                onClick={() => user ? setShowMessageForm(true) : navigate({ name: 'auth' })}
                className="flex items-center gap-2 text-sm text-ink-600 hover:text-ink-900 transition-colors link-underline"
              >
                <MessageCircle className="w-4 h-4" />
                Ask the seller a question
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bid history */}
      {isAuction && bids.length > 0 && (
        <div className="mt-12">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-4">Bid History</h2>
          <div className="card divide-y divide-ink-100">
            {bids.slice(0, 10).map((bid, i) => (
              <div key={bid.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                    bid.is_winning ? 'bg-terracotta-500 text-white' : 'bg-ink-100 text-ink-600'
                  )}>
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-ink-900">
                      {bid.is_winning ? 'Highest Bidder' : `Bidder #${i + 1}`}
                    </p>
                    <p className="text-xs text-ink-400">{formatTimeAgo(bid.created_at)}</p>
                  </div>
                </div>
                <p className="font-mono text-sm font-semibold text-ink-900">{formatPrice(Number(bid.amount))}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related listings */}
      {relatedListings.length > 0 && (
        <div className="mt-12">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-4">You May Also Like</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {relatedListings.map((item) => <ListingCard key={item.id} listing={item} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function TrustItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-ink-50 text-ink-600">
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-ink-400">{label}</p>
      <p className="text-sm font-medium text-ink-900">{value || '—'}</p>
    </div>
  );
}
