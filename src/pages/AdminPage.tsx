import { useEffect, useState, useCallback } from 'react';
import {
  ShieldCheck, CheckCircle2, XCircle, Clock, Search, Package, CheckSquare,
  ChevronRight, AlertCircle, Store, RefreshCw, FileText, Users,
  LayoutDashboard, History as HistoryIcon,
} from 'lucide-react';
import {
  supabase,
  type ListingWithBoutique,
  type Report,
  type GeneralReport,
  type ModerationAction,
  type ModerationStatus,
  type Profile,
} from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import { formatPrice, formatTimeAgo, cn } from '@/lib/utils';

type GeneralReportWithEvidence = GeneralReport & { evidence_urls: string[] };
type AdminSummary = {
  total_accounts: number;
  seller_accounts: number;
  moderator_accounts: number;
  restricted_accounts: number;
  suspended_accounts: number;
  active_listings: number;
  pending_listings: number;
  temporarily_hidden_listings: number;
  active_auctions: number;
  pending_auction_payments: number;
  open_orders: number;
  disputed_orders: number;
  completed_sales_count: number;
  completed_sales_total: number;
  open_barter_offers: number;
  completed_barter_offers: number;
  open_transaction_reports: number;
  open_content_reports: number;
};
type AdminHistoryEntry = {
  id: string;
  source: 'Admin' | 'Inventory' | 'Order';
  action: string;
  actor_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};
type ManagedProfile = Pick<Profile, 'id' | 'display_name' | 'role' | 'account_status' | 'account_restricted_until'> & {
  account_status_reason: string | null;
};
const ACCOUNT_STATUS_OPTIONS: { value: Profile['account_status']; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'suspended', label: 'Suspended' },
];
const PROFILE_ROLE_OPTIONS: { value: Profile['role']; label: string }[] = [
  { value: 'buyer', label: 'Buyer' },
  { value: 'seller', label: 'Seller' },
  { value: 'moderator', label: 'Content Moderator' },
  { value: 'admin', label: 'System Administrator' },
];

export function AdminPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [listings, setListings] = useState<ListingWithBoutique[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ModerationStatus | 'all'>('pending_review');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ id: string; text: string; success: boolean } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkMessage, setBulkMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [rejectModal, setRejectModal] = useState<{ listingId: string | null; listingTitle: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedListing, setSelectedListing] = useState<ListingWithBoutique | null>(null);
  const [moderationHistory, setModerationHistory] = useState<ModerationAction[]>([]);
  const [moderationHistoryError, setModerationHistoryError] = useState<string | null>(null);
  const [moderationHistoryLoading, setModerationHistoryLoading] = useState(false);
  const [listingActionNotes, setListingActionNotes] = useState<Record<string, string>>({});
  const [listingHideHours, setListingHideHours] = useState<Record<string, number>>({});
  const [reports, setReports] = useState<Report[]>([]);
  const [generalReports, setGeneralReports] = useState<GeneralReportWithEvidence[]>([]);
  const [generalReportsError, setGeneralReportsError] = useState<string | null>(null);
  const [reportEscalationNotes, setReportEscalationNotes] = useState<Record<string, string>>({});
  const [generalReportNotes, setGeneralReportNotes] = useState<Record<string, string>>({});
  const [managedProfiles, setManagedProfiles] = useState<ManagedProfile[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [roleUpdateLoading, setRoleUpdateLoading] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState<{ text: string; success: boolean } | null>(null);
  const [accountStatusReason, setAccountStatusReason] = useState('');
  const [accountRestrictionExpiry, setAccountRestrictionExpiry] = useState('');
  const [activeSection, setActiveSection] = useState<'overview' | 'listings' | 'reports' | 'accounts' | 'history'>('listings');
  const [adminSummary, setAdminSummary] = useState<AdminSummary | null>(null);
  const [adminSummaryLoading, setAdminSummaryLoading] = useState(false);
  const [adminSummaryError, setAdminSummaryError] = useState<string | null>(null);
  const [adminHistory, setAdminHistory] = useState<AdminHistoryEntry[]>([]);
  const [adminHistoryLoading, setAdminHistoryLoading] = useState(false);
  const [adminHistoryError, setAdminHistoryError] = useState<string | null>(null);
  const isSystemAdmin = profile?.role === 'admin';
  const hasModerationAccess = isSystemAdmin || profile?.role === 'moderator';
  const selectedListingId = selectedListing?.id;

  const loadAdminSummary = useCallback(async () => {
    setAdminSummaryLoading(true);
    const { data, error } = await supabase.rpc('get_admin_dashboard_summary');
    if (error) {
      setAdminSummaryError(error.message);
    } else {
      setAdminSummary(data as AdminSummary);
      setAdminSummaryError(null);
    }
    setAdminSummaryLoading(false);
  }, []);

  const loadAdminHistory = useCallback(async () => {
    setAdminHistoryLoading(true);
    const [auditResult, inventoryResult, orderResult] = await Promise.all([
      supabase.from('admin_audit_logs').select('id, actor_id, action, details, created_at')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('inventory_events').select('id, actor_id, event_type, details, created_at')
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('order_events').select('id, actor_id, event_type, details, created_at')
        .order('created_at', { ascending: false }).limit(100),
    ]);
    const error = auditResult.error || inventoryResult.error || orderResult.error;
    if (error) {
      setAdminHistoryError(error.message);
      setAdminHistoryLoading(false);
      return;
    }
    const entries: AdminHistoryEntry[] = [
      ...((auditResult.data || []) as Omit<AdminHistoryEntry, 'source'>[]).map((entry) => ({ ...entry, source: 'Admin' as const })),
      ...((inventoryResult.data || []) as { id: string; actor_id: string | null; event_type: string; details: Record<string, unknown>; created_at: string }[])
        .map((entry) => ({ id: entry.id, actor_id: entry.actor_id, action: entry.event_type, details: entry.details, created_at: entry.created_at, source: 'Inventory' as const })),
      ...((orderResult.data || []) as { id: string; actor_id: string | null; event_type: string; details: Record<string, unknown>; created_at: string }[])
        .map((entry) => ({ id: entry.id, actor_id: entry.actor_id, action: entry.event_type, details: entry.details, created_at: entry.created_at, source: 'Order' as const })),
    ];
    setAdminHistory(entries.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 150));
    setAdminHistoryError(null);
    setAdminHistoryLoading(false);
  }, []);

  const loadProfiles = useCallback(async () => {
    setAccountsLoading(true);
    const [profilesResult, restrictionsResult] = await Promise.all([
      supabase.from('profiles')
        .select('id, display_name, role, account_status, account_restricted_until')
        .order('display_name')
        .limit(250),
      supabase.from('account_restrictions')
        .select('profile_id, reason'),
    ]);
    const error = profilesResult.error || restrictionsResult.error;
    if (error) {
      setAccountMessage({ text: `Could not load accounts: ${error.message}`, success: false });
    } else {
      const restrictionReasons = new Map(
        (restrictionsResult.data || []).map((restriction) => [restriction.profile_id, restriction.reason]),
      );
      setManagedProfiles(((profilesResult.data || []) as Omit<ManagedProfile, 'account_status_reason'>[])
        .map((managedProfile) => ({
          ...managedProfile,
          account_status_reason: restrictionReasons.get(managedProfile.id) || null,
        })));
    }
    setAccountsLoading(false);
  }, []);

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

  const loadReports = useCallback(async () => {
    const { data, error } = await supabase
      .from('reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(25);
    if (error) {
      setActionMessage({ id: 'report-load', text: error.message, success: false });
      return;
    }

    const loadedReports = (data as Report[]) || [];
    const reportsWithEvidence = await Promise.all(loadedReports.map(async (report) => ({
      ...report,
      evidence_urls: await Promise.all(report.evidence_urls.map(async (path) => {
        if (path.includes('://')) return path;
        const { data: signed, error: signedError } = await supabase.storage
          .from('report-evidence')
          .createSignedUrl(path, 60 * 60);
        if (signedError) {
          console.error('Could not sign report evidence:', signedError);
          return '';
        }
        return signed.signedUrl;
      })),
    })));
    setReports(reportsWithEvidence);
    setActionMessage((current) => current?.id === 'report-load' ? null : current);
  }, []);

  useEffect(() => {
    if (!authLoading && (!user || !hasModerationAccess)) {
      navigate({ name: 'home' });
    }
  }, [user, hasModerationAccess, authLoading, navigate]);

  useEffect(() => {
    if (user && hasModerationAccess) {
      loadListings();
      void loadReports();
      void loadGeneralReports();
    }
    if (user && isSystemAdmin) void loadProfiles();
  }, [user, hasModerationAccess, isSystemAdmin, loadListings, loadProfiles, loadReports]);

  useEffect(() => {
    if (!user || !isSystemAdmin) return;
    if (activeSection === 'overview') void loadAdminSummary();
    if (activeSection === 'history') void loadAdminHistory();
  }, [user, isSystemAdmin, activeSection, loadAdminHistory, loadAdminSummary]);

  useEffect(() => {
    if (!selectedListingId) {
      setModerationHistory([]);
      setModerationHistoryError(null);
      return;
    }

    let active = true;
    async function loadModerationHistory() {
      setModerationHistoryLoading(true);
      const { data, error } = await supabase
        .from('moderation_actions')
        .select('*')
        .eq('listing_id', selectedListingId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (!active) return;
      if (error) {
        setModerationHistoryError(error.message);
        setModerationHistoryLoading(false);
        return;
      }
      setModerationHistory((data as ModerationAction[]) || []);
      setModerationHistoryError(null);
      setModerationHistoryLoading(false);
    }
    void loadModerationHistory();
    return () => { active = false; };
  }, [selectedListingId]);

  async function loadGeneralReports() {
    const { data, error } = await supabase
      .from('general_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      setGeneralReportsError(error.message);
      return;
    }
    const rows = (data as GeneralReport[]) || [];
    const withEvidence = await Promise.all(rows.map(async (report) => {
      const signedUrls = await Promise.all(report.evidence_paths.map(async (path) => {
        const { data: signed, error: signedError } = await supabase.storage
          .from('report-evidence')
          .createSignedUrl(path, 60 * 60);
        if (signedError) {
          console.error('Could not sign general report evidence:', signedError);
          return '';
        }
        return signed.signedUrl;
      }));
      return { ...report, evidence_urls: signedUrls };
    }));
    setGeneralReports(withEvidence);
    setGeneralReportsError(null);
  }

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

  async function applyListingAction(
    listing: ListingWithBoutique,
    action: 'warning' | 'correction_request' | 'temporary_hide' | 'restore',
  ) {
    const notes = listingActionNotes[listing.id]?.trim() || '';
    if (action !== 'restore' && !notes) {
      setActionMessage({ id: listing.id, text: 'Add a reason before applying this action.', success: false });
      return;
    }
    const hideUntil = action === 'temporary_hide'
      ? new Date(Date.now() + (listingHideHours[listing.id] || 24) * 60 * 60 * 1000).toISOString()
      : null;

    setActionLoading(`listing-policy-${listing.id}`);
    setActionMessage(null);
    try {
      const { data, error } = await supabase.rpc('apply_listing_moderation_action', {
        p_listing_id: listing.id,
        p_action: action,
        p_notes: notes || null,
        p_hide_until: hideUntil,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not apply the listing action.');

      const nextStatus: ModerationStatus = action === 'temporary_hide'
        ? 'temporarily_hidden'
        : action === 'restore' ? 'approved' : listing.moderation_status;
      const nextNote = action === 'restore' ? notes || null : notes;
      const updateListing = (item: ListingWithBoutique): ListingWithBoutique => item.id === listing.id
        ? {
          ...item,
          moderation_status: nextStatus,
          moderation_note: nextNote,
          moderation_hidden_until: action === 'temporary_hide' ? hideUntil : null,
          moderated_at: new Date().toISOString(),
        }
        : item;
      setListings((current) => current.map(updateListing));
      setSelectedListing((current) => current?.id === listing.id ? updateListing(current) : current);
      setListingActionNotes((current) => ({ ...current, [listing.id]: '' }));
      setActionMessage({ id: listing.id, text: result.message, success: true });
      if (action === 'temporary_hide' || action === 'restore') {
        await loadListings();
      }
    } catch (error) {
      setActionMessage({
        id: listing.id,
        text: error instanceof Error ? error.message : 'Could not apply the listing action.',
        success: false,
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function resolveReport(reportId: string, action: 'dismiss' | 'refund' | 'sanction', notes: string) {
    setActionLoading(`report-${reportId}`);
    try {
      const { data, error } = await supabase.rpc('resolve_report', {
        p_report_id: reportId,
        p_action: action,
        p_admin_notes: notes || null,
      });
      if (error) throw error;
      const result = data?.[0];
      if (result?.success) {
        setReports((prev) => prev.map((report) => report.id === reportId ? {
          ...report,
          status: action === 'refund' ? 'resolved_refunded' : 'resolved_dismissed',
          admin_notes: notes || report.admin_notes,
        } : report));
      }
      setActionMessage({ id: `report-${reportId}`, text: result?.message || 'Report updated.', success: result?.success ?? true });
    } catch (err) {
      setActionMessage({ id: `report-${reportId}`, text: err instanceof Error ? err.message : 'Report action failed.', success: false });
    } finally {
      setActionLoading(null);
    }
  }

  async function escalateReport(reportId: string, notes: string) {
    setActionLoading(`report-${reportId}`);
    try {
      const { data, error } = await supabase.rpc('escalate_report', {
        p_report_id: reportId,
        p_admin_notes: notes,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Report could not be escalated.');
      setReports((current) => current.map((report) => report.id === reportId
        ? { ...report, status: 'under_review', admin_notes: notes }
        : report));
      setReportEscalationNotes((current) => ({ ...current, [reportId]: '' }));
      setActionMessage({ id: `report-${reportId}`, text: result.message, success: true });
    } catch (error) {
      setActionMessage({
        id: `report-${reportId}`,
        text: error instanceof Error ? error.message : 'Report escalation failed.',
        success: false,
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function resolveGeneralReport(
    reportId: string,
    action: 'resolve' | 'dismiss' | 'escalate',
    notes: string,
  ) {
    setActionLoading(`general-report-${reportId}`);
    try {
      const { data, error } = await supabase.rpc('resolve_general_report', {
        p_report_id: reportId,
        p_action: action,
        p_admin_notes: notes,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Report could not be updated.');
      setGeneralReports((current) => current.map((report) => report.id === reportId
        ? {
          ...report,
          status: action === 'resolve' ? 'resolved' : action === 'dismiss' ? 'dismissed' : 'under_review',
          admin_notes: notes,
        }
        : report));
      setGeneralReportNotes((current) => ({ ...current, [reportId]: '' }));
      setActionMessage({ id: `general-report-${reportId}`, text: result.message, success: true });
    } catch (error) {
      setActionMessage({
        id: `general-report-${reportId}`,
        text: error instanceof Error ? error.message : 'Report action failed.',
        success: false,
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function classifyGeneralReport(
    reportId: string,
    priority: GeneralReport['moderation_priority'],
  ) {
    const notes = generalReportNotes[reportId]?.trim() || '';
    setActionLoading(`general-report-${reportId}`);
    try {
      const { data, error } = await supabase.rpc('classify_general_report', {
        p_report_id: reportId,
        p_priority: priority,
        p_notes: notes || null,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Report priority could not be updated.');
      setGeneralReports((current) => current.map((report) => report.id === reportId
        ? { ...report, moderation_priority: priority }
        : report));
      setActionMessage({ id: `general-report-${reportId}`, text: result.message, success: true });
    } catch (error) {
      setActionMessage({
        id: `general-report-${reportId}`,
        text: error instanceof Error ? error.message : 'Report priority could not be updated.',
        success: false,
      });
    } finally {
      setActionLoading(null);
    }
  }

  async function setProfileRole(profileId: string, role: Profile['role']) {
    setRoleUpdateLoading(profileId);
    setAccountMessage(null);
    try {
      const { data, error } = await supabase.rpc('set_profile_role', {
        p_profile_id: profileId,
        p_role: role,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not update account role.');
      setManagedProfiles((current) => current.map((managedProfile) => managedProfile.id === profileId
        ? { ...managedProfile, role }
        : managedProfile));
      setAccountMessage({ text: result.message, success: true });
    } catch (error) {
      setAccountMessage({
        text: error instanceof Error ? error.message : 'Could not update account role.',
        success: false,
      });
    } finally {
      setRoleUpdateLoading(null);
    }
  }

  async function setProfileAccountStatus(profileId: string, status: Profile['account_status']) {
    if (status !== 'active' && !accountStatusReason.trim()) {
      setAccountMessage({ text: 'Enter a reason before restricting or suspending an account.', success: false });
      return;
    }

    let restrictedUntil: string | null = null;
    if (status === 'restricted' && accountRestrictionExpiry) {
      const expiry = new Date(`${accountRestrictionExpiry}T23:59:59`);
      if (Number.isNaN(expiry.getTime())) {
        setAccountMessage({ text: 'Enter a valid restriction end date.', success: false });
        return;
      }
      restrictedUntil = expiry.toISOString();
    }

    setRoleUpdateLoading(profileId);
    setAccountMessage(null);
    try {
      const { data, error } = await supabase.rpc('set_profile_account_status', {
        p_profile_id: profileId,
        p_status: status,
        p_reason: accountStatusReason.trim() || null,
        p_restricted_until: restrictedUntil,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not update account status.');
      setManagedProfiles((current) => current.map((managedProfile) => managedProfile.id === profileId
        ? {
          ...managedProfile,
          account_status: status,
          account_status_reason: status === 'active' ? null : accountStatusReason.trim(),
          account_restricted_until: restrictedUntil,
        }
        : managedProfile));
      setAccountStatusReason('');
      setAccountRestrictionExpiry('');
      setAccountMessage({ text: result.message, success: true });
    } catch (error) {
      setAccountMessage({
        text: error instanceof Error ? error.message : 'Could not update account status.',
        success: false,
      });
    } finally {
      setRoleUpdateLoading(null);
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

  if (!user || !hasModerationAccess) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <ShieldCheck className="w-12 h-12 text-ink-300 mx-auto mb-4" />
        <h1 className="font-serif text-xl font-bold text-ink-900 mb-2">Moderation Access Required</h1>
        <p className="text-sm text-ink-500 mb-4">You need a system administrator or content moderator account to access this page.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }

  const pendingCount = listings.filter((l) => l.moderation_status === 'pending_review').length;
  const pendingListings = listings.filter((listing) => listing.moderation_status === 'pending_review');
  const selectedPendingCount = pendingListings.filter((listing) => selectedIds.includes(listing.id)).length;
  const allPendingSelected = pendingListings.length > 0 && selectedPendingCount === pendingListings.length;
  const search = accountSearch.trim().toLowerCase();
  const visibleProfiles = managedProfiles.filter((managedProfile) =>
    managedProfile.display_name.toLowerCase().includes(search)
    || managedProfile.id.toLowerCase().includes(search)
  );

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
            {isSystemAdmin ? 'System Administration' : 'Content Moderation'}
          </h1>
          <p className="text-sm text-ink-500">
            {isSystemAdmin
              ? 'Manage marketplace operations and escalated cases.'
              : 'Review flagged listings and reports. Escalate account or payment actions to a system administrator.'}
          </p>
        </div>
        <button
          onClick={() => {
            if (activeSection === 'listings') void loadListings();
            else if (activeSection === 'reports') {
              void loadReports();
              void loadGeneralReports();
            } else if (activeSection === 'accounts') void loadProfiles();
            else if (activeSection === 'overview') void loadAdminSummary();
            else void loadAdminHistory();
          }}
          className="btn-secondary text-sm flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh {activeSection === 'listings'
            ? 'listings'
            : activeSection === 'reports'
              ? 'reports'
              : activeSection === 'accounts'
                ? 'accounts'
                : activeSection === 'history' ? 'history' : 'overview'}
        </button>
      </div>

      <nav aria-label="Administration sections" className="mb-6 flex gap-2 overflow-x-auto border-b border-ink-100">
        {isSystemAdmin && (
          <button
            type="button"
            aria-pressed={activeSection === 'overview'}
            onClick={() => setActiveSection('overview')}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
              activeSection === 'overview'
                ? 'border-terracotta-500 text-ink-900'
                : 'border-transparent text-ink-500 hover:text-ink-800',
            )}
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
            Overview
          </button>
        )}
        <button
          type="button"
          aria-pressed={activeSection === 'listings'}
          onClick={() => setActiveSection('listings')}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
            activeSection === 'listings'
              ? 'border-terracotta-500 text-ink-900'
              : 'border-transparent text-ink-500 hover:text-ink-800',
          )}
        >
          <Package className="h-4 w-4" aria-hidden="true" />
          Listings
        </button>
        <button
          type="button"
          aria-pressed={activeSection === 'reports'}
          onClick={() => setActiveSection('reports')}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
            activeSection === 'reports'
              ? 'border-terracotta-500 text-ink-900'
              : 'border-transparent text-ink-500 hover:text-ink-800',
          )}
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Reports & Escalations
        </button>
        {isSystemAdmin && (
          <>
            <button
              type="button"
              aria-pressed={activeSection === 'accounts'}
              onClick={() => setActiveSection('accounts')}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                activeSection === 'accounts'
                  ? 'border-terracotta-500 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              Account Roles
            </button>
            <button
              type="button"
              aria-pressed={activeSection === 'history'}
              onClick={() => setActiveSection('history')}
              className={cn(
                'inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                activeSection === 'history'
                  ? 'border-terracotta-500 text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-800',
              )}
            >
              <HistoryIcon className="h-4 w-4" aria-hidden="true" />
              Audit History
            </button>
          </>
        )}
      </nav>

      {isSystemAdmin && activeSection === 'overview' && (
        <section>
          <div className="mb-4">
            <h2 className="font-serif text-2xl font-bold text-ink-900">Marketplace Overview</h2>
            <p className="mt-1 text-xs text-ink-500">Accounts, commerce, auctions, barter, and moderation at a glance.</p>
          </div>
          {adminSummaryError && (
            <p role="alert" className="mb-4 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">
              Could not load the administration summary: {adminSummaryError}
            </p>
          )}
          {adminSummaryLoading ? (
            <p className="py-12 text-center text-sm text-ink-500">Loading marketplace summary…</p>
          ) : adminSummary ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Total accounts', adminSummary.total_accounts],
                ['Seller accounts', adminSummary.seller_accounts],
                ['Content moderators', adminSummary.moderator_accounts],
                ['Restricted / suspended', adminSummary.restricted_accounts + adminSummary.suspended_accounts],
                ['Active listings', adminSummary.active_listings],
                ['Pending review', adminSummary.pending_listings],
                ['Temporarily hidden', adminSummary.temporarily_hidden_listings],
                ['Active auctions', adminSummary.active_auctions],
                ['Auction payments due', adminSummary.pending_auction_payments],
                ['Open orders', adminSummary.open_orders],
                ['Disputed orders', adminSummary.disputed_orders],
                ['Completed sales', adminSummary.completed_sales_count],
                ['Completed sales GMV', formatPrice(adminSummary.completed_sales_total)],
                ['Open barter offers', adminSummary.open_barter_offers],
                ['Completed barter offers', adminSummary.completed_barter_offers],
                ['Open transaction reports', adminSummary.open_transaction_reports],
                ['Open content reports', adminSummary.open_content_reports],
              ].map(([label, count]) => (
                <div key={label} className="card p-4">
                  <p className="text-xs text-ink-500">{label}</p>
                  <p className="mt-1 font-serif text-2xl font-bold text-ink-900">{count}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-ink-500">No summary data available.</p>
          )}
        </section>
      )}

      {isSystemAdmin && activeSection === 'history' && (
        <section>
          <div className="mb-4">
            <h2 className="font-serif text-2xl font-bold text-ink-900">Audit History</h2>
            <p className="mt-1 text-xs text-ink-500">Administrator decisions, inventory changes, and order/payment events.</p>
          </div>
          {adminHistoryError && (
            <p role="alert" className="mb-4 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">
              Could not load audit history: {adminHistoryError}
            </p>
          )}
          {adminHistoryLoading ? (
            <p className="py-12 text-center text-sm text-ink-500">Loading audit history…</p>
          ) : adminHistory.length === 0 ? (
            <p className="card p-6 text-sm text-ink-500">No history events are available.</p>
          ) : (
            <div className="card divide-y divide-ink-100">
              {adminHistory.map((entry) => (
                <article key={`${entry.source}-${entry.id}`} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-ink-100 text-ink-700">{entry.source}</span>
                      <span className="text-sm font-medium text-ink-900">{entry.action.replace(/_/g, ' ')}</span>
                    </div>
                    {entry.details && (
                      <p className="mt-1 break-words text-[10px] text-ink-500">
                        {JSON.stringify(entry.details)}
                      </p>
                    )}
                    {entry.actor_id && <p className="mt-1 text-[10px] text-ink-400">Actor {entry.actor_id}</p>}
                  </div>
                  <time className="shrink-0 text-[10px] text-ink-400">{new Date(entry.created_at).toLocaleString()}</time>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Stats */}
      {activeSection === 'listings' && <div className="mb-6 grid grid-cols-3 gap-4">
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
      </div>}

      {isSystemAdmin && activeSection === 'accounts' && (
        <section className="card mb-6 p-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-900">Account Roles</h2>
            <p className="mt-1 text-xs text-ink-500">
              Content moderators can review listings and content reports. Refunds, sanctions, and role changes stay with system administrators.
            </p>
          </div>
          {accountMessage && (
            <p role={accountMessage.success ? 'status' : 'alert'} className={cn(
              'mt-3 rounded-lg p-2 text-xs',
              accountMessage.success ? 'bg-sage-50 text-sage-700' : 'bg-terracotta-50 text-terracotta-700',
            )}>
              {accountMessage.text}
            </p>
          )}
          <label className="mt-4 block">
            <span className="sr-only">Search accounts by name or account ID</span>
            <input
              value={accountSearch}
              onChange={(event) => setAccountSearch(event.target.value)}
              placeholder="Search accounts by name or account ID"
              className="input-field text-sm"
            />
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-ink-700">Restriction reason</span>
              <input
                value={accountStatusReason}
                onChange={(event) => setAccountStatusReason(event.target.value)}
                maxLength={2000}
                placeholder="Required for restricted or suspended accounts"
                className="input-field text-sm"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-ink-700">Restriction end date (optional)</span>
              <input
                type="date"
                value={accountRestrictionExpiry}
                onChange={(event) => setAccountRestrictionExpiry(event.target.value)}
                className="input-field text-sm"
              />
            </label>
          </div>
          {accountsLoading ? (
            <p className="py-5 text-center text-sm text-ink-500">Loading accounts…</p>
          ) : visibleProfiles.length === 0 ? (
            <p className="py-5 text-center text-sm text-ink-500">No accounts match your search.</p>
          ) : (
            <div className="mt-3 max-h-80 divide-y divide-ink-100 overflow-y-auto">
              {visibleProfiles.map((managedProfile) => (
                <div key={managedProfile.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {managedProfile.display_name || 'Unnamed account'}
                      {managedProfile.id === user.id && <span className="ml-2 text-xs text-ink-400">You</span>}
                    </p>
                    <p className="truncate text-[10px] text-ink-400">{managedProfile.id}</p>
                    {managedProfile.account_status !== 'active' && (
                      <p className="mt-1 max-w-lg text-[10px] text-terracotta-700">
                        {managedProfile.account_status_reason || 'No reason recorded'}
                        {managedProfile.account_restricted_until
                          && ` · Until ${new Date(managedProfile.account_restricted_until).toLocaleDateString()}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select
                      aria-label={`Role for ${managedProfile.display_name || managedProfile.id}`}
                      value={managedProfile.role}
                      disabled={managedProfile.id === user.id || roleUpdateLoading === managedProfile.id}
                      onChange={(event) => {
                        const nextRole = PROFILE_ROLE_OPTIONS
                          .find((option) => option.value === event.target.value)?.value;
                        if (nextRole) void setProfileRole(managedProfile.id, nextRole);
                      }}
                      className="input-field w-full text-sm sm:w-48"
                    >
                      {PROFILE_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <select
                      aria-label={`Account status for ${managedProfile.display_name || managedProfile.id}`}
                      value={managedProfile.account_status}
                      disabled={managedProfile.id === user.id || roleUpdateLoading === managedProfile.id}
                      onChange={(event) => {
                        const status = ACCOUNT_STATUS_OPTIONS
                          .find((option) => option.value === event.target.value)?.value;
                        if (status) void setProfileAccountStatus(managedProfile.id, status);
                      }}
                      className="input-field w-full text-sm sm:w-40"
                    >
                      {ACCOUNT_STATUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] text-ink-400">
            Showing up to 250 accounts. You cannot change your own role.
          </p>
        </section>
      )}

      {activeSection === 'listings' && (
        <>
      {/* Filter tabs + search */}
      <div className="mb-4 flex flex-col sm:flex-row gap-3">
        <div className="flex gap-1 p-1 bg-ink-50 rounded-lg">
          {([
            { key: 'pending_review' as const, label: 'Pending' },
            { key: 'approved' as const, label: 'Approved' },
            { key: 'rejected' as const, label: 'Rejected' },
            { key: 'temporarily_hidden' as const, label: 'Temporarily Hidden' },
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
                  {listing.moderation_status === 'temporarily_hidden' && (
                    <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                      <p>{listing.moderation_note || 'Temporarily hidden by a moderator.'}</p>
                      {listing.moderation_hidden_until && (
                        <p className="mt-1 text-[10px]">
                          Automatic restore: {new Date(listing.moderation_hidden_until).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col items-start gap-2">
                    <div className="flex flex-wrap items-center gap-2">
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
                    {listing.moderation_status === 'approved' && (
                      <div className="w-full space-y-2 rounded-lg border border-ink-100 bg-ink-50 p-2">
                        <textarea
                          value={listingActionNotes[listing.id] || ''}
                          onChange={(event) => setListingActionNotes((current) => ({
                            ...current,
                            [listing.id]: event.target.value,
                          }))}
                          maxLength={2000}
                          placeholder="Document a warning, correction request, or hide reason."
                          aria-label={`Moderation notes for ${listing.title}`}
                          className="input-field min-h-14 resize-y text-xs"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void applyListingAction(listing, 'warning')}
                            disabled={actionLoading === `listing-policy-${listing.id}`}
                            className="btn-secondary text-xs px-3 py-2"
                          >
                            Issue Warning
                          </button>
                          <button
                            type="button"
                            onClick={() => void applyListingAction(listing, 'correction_request')}
                            disabled={actionLoading === `listing-policy-${listing.id}`}
                            className="btn-secondary text-xs px-3 py-2"
                          >
                            Request Correction
                          </button>
                          <select
                            aria-label={`Temporary hide duration for ${listing.title}`}
                            value={listingHideHours[listing.id] || 24}
                            onChange={(event) => setListingHideHours((current) => ({
                              ...current,
                              [listing.id]: Number(event.target.value),
                            }))}
                            className="input-field w-32 text-xs"
                          >
                            <option value={6}>6 hours</option>
                            <option value={24}>24 hours</option>
                            <option value={72}>3 days</option>
                            <option value={168}>7 days</option>
                            <option value={720}>30 days</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void applyListingAction(listing, 'temporary_hide')}
                            disabled={actionLoading === `listing-policy-${listing.id}`}
                            className="btn-primary text-xs px-3 py-2"
                          >
                            Temporarily Hide
                          </button>
                        </div>
                      </div>
                    )}
                    {listing.moderation_status === 'temporarily_hidden' && (
                      <button
                        type="button"
                        onClick={() => void applyListingAction(listing, 'restore')}
                        disabled={actionLoading === `listing-policy-${listing.id}`}
                        className="btn-primary text-xs px-3 py-2"
                      >
                        Restore Listing
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
        </>
      )}

      {activeSection === 'reports' && <section className="mt-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-2xl font-bold text-ink-900">Reports & Escalations</h2>
          <span className="text-xs text-ink-500">{reports.length + generalReports.length} total</span>
        </div>
        {actionMessage?.id === 'report-load' && (
          <p role="alert" className="mb-3 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">
            Could not load reports: {actionMessage.text}
          </p>
        )}
        {generalReportsError && (
          <p role="alert" className="mb-3 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">
            Could not load general reports: {generalReportsError}
          </p>
        )}
        {reports.length === 0 && generalReports.length === 0 ? (
          <div className="card p-6 text-sm text-ink-500">No informal reports have been submitted yet.</div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <div key={report.id} className="card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="badge bg-ink-100 text-ink-700">{report.category === 'product_fraud' ? 'Product Fraud' : 'Illegal Item'}</span>
                      <span className={cn(
                        'badge',
                        report.status === 'pending' || report.status === 'under_review'
                          ? 'bg-amber-100 text-amber-700'
                          : report.status === 'resolved_refunded'
                            ? 'bg-terracotta-100 text-terracotta-700'
                            : 'bg-sage-100 text-sage-700',
                      )}>
                        {report.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-sm text-ink-600 leading-relaxed">{report.description || 'No description provided'}</p>
                    <p className="mt-2 text-[11px] text-ink-400">
                      Listing: {report.listing_id || '—'} · Order: {report.order_id || '—'} · Evidence: {report.evidence_urls.length}
                    </p>
                  </div>
                  {isSystemAdmin ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => resolveReport(report.id, 'dismiss', 'Dismissed by admin; escrow released to seller.')}
                        disabled={actionLoading === `report-${report.id}`}
                        className="btn-secondary text-xs px-3 py-2"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveReport(report.id, 'refund', 'Issued buyer refund from escrow.')}
                        disabled={actionLoading === `report-${report.id}`}
                        className="btn-primary text-xs px-3 py-2"
                      >
                        Refund Buyer
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveReport(report.id, 'sanction', 'Seller sanctioned for policy violation.')}
                        disabled={actionLoading === `report-${report.id}`}
                        className="btn-secondary text-xs px-3 py-2"
                      >
                        Sanction Seller
                      </button>
                    </div>
                  ) : report.status === 'pending' ? (
                    <div className="w-full space-y-2 sm:max-w-sm">
                      <textarea
                        value={reportEscalationNotes[report.id] || ''}
                        onChange={(event) => setReportEscalationNotes((current) => ({
                          ...current,
                          [report.id]: event.target.value,
                        }))}
                        placeholder="Document your review and why this needs administrator action."
                        aria-label="Escalation notes"
                        className="input-field min-h-16 resize-y text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => void escalateReport(report.id, reportEscalationNotes[report.id]?.trim() || '')}
                        disabled={actionLoading === `report-${report.id}` || !reportEscalationNotes[report.id]?.trim()}
                        className="btn-secondary text-xs px-3 py-2"
                      >
                        Escalate to System Administrator
                      </button>
                    </div>
                  ) : report.status === 'under_review' ? (
                    <p className="text-xs text-ink-500">Escalated; awaiting system administrator review.</p>
                  ) : (
                    <p className="text-xs text-ink-500">This report has been closed.</p>
                  )}
                </div>
                {actionMessage?.id === `report-${report.id}` && (
                  <p role="status" className={cn(
                    'mt-2 text-xs',
                    actionMessage.success ? 'text-sage-700' : 'text-terracotta-700',
                  )}>
                    {actionMessage.text}
                  </p>
                )}
                {report.admin_notes && (
                  <p className="mt-2 text-xs text-ink-500">Review notes: {report.admin_notes}</p>
                )}
                {report.evidence_urls.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {report.evidence_urls.filter(Boolean).slice(0, 3).map((url, index) => (
                      <a key={`${report.id}-${index}`} href={url} target="_blank" rel="noreferrer" className="text-xs text-terracotta-600 underline break-all">
                        Evidence {index + 1}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {generalReports.map((report) => (
              <div key={`general-${report.id}`} className="card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="badge bg-ink-100 text-ink-700">
                        {{
                          counterfeit_item: 'Counterfeit / Fake Designer',
                          stolen_goods: 'Stolen / Prohibited Goods',
                          misleading_location: 'False Location Tag',
                          abusive_content: 'Abusive Content',
                        }[report.violation_category]}
                      </span>
                      <span className={cn(
                        'badge',
                        report.status === 'pending' || report.status === 'under_review'
                          ? 'bg-amber-100 text-amber-700'
                          : report.status === 'resolved'
                            ? 'bg-sage-100 text-sage-700'
                            : 'bg-ink-100 text-ink-600',
                      )}>{report.status.replace('_', ' ')}</span>
                    </div>
                    <p className="mb-2 text-[10px] text-ink-500">
                      Case priority: <span className="font-semibold uppercase">{report.moderation_priority}</span>
                    </p>
                    <p className="text-sm leading-relaxed text-ink-600">{report.description}</p>
                    <p className="mt-2 text-[11px] text-ink-400">
                      Listing: {report.listing_id || 'Seller profile'} · Evidence: {report.evidence_paths.length}
                    </p>
                  </div>
                  {(isSystemAdmin || report.status === 'pending') && (
                    <label className="flex shrink-0 items-center gap-2 text-xs text-ink-600">
                      Classify
                      <select
                        aria-label={`Priority for report ${report.id}`}
                        value={report.moderation_priority}
                        disabled={actionLoading === `general-report-${report.id}`}
                        onChange={(event) => {
                          const priority = event.target.value as GeneralReport['moderation_priority'];
                          void classifyGeneralReport(report.id, priority);
                        }}
                        className="input-field w-32 text-xs"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </label>
                  )}
                  {isSystemAdmin && ['pending', 'under_review'].includes(report.status) && (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => void resolveGeneralReport(report.id, 'dismiss', 'Dismissed after system administrator review.')}
                        disabled={actionLoading === `general-report-${report.id}`}
                        className="btn-secondary text-xs"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => void resolveGeneralReport(report.id, 'resolve', 'Resolved after system administrator review.')}
                        disabled={actionLoading === `general-report-${report.id}`}
                        className="btn-primary text-xs"
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                  {!isSystemAdmin && report.status === 'pending' && (
                    <div className="w-full space-y-2 sm:max-w-sm">
                      <textarea
                        value={generalReportNotes[report.id] || ''}
                        onChange={(event) => setGeneralReportNotes((current) => ({
                          ...current,
                          [report.id]: event.target.value,
                        }))}
                        placeholder="Document your review or explain why this needs escalation."
                        aria-label="Content moderation decision notes"
                        className="input-field min-h-16 resize-y text-xs"
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void resolveGeneralReport(report.id, 'dismiss', generalReportNotes[report.id]?.trim() || '')}
                          disabled={actionLoading === `general-report-${report.id}` || !generalReportNotes[report.id]?.trim()}
                          className="btn-secondary text-xs"
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveGeneralReport(report.id, 'resolve', generalReportNotes[report.id]?.trim() || '')}
                          disabled={actionLoading === `general-report-${report.id}` || !generalReportNotes[report.id]?.trim()}
                          className="btn-primary text-xs"
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => void resolveGeneralReport(report.id, 'escalate', generalReportNotes[report.id]?.trim() || '')}
                          disabled={actionLoading === `general-report-${report.id}` || !generalReportNotes[report.id]?.trim()}
                          className="btn-secondary text-xs"
                        >
                          Escalate
                        </button>
                      </div>
                    </div>
                  )}
                  {!isSystemAdmin && report.status === 'under_review' && (
                    <p className="text-xs text-ink-500">Escalated; awaiting system administrator review.</p>
                  )}
                </div>
                {report.admin_notes && <p className="mt-2 text-xs text-ink-500">Review notes: {report.admin_notes}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.evidence_urls.filter(Boolean).map((url, index) => (
                    <a key={`${report.id}-${index}`} href={url} target="_blank" rel="noreferrer" className="text-xs text-terracotta-600 underline">
                      Evidence {index + 1}
                    </a>
                  ))}
                </div>
                {actionMessage?.id === `general-report-${report.id}` && (
                  <p role="status" className={cn('mt-2 text-xs', actionMessage.success ? 'text-sage-700' : 'text-terracotta-700')}>
                    {actionMessage.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>}

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
                  ? reject(
                    rejectModal.listingId,
                    rejectReason.trim() || `Listing rejected by ${isSystemAdmin ? 'system administrator' : 'content moderator'}.`,
                  )
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
              <div className="mt-4 border-t border-ink-100 pt-3">
                <h4 className="text-sm font-semibold text-ink-900">Moderator action history</h4>
                {moderationHistoryLoading ? (
                  <p className="mt-2 text-xs text-ink-500">Loading action history…</p>
                ) : moderationHistoryError ? (
                  <p role="alert" className="mt-2 text-xs text-terracotta-700">
                    Could not load action history: {moderationHistoryError}
                  </p>
                ) : moderationHistory.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-500">No recorded moderation actions.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-ink-100">
                    {moderationHistory.map((entry) => (
                      <li key={entry.id} className="py-2 text-xs">
                        <p className="font-medium text-ink-800">{entry.action.replace(/_/g, ' ')}</p>
                        <p className="text-[10px] text-ink-400">
                          {new Date(entry.created_at).toLocaleString()}
                          {entry.actor_id && ` · Moderator ${entry.actor_id.slice(0, 8)}`}
                          {entry.hide_until && ` · Until ${new Date(entry.hide_until).toLocaleString()}`}
                        </p>
                        {entry.notes && <p className="mt-1 text-ink-600">{entry.notes}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModerationBadge({ status }: { status: ModerationStatus }) {
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
  if (status === 'temporarily_hidden') {
    return (
      <span className="badge bg-amber-100 text-amber-800 shrink-0">
        <Clock className="w-3 h-3" />
        Temporarily Hidden
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
