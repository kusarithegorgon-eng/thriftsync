import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export function DeliveryProofImage({ path }: { path: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data, error: signedUrlError } = await supabase.storage
          .from('delivery-proof')
          .createSignedUrl(path, 60 * 60);
        if (!active) return;
        if (signedUrlError) {
          setError(`Could not load delivery photo proof: ${signedUrlError.message}`);
        } else {
          setSignedUrl(data.signedUrl);
        }
      } catch (loadError) {
        if (active) {
          setError(`Could not load delivery photo proof: ${
            loadError instanceof Error ? loadError.message : 'Unexpected storage error.'
          }`);
        }
      }
    })();

    return () => { active = false; };
  }, [path]);

  return (
    <div className="mt-3 border-t border-ink-100 pt-3">
      <p className="text-xs font-semibold text-ink-700">Delivery photo proof</p>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-terracotta-700">{error}</p>
      ) : signedUrl ? (
        <a href={signedUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block">
          <img
            src={signedUrl}
            alt="Photo proof of the delivered parcel"
            loading="lazy"
            className="max-h-80 max-w-full rounded-lg border border-ink-200 object-contain"
          />
        </a>
      ) : (
        <p className="mt-2 text-xs text-ink-500">Loading delivery photo…</p>
      )}
    </div>
  );
}
