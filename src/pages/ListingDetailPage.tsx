import { useEffect, useState, useCallback } from 'react';
import { Gavel, Heart, BadgeCheck, Eye, Clock, MapPin, MessageCircle, ArrowLeft, Shield, Truck, Leaf, ChevronRight, AlertCircle, TrendingDown, Zap, Camera } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { supabase, type Listing, type Boutique, type Bid, type Review, type ListingWithBoutique, type ImageMetadata, type BidResult } from '@/lib/supabase';
import { formatPrice, formatPriceDetailed, formatCountdown, isAuctionActive, formatTimeAgo, cn, getMinNextBid, getIncrementTierLabel, computeDutchPrice, getNextDropTime } from '@/lib/utils';
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
  const [bidding, setBidding] = useState(false);
  const [timeLeft, setTimeLeft] = useState('');
  const [showMessageForm, setShowMessageForm] = useState(false);
  const [messageBody, setMessageBody] = useState('');
  const [dutchPrice, setDutchPrice] = useState<number | null>(null);
  const [nextDropIn, setNextDropIn] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const loadListing = useCallback(async () => {
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

    await supabase
      .from('listings')
      .update({ views: (listingData as Listing).views + 1 })
      .eq('id', listingId);

    const { data: boutiqueData } = await supabase
      .from('boutiques')
      .select('*')
      .eq('id', (listingData as Listing).boutique_id)
      .maybeSingle();
    setBoutique(boutiqueData as Boutique);

    const { data: bidsData } = await supabase
      .from('bids')
      .select('*')
      .eq('listing_id', listingId)
      .order('amount', { ascending: false });
    setBids((bidsData as Bid[]) || []);

    const { data: related } = await supabase
      .from('listings')
      .select('*, boutiques(id, name, slug, logo_url)')
      .eq('status', 'active')
      .neq('id', listingId)
      .or(`category.eq.${(listingData as Listing).category},era.eq.${(listingData as Listing).era}`)
      .limit(4);
    setRelatedListings(related || []);

    const { data: reviewData } = await supabase
      .from('reviews')
      .select('*')
      .eq('boutique_id', (listingData as Listing).boutique_id)
      .order('created_at', { ascending: false })
      .limit(3);
    setReviews((reviewData as Review[]) || []);

    setLoading(false);
  }, [listingId]);

  useEffect(() => {
    loadListing();
  }, [loadListing]);

  // Countdown timer for English auctions
  useEffect(() => {
    if (listing?.auction_end_at && listing.listing_type === 'auction') {
      const update = () => setTimeLeft(formatCountdown(listing.auction_end_at!));
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [listing]);

  // Dutch auction live price decay
  useEffect(() => {
    if (!listing || listing.listing_type !== 'auction' || listing.auction_mode !== 'DUTCH') return;
    if (!listing.auction_start_price || !listing.dutch_floor_price || !listing.decrement_rate) return;

    const update = () => {
      const computed = computeDutchPrice(
        listing.auction_start_price!,
        listing.dutch_floor_price!,
        listing.decrement_rate!,
        listing.decrement_interval_minutes,
        listing.created_at,
      );
      setDutchPrice(computed);

      const nextDrop = getNextDropTime(listing.decrement_interval_minutes, listing.created_at);
      if (nextDrop) {
        const diff = nextDrop.getTime() - Date.now();
        if (diff > 0) {
          const mins = Math.floor(diff / 60000);
          const secs = Math.floor((diff % 60000) / 1000);
          setNextDropIn(`${mins}m ${secs}s`);
        } else {
          setNextDropIn('Dropping now...');
        }
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
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
  const isDutch = isAuction && listing.auction_mode === 'DUTCH';
  const auctionActive = isAuctionActive(listing);
  const currentBid = bids.length > 0 ? Number(bids[0].amount) : Number(listing.price);
  const minNextBid = getMinNextBid(currentBid, listing.increment_step);
  const incrementLabel = getIncrementTierLabel(currentBid);

  // Image metadata with structured angle/flaw info
  const imageMeta: ImageMetadata[] = listing.image_metadata || [];
  const allImages = imageMeta.length > 0
    ? imageMeta
    : (listing.images || []).map((url, i) => ({ url, angle: i === 0 ? 'front' : 'other', is_flaw: false } as ImageMetadata));

  const flawImages = allImages.filter((img) => img.is_flaw || img.angle === 'flaw');
  const angleImages = allImages.filter((img) => !img.is_flaw && img.angle !== 'flaw');

  const displayPrice: number = isDutch && dutchPrice !== null ? dutchPrice : (isDutch ? Number(listing.current_dutch_price ?? listing.auction_start_price ?? listing.price) : Number(listing.price));

  async function handleBid(e: React.FormEvent) {
    e.preventDefault();
    setBidError(null);
    setBidSuccess(false);

    if (!user) {
      navigate({ name: 'auth' });
      return;
    }

    const amount = parseFloat(bidAmount);
    if (isNaN(amount)) {
      setBidError('Enter a valid bid amount');
      return;
    }

    setBidding(true);

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auction-ops`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'place_bid',
        listing_id: listingId,
        bid_amount: amount,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setBidError(err.error || `Bid failed (${response.status})`);
      setBidding(false);
      return;
    }

    const result: BidResult = await response.json();
    if (!result.success) {
      setBidError(result.message);
      setBidding(false);
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
    setBidding(false);
  }

  async function handleClaimDutch() {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }

    setClaiming(true);
    setClaimError(null);

    const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auction-ops`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'claim_dutch',
        listing_id: listingId,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setClaimError(err.error || `Claim failed (${response.status})`);
      setClaiming(false);
      return;
    }

    const result = await response.json();
    if (result.success) {
      navigate({ name: 'orders' });
    } else {
      setClaimError(result.error || 'Failed to claim item');
    }
    setClaiming(false);
  }

  async function handleBuyNow() {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }

    const { error } = await supabase
      .from('orders')
      .insert({
        buyer_id: user.id,
        listing_id: listing!.id,
        boutique_id: listing!.boutique_id,
        amount: Number(listing!.price),
        status: 'escrow_held',
        shipping_address: 'Pending - Cebu pickup/delivery',
      });

    if (!error) {
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
            {allImages.length > 0 ? (
              <img src={allImages[selectedImage]?.url || allImages[0].url} alt={listing.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-ink-300">
                <Gavel className="w-16 h-16" />
              </div>
            )}
          </div>

          {/* Angle labels on thumbnails */}
          {allImages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {allImages.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedImage(i)}
                  className={cn(
                    'w-20 h-24 rounded-lg overflow-hidden shrink-0 border-2 transition-colors relative',
                    selectedImage === i ? 'border-ink-900' : 'border-transparent',
                  )}
                >
                  <img src={img.url} alt={img.angle} className="w-full h-full object-cover" />
                  <span className={cn(
                    'absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[9px] font-medium text-center',
                    img.is_flaw ? 'bg-terracotta-500/80 text-white' : 'bg-ink-900/60 text-white',
                  )}>
                    {img.angle}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Flaw photos callout */}
          {flawImages.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-terracotta-50 border border-terracotta-200">
              <p className="text-xs font-medium text-terracotta-700 flex items-center gap-1.5 mb-1">
                <AlertCircle className="w-3.5 h-3.5" /> Flaw / Condition Photos
              </p>
              <p className="text-xs text-terracotta-600">
                {flawImages.length} photo{flawImages.length !== 1 ? 's' : ''} documenting condition for vintage grading. {flawImages.map((f) => f.caption).filter(Boolean).join('; ')}
              </p>
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
                  {boutique.barangay && (
                    <span className="text-xs text-ink-400 flex items-center gap-0.5">
                      <MapPin className="w-3 h-3" />{boutique.barangay}, Cebu
                    </span>
                  )}
                  {boutique.pickup_available && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-sage-50 text-sage-700 font-medium">Pickup available</span>
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
              <span className={cn(
                'badge border',
                isDutch
                  ? 'bg-ink-900 text-cream border-ink-900'
                  : 'bg-terracotta-50 text-terracotta-700 border-terracotta-200',
              )}>
                {isDutch ? <><TrendingDown className="w-3 h-3" /> Dutch Auction</> : <><Gavel className="w-3 h-3" /> Live Auction</>}
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
            {isAuction && !isDutch ? (
              <>
                {/* English Auction */}
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
                  <div className={cn('text-right', auctionActive ? '' : 'opacity-50')}>
                    <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Time Left</p>
                    <p className={cn(
                      'font-mono text-lg font-semibold',
                      auctionActive && timeLeft.includes('h') && !timeLeft.startsWith('0') ? 'text-ink-900' : auctionActive ? 'text-terracotta-600' : 'text-ink-500',
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
                      <p className="text-[10px] text-ink-400 mb-2">{incrementLabel}</p>
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
                        <button type="submit" disabled={bidding} className="btn-terracotta px-6">
                          {bidding ? 'Placing...' : 'Place Bid'}
                        </button>
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
            ) : isAuction && isDutch ? (
              <>
                {/* Dutch Auction */}
                <div className="flex items-end justify-between mb-4">
                  <div>
                    <p className="text-xs text-ink-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                      <TrendingDown className="w-3 h-3" /> Current Price
                    </p>
                    <p className="font-serif text-3xl font-bold text-ink-900">{formatPrice(displayPrice)}</p>
                    <p className="text-xs text-ink-500 mt-1">
                      Started at {formatPrice(Number(listing.auction_start_price))}
                      {listing.dutch_floor_price && ` · Floor: ${formatPrice(Number(listing.dutch_floor_price))}`}
                    </p>
                  </div>
                  <div className={cn('text-right', auctionActive ? '' : 'opacity-50')}>
                    <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Next Price Drop</p>
                    <p className={cn('font-mono text-lg font-semibold', auctionActive ? 'text-terracotta-600' : 'text-ink-500')}>
                      {auctionActive ? nextDropIn : 'Ended'}
                    </p>
                    {auctionActive && listing.decrement_rate && (
                      <p className="text-[10px] text-ink-400 mt-0.5">
                        Drops {listing.decrement_rate}% every {listing.decrement_interval_minutes}min
                      </p>
                    )}
                  </div>
                </div>

                {auctionActive && (
                  <div className="space-y-3">
                    <button
                      onClick={handleClaimDutch}
                      disabled={claiming}
                      className="w-full btn-terracotta py-3 flex items-center justify-center gap-2"
                    >
                      <Zap className="w-4 h-4" />
                      {claiming ? 'Claiming...' : `Claim Now — ${formatPrice(displayPrice)}`}
                    </button>
                    {claimError && (
                      <p className="text-xs text-terracotta-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />{claimError}
                      </p>
                    )}
                    <p className="text-[10px] text-ink-400 text-center">
                      First to claim wins. Price drops automatically until claimed or floor is reached.
                    </p>
                  </div>
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
            <TrustItem icon={<Truck className="w-4 h-4" />} label="Cebu Delivery" />
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
              <SpecRow label="Listing Type" value={isDutch ? 'Dutch Auction' : isAuction ? 'English Auction' : 'Fixed Price'} />
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
      {isAuction && !isDutch && bids.length > 0 && (
        <div className="mt-12">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-4">Bid History</h2>
          <div className="card divide-y divide-ink-100">
            {bids.slice(0, 10).map((bid, i) => (
              <div key={bid.id} className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                    bid.is_winning ? 'bg-terracotta-500 text-white' : 'bg-ink-100 text-ink-600',
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
