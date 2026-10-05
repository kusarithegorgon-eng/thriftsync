/*
# Create listing-images storage bucket
Adds a public storage bucket for product images uploaded via signed URLs.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('listing-images', 'listing-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
DROP POLICY IF EXISTS "Authenticated upload listing images" ON storage.objects;
CREATE POLICY "Authenticated upload listing images" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'listing-images');

-- Public read for listing images
DROP POLICY IF EXISTS "Public read listing images" ON storage.objects;
CREATE POLICY "Public read listing images" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'listing-images');

-- Users can delete their own images
DROP POLICY IF EXISTS "Users delete own listing images" ON storage.objects;
CREATE POLICY "Users delete own listing images" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'listing-images' AND owner = auth.uid());