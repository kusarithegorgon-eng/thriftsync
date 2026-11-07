import { useEffect, useState } from 'react';
import { ArrowRight, Gavel, BadgeCheck, Shield, Truck, Sparkles, TrendingUp } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { supabase, type ListingWithBoutique, type Boutique } from '@/lib/supabase';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { formatPrice } from '@/lib/utils';

export function HomePage() {
  const { navigate } = useRouter();
  const [featuredListings, setFeaturedListings] = useState<ListingWithBoutique[]>([]);
  const [auctionListings, setAuctionListings] = useState<ListingWithBoutique[]>([]);
  const [boutiques, setBoutiques] = useState<Boutique[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [featuredRes, auctionRes, boutiqueRes] = await Promise.all([
        supabase
          .from('listings')
          .select('*, boutiques(id, name, slug, logo_url, seller_id, seller_rating_avg, seller_rating_count)')
          .eq('status', 'active')
          .eq('moderation_status', 'approved')
          .eq('listing_type', 'fixed')
          .order('views', { ascending: false })
          .limit(8),
        supabase
          .from('listings')
          .select('*, boutiques(id, name, slug, logo_url, seller_id, seller_rating_avg, seller_rating_count)')
          .eq('status', 'active')
          .eq('moderation_status', 'approved')
          .eq('listing_type', 'auction')
          .order('views', { ascending: false })
          .limit(4),
        supabase
          .from('boutiques')
          .select('*')
          .order('rating_avg', { ascending: false })
          .limit(4),
      ]);

      setFeaturedListings(featuredRes.data as ListingWithBoutique[] || []);
      setAuctionListings(auctionRes.data as ListingWithBoutique[] || []);
      setBoutiques(boutiqueRes.data as Boutique[] || []);
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative h-[70vh] min-h-[500px] overflow-hidden">
        <div className="absolute inset-0">
          <img
            src="https://images.pexels.com/photos/5018379/pexels-photo-5018379.jpeg?auto=compress&cs=tinysrgb&h=900&w=1600"
            alt="Vintage boutique"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/50 via-ink-950/30 to-ink-950/60" />
        </div>

        <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col justify-center">
          <div className="max-w-2xl animate-slide-up">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-cream/90 backdrop-blur-sm rounded-full mb-5">
              <Sparkles className="w-3.5 h-3.5 text-terracotta-500" />
              <span className="text-xs font-medium text-ink-900">One-of-a-kind vintage marketplace</span>
            </div>
            <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-bold text-cream leading-[1.1] tracking-tight text-balance">
              Every piece has a story.<br />
              <span className="italic text-terracotta-200">Yours to continue.</span>
            </h1>
            <p className="mt-5 text-base sm:text-lg text-cream/80 leading-relaxed max-w-xl">
              Discover curated vintage from independent boutiques. Bid on rare finds, verify authenticity, and shop with confidence through our escrow-protected marketplace.
            </p>
            <div className="mt-7 flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => navigate({ name: 'browse' })}
                className="px-6 py-3 bg-cream text-ink-900 rounded-lg font-medium text-sm hover:bg-white transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 group"
              >
                Browse Collection
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </button>
              <button
                onClick={() => navigate({ name: 'sell' })}
                className="px-6 py-3 bg-ink-900/40 backdrop-blur-sm text-cream border border-cream/30 rounded-lg font-medium text-sm hover:bg-ink-900/60 transition-all flex items-center justify-center gap-2"
              >
                Open a Boutique
              </button>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="absolute bottom-0 left-0 right-0 bg-ink-950/60 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="font-serif text-2xl font-bold text-cream">2,400+</p>
                <p className="text-xs text-cream/60">Unique Items</p>
              </div>
              <div className="border-x border-cream/20">
                <p className="font-serif text-2xl font-bold text-cream">180+</p>
                <p className="text-xs text-cream/60">Boutiques</p>
              </div>
              <div>
                <p className="font-serif text-2xl font-bold text-cream">₱4.2M</p>
                <p className="text-xs text-cream/60">GMV This Year</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust badges */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <TrustBadge icon={<Shield className="w-5 h-5" />} title="Escrow Protected" desc="Funds held until delivery" />
          <TrustBadge icon={<BadgeCheck className="w-5 h-5" />} title="Authenticity Verified" desc="COA on luxury pieces" />
          <TrustBadge icon={<Gavel className="w-5 h-5" />} title="Live Auctions" desc="Anti-snipe soft-close" />
          <TrustBadge icon={<Truck className="w-5 h-5" />} title="Tracked Shipping" desc="Carbon offset included" />
        </div>
      </section>

      {/* Live auctions */}
      {auctionListings.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-end justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-terracotta-500 animate-pulse-soft" />
                <span className="text-xs font-medium text-terracotta-600 uppercase tracking-wide">Live Now</span>
              </div>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900">Auctions Ending Soon</h2>
            </div>
            <button
              onClick={() => navigate({ name: 'browse' })}
              className="hidden sm:flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 transition-colors link-underline"
            >
              View all <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
            {loading
              ? Array.from({ length: 4 }).map((_, i) => <ListingCardSkeleton key={i} />)
              : auctionListings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
          </div>
        </section>
      )}

      {/* Featured listings */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-sage-600" />
              <span className="text-xs font-medium text-sage-700 uppercase tracking-wide">Most Viewed</span>
            </div>
            <h2 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900">Featured Finds</h2>
          </div>
          <button
            onClick={() => navigate({ name: 'browse' })}
            className="hidden sm:flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 transition-colors link-underline"
          >
            View all <ArrowRight className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <ListingCardSkeleton key={i} />)
            : featuredListings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
        </div>
      </section>

      {/* Era categories */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 mb-6 text-center">Shop by Era</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { era: '1950s', label: '1950s', desc: 'Atomic Age', img: 'https://images.pexels.com/photos/16332393/pexels-photo-16332393.jpeg?auto=compress&cs=tinysrgb&h=400&w=400' },
            { era: '1960s', label: '1960s', desc: 'Mod Revolution', img: 'https://images.pexels.com/photos/13320317/pexels-photo-13320317.jpeg?auto=compress&cs=tinysrgb&h=400&w=400' },
            { era: '1970s', label: '1970s', desc: 'Bohemian Spirit', img: 'https://images.pexels.com/photos/14789186/pexels-photo-14789186.jpeg?auto=compress&cs=tinysrgb&h=400&w=400' },
            { era: '1980s', label: '1980s', desc: 'Bold & Bright', img: 'https://images.pexels.com/photos/20543563/pexels-photo-20543563.jpeg?auto=compress&cs=tinysrgb&h=400&w=400' },
          ].map((cat) => (
            <button
              key={cat.era}
              onClick={() => navigate({ name: 'browse', era: cat.era })}
              className="group relative aspect-square rounded-2xl overflow-hidden"
            >
              <img src={cat.img} alt={cat.label} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink-950/70 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4 text-left">
                <p className="font-serif text-xl font-bold text-cream">{cat.label}</p>
                <p className="text-xs text-cream/70">{cat.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Featured boutiques */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h2 className="font-serif text-2xl sm:text-3xl font-bold text-ink-900 mb-6">Featured Boutiques</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {boutiques.map((boutique) => (
            <button
              key={boutique.id}
              onClick={() => navigate({ name: 'boutique', slug: boutique.slug })}
              className="group card overflow-hidden text-left hover:shadow-md transition-shadow"
            >
              <div className="aspect-[16/9] overflow-hidden bg-ink-100">
                {boutique.banner_url && (
                  <img src={boutique.banner_url} alt={boutique.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                )}
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  {boutique.logo_url ? (
                    <img src={boutique.logo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-sage-500 flex items-center justify-center text-cream text-sm font-bold">
                      {boutique.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-medium text-ink-900 group-hover:text-terracotta-600 transition-colors">{boutique.name}</h3>
                    {boutique.location && <p className="text-xs text-ink-500">{boutique.location}</p>}
                  </div>
                </div>
                {boutique.tagline && <p className="text-xs text-ink-600 line-clamp-2">{boutique.tagline}</p>}
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs font-medium text-gold-600">★ {Number(boutique.rating_avg).toFixed(1)}</span>
                  <span className="text-xs text-ink-400">({boutique.rating_count})</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* Sustainability banner */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="rounded-2xl bg-sage-900 overflow-hidden relative">
          <div className="absolute inset-0 opacity-10">
            <img src="https://images.pexels.com/photos/6070061/pexels-photo-6070061.jpeg?auto=compress&cs=tinysrgb&h=400&w=1200" alt="" className="w-full h-full object-cover" />
          </div>
          <div className="relative p-8 sm:p-12">
            <div className="max-w-xl">
              <p className="text-xs font-medium text-sage-300 uppercase tracking-wide mb-2">Sustainability Impact</p>
              <h2 className="font-serif text-2xl sm:text-3xl font-bold text-cream mb-3">
                Every purchase diverts textiles from landfills
              </h2>
              <p className="text-sm text-cream/70 leading-relaxed mb-4">
                ThriftSync tracks the carbon savings and waste diversion of every transaction. Join a community that's kept over 12 tons of clothing out of landfills this year.
              </p>
              <div className="flex gap-6">
                <div>
                  <p className="font-serif text-2xl font-bold text-sage-300">12.4t</p>
                  <p className="text-xs text-cream/60">CO₂ Saved</p>
                </div>
                <div>
                  <p className="font-serif text-2xl font-bold text-sage-300">8,900</p>
                  <p className="text-xs text-cream/60">Items Rescued</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function TrustBadge({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 p-4 card">
      <div className="w-10 h-10 rounded-lg bg-sage-50 text-sage-700 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="text-xs text-ink-500">{desc}</p>
      </div>
    </div>
  );
}
