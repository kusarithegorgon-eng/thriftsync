import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, Clock, MessageCircle, Package } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import {
  supabase,
  type Listing,
  type TradeOfferWithItems,
} from '@/lib/supabase';
import { formatPrice, formatTimeAgo } from '@/lib/utils';

type BarterListing = Pick<Listing, 'id' | 'title' | 'images' | 'price' | 'barter_enabled' | 'status' | 'listing_type' | 'category' | 'era'>;

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Awaiting response',
  ACCEPTED: 'Arrange the handover',
  SHIPPED_BY_PARTY_A: 'Waiting for the other seller',
  SHIPPED_BY_PARTY_B: 'Waiting for the other seller',
  REJECTED: 'Declined or expired',
  COMPLETED: 'Exchange completed',
  DISPUTED: 'Disputed',
};

export function TradesPage({ requestedListingId }: { requestedListingId?: string }) {
  const { user, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [offers, setOffers] = useState<TradeOfferWithItems[]>([]);
  const [myListings, setMyListings] = useState<BarterListing[]>([]);
  const [recommendedListings, setRecommendedListings] = useState<Listing[]>([]);
  const [requestedListing, setRequestedListing] = useState<BarterListing | null>(null);
  const [offeredListingId, setOfferedListingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadTrades = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const [{ data: offerData, error: offersError }, { data: boutiques, error: boutiquesError }] = await Promise.all([
      supabase
        .from('trade_offers')
        .select('*, trade_items(*, listings(id, title, images, price)), trade_shipments(*)')
        .or(`initiator_id.eq.${user.id},recipient_id.eq.${user.id}`)
        .order('created_at', { ascending: false }),
      supabase
        .from('boutiques')
        .select('id')
        .eq('seller_id', user.id),
    ]);

    if (offersError) {
      setError(`Could not load your trade offers: ${offersError.message}`);
      setLoading(false);
      return;
    }
    if (boutiquesError) {
      setError(`Could not load your boutique listings: ${boutiquesError.message}`);
      setLoading(false);
      return;
    }

    setOffers((offerData as TradeOfferWithItems[]) || []);

    const boutiqueIds = (boutiques || []).map((boutique) => boutique.id);
    if (boutiqueIds.length === 0) {
      setMyListings([]);
      setRecommendedListings([]);
      setLoading(false);
      return;
    }

    const { data: listingData, error: listingsError } = await supabase
      .from('listings')
      .select('id, title, images, price, barter_enabled, status, listing_type, category, era')
      .in('boutique_id', boutiqueIds)
      .eq('status', 'active')
      .eq('moderation_status', 'approved')
      .eq('listing_type', 'fixed')
      .eq('barter_enabled', true)
      .order('created_at', { ascending: false });

    if (listingsError) {
      setError(`Could not load your available barter listings: ${listingsError.message}`);
    } else {
      const ownedListings = (listingData as BarterListing[]) || [];
      setMyListings(ownedListings);
      if (ownedListings.length > 0) {
        const { data: candidateData, error: candidateError } = await supabase
          .from('listings')
          .select('*, boutiques(id, name, slug, logo_url, seller_id, seller_rating_avg, seller_rating_count)')
          .eq('status', 'active')
          .eq('moderation_status', 'approved')
          .eq('listing_type', 'fixed')
          .eq('barter_enabled', true)
          .not('boutique_id', 'in', `(${boutiqueIds.join(',')})`)
          .limit(100);
        if (candidateError) {
          setError(`Could not load barter recommendations: ${candidateError.message}`);
          setRecommendedListings([]);
        } else {
          const candidates = (candidateData || []) as Listing[];
          const scored = candidates.map((candidate) => {
            const score = Math.max(...ownedListings.map((ownListing) => {
              let match = 0;
              if (ownListing.category && candidate.category === ownListing.category) match += 4;
              if (ownListing.era && candidate.era === ownListing.era) match += 2;
              const priceRatio = Number(candidate.price) / Math.max(Number(ownListing.price), 1);
              if (priceRatio >= 0.5 && priceRatio <= 2) match += 1;
              return match;
            }));
            return { candidate, score };
          });
          setRecommendedListings(scored
            .filter((entry) => entry.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((entry) => entry.candidate));
        }
      } else {
        setRecommendedListings([]);
      }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!authLoading) void loadTrades();
  }, [authLoading, loadTrades]);

  useEffect(() => {
    let cancelled = false;
    async function loadRequestedListing() {
      if (!requestedListingId) {
        setRequestedListing(null);
        return;
      }
      const { data, error: listingError } = await supabase
        .from('listings')
        .select('id, title, images, price, barter_enabled, status, listing_type, category, era')
        .eq('id', requestedListingId)
        .maybeSingle();
      if (cancelled) return;
      if (listingError) {
        setError(`Could not load the requested listing: ${listingError.message}`);
        return;
      }
      setRequestedListing((data as BarterListing | null) ?? null);
    }
    void loadRequestedListing();
    return () => { cancelled = true; };
  }, [requestedListingId]);

  const availableOffers = useMemo(
    () => myListings.filter((listing) => listing.id !== requestedListingId),
    [myListings, requestedListingId],
  );
  const incomingOffers = offers.filter((offer) => offer.recipient_id === user?.id);
  const outgoingOffers = offers.filter((offer) => offer.initiator_id === user?.id);

  async function submitOffer(event: React.FormEvent) {
    event.preventDefault();
    if (!requestedListingId || !offeredListingId) {
      setError('Choose an item from your boutique to offer.');
      return;
    }
    setActionLoading('create');
    setError(null);
    setSuccess(null);
    const { error: createError } = await supabase.rpc('create_trade_offer', {
      p_requested_listing_id: requestedListingId,
      p_offered_listing_id: offeredListingId,
    });
    if (createError) {
      setError(createError.message);
    } else {
      setSuccess('Your one-to-one barter offer was sent. It expires in 72 hours if the seller does not respond.');
      setOfferedListingId('');
      await loadTrades();
    }
    setActionLoading(null);
  }

  async function respond(offerId: string, action: 'accept' | 'reject' | 'cancel') {
    setActionLoading(offerId);
    setError(null);
    setSuccess(null);
    const { data, error: responseError } = await supabase.rpc('respond_to_trade_offer', {
      p_trade_offer_id: offerId,
      p_action: action,
    });
    if (responseError) {
      setError(responseError.message);
    } else {
      const status = data as string;
      setSuccess(status === 'REJECTED' && action === 'accept'
        ? 'This offer has expired and can no longer be accepted.'
        : action === 'accept'
          ? 'Offer accepted. Both items are reserved until both sellers confirm the handover.'
          : action === 'cancel' ? 'Your offer was cancelled.' : 'The offer was declined.');
      await loadTrades();
    }
    setActionLoading(null);
  }

  async function confirmExchange(offerId: string) {
    setActionLoading(offerId);
    setError(null);
    setSuccess(null);
    const { data, error: confirmError } = await supabase.rpc('confirm_trade_exchange', {
      p_trade_offer_id: offerId,
    });
    if (confirmError) {
      setError(confirmError.message);
    } else {
      const status = data as string;
      setSuccess(status === 'COMPLETED'
        ? 'Both sellers confirmed the exchange. The listings are now marked as exchanged.'
        : 'Your receipt is confirmed. The other seller must confirm before the trade is complete.');
      await loadTrades();
    }
    setActionLoading(null);
  }

  async function messageTradePartner(offerId: string) {
    setActionLoading(offerId);
    setError(null);
    const { data: conversationId, error: conversationError } = await supabase.rpc('get_or_create_trade_conversation', {
      p_trade_offer_id: offerId,
    });
    if (conversationError) {
      setError(conversationError.message);
    } else if (conversationId) {
      navigate({ name: 'messages', conversationId });
    } else {
      setError('Could not open a conversation for this trade.');
    }
    setActionLoading(null);
  }

  if (!authLoading && !user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <ArrowLeftRight className="mx-auto mb-4 h-10 w-10 text-ink-300" />
        <p className="mb-4 text-ink-500">Sign in to make or manage barter offers.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }

  const requestIsAvailable = Boolean(
    requestedListing
      && requestedListing.barter_enabled
      && requestedListing.status === 'active'
      && requestedListing.listing_type === 'fixed',
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">My Trades</h1>
          <p className="mt-1 text-sm text-ink-500">Exchange one barter-enabled item for another. No cash top-ups.</p>
        </div>
        <button onClick={() => navigate({ name: 'browse' })} className="btn-secondary text-sm">Browse items</button>
      </div>

      {error && <p role="alert" className="mb-4 rounded-lg border border-terracotta-200 bg-terracotta-50 p-3 text-sm text-terracotta-700">{error}</p>}
      {success && <p role="status" className="mb-4 rounded-lg border border-sage-200 bg-sage-50 p-3 text-sm text-sage-700">{success}</p>}

      {requestedListingId && (
        <section className="card mb-8 p-5">
          <h2 className="mb-1 text-lg font-semibold text-ink-900">Make a barter offer</h2>
          {requestedListing ? (
            <p className="mb-4 text-sm text-ink-600">
              Requested item: <span className="font-medium text-ink-900">{requestedListing.title}</span>
            </p>
          ) : (
            <p className="mb-4 text-sm text-ink-500">Loading requested item…</p>
          )}
          {requestedListing && !requestIsAvailable && (
            <p className="text-sm text-terracotta-700">This item is no longer available for barter.</p>
          )}
          {requestIsAvailable && availableOffers.length === 0 && (
            <p className="text-sm text-ink-500">
              You need an approved, active fixed-price listing with "Accept barter offers" enabled before you can make an offer.
            </p>
          )}
          {requestIsAvailable && availableOffers.length > 0 && (
            <form onSubmit={(event) => void submitOffer(event)} className="space-y-3">
              <label className="block text-xs font-medium text-ink-600" htmlFor="offered-listing">
                Choose one of your barter-enabled items
              </label>
              <select
                id="offered-listing"
                value={offeredListingId}
                onChange={(event) => setOfferedListingId(event.target.value)}
                className="input-field"
                required
              >
                <option value="">Select an item…</option>
                {availableOffers.map((listing) => (
                  <option key={listing.id} value={listing.id}>
                    {listing.title} — {formatPrice(Number(listing.price))}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-primary" disabled={actionLoading === 'create'}>
                {actionLoading === 'create' ? 'Sending offer…' : 'Send barter offer'}
              </button>
              <p className="text-xs text-ink-400">Offers expire after 72 hours. Sending an offer does not reserve either item.</p>
            </form>
          )}
        </section>
      )}

      {loading ? (
        <div className="card p-6 text-sm text-ink-500">Loading your trades…</div>
      ) : (
        <div className="space-y-8">
          <TradeSection
            title="Offers to you"
            offers={incomingOffers}
            currentUserId={user?.id || ''}
            actionLoading={actionLoading}
            onRespond={respond}
            onConfirm={confirmExchange}
            onMessage={messageTradePartner}
          />
          <TradeSection
            title="Offers you sent"
            offers={outgoingOffers}
            currentUserId={user?.id || ''}
            actionLoading={actionLoading}
            onRespond={respond}
            onConfirm={confirmExchange}
            onMessage={messageTradePartner}
          />
          {recommendedListings.length > 0 && (
            <section>
              <h2 className="mb-1 text-lg font-semibold text-ink-900">Suggested barter matches</h2>
              <p className="mb-3 text-xs text-ink-500">Matched to your active barter listings by category, era, and price range.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recommendedListings.map((listing) => (
                  <article key={listing.id} className="card overflow-hidden">
                    {listing.images[0] && <img src={listing.images[0]} alt="" className="h-36 w-full object-cover" />}
                    <div className="p-3">
                      <h3 className="truncate text-sm font-medium text-ink-900">{listing.title}</h3>
                      <p className="mt-1 text-xs text-ink-500">{formatPrice(Number(listing.price))}</p>
                      <button
                        type="button"
                        onClick={() => navigate({ name: 'trades', listingId: listing.id })}
                        className="btn-secondary mt-3 w-full text-xs"
                      >
                        Make an offer
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function TradeSection({
  title,
  offers,
  currentUserId,
  actionLoading,
  onRespond,
  onConfirm,
  onMessage,
}: {
  title: string;
  offers: TradeOfferWithItems[];
  currentUserId: string;
  actionLoading: string | null;
  onRespond: (offerId: string, action: 'accept' | 'reject' | 'cancel') => void;
  onConfirm: (offerId: string) => void;
  onMessage: (offerId: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-ink-900">{title}</h2>
      {offers.length === 0 ? (
        <div className="card p-5 text-sm text-ink-500">No offers yet.</div>
      ) : (
        <div className="space-y-3">
          {offers.map((offer) => {
            const isIncoming = offer.recipient_id === currentUserId;
            const myShipment = offer.trade_shipments?.find((shipment) => shipment.recipient_id === currentUserId);
            const canConfirm = ['ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B'].includes(offer.status)
              && myShipment?.status === 'PENDING';
            const isBusy = actionLoading === offer.id;

            return (
              <article key={offer.id} className="card p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900">
                    <ArrowLeftRight className="h-4 w-4 text-sage-600" />
                    {STATUS_LABELS[offer.status] || offer.status}
                  </span>
                  <span className="text-xs text-ink-400">
                    {offer.status === 'PENDING' ? (
                      <><Clock className="mr-1 inline h-3 w-3" />Expires {new Date(offer.expires_at).toLocaleString()}</>
                    ) : formatTimeAgo(offer.updated_at)}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  {(['OFFERED', 'REQUESTED'] as const).map((side) => {
                    const item = offer.trade_items.find((tradeItem) => tradeItem.side === side);
                    return (
                      <div key={side} className="flex items-center gap-3 rounded-lg bg-ink-50 p-3">
                        <div className="h-14 w-12 shrink-0 overflow-hidden rounded bg-ink-100">
                          {item?.listings?.images?.[0] && (
                            <img src={item.listings.images[0]} alt="" className="h-full w-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wide text-ink-400">
                            {side === 'OFFERED'
                              ? isIncoming ? 'They offer' : 'You offer'
                              : isIncoming ? 'Your item' : 'Requested item'}
                          </p>
                          <p className="truncate text-sm font-medium text-ink-900">{item?.title_snapshot || 'Listing unavailable'}</p>
                          <p className="text-xs text-ink-500">{formatPrice(Number(item?.price_snapshot || 0))}</p>
                        </div>
                      </div>
                    );
                  })}
                  <span className="hidden text-ink-400 sm:block">⇄</span>
                </div>

                <p className="mt-3 text-xs text-ink-400">Offer created {formatTimeAgo(offer.created_at)}</p>
                {['ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B'].includes(offer.status) && (
                  <div className="mt-3 rounded-lg border border-gold-200 bg-gold-50 p-3 text-xs text-gold-800">
                    Both items are reserved while this accepted exchange is in progress. Agree on a safe pickup or delivery with the other seller; each side must confirm receipt here to finish.
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {isIncoming && offer.status === 'PENDING' && (
                    <>
                      <button
                        type="button"
                        onClick={() => onRespond(offer.id, 'accept')}
                        disabled={isBusy}
                        className="btn-primary inline-flex items-center gap-1.5 text-sm"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => onRespond(offer.id, 'reject')}
                        disabled={isBusy}
                        className="btn-secondary text-sm"
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {!isIncoming && offer.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={() => onRespond(offer.id, 'cancel')}
                      disabled={isBusy}
                      className="btn-secondary text-sm"
                    >
                      Cancel offer
                    </button>
                  )}
                  {canConfirm && (
                    <button
                      type="button"
                      onClick={() => onConfirm(offer.id)}
                      disabled={isBusy}
                      className="btn-primary inline-flex items-center gap-1.5 text-sm"
                    >
                      <Package className="h-4 w-4" />
                      {isBusy ? 'Confirming…' : 'Confirm item received'}
                    </button>
                  )}
                  {['ACCEPTED', 'SHIPPED_BY_PARTY_A', 'SHIPPED_BY_PARTY_B'].includes(offer.status) && (
                    <button
                      type="button"
                      onClick={() => onMessage(offer.id)}
                      disabled={isBusy}
                      className="btn-secondary inline-flex items-center gap-1.5 text-sm"
                    >
                      <MessageCircle className="h-4 w-4" /> Message other seller
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
