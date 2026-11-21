import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase, type Boutique, type Profile } from '@/lib/supabase';
import { resizeImage } from '@/lib/utils';

type SellerProfileEditorProps = {
  userId: string;
  profile: Profile;
  boutique: Boutique;
  onClose: () => void;
  onBoutiqueSaved: (boutique: Boutique) => void;
};

async function uploadStoreImage(file: File, userId: string): Promise<{ path: string; url: string }> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Each image must be smaller than 10 MB.');
  }

  const image = await resizeImage(file, 1200, 1200, 0.86);
  const path = `${userId}/storefront/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from('listing-images')
    .upload(path, image, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(`Image upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage.from('listing-images').getPublicUrl(path);
  return { path, url: publicUrl };
}

async function removeUploadedImages(paths: string[]): Promise<string | null> {
  if (paths.length === 0) return null;
  const { error } = await supabase.storage.from('listing-images').remove(paths);
  return error?.message || null;
}

export function SellerProfileEditor({
  userId,
  profile,
  boutique,
  onClose,
  onBoutiqueSaved,
}: SellerProfileEditorProps) {
  const { refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState(profile.display_name || '');
  const [profileBio, setProfileBio] = useState(profile.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [shopName, setShopName] = useState(boutique.name);
  const [tagline, setTagline] = useState(boutique.tagline || '');
  const [shopBio, setShopBio] = useState(boutique.bio || '');
  const [logoUrl, setLogoUrl] = useState(boutique.logo_url || '');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerUrl, setBannerUrl] = useState(boutique.banner_url || '');
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [location, setLocation] = useState(boutique.location || '');
  const [policies, setPolicies] = useState(boutique.policies || '');
  const [saving, setSaving] = useState<'profile' | 'store' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function saveSellerProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!displayName.trim()) {
      setError('Enter a display name.');
      return;
    }
    setSaving('profile');
    const uploadedPaths: string[] = [];
    try {
      let nextAvatarUrl = avatarUrl.trim() || null;
      if (avatarFile) {
        const uploaded = await uploadStoreImage(avatarFile, userId);
        uploadedPaths.push(uploaded.path);
        nextAvatarUrl = uploaded.url;
      }

      const { data, error: updateError } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          bio: profileBio.trim() || null,
          avatar_url: nextAvatarUrl,
        })
        .eq('id', userId)
        .select('id')
        .maybeSingle();

      if (updateError) throw new Error(`Could not save your seller profile: ${updateError.message}`);
      if (!data) throw new Error('No profile changes were saved. You can only edit your own profile.');

      setAvatarUrl(nextAvatarUrl || '');
      setAvatarFile(null);
      await refreshProfile();
      setSuccess('Seller profile saved.');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save your seller profile.';
      const cleanupError = await removeUploadedImages(uploadedPaths);
      setError(cleanupError ? `${message} The uploaded image also could not be cleaned up: ${cleanupError}` : message);
    } finally {
      setSaving(null);
    }
  }

  async function saveStorefront(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!shopName.trim()) {
      setError('Enter a shop name.');
      return;
    }
    setSaving('store');
    const uploadedPaths: string[] = [];
    try {
      let nextLogoUrl = logoUrl.trim() || null;
      let nextBannerUrl = bannerUrl.trim() || null;
      if (logoFile) {
        const uploaded = await uploadStoreImage(logoFile, userId);
        uploadedPaths.push(uploaded.path);
        nextLogoUrl = uploaded.url;
      }
      if (bannerFile) {
        const uploaded = await uploadStoreImage(bannerFile, userId);
        uploadedPaths.push(uploaded.path);
        nextBannerUrl = uploaded.url;
      }

      const { data, error: updateError } = await supabase
        .from('boutiques')
        .update({
          name: shopName.trim(),
          tagline: tagline.trim() || null,
          bio: shopBio.trim() || null,
          logo_url: nextLogoUrl,
          banner_url: nextBannerUrl,
          location: location.trim() || null,
          policies: policies.trim() || null,
        })
        .eq('id', boutique.id)
        .eq('seller_id', userId)
        .select('*')
        .maybeSingle();

      if (updateError) throw new Error(`Could not save your storefront: ${updateError.message}`);
      if (!data) throw new Error('No storefront changes were saved. You can only edit your own shop.');

      setLogoUrl(nextLogoUrl || '');
      setLogoFile(null);
      setBannerUrl(nextBannerUrl || '');
      setBannerFile(null);
      onBoutiqueSaved(data as Boutique);
      setSuccess('Storefront saved.');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Could not save your storefront.';
      const cleanupError = await removeUploadedImages(uploadedPaths);
      setError(cleanupError ? `${message} Uploaded images also could not be cleaned up: ${cleanupError}` : message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-ink-950/60 p-4 sm:items-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="seller-profile-editor-title"
        className="my-auto w-full max-w-2xl rounded-2xl bg-cream shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-ink-100 p-5">
          <div>
            <h2 id="seller-profile-editor-title" className="font-serif text-xl font-bold text-ink-900">Edit seller profile</h2>
            <p className="mt-1 text-xs text-ink-500">Update how buyers see you and your shop.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close editor" className="rounded-lg p-2 text-ink-500 hover:bg-ink-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[75vh] space-y-6 overflow-y-auto p-5">
          <form onSubmit={saveSellerProfile} className="space-y-3">
            <h3 className="text-sm font-semibold text-ink-900">Your public seller profile</h3>
            <label className="block text-xs font-medium text-ink-700">
              Display name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                maxLength={80}
                required
                className="input-field mt-1"
              />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              About you
              <textarea
                value={profileBio}
                onChange={(event) => setProfileBio(event.target.value)}
                maxLength={1000}
                rows={3}
                className="input-field mt-1 resize-y"
                placeholder="Tell buyers a little about yourself."
              />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              Profile photo
              {avatarUrl && !avatarFile && (
                <img src={avatarUrl} alt="Current profile photo" className="mb-2 mt-1 h-16 w-16 rounded-full object-cover" />
              )}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setAvatarFile(event.target.files?.[0] || null)}
                className="input-field mt-1"
              />
              <span className="mt-1 block font-normal text-ink-400">
                {avatarFile ? `Selected: ${avatarFile.name}` : 'Choose a JPG, PNG, or WebP file (max 10 MB).'}
              </span>
              {(avatarUrl || avatarFile) && (
                <button type="button" onClick={() => { setAvatarUrl(''); setAvatarFile(null); }} className="mt-1 text-xs text-terracotta-700 hover:underline">
                  Remove profile photo
                </button>
              )}
            </label>
            <button type="submit" disabled={saving !== null} className="btn-secondary text-sm disabled:opacity-60">
              {saving === 'profile' ? 'Saving…' : 'Save seller profile'}
            </button>
          </form>

          <form onSubmit={saveStorefront} className="space-y-3 border-t border-ink-100 pt-5">
            <h3 className="text-sm font-semibold text-ink-900">Your storefront</h3>
            <label className="block text-xs font-medium text-ink-700">
              Shop name
              <input
                value={shopName}
                onChange={(event) => setShopName(event.target.value)}
                maxLength={100}
                required
                className="input-field mt-1"
              />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              Tagline
              <input
                value={tagline}
                onChange={(event) => setTagline(event.target.value)}
                maxLength={160}
                className="input-field mt-1"
                placeholder="A short line about your shop"
              />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              About your shop
              <textarea
                value={shopBio}
                onChange={(event) => setShopBio(event.target.value)}
                maxLength={1500}
                rows={4}
                className="input-field mt-1 resize-y"
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-ink-700">
                Shop logo
                {logoUrl && !logoFile && (
                  <img src={logoUrl} alt="Current shop logo" className="mb-2 mt-1 h-16 w-16 rounded-lg object-cover" />
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
                  className="input-field mt-1"
                />
                <span className="mt-1 block font-normal text-ink-400">
                  {logoFile ? `Selected: ${logoFile.name}` : 'Choose a JPG, PNG, or WebP file (max 10 MB).'}
                </span>
                {(logoUrl || logoFile) && (
                  <button type="button" onClick={() => { setLogoUrl(''); setLogoFile(null); }} className="mt-1 text-xs text-terracotta-700 hover:underline">
                    Remove shop logo
                  </button>
                )}
              </label>
              <label className="block text-xs font-medium text-ink-700">
                Cover image
                {bannerUrl && !bannerFile && (
                  <img src={bannerUrl} alt="Current storefront cover" className="mb-2 mt-1 h-16 w-full rounded-lg object-cover" />
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => setBannerFile(event.target.files?.[0] || null)}
                  className="input-field mt-1"
                />
                <span className="mt-1 block font-normal text-ink-400">
                  {bannerFile ? `Selected: ${bannerFile.name}` : 'Choose a JPG, PNG, or WebP file (max 10 MB).'}
                </span>
                {(bannerUrl || bannerFile) && (
                  <button type="button" onClick={() => { setBannerUrl(''); setBannerFile(null); }} className="mt-1 text-xs text-terracotta-700 hover:underline">
                    Remove cover image
                  </button>
                )}
              </label>
            </div>
            <label className="block text-xs font-medium text-ink-700">
              Shop location
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={200}
                className="input-field mt-1"
              />
            </label>
            <label className="block text-xs font-medium text-ink-700">
              Shop policies
              <textarea
                value={policies}
                onChange={(event) => setPolicies(event.target.value)}
                maxLength={2000}
                rows={3}
                className="input-field mt-1 resize-y"
                placeholder="Shipping, returns, and other shop details"
              />
            </label>
            <p className="text-[11px] text-ink-400">Your public shop link will stay the same if you change the shop name.</p>
            <button type="submit" disabled={saving !== null} className="btn-primary text-sm disabled:opacity-60">
              {saving === 'store' ? 'Saving…' : 'Save storefront'}
            </button>
          </form>

          {error && <p role="alert" className="rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">{error}</p>}
          {success && <p role="status" className="rounded-lg bg-sage-50 p-3 text-sm text-sage-700">{success}</p>}
        </div>
      </section>
    </div>
  );
}
