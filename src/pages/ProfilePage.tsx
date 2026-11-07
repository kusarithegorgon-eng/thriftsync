import { useEffect, useState } from 'react';
import { ArrowLeft, Star, Store, UserRound } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { supabase, type Boutique, type Profile } from '@/lib/supabase';

export function ProfilePage({ profileId }: { profileId: string }) {
  const { navigate } = useRouter();
  const [member, setMember] = useState<Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'bio' | 'created_at'> | null>(null);
  const [boutique, setBoutique] = useState<Pick<Boutique, 'slug' | 'name' | 'seller_rating_avg' | 'seller_rating_count'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('id, display_name, avatar_url, bio, created_at')
        .eq('id', profileId)
        .maybeSingle();
      if (!active) return;
      if (profileError) {
        setError(profileError.message);
        return;
      }
      if (!data) return;
      setMember(data);

      const { data: boutiqueData, error: boutiqueError } = await supabase
        .from('boutiques')
        .select('slug, name, seller_rating_avg, seller_rating_count')
        .eq('seller_id', profileId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      if (boutiqueError) {
        setError(boutiqueError.message);
        return;
      }
      setBoutique(boutiqueData);
    }
    void load();
    return () => { active = false; };
  }, [profileId]);

  if (!member && !error) {
    return <div className="mx-auto max-w-3xl px-4 py-20 text-center text-sm text-ink-500">Loading profile…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <button onClick={() => navigate({ name: 'browse' })} className="mb-6 inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Back to collection
      </button>
      {error && <p role="alert" className="mb-4 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">{error}</p>}
      {!member ? (
        <p className="card p-8 text-center text-sm text-ink-500">This profile is unavailable.</p>
      ) : (
        <section className="card p-6">
          <div className="flex items-center gap-4">
            {member.avatar_url ? (
              <img src={member.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ink-100 text-ink-500">
                <UserRound className="h-8 w-8" />
              </div>
            )}
            <div>
              <h1 className="font-serif text-2xl font-bold text-ink-900">{member.display_name || 'ThriftSync member'}</h1>
              <p className="text-xs text-ink-500">Member since {new Date(member.created_at).toLocaleDateString()}</p>
            </div>
          </div>
          {member.bio && <p className="mt-5 text-sm leading-relaxed text-ink-600">{member.bio}</p>}
          {boutique && (
            <button
              onClick={() => navigate({ name: 'boutique', slug: boutique.slug })}
              className="mt-6 flex w-full items-center gap-3 rounded-xl bg-ink-50 p-4 text-left hover:bg-ink-100"
            >
              <Store className="h-5 w-5 text-sage-700" />
              <span className="flex-1 text-sm font-medium text-ink-900">{boutique.name}</span>
              {boutique.seller_rating_count > 0 && (
                <span className="flex items-center gap-1 text-xs text-ink-600">
                  <Star className="h-3.5 w-3.5 fill-gold-500 text-gold-500" />
                  {Number(boutique.seller_rating_avg).toFixed(1)} ({boutique.seller_rating_count})
                </span>
              )}
            </button>
          )}
        </section>
      )}
    </div>
  );
}
