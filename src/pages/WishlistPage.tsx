import { useEffect, useState } from 'react';
import { Heart, ArrowRight } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type ListingWithBoutique } from '@/lib/supabase';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';

export function WishlistPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [wishlistItems, setWishlistItems] = useState<ListingWithBoutique[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('wishlists')
        .select('listing_id, listings(*, boutiques(id, name, slug, logo_url))')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      const items = ((data as any[]) || [])
        .filter((w) => w.listings)
        .map((w) => w.listings) as ListingWithBoutique[];
      setWishlistItems(items);
      setLoading(false);
    }
    load();
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ink-100 mb-4">
          <Heart className="w-8 h-8 text-ink-400" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Sign in to view your wishlist</h1>
        <p className="text-sm text-ink-500 mb-6">Save your favorite vintage finds and get notified about price drops.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary inline-flex items-center gap-2">
          Sign In <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <h1 className="font-serif text-2xl font-bold text-ink-900 mb-1">Your Wishlist</h1>
      <p className="text-sm text-ink-500 mb-6">
        {loading ? 'Loading...' : `${wishlistItems.length} saved item${wishlistItems.length !== 1 ? 's' : ''}`}
      </p>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {Array.from({ length: 4 }).map((_, i) => <ListingCardSkeleton key={i} />)}
        </div>
      ) : wishlistItems.length === 0 ? (
        <div className="text-center py-20">
          <Heart className="w-12 h-12 text-ink-300 mx-auto mb-4" />
          <p className="text-ink-500 mb-2">No saved items yet</p>
          <button onClick={() => navigate({ name: 'browse' })} className="btn-secondary">Browse Collection</button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {wishlistItems.map((item) => <ListingCard key={item.id} listing={item} />)}
        </div>
      )}
    </div>
  );
}
