import { useEffect, useState } from 'react';
import { SlidersHorizontal, X, Gavel } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { supabase, type ListingWithBoutique, type CebuDistrict } from '@/lib/supabase';
import { ListingCard, ListingCardSkeleton } from '@/components/ListingCard';
import { CATEGORIES, ERAS, CONDITIONS, CEBU_DISTRICTS, cn } from '@/lib/utils';

export function BrowsePage() {
  const { route, navigate } = useRouter();
  const initialCategory = route.name === 'browse' ? route.category : undefined;
  const initialEra = route.name === 'browse' ? route.era : undefined;
  const initialQ = route.name === 'browse' ? route.q : undefined;

  const [listings, setListings] = useState<ListingWithBoutique[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'popular' | 'price_asc' | 'price_desc' | 'newest'>('popular');

  const [selectedCategories, setSelectedCategories] = useState<string[]>(initialCategory ? [initialCategory] : []);
  const [selectedEras, setSelectedEras] = useState<string[]>(initialEra ? [initialEra] : []);
  const [selectedConditions, setSelectedConditions] = useState<string[]>([]);
  const [auctionOnly, setAuctionOnly] = useState(false);
  const [dutchOnly, setDutchOnly] = useState(false);
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialQ || '');

  useEffect(() => {
    if (initialCategory) setSelectedCategories([initialCategory]);
    if (initialEra) setSelectedEras([initialEra]);
    if (initialQ) setSearchQuery(initialQ);
  }, [initialCategory, initialEra, initialQ]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from('listings')
        .select('*, boutiques(id, name, slug, logo_url)')
        .eq('status', 'active')
        .eq('moderation_status', 'approved');

      if (selectedCategories.length > 0) {
        query = query.in('category', selectedCategories);
      }
      if (selectedEras.length > 0) {
        query = query.in('era', selectedEras);
      }
      if (selectedConditions.length > 0) {
        query = query.in('condition_grade', selectedConditions);
      }
      if (auctionOnly) {
        query = query.eq('listing_type', 'auction');
      }
      if (dutchOnly) {
        query = query.eq('auction_mode', 'DUTCH');
      }
      if (selectedDistricts.length > 0) {
        const { data: districtBoutiques } = await supabase
          .from('boutiques')
          .select('id')
          .in('district_id', selectedDistricts);
        if (districtBoutiques && districtBoutiques.length > 0) {
          query = query.in('boutique_id', districtBoutiques.map((b) => b.id));
        } else {
          setListings([]);
          setLoading(false);
          return;
        }
      }
      if (searchQuery) {
        query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
      }

      switch (sortBy) {
        case 'price_asc':
          query = query.order('price', { ascending: true });
          break;
        case 'price_desc':
          query = query.order('price', { ascending: false });
          break;
        case 'newest':
          query = query.order('created_at', { ascending: false });
          break;
        default:
          query = query.order('views', { ascending: false });
      }

      const { data, error } = await query.limit(60);
      if (error) {
        console.error('Browse error:', error);
      }
      setListings((data as ListingWithBoutique[]) || []);
      setLoading(false);
    }
    load();
  }, [selectedCategories, selectedEras, selectedConditions, auctionOnly, dutchOnly, selectedDistricts, searchQuery, sortBy]);

  function toggleArrayValue(arr: string[], value: string): string[] {
    return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
  }

  function clearFilters() {
    setSelectedCategories([]);
    setSelectedEras([]);
    setSelectedConditions([]);
    setAuctionOnly(false);
    setDutchOnly(false);
    setSelectedDistricts([]);
    setSearchQuery('');
    navigate({ name: 'browse' });
  }

  const activeFilterCount =
    selectedCategories.length + selectedEras.length + selectedConditions.length + selectedDistricts.length + (auctionOnly ? 1 : 0) + (dutchOnly ? 1 : 0) + (searchQuery ? 1 : 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <div className="mb-6">
        <h1 className="font-serif text-3xl font-bold text-ink-900 mb-1">Browse Collection</h1>
        <p className="text-sm text-ink-500">
          {loading ? 'Loading...' : `${listings.length} unique item${listings.length !== 1 ? 's' : ''} found`}
        </p>
      </div>

      {/* Search bar */}
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by title or description..."
          className="input-field flex-1"
        />
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors flex items-center gap-2',
            showFilters || activeFilterCount > 0
              ? 'border-ink-900 bg-ink-900 text-cream'
              : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400'
          )}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">Filters</span>
          {activeFilterCount > 0 && (
            <span className="bg-terracotta-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex gap-6">
        {/* Filters sidebar */}
        {showFilters && (
          <aside className="w-64 shrink-0 hidden lg:block animate-slide-down">
            <FilterPanel
              selectedCategories={selectedCategories}
              selectedEras={selectedEras}
              selectedConditions={selectedConditions}
              auctionOnly={auctionOnly}
              dutchOnly={dutchOnly}
              selectedDistricts={selectedDistricts}
              onToggleCategory={(v) => setSelectedCategories((prev) => toggleArrayValue(prev, v))}
              onToggleEra={(v) => setSelectedEras((prev) => toggleArrayValue(prev, v))}
              onToggleCondition={(v) => setSelectedConditions((prev) => toggleArrayValue(prev, v))}
              onToggleAuction={() => setAuctionOnly(!auctionOnly)}
              onToggleDutch={() => setDutchOnly(!dutchOnly)}
              onToggleDistrict={(v) => setSelectedDistricts((prev) => toggleArrayValue(prev, v))}
              onClear={clearFilters}
            />
          </aside>
        )}

        {/* Mobile filter drawer */}
        {showFilters && (
          <div className="lg:hidden fixed inset-0 z-50 bg-ink-950/50 flex" onClick={() => setShowFilters(false)}>
            <div className="bg-cream w-80 max-w-[85vw] h-full overflow-y-auto p-4 animate-slide-down" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h2 className="font-serif text-lg font-bold">Filters</h2>
                <button onClick={() => setShowFilters(false)} className="p-1 rounded hover:bg-ink-100">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <FilterPanel
                selectedCategories={selectedCategories}
                selectedEras={selectedEras}
                selectedConditions={selectedConditions}
                auctionOnly={auctionOnly}
                dutchOnly={dutchOnly}
                selectedDistricts={selectedDistricts}
                onToggleCategory={(v) => setSelectedCategories((prev) => toggleArrayValue(prev, v))}
                onToggleEra={(v) => setSelectedEras((prev) => toggleArrayValue(prev, v))}
                onToggleCondition={(v) => setSelectedConditions((prev) => toggleArrayValue(prev, v))}
                onToggleAuction={() => setAuctionOnly(!auctionOnly)}
                onToggleDutch={() => setDutchOnly(!dutchOnly)}
                onToggleDistrict={(v) => setSelectedDistricts((prev) => toggleArrayValue(prev, v))}
                onClear={clearFilters}
              />
            </div>
          </div>
        )}

        {/* Listings grid */}
        <div className="flex-1">
          {/* Sort bar */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 flex-wrap">
              {selectedCategories.map((c) => (
                <FilterChip key={c} label={c} onRemove={() => setSelectedCategories((prev) => prev.filter((v) => v !== c))} />
              ))}
              {selectedEras.map((e) => (
                <FilterChip key={e} label={e} onRemove={() => setSelectedEras((prev) => prev.filter((v) => v !== e))} />
              ))}
              {selectedConditions.map((c) => (
                <FilterChip key={c} label={c} onRemove={() => setSelectedConditions((prev) => prev.filter((v) => v !== c))} />
              ))}
              {auctionOnly && <FilterChip label="Auctions Only" onRemove={() => setAuctionOnly(false)} />}
              {dutchOnly && <FilterChip label="Dutch Auctions" onRemove={() => setDutchOnly(false)} />}
              {selectedDistricts.map((d) => (
                <FilterChip key={d} label={d} onRemove={() => setSelectedDistricts((prev) => prev.filter((v) => v !== d))} />
              ))}
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="text-sm border border-ink-200 rounded-lg px-3 py-1.5 bg-white text-ink-700 focus:outline-none focus:border-ink-900"
            >
              <option value="popular">Most Popular</option>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {Array.from({ length: 12 }).map((_, i) => <ListingCardSkeleton key={i} />)}
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-20">
              <Gavel className="w-12 h-12 text-ink-300 mx-auto mb-4" />
              <p className="text-ink-500 mb-2">No items match your filters</p>
              <button onClick={clearFilters} className="btn-secondary">Clear all filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
              {listings.map((listing) => <ListingCard key={listing.id} listing={listing} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterPanel(props: {
  selectedCategories: string[];
  selectedEras: string[];
  selectedConditions: string[];
  auctionOnly: boolean;
  dutchOnly: boolean;
  selectedDistricts: string[];
  onToggleCategory: (v: string) => void;
  onToggleEra: (v: string) => void;
  onToggleCondition: (v: string) => void;
  onToggleAuction: () => void;
  onToggleDutch: () => void;
  onToggleDistrict: (v: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-ink-900">Filters</h3>
        <button onClick={props.onClear} className="text-xs text-terracotta-600 hover:text-terracotta-700">Clear all</button>
      </div>

      <FilterGroup title="Category">
        {CATEGORIES.map((cat) => (
          <FilterCheckbox
            key={cat}
            label={cat}
            checked={props.selectedCategories.includes(cat)}
            onChange={() => props.onToggleCategory(cat)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Era">
        {ERAS.map((era) => (
          <FilterCheckbox
            key={era}
            label={era}
            checked={props.selectedEras.includes(era)}
            onChange={() => props.onToggleEra(era)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Condition">
        {CONDITIONS.map((cond) => (
          <FilterCheckbox
            key={cond}
            label={cond}
            checked={props.selectedConditions.includes(cond)}
            onChange={() => props.onToggleCondition(cond)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Cebu District">
        {CEBU_DISTRICTS.filter((d) => d.metro).map((d) => (
          <FilterCheckbox
            key={d.name}
            label={`${d.name} (${d.city})`}
            checked={props.selectedDistricts.includes(d.name)}
            onChange={() => props.onToggleDistrict(d.name)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Listing Type">
        <FilterCheckbox
          label="Auction items only"
          checked={props.auctionOnly}
          onChange={props.onToggleAuction}
        />
        <FilterCheckbox
          label="Dutch auctions (descending price)"
          checked={props.dutchOnly}
          onChange={props.onToggleDutch}
        />
      </FilterGroup>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-sm font-medium text-ink-900 mb-2">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={cn(
        'flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-sm transition-colors text-left',
        checked ? 'bg-sage-50 text-sage-900' : 'text-ink-600 hover:bg-ink-50'
      )}
    >
      <div className={cn(
        'w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0',
        checked ? 'bg-sage-600 border-sage-600' : 'border-ink-300'
      )}>
        {checked && <div className="w-2 h-2 rounded-sm bg-cream" />}
      </div>
      {label}
    </button>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-sage-50 text-sage-800 rounded-full text-xs font-medium">
      {label}
      <button onClick={onRemove} className="hover:text-sage-900">
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
