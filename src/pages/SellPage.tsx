import { useState } from 'react';
import { Store, ArrowRight, Check, Gavel, TrendingUp, Shield, Package } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { CATEGORIES, ERAS, CONDITIONS, slugify } from '@/lib/utils';

export function SellPage() {
  const { navigate } = useRouter();
  const { user, profile } = useAuth();
  const [step, setStep] = useState<'intro' | 'boutique' | 'listing'>('intro');
  const [boutiqueName, setBoutiqueName] = useState('');
  const [boutiqueTagline, setBoutiqueTagline] = useState('');
  const [boutiqueBio, setBoutiqueBio] = useState('');
  const [boutiqueLocation, setBoutiqueLocation] = useState('');
  const [boutiquePolicies, setBoutiquePolicies] = useState('');

  const [listingTitle, setListingTitle] = useState('');
  const [listingDesc, setListingDesc] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [listingEra, setListingEra] = useState('');
  const [listingCategory, setListingCategory] = useState('');
  const [listingCondition, setListingCondition] = useState('');
  const [listingMaterial, setListingMaterial] = useState('');
  const [listingType, setListingType] = useState<'fixed' | 'auction'>('fixed');
  const [imageUrl, setImageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ink-100 mb-4">
          <Store className="w-8 h-8 text-ink-400" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Open your boutique</h1>
        <p className="text-sm text-ink-500 mb-6">Sign in to start selling vintage and one-of-a-kind goods on ThriftSync.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary inline-flex items-center gap-2">
          Sign In to Start Selling <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  async function handleCreateBoutique(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);

    const { data, error: boutiqueError } = await supabase
      .from('boutiques')
      .insert({
        seller_id: user.id,
        name: boutiqueName,
        slug: slugify(boutiqueName) + '-' + Date.now().toString(36).slice(-4),
        tagline: boutiqueTagline,
        bio: boutiqueBio,
        location: boutiqueLocation,
        policies: boutiquePolicies,
        rating_avg: 0,
        rating_count: 0,
      })
      .select()
      .maybeSingle();

    if (boutiqueError) {
      setError(boutiqueError.message);
      setSubmitting(false);
      return;
    }

    if (data) {
      setStep('listing');
    }
    setSubmitting(false);
  }

  async function handleCreateListing(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);

    const { data: boutique } = await supabase
      .from('boutiques')
      .select('id')
      .eq('seller_id', user.id)
      .maybeSingle();

    if (!boutique) {
      setError('No boutique found. Please create one first.');
      setSubmitting(false);
      return;
    }

    const { error: listingError } = await supabase
      .from('listings')
      .insert({
        boutique_id: boutique.id,
        title: listingTitle,
        description: listingDesc,
        price: parseFloat(listingPrice),
        era: listingEra || null,
        category: listingCategory || null,
        condition_grade: listingCondition || null,
        material: listingMaterial || null,
        images: imageUrl ? [imageUrl] : [],
        listing_type: listingType,
        auction_end_at: listingType === 'auction' ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null,
        reserve_price: listingType === 'auction' ? parseFloat(listingPrice) : null,
        status: 'active',
        sku: 'TS-' + Date.now().toString(36).slice(-6).toUpperCase(),
        coa_verified: false,
        views: 0,
      });

    if (listingError) {
      setError(listingError.message);
      setSubmitting(false);
      return;
    }

    setSuccess(true);
    setSubmitting(false);
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-sage-100 mb-4">
          <Check className="w-8 h-8 text-sage-600" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Listing Published!</h1>
        <p className="text-sm text-ink-500 mb-6">Your item is now live on ThriftSync and visible to buyers worldwide.</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => navigate({ name: 'dashboard' })} className="btn-primary">Go to Dashboard</button>
          <button
            onClick={() => {
              setSuccess(false);
              setListingTitle('');
              setListingDesc('');
              setListingPrice('');
              setListingEra('');
              setListingCategory('');
              setListingCondition('');
              setListingMaterial('');
              setImageUrl('');
            }}
            className="btn-secondary"
          >
            List Another Item
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {step === 'intro' && (
        <>
          <div className="text-center mb-8">
            <h1 className="font-serif text-3xl font-bold text-ink-900 mb-2">Start Selling on ThriftSync</h1>
            <p className="text-sm text-ink-500">Join a community of vintage boutiques and reach collectors worldwide.</p>
          </div>

          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            <FeatureCard icon={<Store className="w-5 h-5" />} title="Open a Boutique" desc="Create your storefront with custom branding, policies, and bio." />
            <FeatureCard icon={<Package className="w-5 h-5" />} title="List 1-of-1 Items" desc="Every item is unique. Track SKUs, era, condition, and authenticity." />
            <FeatureCard icon={<TrendingUp className="w-5 h-5" />} title="Track Performance" desc="Monitor GMV, conversion rates, and inventory velocity." />
          </div>

          <div className="card p-6">
            <h2 className="font-serif text-xl font-bold text-ink-900 mb-2">Why sell with us?</h2>
            <div className="space-y-2 mb-6">
              {[
                'Escrow-protected payments — funds held until delivery confirmation',
                'Live auction engine with anti-snipe soft-close timers',
                'Certificate of Authenticity verification for luxury pieces',
                'Multi-channel inventory sync to prevent double-selling',
                'Carbon offset tracking for sustainability-conscious buyers',
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-ink-600">
                  <Check className="w-4 h-4 text-sage-600 mt-0.5 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
            <button onClick={() => setStep('boutique')} className="w-full btn-primary py-3 flex items-center justify-center gap-2">
              {profile?.role === 'seller' ? 'List a New Item' : 'Get Started'} <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {step === 'boutique' && (
        <div className="card p-6 animate-slide-down">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-1">Create Your Boutique</h2>
          <p className="text-sm text-ink-500 mb-5">Set up your storefront profile. You can edit this later.</p>

          <form onSubmit={handleCreateBoutique} className="space-y-4">
            <FormField label="Boutique Name" required>
              <input type="text" value={boutiqueName} onChange={(e) => setBoutiqueName(e.target.value)} className="input-field" placeholder="e.g. Velvet & Vinyl" required />
            </FormField>
            <FormField label="Tagline">
              <input type="text" value={boutiqueTagline} onChange={(e) => setBoutiqueTagline(e.target.value)} className="input-field" placeholder="A short description of your shop" />
            </FormField>
            <FormField label="Bio">
              <textarea value={boutiqueBio} onChange={(e) => setBoutiqueBio(e.target.value)} className="input-field min-h-[80px] resize-none" placeholder="Tell buyers about your curation philosophy..." />
            </FormField>
            <FormField label="Location">
              <input type="text" value={boutiqueLocation} onChange={(e) => setBoutiqueLocation(e.target.value)} className="input-field" placeholder="City, State" />
            </FormField>
            <FormField label="Shop Policies">
              <textarea value={boutiquePolicies} onChange={(e) => setBoutiquePolicies(e.target.value)} className="input-field min-h-[60px] resize-none" placeholder="Return policy, shipping info, etc." />
            </FormField>

            {error && <p className="text-sm text-terracotta-600">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full btn-primary py-3">
              {submitting ? 'Creating...' : 'Create Boutique & Continue'}
            </button>
          </form>
        </div>
      )}

      {step === 'listing' && (
        <div className="card p-6 animate-slide-down">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-1">List an Item</h2>
          <p className="text-sm text-ink-500 mb-5">Create a listing for your one-of-a-kind piece.</p>

          <form onSubmit={handleCreateListing} className="space-y-4">
            <FormField label="Item Title" required>
              <input type="text" value={listingTitle} onChange={(e) => setListingTitle(e.target.value)} className="input-field" placeholder="e.g. Psychedelic Silk Caftan 1969" required />
            </FormField>
            <FormField label="Description" required>
              <textarea value={listingDesc} onChange={(e) => setListingDesc(e.target.value)} className="input-field min-h-[100px] resize-none" placeholder="Describe the item, its condition, provenance, and any notable details..." required />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Price (USD)" required>
                <input type="number" step="0.01" value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} className="input-field" placeholder="0.00" required />
              </FormField>
              <FormField label="Listing Type">
                <select value={listingType} onChange={(e) => setListingType(e.target.value as 'fixed' | 'auction')} className="input-field">
                  <option value="fixed">Fixed Price</option>
                  <option value="auction">Auction (7 days)</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Era">
                <select value={listingEra} onChange={(e) => setListingEra(e.target.value)} className="input-field">
                  <option value="">Select era...</option>
                  {ERAS.map((era) => <option key={era} value={era}>{era}</option>)}
                </select>
              </FormField>
              <FormField label="Category">
                <select value={listingCategory} onChange={(e) => setListingCategory(e.target.value)} className="input-field">
                  <option value="">Select category...</option>
                  {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Condition">
                <select value={listingCondition} onChange={(e) => setListingCondition(e.target.value)} className="input-field">
                  <option value="">Select condition...</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField label="Material">
                <input type="text" value={listingMaterial} onChange={(e) => setListingMaterial(e.target.value)} className="input-field" placeholder="e.g. Silk, Leather" />
              </FormField>
            </div>
            <FormField label="Image URL">
              <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="input-field" placeholder="https://..." />
            </FormField>

            {error && <p className="text-sm text-terracotta-600">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full btn-primary py-3">
              {submitting ? 'Publishing...' : 'Publish Listing'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="card p-4">
      <div className="w-10 h-10 rounded-lg bg-sage-50 text-sage-700 flex items-center justify-center mb-3">{icon}</div>
      <h3 className="text-sm font-medium text-ink-900 mb-1">{title}</h3>
      <p className="text-xs text-ink-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function FormField({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-ink-700 mb-1.5 block">
        {label}{required && <span className="text-terracotta-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
