import { Gavel, Heart, Eye, BadgeCheck, Clock, TrendingDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useRouter } from '@/lib/router';
import { supabase, type ListingWithBoutique } from '@/lib/supabase';
import { formatPrice, formatCountdown, isAuctionActive, cn, computeDutchPrice } from '@/lib/utils';

export function ListingCard({ listing }: { listing: ListingWithBoutique }) {
  const { navigate } = useRouter();
  const [wishlisted, setWishlisted] = useState(false);
  const [currentBid, setCurrentBid] = useState<number | null>(null);
  const [bidCount, setBidCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState('');

  const [dutchPrice, setDutchPrice] = useState<number | null>(null);

  const isAuction = listing.listing_type === 'auction';
  const isDutch = isAuction && listing.auction_mode === 'DUTCH';
  const auctionActive = isAuctionActive(listing);

  useEffect(() => {
    if (isAuction && !isDutch) {
      supabase
        .from('bids')
        .select('amount')
        .eq('listing_id', listing.id)
        .order('amount', { ascending: false })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setCurrentBid(Number(data[0].amount));
            setBidCount(data.length);
          }
        });
    }
  }, [listing.id, isAuction, isDutch]);

  useEffect(() => {
    if (isAuction && listing.auction_end_at && !isDutch) {
      const update = () => setTimeLeft(formatCountdown(listing.auction_end_at!));
      update();
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [isAuction, isDutch, listing.auction_end_at]);

  // Dutch auction live price decay
  useEffect(() => {
    if (!isDutch || !listing.auction_start_price || !listing.dutch_floor_price || !listing.decrement_rate) return;
    const update = () => {
      const computed = computeDutchPrice(
        listing.auction_start_price!,
        listing.dutch_floor_price!,
        listing.decrement_rate!,
        listing.decrement_interval_minutes,
        listing.auction_start_at || listing.created_at,
      );
      setDutchPrice(computed);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [isDutch, listing.auction_start_price, listing.dutch_floor_price, listing.decrement_rate, listing.decrement_interval_minutes, listing.auction_start_at, listing.created_at]);

  const displayPrice = isDutch
    ? (dutchPrice ?? Number(listing.current_dutch_price ?? listing.auction_start_price))
    : isAuction ? (currentBid ?? Number(listing.price)) : Number(listing.price);

  return (
    <div
      onClick={() => navigate({ name: 'listing', id: listing.id })}
      className="group cursor-pointer animate-slide-up"
    >
      <div className="relative aspect-[4/5] rounded-xl overflow-hidden bg-ink-100 mb-3">
        {listing.images && listing.images.length > 0 ? (
          <img
            src={listing.images[0]}
            alt={listing.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ink-300">
            <Gavel className="w-10 h-10" />
          </div>
        )}

        {/* Top badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1.5">
          {isAuction && !isDutch && (
            <span className="badge bg-terracotta-500 text-white">
              <Gavel className="w-3 h-3" />
              Ascending Auction
            </span>
          )}
          {isDutch && (
            <span className="badge bg-ink-900 text-cream">
              <TrendingDown className="w-3 h-3" />
              Descending Auction
            </span>
          )}
          {listing.coa_verified && (
            <span className="badge bg-sage-600 text-white">
              <BadgeCheck className="w-3 h-3" />
              Verified
            </span>
          )}
          {listing.status === 'sold' && (
            <span className="badge bg-ink-900 text-cream">Sold</span>
          )}
        </div>

        {/* Wishlist button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setWishlisted(!wishlisted);
          }}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm flex items-center justify-center hover:bg-white transition-colors"
        >
          <Heart className={cn('w-4 h-4', wishlisted ? 'text-terracotta-500 fill-terracotta-500' : 'text-ink-600')} />
        </button>

        {/* Auction countdown overlay */}
        {isAuction && !isDutch && auctionActive && timeLeft && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-ink-950/80 to-transparent p-3">
            <div className="flex items-center gap-1.5 text-cream text-xs font-mono">
              <Clock className="w-3 h-3" />
              <span>{timeLeft}</span>
            </div>
          </div>
        )}
        {isDutch && auctionActive && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-ink-950/80 to-transparent p-3">
            <div className="flex items-center gap-1.5 text-cream text-xs font-mono">
              <TrendingDown className="w-3 h-3" />
              <span>{formatPrice(displayPrice)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="space-y-1">
        {listing.boutiques && (
          <p className="text-xs text-ink-500 truncate">{listing.boutiques.name}</p>
        )}
        <h3 className="text-sm font-medium text-ink-900 leading-snug line-clamp-2 group-hover:text-terracotta-600 transition-colors">
          {listing.title}
        </h3>
        <div className="flex items-center justify-between pt-0.5">
          <div>
            {isAuction ? (
              <div>
                <p className="text-[10px] text-ink-500 uppercase tracking-wide">
                  {isDutch ? 'Current Price' : bidCount > 0 ? `${bidCount} bid${bidCount > 1 ? 's' : ''}` : 'Starting at'}
                </p>
                <p className={cn('text-base font-semibold', isDutch ? 'text-ink-900' : 'text-ink-900')}>{formatPrice(displayPrice)}</p>
              </div>
            ) : (
              <p className="text-base font-semibold text-ink-900">{formatPrice(displayPrice)}</p>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-ink-400">
            <Eye className="w-3 h-3" />
            <span>{listing.views}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ListingCardSkeleton() {
  return (
    <div>
      <div className="aspect-[4/5] rounded-xl skeleton mb-3" />
      <div className="space-y-2">
        <div className="h-3 w-1/3 skeleton rounded" />
        <div className="h-4 w-full skeleton rounded" />
        <div className="h-5 w-1/2 skeleton rounded" />
      </div>
    </div>
  );
}
