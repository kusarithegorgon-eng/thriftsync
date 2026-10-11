BEGIN;

INSERT INTO public.profiles (id, role, display_name, bio)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'seller', 'Demo Seller - Vintage Loop', 'Sample seller profile for marketplace demo data.'),
  ('d0000000-0000-4000-8000-000000000002', 'seller', 'Demo Seller - Second Story', 'Sample seller profile for marketplace demo data.'),
  ('d0000000-0000-4000-8000-000000000003', 'buyer', 'Demo Buyer', 'Sample buyer profile for marketplace demo data.')
ON CONFLICT (id) DO UPDATE
SET role = EXCLUDED.role,
    display_name = EXCLUDED.display_name,
    bio = EXCLUDED.bio;

INSERT INTO public.boutiques (
  id, seller_id, name, slug, tagline, bio, location, barangay,
  lat, lng, pickup_available, courier_delivery
)
VALUES
  (
    'c0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'Vintage Loop Cebu',
    'demo-vintage-loop-cebu',
    'Good finds, another life.',
    'A demo shop featuring curated secondhand wardrobe staples.',
    'Lahug, Cebu City',
    'Lahug',
    10.3389,
    123.9033,
    true,
    true
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000002',
    'Second Story Finds',
    'demo-second-story-finds',
    'Pre-loved pieces with a story.',
    'A demo shop for timeless accessories and everyday vintage.',
    'Banilad, Cebu City',
    'Banilad',
    10.3392,
    123.9133,
    true,
    true
  )
ON CONFLICT (id) DO UPDATE
SET seller_id = EXCLUDED.seller_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    tagline = EXCLUDED.tagline,
    bio = EXCLUDED.bio,
    location = EXCLUDED.location,
    barangay = EXCLUDED.barangay,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    pickup_available = EXCLUDED.pickup_available,
    courier_delivery = EXCLUDED.courier_delivery;

INSERT INTO public.listings (
  id, boutique_id, title, description, price, era, category,
  condition_grade, material, images, status, moderation_status, moderated_at, created_at
)
VALUES
  (
    'b0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    'Classic Blue Denim Jacket',
    'A relaxed-fit vintage denim jacket with light natural fading. A versatile layering piece.',
    1250,
    '1990s',
    'Outerwear',
    'Good',
    'Denim',
    ARRAY['https://images.unsplash.com/photo-1543076447-215ad9ba6923?auto=format&fit=crop&w=900&q=80'],
    'sold',
    'approved',
    now() - interval '25 days',
    now() - interval '45 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000001',
    'Striped Linen Camp Shirt',
    'Lightweight short-sleeve shirt in a muted stripe, ideal for warm-weather outfits.',
    780,
    '2000s',
    'Tops',
    'Excellent',
    'Linen blend',
    ARRAY['https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=80'],
    'sold',
    'approved',
    now() - interval '18 days',
    now() - interval '38 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000002',
    'Everyday Leather Shoulder Bag',
    'A compact pre-loved shoulder bag with a roomy main compartment and adjustable strap.',
    1850,
    '1990s',
    'Accessories',
    'Good',
    'Leather',
    ARRAY['https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=80'],
    'sold',
    'approved',
    now() - interval '12 days',
    now() - interval '32 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000004',
    'c0000000-0000-4000-8000-000000000001',
    'Embroidered Cotton Blouse',
    'Soft cotton blouse with delicate embroidery and an easy, relaxed fit.',
    650,
    '2000s',
    'Tops',
    'Excellent',
    'Cotton',
    ARRAY['https://images.unsplash.com/photo-1551163943-3f6a855d1153?auto=format&fit=crop&w=900&q=80'],
    'active',
    'approved',
    now() - interval '8 days',
    now() - interval '8 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000005',
    'c0000000-0000-4000-8000-000000000001',
    'Retro Canvas Sneakers',
    'Classic low-top canvas sneakers with plenty of life left in them.',
    1600,
    '2010s',
    'Shoes',
    'Good',
    'Canvas',
    ARRAY['https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=900&q=80'],
    'active',
    'approved',
    now() - interval '6 days',
    now() - interval '6 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000006',
    'c0000000-0000-4000-8000-000000000002',
    'Structured Vintage Tote',
    'A structured everyday tote with sturdy handles and a clean, timeless shape.',
    2450,
    '2000s',
    'Accessories',
    'Excellent',
    'Faux leather',
    ARRAY['https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80'],
    'active',
    'approved',
    now() - interval '5 days',
    now() - interval '5 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000007',
    'c0000000-0000-4000-8000-000000000002',
    'Forest Green Knit Sweater',
    'A cozy mid-weight knit in deep green, with a gently relaxed silhouette.',
    1100,
    '1990s',
    'Knitwear',
    'Good',
    'Acrylic blend',
    ARRAY['https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=80'],
    'active',
    'approved',
    now() - interval '3 days',
    now() - interval '3 days'
  ),
  (
    'b0000000-0000-4000-8000-000000000008',
    'c0000000-0000-4000-8000-000000000001',
    'High-Waisted Denim Skirt',
    'A classic high-waisted denim skirt with a simple five-pocket design.',
    720,
    '2000s',
    'Bottoms',
    'Excellent',
    'Denim',
    ARRAY['https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?auto=format&fit=crop&w=900&q=80'],
    'active',
    'approved',
    now() - interval '2 days',
    now() - interval '2 days'
  )
ON CONFLICT (id) DO UPDATE
SET boutique_id = EXCLUDED.boutique_id,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    price = EXCLUDED.price,
    era = EXCLUDED.era,
    category = EXCLUDED.category,
    condition_grade = EXCLUDED.condition_grade,
    material = EXCLUDED.material,
    images = EXCLUDED.images,
    status = EXCLUDED.status,
    moderation_status = EXCLUDED.moderation_status,
    moderated_at = EXCLUDED.moderated_at,
    created_at = EXCLUDED.created_at;

INSERT INTO public.orders (
  id, buyer_id, listing_id, boutique_id, amount, status,
  shipping_address, created_at
)
VALUES
  (
    'a0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000001',
    'c0000000-0000-4000-8000-000000000001',
    1250,
    'completed',
    'Demo transaction - not for shipping',
    now() - interval '25 days'
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000002',
    'c0000000-0000-4000-8000-000000000001',
    780,
    'completed',
    'Demo transaction - not for shipping',
    now() - interval '18 days'
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000003',
    'c0000000-0000-4000-8000-000000000002',
    1850,
    'completed',
    'Demo transaction - not for shipping',
    now() - interval '12 days'
  )
ON CONFLICT (id) DO UPDATE
SET buyer_id = EXCLUDED.buyer_id,
    listing_id = EXCLUDED.listing_id,
    boutique_id = EXCLUDED.boutique_id,
    amount = EXCLUDED.amount,
    status = EXCLUDED.status,
    shipping_address = EXCLUDED.shipping_address,
    created_at = EXCLUDED.created_at;

COMMIT;
