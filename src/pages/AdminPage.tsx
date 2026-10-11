import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, CheckCircle2, XCircle, Clock, Search, Package, CheckSquare,
  ChevronRight, AlertCircle, Store, RefreshCw,
} from 'lucide-react';
import { supabase, type ListingWithBoutique } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';

export function AdminPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [listings, setListings] = useState<ListingWithBoutique[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending_review' | 'approved' | 'rejected' | 'all'>('pending_review');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ id: string; text: string; success: boolean } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMessage, setBulkMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [rejectModal, setRejectModal] = useState<{ listingId: string | null; listingTitle: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedListing, setSelectedListing] = useState<ListingWithBoutique | null>(null);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setSelectedIds([]);
    let query = supabase
      .from('listings')
      .select('*, boutiques(id, name, slug, logo_url)');

    if (filter !== 'all') {
      query = query.eq('moderation_status', filter);
    }

    if (searchQuery) {
      query = query.or(`title.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false }).limit(50);
    if (error) {
      console.error('Admin load error:', error);
    }
    setListings((data as ListingWithBoutique[]) || []);
    setLoading(false);
  }, [filter, searchQuery]);

  useEffect(() => {
    if (!authLoading && (!user || profile?.role !== 'admin')) {
      navigate({ name: 'home' });
    }
  }, [user, profile, authLoading, navigate]);

  useEffect(() => {
    if (user && profile?.role === 'admin') {
      loadListings();
    }
  }, [user, profile, loadListings]);

  async function approve(listingId: string) {
    setActionLoading(listingId);
    setActionMessage(null);
    try {
      const { data, error } = await supabase.rpc('approve_listing', {
        p_listing_id: listingId,
      });
      if (error) throw error;
      const row = data?.[0];
      setActionMessage({ id: listingId, text: row?.message || 'Approved', success: row?.success ?? true });
      if (row?.success) {
        setListings((prev) => prev.filter((l) => l.id !== listingId));
      }
    } catch (err) {
      setActionMessage({ id: listingId, text: err instanceof Error ? err.message : 'Failed to approve', success: false });
    } finally {
      setActionLoading(null);
    }
  }

  async function reject(listingId: string, reason: string) {
    setActionLoading(listingId);
    setActionMessage(null);
    try {
      const { data, error } = await supabase.rpc('reject_listing', {
        p_listing_id: listingId,
        p_reason: reason,
      });
      if (error) throw error;
      const row = data?.[0];
      setActionMessage({ id: listingId, text: row?.message || 'Rejected', success: row?.success ?? true });
      if (row?.success) {
        setListings((prev) => prev.filter((l) => l.id !== listingId));
        setRejectModal(null);
        setRejectReason('');
      }
    } catch (err) {
      setActionMessage({ id: listingId, text: err instanceof Error ? err.message : 'Failed to reject', success: false });
    } finally {
      setActionLoading(null);
    }
  }

  async function moderateSelected(action: 'approve' | 'reject', reason?: string) {
    const pendingIds = listings
      .filter((listing) => listing.moderation_status === 'pending_review' && selectedIds.includes(listing.id))
      .map((listing) => listing.id);
    if (!pendingIds.length) return;

    setActionLoading('bulk');
    setBulkMessage(null);
    try {
      const { data, error } = await supabase.rpc('bulk_moderate_listings', {
        p_listing_ids: pendingIds,
        p_action: action,
        p_reason: reason || null,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result) throw new Error('Bulk moderation did not return a result.');
      setBulkMessage({ text: result.message, success: result.processed_count > 0 });
      setSelectedIds([]);
      setRejectModal(null);
      setRejectReason('');
      await loadListings();
    } catch (err) {
      setBulkMessage({
        text: err instanceof Error ? err.message : 'Bulk moderation failed.',
        success: false,
      });
    } finally {
      setActionLoading(null);
    }
  }

  if (authLoading) {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-ink-500">Loading...</div>;
  }

  if (!user || profile?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <ShieldCheck className="w-12 h-12 text-ink-300 mx-auto mb-4" />
        <h1 className="font-serif text-xl font-bold text-ink-900 mb-2">Admin Access Required</h1>
        <p className="text-sm text-ink-500 mb-4">You need an admin account to access this page.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In as Admin</button>
      </div>
    );
  }

  const pendingCount = listings.filter((l) => l.moderation_status === 'pending_review').length;
  const pendingListings = listings.filter((listing) => listing.moderation_status === 'pending_review');
  const selectedPendingCount = pendingListings.filter((listing) => selectedIds.includes(listing.id)).length;
  const allPendingSelected = pendingListings.length > 0 && selectedPendingCount === pendingListings.length;

  function toggleListingSelection(listingId: string) {
    setSelectedIds((current) => current.includes(listingId)
      ? current.filter((id) => id !== listingId)
      : [...current, listingId]);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl font-bold text-ink-900 mb-1 flex items-center gap-2">
            <ShieldCheck className="w-7 h-7 text-sage-700" />
            Admin Moderation
          </h1>
          <p className="text-sm text-ink-500">
            Review and approve listings before they go live. Check for illegal or stolen items.
          </p>
        </div>
        <button
          onClick={loadListings}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className="card p-4 text-center">
          <Clock className="w-6 h-6 text-terracotta-500 mx-auto mb-2" />
          <p className="text-2xl font-serif font-bold text-ink-900">{pendingCount}</p>
          <p className="text-xs text-ink-500">Pending Review</p>
        </div>
        <div className="card p-4 text-center">
          <CheckCircle2 className="w-6 h-6 text-sage-600 mx-auto mb-2" />
          <p className="text-2xl font-serif font-bold text-ink-900">{listings.filter((l) => l.moderation_status === 'approved').length}</p>
          <p className="text-xs text-ink-500">Approved</p>
        </div>
        <div className="card p-4 text-center">
          <XCircle className="w-6 h-6 text-ink-400 mx-auto mb-2" />
          <p className="text-2xl font-serif font-bold text-ink-900">{listings.filter((l) => l.moderation_status === 'rejected').length}</p>
          <p className="text-xs text-ink-500">Rejected</p>
        </div>
      </div>

      {/* Filter tabs + search */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 p-1 bg-ink-50 rounded-lg">
          {([
            { key: 'pending_review' as const, label: 'Pending' },
            { key: 'approved' as const, label: 'Approved' },
            { key: 'rejected' as const, label: 'Rejected' },
            { key: 'all' as const, label: 'All' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                filter === key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search listings..."
            className="input-field text-sm pl-10"
          />
        </div>
      </div>

      {bulkMessage && (
        <div className={cn(
          'mb-4 p-3 rounded-lg text-sm flex items-center gap-2',
          bulkMessage.success ? 'bg-sage-50 text-sage-700' : 'bg-terracotta-50 text-terracotta-700',
        )}>
          {bulkMessage.success
            ? <CheckCircle2 className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {bulkMessage.text}
        </div>
      )}

      {/* Listings */}
      {loading ? (
        <div className="text-center py-16 text-sm text-ink-500">Loading listings...</div>
      ) : listings.length === 0 ? (
        <div className="text-center py-16">
          <Package className="w-12 h-12 text-ink-200 mx-auto mb-4" />
          <p className="text-ink-500">No listings in this category</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filter === 'pending_review' && pendingListings.length > 0 && (
            <div className="card p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allPendingSelected}
                  onChange={(event) => setSelectedIds(
                    event.target.checked ? pendingListings.map((listing) => listing.id) : [],
                  )}
                  disabled={actionLoading !== null}
                  className="w-4 h-4 rounded border-ink-300 text-terracotta-500 focus:ring-terracotta-400"
                />
                Select all {pendingListings.length} pending listings on this page
              </label>
              <span className="text-xs text-ink-500 sm:ml-auto">
                {selectedPendingCount} selected
              </span>
              <button
                onClick={() => moderateSelected('approve')}
                disabled={selectedPendingCount === 0 || actionLoading !== null}
                className="btn-primary text-xs px-3 py-2 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {actionLoading === 'bulk' ? 'Processing...' : `Approve Selected (${selectedPendingCount})`}
              </button>
              <button
                onClick={() => {
                  setRejectModal({ listingId: null, listingTitle: `${selectedPendingCount} selected listings` });
                  setRejectReason('');
                }}
                disabled={selectedPendingCount === 0 || actionLoading !== null}
                className="btn-secondary text-xs px-3 py-2 flex items-center justify-center gap-1 disabled:opacity-50"
              >
                <XCircle className="w-3.5 h-3.5" />
                Reject Selected
              </button>
            </div>
          )}
          {listings.map((listing) => (
            <div key={listing.id} className="card p-4">
              <div className="flex items-start gap-4">
                {filter === 'pending_review' && listing.moderation_status === 'pending_review' && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${listing.title}`}
                    checked={selectedIds.includes(listing.id)}
                    onChange={() => toggleListingSelection(listing.id)}
                    disabled={actionLoading !== null}
                    className="mt-1 w-4 h-4 shrink-0 rounded border-ink-300 text-terracotta-500 focus:ring-terracotta-400"
                  />
                )}
                {/* Image */}
                <div className="w-20 h-20 rounded-lg overflow-hidden bg-ink-100 shrink-0">
                  {listing.images && listing.images.length > 0 ? (
                    <img src={listing.images[0]} alt={listing.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-6 h-6 text-ink-300" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-ink-900 truncate">{listing.title}</h3>
                      <p className="text-xs text-ink-500 flex items-center gap-1">
                        <Store className="w-3 h-3" />
                        {listing.boutiques?.name || 'Unknown boutique'}
                        {' · '}
                        {formatPrice(Number(listing.price))}
                      </p>
                    </div>
                    <ModerationBadge status={listing.moderation_status} />
                  </div>

                  <p className="text-xs text-ink-500 line-clamp-2 mb-2">
                    {listing.description || 'No description'}
                  </p>

                  <div className="flex items-center gap-3 text-[10px] text-ink-400 mb-3">
                    <span>{listing.era || 'No era'}</span>
                    <span>·</span>
                    <span>{listing.category || 'No category'}</span>
                    <span>·</span>
                    <span>{listing.condition_grade || 'No condition'}</span>
                    <span>·</span>
                    <span>{formatTimeAgo(listing.created_at)}</span>
                  </div>

                  {/* Action message */}
                  {actionMessage?.id === listing.id && (
                    <div className={cn(
                      'mb-3 p-2 rounded-lg text-xs flex items-center gap-1.5',
                      actionMessage.success ? 'bg-sage-50 text-sage-700' : 'bg-terracotta-50 text-terracotta-600',
                    )}>
                      {actionMessage.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                      {actionMessage.text}
                    </div>
                  )}

                  {/* Rejection reason */}
                  {listing.moderation_status === 'rejected' && listing.moderation_note && (
                    <div className="mb-3 p-2 rounded-lg bg-terracotta-50 text-xs text-terracotta-700">
                      <span className="font-medium">Rejection reason: </span>
                      {listing.moderation_note}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {listing.moderation_status === 'pending_review' && (
                      <>
                        <button
                          onClick={() => approve(listing.id)}
                          disabled={actionLoading === listing.id}
                          className="btn-primary text-xs px-3 py-2 flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {actionLoading === listing.id ? 'Processing...' : 'Approve'}
                        </button>
                        <button
                          onClick={() => {
                            setRejectModal({ listingId: listing.id, listingTitle: listing.title });
                            setRejectReason('');
                          }}
                          disabled={actionLoading === listing.id}
                          className="btn-secondary text-xs px-3 py-2 flex items-center gap-1"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Reject
                        </button>
                      </>
                    )}
                    {listing.moderation_status === 'approved' && (
                      <button
                        onClick={() => {
                          setRejectModal({ listingId: listing.id, listingTitle: listing.title });
                          setRejectReason('');
                        }}
                        disabled={actionLoading === listing.id}
                        className="btn-secondary text-xs px-3 py-2 flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Revoke
                      </button>
                    )}
                    {listing.moderation_status === 'rejected' && (
                      <button
                        onClick={() => approve(listing.id)}
                        disabled={actionLoading === listing.id}
                        className="btn-primary text-xs px-3 py-2 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve Now
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedListing(listing)}
                      className="text-xs text-ink-500 hover:text-ink-900 flex items-center gap-1 ml-auto"
                    >
                      View Details
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-[1000] bg-ink-950/50 flex items-center justify-center p-4" onClick={() => setRejectModal(null)}>
          <div className="bg-cream rounded-xl shadow-xl max-w-md w-full p-6 animate-slide-down" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-terracotta-100 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-terracotta-600" />
              </div>
              <div>
                <h2 className="font-serif text-lg font-bold text-ink-900">
                  {rejectModal.listingId ? 'Reject Listing' : 'Reject Selected Listings'}
                </h2>
                <p className="text-xs text-ink-500">{rejectModal.listingTitle}</p>
              </div>
            </div>
            <p className="text-sm text-ink-600 mb-3">
              Provide a reason for rejecting this listing. The seller will see this message.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Item appears to be stolen goods. Please provide proof of ownership."
              className="input-field min-h-[80px] resize-none mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => rejectModal.listingId
                  ? reject(rejectModal.listingId, rejectReason.trim() || 'Listing rejected by admin')
                  : moderateSelected('reject', rejectReason.trim())}
                disabled={rejectModal.listingId
                  ? actionLoading === rejectModal.listingId
                  : actionLoading !== null || !rejectReason.trim()}
                className="btn-primary flex-1"
              >
                {actionLoading !== null ? 'Processing...' : rejectModal.listingId ? 'Confirm Rejection' : 'Reject Selected'}
              </button>
              <button onClick={() => setRejectModal(null)} className="btn-secondary">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {selectedListing && (
        <div className="fixed inset-0 z-[1000] bg-ink-950/50 flex items-center justify-center p-4" onClick={() => setSelectedListing(null)}>
          <div className="bg-cream rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto animate-slide-down" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-ink-100 sticky top-0 bg-cream z-10">
              <h2 className="font-serif text-lg font-bold">Listing Details</h2>
              <button onClick={() => setSelectedListing(null)} className="p-1 rounded hover:bg-ink-100 text-ink-500">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              {selectedListing.images && selectedListing.images.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {selectedListing.images.slice(0, 6).map((img, i) => (
                    <img key={i} src={img} alt="" className="w-full aspect-square object-cover rounded-lg" />
                  ))}
                </div>
              )}
              <h3 className="font-medium text-ink-900 mb-1">{selectedListing.title}</h3>
              <p className="text-lg font-semibold text-ink-900 mb-3">{formatPrice(Number(selectedListing.price))}</p>
              <p className="text-sm text-ink-600 mb-4">{selectedListing.description}</p>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div><span className="text-ink-400">Era:</span> {selectedListing.era || '—'}</div>
                <div><span className="text-ink-400">Category:</span> {selectedListing.category || '—'}</div>
                <div><span className="text-ink-400">Condition:</span> {selectedListing.condition_grade || '—'}</div>
                <div><span className="text-ink-400">Material:</span> {selectedListing.material || '—'}</div>
                <div><span className="text-ink-400">Type:</span> {selectedListing.listing_type}</div>
                <div><span className="text-ink-400">COA:</span> {selectedListing.coa_verified ? 'Verified' : 'No'}</div>
              </div>
              <div className="pt-3 border-t border-ink-100">
                <ModerationBadge status={selectedListing.moderation_status} />
                {selectedListing.moderation_note && (
                  <p className="text-xs text-ink-500 mt-2">Note: {selectedListing.moderation_note}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModerationBadge({ status }: { status: 'pending_review' | 'approved' | 'rejected' }) {
  if (status === 'approved') {
    return (
      <span className="badge bg-sage-100 text-sage-700 shrink-0">
        <CheckCircle2 className="w-3 h-3" />
        Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="badge bg-terracotta-100 text-terracotta-600 shrink-0">
        <XCircle className="w-3 h-3" />
        Rejected
      </span>
    );
  }
  return (
    <span className="badge bg-ink-100 text-ink-600 shrink-0">
      <Clock className="w-3 h-3" />
      Pending
    </span>
  );
}
