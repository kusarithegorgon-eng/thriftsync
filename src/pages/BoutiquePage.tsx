import { useEffect, useState } from 'react';
import { MapPin, Star, Package, Shield, Clock } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Boutique, type Listing, type Review, type SellerReview } from '@/lib/supabase';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { ReportSubmissionModal } from '@/components/ReportSubmissionModal';

export function BoutiquePage({ slug }: { slug: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [sellerReviews, setSellerReviews] = useState<Pick<SellerReview, 'accuracy_rating' | 'communication_rating' | 'punctuality_rating'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: boutiqueData } = await supabase
        .from('boutiques')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (!boutiqueData) {
        setLoading(false);
        return;
      }

      setBoutique(boutiqueData as Boutique);

      const { data: listingData } = await supabase
        .from('listings')
        .select('*')
        .eq('boutique_id', (boutiqueData as Boutique).id)
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      setListings((listingData as Listing[]) || []);

      const { data: reviewData } = await supabase
        .from('reviews')
        .select('*')
        .eq('boutique_id', (boutiqueData as Boutique).id)
        .order('created_at', { ascending: false })
        .limit(5);
      setReviews((reviewData as Review[]) || []);

      const { data: sellerReviewData, error: sellerReviewError } = await supabase
        .from('seller_review_scores')
        .select('accuracy_rating, communication_rating, punctuality_rating')
        .eq('seller_id', (boutiqueData as Boutique).seller_id);
      if (sellerReviewError) console.error('Seller reputation load error:', sellerReviewError);
      setSellerReviews(sellerReviewData || []);

      setLoading(false);
    }
    load();
  }, [slug]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="h-48 skeleton rounded-2xl mb-6" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <ListingCardSkeleton key={i} />)}
        </div>
      </div>
    );
  }

  if (!boutique) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 text-center">
        <p className="text-ink-500 mb-4">Boutique not found.</p>
        <button onClick={() => navigate({ name: 'browse' })} className="btn-primary">Back to Browse</button>
      </div>
    );
  }

  const ratingAverage = (key: 'accuracy_rating' | 'communication_rating' | 'punctuality_rating') => (
    sellerReviews.length > 0
      ? sellerReviews.reduce((sum, review) => sum + review[key], 0) / sellerReviews.length
      : 0
  );

  return (
    <div className="animate-fade-in">
      {/* Banner */}
      <div className="relative h-48 sm:h-64 overflow-hidden">
        {boutique.banner_url ? (
          <img src={boutique.banner_url} alt={boutique.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-ink-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/60 to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Profile header */}
        <div className="flex flex-col sm:flex-row gap-4 -mt-12 sm:-mt-16 relative z-10">
          <div className="flex items-end gap-4">
            {boutique.logo_url ? (
              <img src={boutique.logo_url} alt="" className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-4 border-cream shadow-lg" />
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-sage-500 border-4 border-cream shadow-lg flex items-center justify-center text-cream text-2xl font-bold">
                {boutique.name.charAt(0)}
              </div>
            )}
          </div>
          <div className="flex-1 sm:pb-4">
            <h1 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900">{boutique.name}</h1>
            {boutique.tagline && <p className="text-sm text-ink-600 mt-0.5">{boutique.tagline}</p>}
            <div className="flex flex-wrap items-center gap-3 mt-2 text-sm">
              <span className="flex items-center gap-1 text-gold-600 font-medium">
                <Star className="w-4 h-4 fill-gold-500 text-gold-500" />
                {Number(boutique.seller_rating_avg).toFixed(1)} ({boutique.seller_rating_count} verified)
              </span>
              {boutique.location && (
                <span className="flex items-center gap-1 text-ink-500">
                  <MapPin className="w-4 h-4" />{boutique.location}
                </span>
              )}
              <span className="flex items-center gap-1 text-ink-500">
                <Package className="w-4 h-4" />{listings.length} items
              </span>
            </div>
          </div>
        </div>

        {/* Bio */}
        {boutique.bio && (
          <div className="mt-6 max-w-2xl">
            <p className="text-sm text-ink-600 leading-relaxed">{boutique.bio}</p>
          </div>
        )}

        {/* Trust badges */}
        <div className="flex flex-wrap gap-3 mt-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-sage-50 text-sage-700 rounded-lg text-xs font-medium">
            <Shield className="w-3.5 h-3.5" /> Escrow Protected
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-ink-50 text-ink-600 rounded-lg text-xs font-medium">
            <Clock className="w-3.5 h-3.5" /> Joined {new Date(boutique.created_at).getFullYear()}
          </div>
          {user && (
            <button
              type="button"
              onClick={() => setShowReportModal(true)}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              Report Seller
            </button>
          )}
        </div>

        {/* Policies */}
        {boutique.policies && (
          <div className="mt-6 card p-4">
            <h3 className="text-sm font-medium text-ink-900 mb-2">Shop Policies</h3>
            <p className="text-sm text-ink-600 leading-relaxed">{boutique.policies}</p>
          </div>
        )}

        {/* Listings */}
        <div className="mt-8">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-4">Available Items</h2>
          {listings.length === 0 ? (
            <p className="text-ink-500 text-sm">No items currently available.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {listings.map((listing) => (
                <ListingCard key={listing.id} listing={{ ...listing, boutiques: {
                  id: boutique.id, name: boutique.name, slug: boutique.slug, logo_url: boutique.logo_url,
                  seller_id: boutique.seller_id, seller_rating_avg: boutique.seller_rating_avg, seller_rating_count: boutique.seller_rating_count,
                } }} />
              ))}
            </div>
          )}
        </div>

        {sellerReviews.length > 0 && (
          <section className="mt-10 card p-4">
            <h2 className="font-serif text-xl font-bold text-ink-900">Verified Seller Reputation</h2>
            <p className="mb-4 text-xs text-ink-500">Ratings from completed orders · {sellerReviews.length} review{sellerReviews.length === 1 ? '' : 's'}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <RatingBreakdown label="Item accuracy" value={ratingAverage('accuracy_rating')} />
              <RatingBreakdown label="Communication speed" value={ratingAverage('communication_rating')} />
              <RatingBreakdown label="Locker drop-off punctuality" value={ratingAverage('punctuality_rating')} />
            </div>
          </section>
        )}

        {/* Reviews */}
        {reviews.length > 0 && (
          <div className="mt-12">
            <h2 className="font-serif text-xl font-bold text-ink-900 mb-4">Customer Reviews</h2>
            <div className="space-y-3">
              {reviews.map((review) => (
                <div key={review.id} className="card p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={i < review.rating ? 'w-3.5 h-3.5 fill-gold-500 text-gold-500' : 'w-3.5 h-3.5 text-ink-200'} />
                      ))}
                    </div>
                  </div>
                  {review.body && <p className="text-sm text-ink-600 leading-relaxed">{review.body}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {boutique && (
        <ReportSubmissionModal
          open={showReportModal}
          onClose={() => setShowReportModal(false)}
          listingId={null}
          sellerId={boutique.seller_id}
          orderId={null}
          defaultCategory="illegal_item"
          title="Report Seller"
          fraudEligible={false}
        />
      )}
    </div>
  );
}

function RatingBreakdown({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-ink-50 p-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-ink-900">
        <Star className="h-4 w-4 fill-gold-500 text-gold-500" /> {value.toFixed(1)} / 5
      </p>
    </div>
  );
}
