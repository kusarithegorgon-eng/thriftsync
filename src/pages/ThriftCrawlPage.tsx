import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import {
  MapPin, Plus, X, Clock, Navigation, Car, PersonStanding, Bus,
  Save, Route, Trash2, GripVertical, Store, ArrowRight, Calendar,
} from 'lucide-react';
import { supabase, type Boutique, type ItineraryStop, type TransportMode, type Itinerary } from '@/lib/supabase';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import {
  CEBU_CENTER, cn, optimizeRoute, formatDuration, formatDistance, haversineDistance,
} from '@/lib/utils';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STOP_COLORS = ['#b45309', '#0f766e', '#be123c', '#1d4ed8', '#7c3aed', '#c2410c'];

function FitBounds({ stops }: { stops: { lat: number; lng: number }[] }) {
  const map = useMap();
  useEffect(() => {
    if (stops.length === 0) return;
    if (stops.length === 1) {
      map.setView([stops[0].lat, stops[0].lng], 14);
      return;
    }
    const bounds = L.latLngBounds(stops.map((s) => [s.lat, s.lng] as [number, number]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }, [stops, map]);
  return null;
}

export function ThriftCrawlPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [boutiques, setBoutiques] = useState<Boutique[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStops, setSelectedStops] = useState<ItineraryStop[]>([]);
  const [transportMode, setTransportMode] = useState<TransportMode>('driving');
  const [itineraryName, setItineraryName] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedItineraries, setSavedItineraries] = useState<Itinerary[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('boutiques')
        .select('*')
        .not('lat', 'is', null)
        .not('lng', 'is', null)
        .order('name');

      if (error) {
        console.error('Load boutiques error:', error);
      }
      setBoutiques((data as Boutique[]) || []);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('itineraries')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (data) setSavedItineraries(data as Itinerary[]);
      });
  }, [user]);

  const optimized = useMemo(() => {
    if (selectedStops.length < 2) return null;
    return optimizeRoute(selectedStops, transportMode);
  }, [selectedStops, transportMode]);

  const filteredBoutiques = useMemo(() => {
    if (!searchQuery) return boutiques;
    const q = searchQuery.toLowerCase();
    return boutiques.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.barangay || '').toLowerCase().includes(q) ||
        (b.location || '').toLowerCase().includes(q),
    );
  }, [boutiques, searchQuery]);

  function addStop(boutique: Boutique) {
    if (selectedStops.some((s) => s.boutique_id === boutique.id)) return;
    if (!boutique.lat || !boutique.lng) return;
    setSelectedStops([
      ...selectedStops,
      {
        boutique_id: boutique.id,
        stop_order: selectedStops.length + 1,
        boutique_name: boutique.name,
        lat: boutique.lat,
        lng: boutique.lng,
      },
    ]);
    setShowSearch(false);
    setSearchQuery('');
  }

  function removeStop(boutiqueId: string) {
    setSelectedStops(
      selectedStops
        .filter((s) => s.boutique_id !== boutiqueId)
        .map((s, i) => ({ ...s, stop_order: i + 1 })),
    );
  }

  function moveStop(index: number, dir: -1 | 1) {
    const newIndex = index + dir;
    if (newIndex < 0 || newIndex >= selectedStops.length) return;
    const reordered = [...selectedStops];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];
    setSelectedStops(reordered.map((s, i) => ({ ...s, stop_order: i + 1 })));
  }

  async function saveItinerary() {
    if (!user) {
      navigate({ name: 'auth' });
      return;
    }
    if (!itineraryName || selectedStops.length < 2) return;

    setSaving(true);
    try {
      const stopsData = selectedStops.map((s, i) => ({
        boutique_id: s.boutique_id,
        stop_order: i + 1,
        boutique_name: s.boutique_name,
        lat: s.lat,
        lng: s.lng,
      }));

      const { data, error } = await supabase
        .from('itineraries')
        .insert({
          user_id: user.id,
          name: itineraryName,
          stops: stopsData,
          transport_mode: transportMode,
          total_distance_km: optimized?.total_distance_km ?? 0,
          total_time_minutes: optimized?.total_time_minutes ?? 0,
          scheduled_date: scheduledDate || null,
          status: 'planned',
        })
        .select()
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setSavedItineraries([data as Itinerary, ...savedItineraries]);
        setShowSaved(true);
      }
    } catch (err) {
      console.error('Save itinerary error:', err);
    } finally {
      setSaving(false);
    }
  }

  function loadItinerary(it: Itinerary) {
    setSelectedStops(it.stops || []);
    setTransportMode(it.transport_mode);
    setItineraryName(it.name);
    setScheduledDate(it.scheduled_date || '');
    setShowSaved(false);
  }

  const routePositions = optimized
    ? optimized.ordered_stops.map((s) => [s.lat, s.lng] as [number, number])
    : selectedStops.map((s) => [s.lat, s.lng] as [number, number]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl font-bold text-ink-900 mb-1 flex items-center gap-2">
            <Route className="w-7 h-7 text-terracotta-500" />
            Thrift Crawl Planner
          </h1>
          <p className="text-sm text-ink-500">
            Build a multi-stop itinerary across Cebu's vintage boutiques. Pick your transport, optimize the route, and save your crawl.
          </p>
        </div>
        {savedItineraries.length > 0 && (
          <button
            onClick={() => setShowSaved(!showSaved)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0',
              showSaved ? 'bg-ink-900 text-cream' : 'bg-white border border-ink-200 text-ink-700 hover:border-ink-400',
            )}
          >
            Saved Crawls ({savedItineraries.length})
          </button>
        )}
      </div>

      {/* Saved itineraries panel */}
      {showSaved && (
        <div className="mb-6 card p-4 animate-slide-down">
          <h3 className="font-medium text-ink-900 mb-3">Your Saved Crawls</h3>
          <div className="space-y-2">
            {savedItineraries.map((it) => (
              <div
                key={it.id}
                className="flex items-center justify-between p-3 rounded-lg bg-ink-50 hover:bg-ink-100 transition-colors cursor-pointer"
                onClick={() => loadItinerary(it)}
              >
                <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-ink-400" />
                  <div>
                    <p className="text-sm font-medium text-ink-900">{it.name}</p>
                    <p className="text-xs text-ink-500">
                      {it.stops?.length || 0} stops · {formatDistance(Number(it.total_distance_km))} · {formatDuration(it.total_time_minutes)}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-ink-400" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-[1fr_400px] gap-6">
        {/* Map column */}
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden border border-ink-200" style={{ height: '500px' }}>
            <MapContainer
              center={[CEBU_CENTER.lat, CEBU_CENTER.lng]}
              zoom={12}
              style={{ height: '100%', width: '100%' }}
              scrollWheelZoom={false}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
              />
              {selectedStops.map((stop, i) => (
                <Marker
                  key={stop.boutique_id}
                  position={[stop.lat, stop.lng]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="background:${STOP_COLORS[i % STOP_COLORS.length]};width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3)"><span style="transform:rotate(45deg);color:white;font-size:12px;font-weight:bold">${i + 1}</span></div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 28],
                  })}
                >
                  <Popup>
                    <div className="text-sm">
                      <p className="font-medium">Stop {i + 1}: {stop.boutique_name}</p>
                    </div>
                  </Popup>
                </Marker>
              ))}
              {routePositions.length >= 2 && (
                <Polyline positions={routePositions} pathOptions={{ color: '#b45309', weight: 3, opacity: 0.7, dashArray: '8 6' }} />
              )}
              <FitBounds stops={selectedStops} />
            </MapContainer>
          </div>

          {/* Route summary */}
          {optimized && selectedStops.length >= 2 && (
            <div className="card p-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Stops</p>
                  <p className="text-2xl font-serif font-bold text-ink-900">{optimized.ordered_stops.length}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Distance</p>
                  <p className="text-2xl font-serif font-bold text-ink-900">{formatDistance(optimized.total_distance_km)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-500 uppercase tracking-wide mb-1">Travel Time</p>
                  <p className="text-2xl font-serif font-bold text-ink-900">{formatDuration(optimized.total_time_minutes)}</p>
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-ink-100">
                <p className="text-xs text-ink-400 text-center">
                  Route optimized using nearest-neighbor algorithm for {transportMode} mode
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: stops + controls */}
        <div className="space-y-4">
          {/* Transport mode selector */}
          <div className="card p-4">
            <h3 className="text-sm font-medium text-ink-900 mb-3">Transport Mode</h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                { mode: 'driving' as const, icon: Car, label: 'Drive' },
                { mode: 'jeepney' as const, icon: Bus, label: 'Jeepney' },
                { mode: 'walking' as const, icon: PersonStanding, label: 'Walk' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  onClick={() => setTransportMode(mode)}
                  className={cn(
                    'flex flex-col items-center gap-1 py-3 rounded-lg border text-xs font-medium transition-all',
                    transportMode === mode
                      ? 'border-ink-900 bg-ink-900 text-cream'
                      : 'border-ink-200 bg-white text-ink-600 hover:border-ink-400',
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Stop list */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-ink-900">Your Stops</h3>
              <span className="text-xs text-ink-500">{selectedStops.length} selected</span>
            </div>

            {selectedStops.length === 0 ? (
              <div className="text-center py-8">
                <Store className="w-10 h-10 text-ink-200 mx-auto mb-3" />
                <p className="text-sm text-ink-500 mb-3">No stops yet. Add boutiques to start your crawl.</p>
                <button onClick={() => setShowSearch(true)} className="btn-terracotta text-xs">
                  <Plus className="w-4 h-4 inline mr-1" />
                  Add First Stop
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {selectedStops.map((stop, i) => (
                  <div
                    key={stop.boutique_id}
                    className="flex items-center gap-2 p-2.5 rounded-lg bg-ink-50 group"
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                      style={{ backgroundColor: STOP_COLORS[i % STOP_COLORS.length] }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-900 truncate">{stop.boutique_name}</p>
                      {i < selectedStops.length - 1 && (
                        <p className="text-[10px] text-ink-400">
                          {formatDistance(haversineDistance(stop.lat, stop.lng, selectedStops[i + 1].lat, selectedStops[i + 1].lng))} to next
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <button
                        onClick={() => moveStop(i, -1)}
                        disabled={i === 0}
                        className="text-ink-400 hover:text-ink-900 disabled:opacity-20 text-xs"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveStop(i, 1)}
                        disabled={i === selectedStops.length - 1}
                        className="text-ink-400 hover:text-ink-900 disabled:opacity-20 text-xs"
                      >
                        ▼
                      </button>
                    </div>
                    <button
                      onClick={() => removeStop(stop.boutique_id)}
                      className="text-ink-400 hover:text-terracotta-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setShowSearch(true)}
                  className="w-full py-2.5 rounded-lg border border-dashed border-ink-300 text-sm text-ink-500 hover:border-ink-900 hover:text-ink-900 transition-colors flex items-center justify-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Stop
                </button>
              </div>
            )}
          </div>

          {/* Save itinerary */}
          {selectedStops.length >= 2 && (
            <div className="card p-4 space-y-3">
              <h3 className="text-sm font-medium text-ink-900">Save This Crawl</h3>
              <input
                type="text"
                value={itineraryName}
                onChange={(e) => setItineraryName(e.target.value)}
                placeholder="Crawl name (e.g. Saturday Lahug Crawl)"
                className="input-field text-sm"
              />
              <input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="input-field text-sm"
              />
              <button
                onClick={saveItinerary}
                disabled={!itineraryName || saving}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Itinerary'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Boutique search modal */}
      {showSearch && (
        <div className="fixed inset-0 z-50 bg-ink-950/50 flex items-center justify-center p-4" onClick={() => setShowSearch(false)}>
          <div className="bg-cream rounded-xl shadow-xl max-w-md w-full max-h-[80vh] flex flex-col animate-slide-down" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-ink-100">
              <h2 className="font-serif text-lg font-bold">Add a Stop</h2>
              <button onClick={() => setShowSearch(false)} className="p-1 rounded hover:bg-ink-100">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 border-b border-ink-100">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search boutiques by name or area..."
                className="input-field text-sm"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="text-center py-8 text-sm text-ink-500">Loading boutiques...</div>
              ) : filteredBoutiques.length === 0 ? (
                <div className="text-center py-8 text-sm text-ink-500">No boutiques found</div>
              ) : (
                filteredBoutiques.map((b) => {
                  const alreadyAdded = selectedStops.some((s) => s.boutique_id === b.id);
                  return (
                    <button
                      key={b.id}
                      onClick={() => addStop(b)}
                      disabled={alreadyAdded}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-lg text-left transition-colors mb-1',
                        alreadyAdded ? 'opacity-40 cursor-not-allowed' : 'hover:bg-ink-100',
                      )}
                    >
                      <div className="w-9 h-9 rounded-lg bg-sage-100 flex items-center justify-center shrink-0">
                        <Store className="w-4 h-4 text-sage-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">{b.name}</p>
                        <p className="text-xs text-ink-500 truncate">
                          {b.barangay || b.location || 'Cebu'}
                        </p>
                      </div>
                      {alreadyAdded ? (
                        <span className="text-xs text-ink-400">Added</span>
                      ) : (
                        <Plus className="w-4 h-4 text-terracotta-500" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
