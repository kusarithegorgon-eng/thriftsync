import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  Lock, MapPin, Clock, Phone, Package, KeyRound, CheckCircle2,
  AlertCircle, X, Search,
} from 'lucide-react';
import { supabase, type LockerLocation, type LockerHandoff, type HandoffPinResult } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import {
  CEBU_CENTER, CEBU_DISTRICTS, cn, haversineDistance, getTodayHours, isLockerOpenNow,
  formatDistance, formatTimeAgo,
} from '@/lib/utils';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const lockerIcon = L.divIcon({
  className: '',
  html: '<div style="background:#0f766e;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3)">🔒</div>',
  iconSize: [32, 32],
  iconAnchor: [16, 16],
});

function FitBounds({ points }: { points: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) {
      map.setView([CEBU_CENTER.lat, CEBU_CENTER.lng], 11);
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [points, map]);
  return null;
}

export function LockerNetworkPage() {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [lockers, setLockers] = useState<LockerLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLocker, setSelectedLocker] = useState<LockerLocation | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [handoffs, setHandoffs] = useState<LockerHandoff[]>([]);
  const [generatingPin, setGeneratingPin] = useState(false);
  const [pinResult, setPinResult] = useState<HandoffPinResult | null>(null);
  const [pinError, setPinError] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmHandoffId, setConfirmHandoffId] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('locker_locations')
        .select('*')
        .eq('is_active', true)
        .order('partner_name');

      if (error) {
        console.error('Load lockers error:', error);
      }
      setLockers((data as LockerLocation[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLat(pos.coords.latitude);
          setUserLng(pos.coords.longitude);
        },
        () => {},
        { timeout: 5000 },
      );
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('locker_handoffs')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['PENDING', 'DROPPED_OFF'])
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setHandoffs(data as LockerHandoff[]);
      });
  }, [user]);

  const filteredLockers = lockers.filter((l) => {
    if (selectedDistrict && l.city_municipality !== selectedDistrict) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        l.partner_name.toLowerCase().includes(q) ||
        l.address.toLowerCase().includes(q) ||
        l.city_municipality.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const lockerPoints = filteredLockers.map((l) => ({ lat: l.lat, lng: l.lng }));

  async function generatePin(locker: LockerLocation) {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }
    setGeneratingPin(true);
    setPinError('');
    setPinResult(null);

    try {
      const { data, error } = await supabase.rpc('generate_handoff_pin', {
        p_locker_location_id: locker.id,
      });

      if (error) throw error;
      if (data && data.length > 0) {
        const row = data[0];
        setPinResult({
          handoff_id: row.handoff_id,
          pin_code: row.pin_code,
          locker_name: row.locker_name,
          expires_at: row.expires_at,
        });
        setShowPinModal(true);

        setHandoffs([
          {
            id: row.handoff_id,
            locker_location_id: locker.id,
            order_id: null,
            user_id: user.id,
            pin_code: row.pin_code,
            status: 'PENDING',
            drop_off_window_start: new Date().toISOString(),
            drop_off_window_end: row.expires_at,
            dropped_off_at: null,
            picked_up_at: null,
            created_at: new Date().toISOString(),
          },
          ...handoffs,
        ]);
      }
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Failed to generate PIN');
    } finally {
      setGeneratingPin(false);
    }
  }

  async function confirmPickup() {
    if (!confirmHandoffId || !confirmPin) return;
    setConfirmMessage('');

    try {
      const { data, error } = await supabase.rpc('confirm_handoff_pickup', {
        p_handoff_id: confirmHandoffId,
        p_pin_code: confirmPin,
      });

      if (error) throw error;
      if (data && data.length > 0) {
        const row = data[0];
        setConfirmMessage(row.message);
        if (row.success) {
          setHandoffs(handoffs.filter((h) => h.id !== confirmHandoffId));
          setConfirmPin('');
          setConfirmHandoffId('');
        }
      }
    } catch (err) {
      setConfirmMessage(err instanceof Error ? err.message : 'Failed to confirm pickup');
    }
  }

  const sortedLockers = userLat && userLng
    ? [...filteredLockers].sort((a, b) => {
        const distA = haversineDistance(userLat, userLng, a.lat, a.lng);
        const distB = haversineDistance(userLat, userLng, b.lat, b.lng);
        return distA - distB;
      })
    : filteredLockers;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-bold text-ink-900 mb-1 flex items-center gap-2">
          <Lock className="w-7 h-7 text-sage-700" />
          Partner Locker Network
        </h1>
        <p className="text-sm text-ink-500">
          Pick up or drop off items at secure partner locations across Cebu. Generate a PIN-based handoff code for contactless exchange.
        </p>
      </div>

      {/* Active handoffs */}
      {handoffs.length > 0 && (
        <div className="mb-6 card p-4">
          <h3 className="font-medium text-ink-900 mb-3 flex items-center gap-2">
            <Package className="w-4 h-4 text-terracotta-500" />
            Active Handoffs ({handoffs.length})
          </h3>
          <div className="space-y-3">
            {handoffs.map((h) => {
              const locker = lockers.find((l) => l.id === h.locker_location_id);
              return (
                <div key={h.id} className="flex items-center justify-between p-3 rounded-lg bg-ink-50">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center',
                      h.status === 'DROPPED_OFF' ? 'bg-sage-100' : 'bg-terracotta-100',
                    )}>
                      <KeyRound className={cn(
                        'w-5 h-5',
                        h.status === 'DROPPED_OFF' ? 'text-sage-700' : 'text-terracotta-600',
                      )} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink-900">{locker?.partner_name || 'Locker'}</p>
                      <p className="text-xs text-ink-500">
                        PIN: <span className="font-mono font-bold text-ink-900">{h.pin_code}</span>
                        {' · '}
                        <span className={cn(
                          h.status === 'DROPPED_OFF' ? 'text-sage-700' : 'text-terracotta-600',
                        )}>
                          {h.status === 'DROPPED_OFF' ? 'Ready for pickup' : 'Awaiting drop-off'}
                        </span>
                      </p>
                      <p className="text-[10px] text-ink-400">
                        Created {formatTimeAgo(h.created_at)}
                        {h.drop_off_window_end && ` · Expires ${formatTimeAgo(h.drop_off_window_end)}`}
                      </p>
                    </div>
                  </div>
                  {h.status === 'DROPPED_OFF' && (
                    <button
                      onClick={() => {
                        setConfirmHandoffId(h.id);
                        setConfirmPin('');
                        setConfirmMessage('');
                      }}
                      className="btn-terracotta text-xs px-3 py-2"
                    >
                      Confirm Pickup
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Confirm pickup form */}
          {confirmHandoffId && (
            <div className="mt-3 p-3 rounded-lg border border-terracotta-200 bg-terracotta-50 animate-slide-down">
              <h4 className="text-sm font-medium text-ink-900 mb-2">Enter PIN to Confirm Pickup</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value)}
                  placeholder="6-digit PIN"
                  maxLength={6}
                  className="input-field text-sm font-mono tracking-widest"
                  style={{ width: '140px' }}
                />
                <button onClick={confirmPickup} className="btn-primary text-xs" disabled={!confirmPin}>
                  Confirm
                </button>
                <button onClick={() => setConfirmHandoffId('')} className="btn-secondary text-xs">
                  Cancel
                </button>
              </div>
              {confirmMessage && (
                <p className={cn(
                  'text-xs mt-2 flex items-center gap-1',
                  confirmMessage.includes('success') ? 'text-sage-700' : 'text-terracotta-600',
                )}>
                  {confirmMessage.includes('success') ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                  {confirmMessage}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_400px] gap-6">
        {/* Map */}
        <div className="rounded-xl overflow-hidden border border-ink-200" style={{ height: '500px' }}>
          <MapContainer
            center={[CEBU_CENTER.lat, CEBU_CENTER.lng]}
            zoom={11}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
            {filteredLockers.map((locker) => (
              <Marker
                key={locker.id}
                position={[locker.lat, locker.lng]}
                icon={lockerIcon}
                eventHandlers={{
                  click: () => setSelectedLocker(locker),
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">{locker.partner_name}</p>
                    <p className="text-xs text-ink-500">{locker.address}</p>
                    <p className="text-xs mt-1">
                      {locker.capacity_available}/{locker.capacity_total} compartments available
                    </p>
                  </div>
                </Popup>
              </Marker>
            ))}
            {userLat && userLng && (
              <Marker position={[userLat, userLng]}>
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">Your Location</p>
                  </div>
                </Popup>
              </Marker>
            )}
            <FitBounds points={lockerPoints} />
          </MapContainer>
        </div>

        {/* Locker list sidebar */}
        <div className="space-y-4">
          {/* Search + filter */}
          <div className="card p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search lockers..."
                className="input-field text-sm pl-10"
              />
            </div>
            <select
              value={selectedDistrict}
              onChange={(e) => setSelectedDistrict(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">All Cities / Municipalities</option>
              {[...new Set(CEBU_DISTRICTS.map((d) => d.city))].map((city) => (
                <option key={city} value={city}>{city}</option>
              ))}
            </select>
          </div>

          {/* Locker list */}
          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {loading ? (
              <div className="text-center py-8 text-sm text-ink-500">Loading lockers...</div>
            ) : sortedLockers.length === 0 ? (
              <div className="text-center py-8">
                <Lock className="w-10 h-10 text-ink-200 mx-auto mb-3" />
                <p className="text-sm text-ink-500">No lockers found in this area</p>
              </div>
            ) : (
              sortedLockers.map((locker) => {
                const isOpen = isLockerOpenNow(locker.operating_hours);
                const distance = userLat && userLng
                  ? haversineDistance(userLat, userLng, locker.lat, locker.lng)
                  : null;
                const isSelected = selectedLocker?.id === locker.id;

                return (
                  <div
                    key={locker.id}
                    className={cn(
                      'card p-4 cursor-pointer transition-all',
                      isSelected ? 'ring-2 ring-sage-500' : 'hover:shadow-md',
                    )}
                    onClick={() => setSelectedLocker(locker)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
                          isOpen ? 'bg-sage-100' : 'bg-ink-100',
                        )}>
                          <Lock className={cn('w-5 h-5', isOpen ? 'text-sage-700' : 'text-ink-400')} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-ink-900">{locker.partner_name}</p>
                          <p className="text-xs text-ink-500">{locker.address}</p>
                        </div>
                      </div>
                      <span className={cn(
                        'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                        isOpen ? 'bg-sage-100 text-sage-700' : 'bg-ink-100 text-ink-500',
                      )}>
                        {isOpen ? 'OPEN' : 'CLOSED'}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs text-ink-500 mb-3">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {getTodayHours(locker.operating_hours)}
                      </span>
                      {distance !== null && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {formatDistance(distance)} away
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex gap-1">
                          {Array.from({ length: locker.capacity_total }).slice(0, 8).map((_, i) => (
                            <div
                              key={i}
                              className={cn(
                                'w-5 h-7 rounded border-2',
                                i < locker.capacity_available
                                  ? 'border-sage-400 bg-sage-50'
                                  : 'border-ink-200 bg-ink-100',
                              )}
                            />
                          ))}
                        </div>
                        <span className="text-xs text-ink-500">
                          {locker.capacity_available}/{locker.capacity_total} free
                        </span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          generatePin(locker);
                        }}
                        disabled={locker.capacity_available === 0 || generatingPin}
                        className="btn-terracotta text-xs px-3 py-2 flex items-center gap-1"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Generate PIN
                      </button>
                    </div>

                    {locker.contact_phone && (
                      <p className="text-[10px] text-ink-400 mt-2 flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {locker.contact_phone}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* PIN result modal */}
      {showPinModal && pinResult && (
        <div className="fixed inset-0 z-50 bg-ink-950/50 flex items-center justify-center p-4" onClick={() => setShowPinModal(false)}>
          <div className="bg-cream rounded-xl shadow-xl max-w-sm w-full p-6 animate-slide-down" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-sage-100 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-8 h-8 text-sage-700" />
              </div>
              <h2 className="font-serif text-xl font-bold text-ink-900 mb-1">Your Handoff PIN</h2>
              <p className="text-xs text-ink-500 mb-4">{pinResult.locker_name}</p>
              <p className="text-4xl font-mono font-bold text-ink-900 tracking-[0.3em] py-4 bg-ink-50 rounded-lg mb-4">
                {pinResult.pin_code}
              </p>
              <div className="text-xs text-ink-500 space-y-1 mb-4">
                <p className="flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3" />
                  Valid for 48 hours
                </p>
                <p>Show this PIN at the locker to drop off or pick up your item.</p>
              </div>
              <button
                onClick={() => setShowPinModal(false)}
                className="w-full btn-primary"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PIN error */}
      {pinError && !showPinModal && (
        <div className="fixed bottom-4 right-4 z-50 bg-terracotta-50 border border-terracotta-200 rounded-lg p-4 shadow-lg max-w-xs animate-slide-up">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-terracotta-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-terracotta-900">{pinError}</p>
            </div>
            <button onClick={() => setPinError('')} className="text-terracotta-400 hover:text-terracotta-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
