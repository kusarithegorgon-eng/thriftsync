export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatPriceDetailed(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  const past = new Date(date);
  const diff = now.getTime() - past.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 30) return new Date(past).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function formatCountdown(targetDate: string | Date): string {
  const now = new Date().getTime();
  const target = new Date(targetDate).getTime();
  const diff = target - now;

  if (diff <= 0) return 'Ended';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function isAuctionActive(listing: { listing_type: string; auction_end_at: string | null; status: string }): boolean {
  if (listing.listing_type !== 'auction') return false;
  if (listing.status !== 'active') return false;
  if (!listing.auction_end_at) return false;
  return new Date(listing.auction_end_at).getTime() > Date.now();
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const ERAS = ['1890s', '1920s', '1930s', '1950s', '1960s', '1970s', '1980s', '1990s'];
export const CATEGORIES = ['Apparel', 'Footwear', 'Accessories', 'Jewelry', 'Furniture', 'Home Decor', 'Electronics'];
export const CONDITIONS = ['Mint', 'Excellent', 'Good', 'Fair', 'Distressed'];

// ============================================================
// CEBU GEOFENCING
// ============================================================

export const CEBU_BOUNDS = {
  latMin: 9.25,
  latMax: 11.00,
  lngMin: 123.20,
  lngMax: 124.70,
};

export const CEBU_CENTER = { lat: 10.3157, lng: 123.8854 };

export const CEBU_BARANGAYS = [
  { name: 'Lahug', city: 'Cebu City', lat: 10.3389, lng: 123.9033, metro: true },
  { name: 'Guadalupe', city: 'Cebu City', lat: 10.3156, lng: 123.8833, metro: true },
  { name: 'Banilad', city: 'Cebu City', lat: 10.3392, lng: 123.9133, metro: true },
  { name: 'Capitol Site', city: 'Cebu City', lat: 10.3167, lng: 123.8856, metro: true },
  { name: 'Kamputhaw', city: 'Cebu City', lat: 10.3258, lng: 123.8983, metro: true },
  { name: 'Mabolo', city: 'Cebu City', lat: 10.3183, lng: 123.9050, metro: true },
  { name: 'Pardo', city: 'Cebu City', lat: 10.2983, lng: 123.8683, metro: true },
  { name: 'Talisay', city: 'Cebu City', lat: 10.2633, lng: 123.8417, metro: true },
  { name: 'Mandaue City Proper', city: 'Mandaue City', lat: 10.3300, lng: 123.9300, metro: true },
  { name: 'Banilad', city: 'Mandaue City', lat: 10.3400, lng: 123.9200, metro: true },
  { name: 'Maguikay', city: 'Mandaue City', lat: 10.3250, lng: 123.9350, metro: true },
  { name: 'Lapu-Lapu City Proper', city: 'Lapu-Lapu City', lat: 10.3050, lng: 124.0050, metro: true },
  { name: 'Mactan', city: 'Lapu-Lapu City', lat: 10.2900, lng: 124.0150, metro: true },
  { name: 'Maribago', city: 'Lapu-Lapu City', lat: 10.2850, lng: 124.0000, metro: true },
  { name: 'Talisay City Proper', city: 'Talisay City', lat: 10.2500, lng: 123.8500, metro: true },
  { name: 'Minglanilla Proper', city: 'Minglanilla', lat: 10.2400, lng: 123.7900, metro: true },
  { name: 'Naga City Proper', city: 'Naga City', lat: 10.2100, lng: 123.7600, metro: true },
  { name: 'Danao City Proper', city: 'Danao City', lat: 10.5600, lng: 124.0000, metro: false },
  { name: 'Carcar City Proper', city: 'Carcar City', lat: 10.1200, lng: 123.6400, metro: false },
  { name: 'Toledo City Proper', city: 'Toledo City', lat: 10.3900, lng: 123.6400, metro: false },
] as const;

export function isWithinCebu(lat: number, lng: number): boolean {
  return (
    lat >= CEBU_BOUNDS.latMin && lat <= CEBU_BOUNDS.latMax &&
    lng >= CEBU_BOUNDS.lngMin && lng <= CEBU_BOUNDS.lngMax
  );
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function findNearestBarangay(lat: number, lng: number) {
  let nearest = null;
  let minDist = Infinity;
  for (const b of CEBU_BARANGAYS) {
    const dist = haversineDistance(lat, lng, b.lat, b.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = b;
    }
  }
  return nearest ? { ...nearest, distance_km: minDist } : null;
}

// ============================================================
// AUCTION INCREMENT TIERS
// ============================================================

export const BID_INCREMENT_TIERS = [
  { max: 50, increment: 1, label: '$0 – $50: $1 minimum' },
  { max: 200, increment: 5, label: '$50 – $200: $5 minimum' },
  { max: 500, increment: 10, label: '$200 – $500: $10 minimum' },
  { max: 1000, increment: 25, label: '$500 – $1,000: $25 minimum' },
  { max: Infinity, increment: 50, label: '$1,000+: $50 minimum' },
] as const;

export function getMinIncrement(currentBid: number, override?: number | null): number {
  if (override && override > 0) return override;
  for (const tier of BID_INCREMENT_TIERS) {
    if (currentBid < tier.max) return tier.increment;
  }
  return 50;
}

export function getMinNextBid(currentBid: number, override?: number | null): number {
  return currentBid + getMinIncrement(currentBid, override);
}

export function getIncrementTierLabel(currentBid: number): string {
  for (const tier of BID_INCREMENT_TIERS) {
    if (currentBid < tier.max) return tier.label;
  }
  return '$1,000+: $50 minimum';
}

// Dutch auction: compute current price based on time elapsed
export function computeDutchPrice(
  startPrice: number,
  floorPrice: number,
  decrementRate: number,
  intervalMinutes: number,
  auctionStartAt: string,
  isPercentage: boolean = true,
): number {
  const elapsedMs = Date.now() - new Date(auctionStartAt).getTime();
  const elapsedMinutes = elapsedMs / 60000;
  const steps = Math.floor(elapsedMinutes / intervalMinutes);

  let currentPrice = startPrice;
  if (isPercentage) {
    for (let i = 0; i < steps; i++) {
      currentPrice = currentPrice * (1 - decrementRate / 100);
      if (currentPrice <= floorPrice) {
        currentPrice = floorPrice;
        break;
      }
    }
  } else {
    currentPrice = startPrice - decrementRate * steps;
  }

  return Math.max(currentPrice, floorPrice);
}

export function getNextDropTime(
  intervalMinutes: number,
  auctionStartAt: string,
): Date | null {
  const elapsedMs = Date.now() - new Date(auctionStartAt).getTime();
  const elapsedMinutes = elapsedMs / 60000;
  const stepsCompleted = Math.floor(elapsedMinutes / intervalMinutes);
  const nextDropMs = new Date(auctionStartAt).getTime() + (stepsCompleted + 1) * intervalMinutes * 60000;
  return new Date(nextDropMs);
}

// ============================================================
// IMAGE RESIZING (client-side)
// ============================================================

export async function resizeImage(
  file: File,
  maxWidth: number = 1200,
  maxHeight: number = 1600,
  quality: number = 0.85,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to resize image'));
        },
        'image/jpeg',
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}
