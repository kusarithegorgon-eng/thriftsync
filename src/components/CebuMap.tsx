import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapPin, Navigation } from 'lucide-react';
import { CEBU_CENTER, haversineDistance } from '@/lib/utils';

// Fix default marker icon for leaflet in bundler environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

type CebuMapProps = {
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickupLabel?: string;
  buyerLat?: number | null;
  buyerLng?: number | null;
  onMapClick?: (lat: number, lng: number) => void;
  interactive?: boolean;
  height?: string;
  showDistance?: boolean;
};

function Recenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 13);
  }, [map, center]);
  return null;
}

function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => {
      onClick(e.latlng.lat, e.latlng.lng);
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
  }, [map, onClick]);
  return null;
}

export function CebuMap({
  pickupLat,
  pickupLng,
  pickupLabel,
  buyerLat,
  buyerLng,
  onMapClick,
  interactive = false,
  height = '300px',
  showDistance = false,
}: CebuMapProps) {
  const center: [number, number] = [
    pickupLat ?? CEBU_CENTER.lat,
    pickupLng ?? CEBU_CENTER.lng,
  ];

  const distance = pickupLat && pickupLng && buyerLat && buyerLng
    ? haversineDistance(buyerLat, buyerLng, pickupLat, pickupLng)
    : null;

  return (
    <div className="relative rounded-xl overflow-hidden border border-ink-200" style={{ height }}>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; OpenStreetMap contributors'
        />
        {pickupLat && pickupLng && (
          <Marker position={[pickupLat, pickupLng]}>
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{pickupLabel || 'Pickup Location'}</p>
                <p className="text-xs text-ink-500">{pickupLat.toFixed(4)}, {pickupLng.toFixed(4)}</p>
              </div>
            </Popup>
          </Marker>
        )}
        {buyerLat && buyerLng && (
          <Marker position={[buyerLat, buyerLng]}>
            <Popup>
              <div className="text-sm">
                <p className="font-medium">Your Location</p>
                <p className="text-xs text-ink-500">{buyerLat.toFixed(4)}, {buyerLng.toFixed(4)}</p>
              </div>
            </Popup>
          </Marker>
        )}
        {onMapClick && interactive && <ClickHandler onClick={onMapClick} />}
        <Recenter center={center} />
      </MapContainer>

      {showDistance && distance !== null && (
        <div className="absolute bottom-3 left-3 bg-white/95 backdrop-blur-sm rounded-lg shadow-md px-3 py-2 flex items-center gap-2 z-[1000]">
          <Navigation className="w-4 h-4 text-terracotta-500" />
          <span className="text-sm font-medium text-ink-900">
            {distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} away
          </span>
        </div>
      )}

      <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm rounded-lg shadow-md px-2.5 py-1.5 flex items-center gap-1.5 z-[1000]">
        <MapPin className="w-3.5 h-3.5 text-terracotta-500" />
        <span className="text-xs font-medium text-ink-700">Cebu Only</span>
      </div>
    </div>
  );
}
