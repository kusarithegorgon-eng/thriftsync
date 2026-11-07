import { useCallback, useEffect, useState } from 'react';
import { Activity, ExternalLink, Gavel, Star, X } from 'lucide-react';
import { supabase, type SellerAuctionBid } from '@/lib/supabase';
import { formatPrice, formatTimeAgo } from '@/lib/utils';

type SellerLiveAuctionBiddersModalProps = {
  open: boolean;
  listingId: string;
  listingTitle: string;
  onClose: () => void;
};

export function SellerLiveAuctionBiddersModal({
  open,
  listingId,
  listingTitle,
  onClose,
}: SellerLiveAuctionBiddersModalProps) {
  const [bids, setBids] = useState<SellerAuctionBid[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBids = useCallback(async () => {
    const { data, error: loadError } = await supabase.rpc('get_seller_auction_bids', {
      p_listing_id: listingId,
    });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setBids((data as SellerAuctionBid[]) || []);
    setError(null);
  }, [listingId]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void loadBids().finally(() => {
      if (active) setLoading(false);
    });

    const channel = supabase
      .channel(`seller-auction-bids-${listingId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'auction_bids',
        filter: `listing_id=eq.${listingId}`,
      }, () => {
        void loadBids();
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && active) {
          setError('Live bid updates are unavailable. Refresh the modal to retry.');
        }
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [loadBids, listingId, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-ink-950/60 p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auction-bidders-title"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-cream shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-100 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-terracotta-100 text-terracotta-700">
              <Gavel className="h-5 w-5" />
            </div>
            <div>
              <h2 id="auction-bidders-title" className="font-serif text-xl font-bold text-ink-900">Live Bidders</h2>
              <p className="max-w-[min(70vw,32rem)] truncate text-xs text-ink-500">{listingTitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close bidders" className="rounded-lg p-2 text-ink-500 hover:bg-ink-100">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="p-4">
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-sage-50 p-3 text-xs text-sage-800">
            <Activity className="h-4 w-4 shrink-0" />
            <span>Bid updates stream live. Bidder profile details are only visible to this listing’s seller.</span>
          </div>
          {error && <p role="alert" className="mb-3 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">{error}</p>}
          {loading && bids.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">Loading live bidders…</p>
          ) : bids.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">No bids yet.</p>
          ) : (
            <div className="divide-y divide-ink-100">
              {bids.map((bid, index) => (
                <div key={bid.id} className="flex items-center gap-3 py-3">
                  {bid.avatar_url ? (
                    <img src={bid.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ink-100 font-semibold text-ink-600">
                      {bid.display_name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <a href={bid.profile_url} className="inline-flex max-w-full items-center gap-1 truncate text-sm font-medium text-ink-900 hover:text-terracotta-700">
                      {bid.display_name}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <p className="flex items-center gap-1 text-xs text-ink-500">
                      <Star className="h-3 w-3 fill-gold-500 text-gold-500" />
                      {bid.feedback_score === null ? 'No feedback yet' : `${Number(bid.feedback_score).toFixed(1)} feedback`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold text-ink-900">{formatPrice(Number(bid.amount))}</p>
                    {bids[index + 1] && (
                      <p className="text-[10px] font-medium text-sage-700">
                        +{formatPrice(Number(bid.amount) - Number(bids[index + 1].amount))}
                      </p>
                    )}
                    <p className="text-[10px] text-ink-400">{formatTimeAgo(bid.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
