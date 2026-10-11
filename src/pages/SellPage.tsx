import { useEffect, useState, useRef, useCallback } from 'react';
import { Upload, X, Camera, AlertTriangle, Check, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { supabase, type Boutique, type ImageMetadata, type ImageAngle } from '@/lib/supabase';
import { resizeImage, CEBU_BARANGAYS, isWithinCebu, findNearestBarangay, cn } from '@/lib/utils';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';

type UploadedImage = {
  url: string;
  angle: ImageAngle;
  is_flaw: boolean;
  caption: string;
};

const ANGLE_OPTIONS: { value: ImageAngle; label: string; required: boolean }[] = [
  { value: 'front', label: 'Front', required: true },
  { value: 'back', label: 'Back', required: true },
  { value: 'left', label: 'Left Side', required: false },
  { value: 'right', label: 'Right Side', required: false },
  { value: 'detail', label: 'Detail Shot', required: false },
  { value: 'flaw', label: 'Flaw / Damage', required: true },
  { value: 'tag', label: 'Brand Tag', required: false },
];

export function SellPage() {
  const { navigate } = useRouter();
  const { user, profile } = useAuth();
  const [step, setStep] = useState<'intro' | 'boutique' | 'listing'>('intro');
  const [store, setStore] = useState<Pick<Boutique, 'id' | 'name'> | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [boutiqueName, setBoutiqueName] = useState('');
  const [boutiqueTagline, setBoutiqueTagline] = useState('');
  const [boutiqueBio, setBoutiqueBio] = useState('');
  const [boutiqueBarangay, setBoutiqueBarangay] = useState('');
  const [boutiqueCity, setBoutiqueCity] = useState('Cebu City');
  const [boutiqueLat, setBoutiqueLat] = useState<number | null>(null);
  const [boutiqueLng, setBoutiqueLng] = useState<number | null>(null);
  const [boutiquePickup, setBoutiquePickup] = useState(false);
  const [boutiqueCourier, setBoutiqueCourier] = useState(true);
  const [boutiquePolicies, setBoutiquePolicies] = useState('');

  const [listingTitle, setListingTitle] = useState('');
  const [listingDesc, setListingDesc] = useState('');
  const [listingPrice, setListingPrice] = useState('');
  const [listingEra, setListingEra] = useState('');
  const [listingCategory, setListingCategory] = useState('');
  const [listingCondition, setListingCondition] = useState('');
  const [listingMaterial, setListingMaterial] = useState('');
  const [listingType, setListingType] = useState<'fixed' | 'auction'>('fixed');
  const [auctionMode, setAuctionMode] = useState<'ENGLISH' | 'DUTCH'>('ENGLISH');
  const [auctionDays, setAuctionDays] = useState('7');
  const [incrementStep, setIncrementStep] = useState('');
  const [dutchStartPrice, setDutchStartPrice] = useState('');
  const [dutchFloorPrice, setDutchFloorPrice] = useState('');
  const [decrementRate, setDecrementRate] = useState('5');
  const [decrementInterval, setDecrementInterval] = useState('60');

  const [images, setImages] = useState<UploadedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAngle, setPendingAngle] = useState<ImageAngle>('front');

  useEffect(() => {
    let cancelled = false;

    async function loadStore() {
      if (!user) {
        setStoreLoading(false);
        return;
      }
      const { data, error: storeError } = await supabase
        .from('boutiques')
        .select('id, name')
        .eq('seller_id', user.id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (storeError) {
        setError(storeError.message);
      } else if (data) {
        setStore(data as Pick<Boutique, 'id' | 'name'>);
        setStep('listing');
      }
      setStoreLoading(false);
    }

    loadStore();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ink-100 mb-4">
          <Upload className="w-8 h-8 text-ink-400" />
        </div>
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Open your boutique</h1>
        <p className="text-sm text-ink-500 mb-6">Sign in to start selling vintage and one-of-a-kind goods on ThriftSync.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In to Start Selling</button>
      </div>
    );
  }

  const barangays = CEBU_BARANGAYS.filter((b) => b.city === boutiqueCity);

  function handleBarangaySelect(name: string) {
    setBoutiqueBarangay(name);
    const b = CEBU_BARANGAYS.find((x) => x.name === name && x.city === boutiqueCity);
    if (b) {
      setBoutiqueLat(b.lat);
      setBoutiqueLng(b.lng);
    }
  }

  async function handleImageUpload(files: FileList, angle: ImageAngle) {
    setUploading(true);
    setUploadError(null);

    const file = files[0];
    if (!file) {
      setUploading(false);
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setUploadError('Image must be under 10MB');
      setUploading(false);
      return;
    }

    try {
      if (!user) throw new Error('Sign in to upload images.');
      const resized = await resizeImage(file, 1200, 1600, 0.85);
      const resizedFile = new File([resized], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });

      const filePath = `${user.id}/${crypto.randomUUID()}.jpg`;
      const { error: storageError } = await supabase.storage
        .from('listing-images')
        .upload(filePath, resizedFile, { contentType: 'image/jpeg', upsert: false });
      if (storageError) throw storageError;
      const { data: { publicUrl } } = supabase.storage
        .from('listing-images')
        .getPublicUrl(filePath);
      const isFlaw = angle === 'flaw';
      setImages((prev) => {
        const filtered = prev.filter((img) => img.angle !== angle);
        return [...filtered, { url: publicUrl, angle, is_flaw: isFlaw, caption: '' }];
      });
    } catch (err: any) {
      setUploadError(err.message || 'Failed to upload image');
    } finally {
      setUploading(false);
    }
  }

  function removeImage(angle: ImageAngle) {
    setImages((prev) => prev.filter((img) => img.angle !== angle));
  }

  function updateCaption(angle: ImageAngle, caption: string) {
    setImages((prev) => prev.map((img) => (img.angle === angle ? { ...img, caption } : img)));
  }

  const requiredAngles = ANGLE_OPTIONS.filter((a) => a.required);
  const hasAllRequired = requiredAngles.every((req) => images.some((img) => img.angle === req.value));

  async function handleCreateBoutique(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);

    if (!boutiqueLat || !boutiqueLng) {
      setError('Please select a barangay to set your boutique coordinates within Cebu.');
      setSubmitting(false);
      return;
    }

    if (!isWithinCebu(boutiqueLat, boutiqueLng)) {
      setError('Boutique location must be within Cebu. Only Cebu-based boutiques are supported.');
      setSubmitting(false);
      return;
    }

    const { data, error: boutiqueError } = await supabase
      .from('boutiques')
      .insert({
        seller_id: user.id,
        name: boutiqueName,
        slug: boutiqueName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '-' + Date.now().toString(36).slice(-4),
        tagline: boutiqueTagline,
        bio: boutiqueBio,
        location: `${boutiqueBarangay}, ${boutiqueCity}, Cebu`,
        lat: boutiqueLat,
        lng: boutiqueLng,
        barangay: boutiqueBarangay,
        pickup_available: boutiquePickup,
        courier_delivery: boutiqueCourier,
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
      setStore({ id: data.id, name: data.name });
      setStep('listing');
    }
    setSubmitting(false);
  }

  async function handleCreateListing(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);

    if (!hasAllRequired) {
      setError('Please upload all required photos: Front, Back, and Flaw/Damage.');
      setSubmitting(false);
      return;
    }

    if (!store) {
      setError('Create your storefront before adding products.');
      setSubmitting(false);
      return;
    }

    const imageUrls = images.map((img) => img.url);
    const imageMeta: ImageMetadata[] = images.map((img) => ({
      url: img.url,
      angle: img.angle,
      is_flaw: img.is_flaw,
      caption: img.caption || undefined,
    }));

    const isAuction = listingType === 'auction';
    const isDutch = isAuction && auctionMode === 'DUTCH';
    const startingPrice = Number(listingPrice);
    const durationDays = Number(auctionDays);

    if (!Number.isFinite(startingPrice) || startingPrice <= 0) {
      setError('Enter a starting price greater than zero.');
      setSubmitting(false);
      return;
    }
    if (isAuction && (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30)) {
      setError('Auction duration must be between 1 and 30 days.');
      setSubmitting(false);
      return;
    }
    if (isDutch) {
      const startPrice = Number(dutchStartPrice);
      const floorPrice = Number(dutchFloorPrice);
      const rate = Number(decrementRate);
      const interval = Number(decrementInterval);
      if (!Number.isFinite(startPrice) || !Number.isFinite(floorPrice) || floorPrice <= 0 || startPrice <= floorPrice) {
        setError('Dutch auction start price must be greater than a positive floor price.');
        setSubmitting(false);
        return;
      }
      if (!Number.isFinite(rate) || rate <= 0 || rate > 100 || !Number.isInteger(interval) || interval < 5) {
        setError('Set a price-drop rate greater than 0 and at most 100%, and an interval of at least 5 minutes.');
        setSubmitting(false);
        return;
      }
    } else if (isAuction && incrementStep && (!Number.isFinite(Number(incrementStep)) || Number(incrementStep) <= 0)) {
      setError('The minimum bid increment must be greater than zero.');
      setSubmitting(false);
      return;
    }

    const { error: listingError } = await supabase
      .from('listings')
      .insert({
        boutique_id: store.id,
        title: listingTitle,
        description: listingDesc,
        price: startingPrice,
        era: listingEra || null,
        category: listingCategory || null,
        condition_grade: listingCondition || null,
        material: listingMaterial || null,
        images: imageUrls,
        image_metadata: imageMeta,
        listing_type: listingType,
        auction_mode: isAuction ? auctionMode : 'ENGLISH',
        auction_duration_days: isAuction ? durationDays : null,
        auction_end_at: isAuction ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString() : null,
        auction_start_price: isDutch ? parseFloat(dutchStartPrice) : null,
        reserve_price: isAuction && !isDutch ? parseFloat(listingPrice) : null,
        increment_step: isAuction && !isDutch && incrementStep ? parseFloat(incrementStep) : null,
        decrement_rate: isDutch ? parseFloat(decrementRate) : null,
        decrement_interval_minutes: isDutch ? parseInt(decrementInterval) : 60,
        current_dutch_price: isDutch ? parseFloat(dutchStartPrice) : null,
        dutch_floor_price: isDutch ? parseFloat(dutchFloorPrice) : null,
        status: 'draft',
        moderation_status: 'pending_review',
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
        <h1 className="font-serif text-2xl font-bold text-ink-900 mb-2">Product Submitted for Review!</h1>
        <p className="text-sm text-ink-500 mb-6">Your item has been submitted for admin review. Once approved, it will be live on ThriftSync and visible to buyers in Cebu. This usually takes less than 24 hours.</p>
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
              setListingType('fixed');
              setAuctionMode('ENGLISH');
              setAuctionDays('7');
              setIncrementStep('');
              setDutchStartPrice('');
              setDutchFloorPrice('');
              setDecrementRate('5');
              setDecrementInterval('60');
              setImages([]);
              setError(null);
              setUploadError(null);
            }}
            className="btn-secondary"
          >
            Add Another Product
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {storeLoading && (
        <div className="card p-6 text-sm text-ink-500">Loading your storefront...</div>
      )}
      {!storeLoading && error && !store && step === 'intro' && (
        <div className="card p-6">
          <p className="text-sm text-terracotta-600">{error}</p>
        </div>
      )}
      {!storeLoading && step === 'intro' && (
        <>
          <div className="text-center mb-8">
            <h1 className="font-serif text-3xl font-bold text-ink-900 mb-2">Start Selling on ThriftSync</h1>
            <p className="text-sm text-ink-500">Join a community of Cebu-based vintage boutiques and reach collectors across Metro Cebu.</p>
          </div>
          <div className="card p-6">
            <div className="flex items-start gap-3 mb-4 p-3 bg-terracotta-50 rounded-lg border border-terracotta-200">
              <MapPin className="w-5 h-5 text-terracotta-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-terracotta-800">Cebu-Exclusive Marketplace</p>
                <p className="text-xs text-terracotta-600 mt-0.5">All boutiques and shipping are restricted to Cebu, Philippines. Local pickup and courier delivery only.</p>
              </div>
            </div>
            <button onClick={() => setStep('boutique')} className="w-full btn-primary py-3">
              {profile?.role === 'seller' ? 'List a New Item' : 'Get Started'}
            </button>
          </div>
        </>
      )}

      {!storeLoading && step === 'boutique' && (
        <div className="card p-6 animate-slide-down">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-1">Create Your Boutique</h2>
          <p className="text-sm text-ink-500 mb-5">Set up your storefront. Your boutique must be located in Cebu.</p>

          <form onSubmit={handleCreateBoutique} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Boutique Name *</label>
              <input type="text" value={boutiqueName} onChange={(e) => setBoutiqueName(e.target.value)} className="input-field" placeholder="e.g. Velvet & Vinyl" required />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Tagline</label>
              <input type="text" value={boutiqueTagline} onChange={(e) => setBoutiqueTagline(e.target.value)} className="input-field" placeholder="A short description of your shop" />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Bio</label>
              <textarea value={boutiqueBio} onChange={(e) => setBoutiqueBio(e.target.value)} className="input-field min-h-[80px] resize-none" placeholder="Tell buyers about your curation philosophy..." />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">City / Municipality *</label>
                <select value={boutiqueCity} onChange={(e) => { setBoutiqueCity(e.target.value); setBoutiqueBarangay(''); }} className="input-field">
                  {[...new Set(CEBU_BARANGAYS.map((b) => b.city))].map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Barangay *</label>
                <select value={boutiqueBarangay} onChange={(e) => handleBarangaySelect(e.target.value)} className="input-field" required>
                  <option value="">Select barangay...</option>
                  {barangays.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {boutiqueLat && boutiqueLng && (
              <div className="p-3 bg-sage-50 rounded-lg border border-sage-200 flex items-center gap-2">
                <Check className="w-4 h-4 text-sage-600" />
                <p className="text-xs text-sage-700">
                  Coordinates set: {boutiqueLat.toFixed(4)}, {boutiqueLng.toFixed(4)} — verified within Cebu
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={boutiquePickup} onChange={(e) => setBoutiquePickup(e.target.checked)} className="w-4 h-4 rounded border-ink-300 text-terracotta-500 focus:ring-terracotta-400" />
                <span className="text-sm text-ink-700">Offer local pickup at my boutique</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={boutiqueCourier} onChange={(e) => setBoutiqueCourier(e.target.checked)} className="w-4 h-4 rounded border-ink-300 text-terracotta-500 focus:ring-terracotta-400" />
                <span className="text-sm text-ink-700">Offer local courier delivery within Cebu</span>
              </label>
            </div>

            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Shop Policies</label>
              <textarea value={boutiquePolicies} onChange={(e) => setBoutiquePolicies(e.target.value)} className="input-field min-h-[60px] resize-none" placeholder="Return policy, pickup/delivery info, etc." />
            </div>

            {error && <p className="text-sm text-terracotta-600">{error}</p>}

            <button type="submit" disabled={submitting} className="w-full btn-primary py-3">
              {submitting ? 'Creating...' : 'Create Boutique & Continue'}
            </button>
          </form>
        </div>
      )}

      {!storeLoading && step === 'listing' && (
        <div className="card p-6 animate-slide-down">
          <div className="mb-5">
            <h2 className="font-serif text-xl font-bold text-ink-900 mb-1">Add a Product</h2>
            <p className="text-sm text-ink-500">
              {store ? `Adding a product to ${store.name}.` : 'Upload a product for your new storefront.'}
              {' '}Each product gets its own listing in your store.
            </p>
          </div>

          <form onSubmit={handleCreateListing} className="space-y-4">
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Item Title *</label>
              <input type="text" value={listingTitle} onChange={(e) => setListingTitle(e.target.value)} className="input-field" placeholder="e.g. Psychedelic Silk Caftan 1969" required />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Description *</label>
              <textarea value={listingDesc} onChange={(e) => setListingDesc(e.target.value)} className="input-field min-h-[100px] resize-none" placeholder="Describe the item, its condition, provenance, and any notable details..." required />
            </div>

            {/* Image Upload Section */}
            <div className="border border-ink-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-ink-700 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5" /> Product Photos *
                </label>
                <span className={cn('text-xs', hasAllRequired ? 'text-sage-600' : 'text-ink-400')}>
                  {hasAllRequired ? 'All required angles covered' : 'Front, Back & Flaw photos required'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {ANGLE_OPTIONS.map((opt) => {
                  const img = images.find((i) => i.angle === opt.value);
                  return (
                    <div key={opt.value} className="relative group">
                      <div className={cn(
                        'aspect-[3/4] rounded-lg border-2 overflow-hidden flex items-center justify-center bg-ink-50 transition-colors',
                        img ? 'border-sage-300' : opt.required ? 'border-terracotta-200 border-dashed' : 'border-ink-200 border-dashed',
                      )}>
                        {img ? (
                          <>
                            <img src={img.url} alt={opt.label} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => removeImage(opt.value)}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-ink-900/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <label className="cursor-pointer flex flex-col items-center gap-1 p-2 text-center">
                            {opt.required ? (
                              <Upload className="w-5 h-5 text-terracotta-400" />
                            ) : (
                              <Upload className="w-5 h-5 text-ink-300" />
                            )}
                            <span className={cn('text-[10px] font-medium', opt.required ? 'text-terracotta-600' : 'text-ink-400')}>
                              {opt.label}{opt.required ? ' *' : ''}
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) => e.target.files && handleImageUpload(e.target.files, opt.value)}
                            />
                          </label>
                        )}
                      </div>
                      {img && (
                        <input
                          type="text"
                          value={img.caption}
                          onChange={(e) => updateCaption(opt.value, e.target.value)}
                          placeholder="Caption (optional)"
                          className="w-full text-[10px] mt-1 px-2 py-1 rounded border border-ink-100 text-ink-600 focus:outline-none focus:border-ink-300"
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {uploading && (
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading and resizing image...
                </div>
              )}
              {uploadError && (
                <p className="text-xs text-terracotta-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{uploadError}
                </p>
              )}
              <p className="text-[10px] text-ink-400">
                Images are auto-resized to max 1200x1600px and uploaded to your store. Required: Front, Back, Flaw/Damage. Flaw photos document condition for vintage grading.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Price (₱) *</label>
                <input type="number" step="0.01" value={listingPrice} onChange={(e) => setListingPrice(e.target.value)} className="input-field" placeholder="0.00" required />
              </div>
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Listing Type</label>
                <select value={listingType} onChange={(e) => setListingType(e.target.value as 'fixed' | 'auction')} className="input-field">
                  <option value="fixed">Fixed Price</option>
                  <option value="auction">Auction</option>
                </select>
              </div>
            </div>

            {listingType === 'auction' && (
              <div className="border border-ink-200 rounded-xl p-4 space-y-3 animate-slide-down">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1.5 block">Auction Mode</label>
                    <select value={auctionMode} onChange={(e) => setAuctionMode(e.target.value as 'ENGLISH' | 'DUTCH')} className="input-field">
                      <option value="ENGLISH">English (Ascending Bids)</option>
                      <option value="DUTCH">Dutch (Descending Price)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1.5 block">Duration (Days)</label>
                    <input type="number" value={auctionDays} onChange={(e) => setAuctionDays(e.target.value)} min="1" max="30" className="input-field" />
                  </div>
                </div>

                {auctionMode === 'ENGLISH' && (
                  <div>
                    <label className="text-xs font-medium text-ink-700 mb-1.5 block">Min Bid Increment (optional — leave blank for tier-based)</label>
                    <input type="number" step="0.01" value={incrementStep} onChange={(e) => setIncrementStep(e.target.value)} className="input-field" placeholder="Auto: ₱1/₱5/₱10/₱25/₱50 by tier" />
                    <p className="text-[10px] text-ink-400 mt-1">If blank, minimum increments apply: ₱1 (under ₱50), ₱5 (₱50–₱200), ₱10 (₱200–₱500), ₱25 (₱500–₱1K), ₱50 (₱1K+)</p>
                  </div>
                )}

                {auctionMode === 'DUTCH' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-ink-700 mb-1.5 block">Start Price *</label>
                        <input type="number" step="0.01" value={dutchStartPrice} onChange={(e) => setDutchStartPrice(e.target.value)} className="input-field" placeholder="Price starts here" required />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-ink-700 mb-1.5 block">Floor Price *</label>
                        <input type="number" step="0.01" value={dutchFloorPrice} onChange={(e) => setDutchFloorPrice(e.target.value)} className="input-field" placeholder="Minimum price" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-ink-700 mb-1.5 block">Decrement Rate (%) *</label>
                        <input type="number" step="0.1" value={decrementRate} onChange={(e) => setDecrementRate(e.target.value)} className="input-field" placeholder="e.g. 5" required />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-ink-700 mb-1.5 block">Interval (minutes) *</label>
                        <input type="number" value={decrementInterval} onChange={(e) => setDecrementInterval(e.target.value)} min="5" className="input-field" placeholder="e.g. 60" required />
                      </div>
                    </div>
                    <p className="text-[10px] text-ink-400">Price drops by {decrementRate || '5'}% every {decrementInterval || '60'} minutes until someone claims it or the floor price is reached.</p>
                  </>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Era</label>
                <select value={listingEra} onChange={(e) => setListingEra(e.target.value)} className="input-field">
                  <option value="">Select era...</option>
                  {['1890s', '1920s', '1930s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'].map((era) => <option key={era} value={era}>{era}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Category</label>
                <select value={listingCategory} onChange={(e) => setListingCategory(e.target.value)} className="input-field">
                  <option value="">Select category...</option>
                  {['Apparel', 'Footwear', 'Accessories', 'Jewelry', 'Furniture', 'Home Decor', 'Electronics'].map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Condition</label>
                <select value={listingCondition} onChange={(e) => setListingCondition(e.target.value)} className="input-field">
                  <option value="">Select condition...</option>
                  {['Mint', 'Excellent', 'Good', 'Fair', 'Distressed'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-ink-700 mb-1.5 block">Material</label>
                <input type="text" value={listingMaterial} onChange={(e) => setListingMaterial(e.target.value)} className="input-field" placeholder="e.g. Silk, Leather" />
              </div>
            </div>

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
