import { useEffect, useState } from 'react';
import { Tag, Plus, Trash2, Copy, Check, AlertCircle, TrendingUp, Percent, DollarSign, Clock, X } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { supabase, type Voucher, type VoucherRedemption, type Boutique } from '@/lib/supabase';
import { formatPrice, cn } from '@/lib/utils';

export function VouchersPage() {
  const { navigate } = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [redemptions, setRedemptions] = useState<VoucherRedemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!user) {
        setLoading(false);
        return;
      }

      const { data: boutiqueData } = await supabase
        .from('boutiques')
        .select('*')
        .eq('seller_id', user.id)
        .maybeSingle();
      setBoutique(boutiqueData as Boutique);

      const { data: voucherData } = await supabase
        .from('vouchers')
        .select('*')
        .order('created_at', { ascending: false });
      setVouchers((voucherData as Voucher[]) || []);

      const { data: redemptionData } = await supabase
        .from('voucher_redemptions')
        .select('*')
        .order('redeemed_at', { ascending: false })
        .limit(20);
      setRedemptions((redemptionData as VoucherRedemption[]) || []);

      setLoading(false);
    }
    if (!authLoading) load();
  }, [user, authLoading]);

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }

  if (!authLoading && !user) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <Tag className="w-12 h-12 text-ink-300 mx-auto mb-4" />
        <p className="text-ink-500 mb-4">Sign in to manage your promo codes.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="h-8 w-48 skeleton rounded mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
        </div>
        <div className="h-64 skeleton rounded-2xl" />
      </div>
    );
  }

  const activeVouchers = vouchers.filter((v) => v.status === 'ACTIVE');
  const totalRedemptions = redemptions.length;
  const totalDiscountGiven = redemptions.reduce((sum, r) => sum + Number(r.discount_amount), 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">Promo Codes</h1>
          <p className="text-sm text-ink-500">Create and manage discount codes for your boutique</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          disabled={!boutique}
          className="btn-primary flex items-center gap-2 self-start disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus className="w-4 h-4" /> Create Code
        </button>
      </div>

      {!boutique && (
        <div className="card p-4 mb-6 flex items-center gap-3 bg-gold-50 border-gold-200">
          <AlertCircle className="w-5 h-5 text-gold-600 shrink-0" />
          <p className="text-sm text-gold-800">
            You need a boutique to create seller-scoped promo codes. Platform-wide codes are admin-only.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Tag className="w-5 h-5" />} label="Active Codes" value={String(activeVouchers.length)} color="sage" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Total Redemptions" value={String(totalRedemptions)} color="ink" />
        <StatCard icon={<DollarSign className="w-5 h-5" />} label="Discount Given" value={formatPrice(totalDiscountGiven)} color="terracotta" />
        <StatCard icon={<Percent className="w-5 h-5" />} label="All Codes" value={String(vouchers.length)} color="gold" />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-ink-100">
              <h2 className="text-sm font-medium text-ink-900">Your Codes</h2>
            </div>
            <div className="divide-y divide-ink-100">
              {vouchers.length === 0 ? (
                <div className="p-8 text-center">
                  <Tag className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  <p className="text-sm text-ink-500 mb-3">No promo codes yet</p>
                  {boutique && (
                    <button onClick={() => setShowCreate(true)} className="btn-secondary">Create your first code</button>
                  )}
                </div>
              ) : (
                vouchers.map((voucher) => (
                  <div key={voucher.id} className="p-4 hover:bg-ink-50 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm font-bold text-ink-900 tracking-wide">{voucher.code}</code>
                          <button
                            onClick={() => copyCode(voucher.code)}
                            className="p-1 rounded hover:bg-ink-100 transition-colors"
                            aria-label="Copy code"
                          >
                            {copiedCode === voucher.code ? (
                              <Check className="w-3.5 h-3.5 text-sage-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-ink-400" />
                            )}
                          </button>
                          <span className={cn(
                            'badge text-[10px]',
                            voucher.status === 'ACTIVE' ? 'bg-sage-50 text-sage-700' :
                            voucher.status === 'PAUSED' ? 'bg-gold-50 text-gold-700' :
                            'bg-ink-100 text-ink-500'
                          )}>
                            {voucher.status}
                          </span>
                        </div>
                        {voucher.description && (
                          <p className="text-xs text-ink-500 mb-1.5">{voucher.description}</p>
                        )}
                        <div className="flex items-center gap-3 flex-wrap text-xs text-ink-400">
                          <span className="flex items-center gap-1">
                            {voucher.discount_type === 'PERCENTAGE' ? (
                              <><Percent className="w-3 h-3" />{voucher.discount_value}% off</>
                            ) : (
                              <><DollarSign className="w-3 h-3" />{formatPrice(Number(voucher.discount_value))} off</>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            <Tag className="w-3 h-3" />{voucher.scope.toLowerCase()}
                          </span>
                          {voucher.min_spend > 0 && (
                            <span>Min ${voucher.min_spend}</span>
                          )}
                          <span>{voucher.uses} uses</span>
                          {voucher.max_uses && (
                            <span>/ {voucher.max_uses} max</span>
                          )}
                          {voucher.expires_at && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />exp {new Date(voucher.expires_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                      {boutique && voucher.scope === 'BOUTIQUE' && voucher.boutique_id === boutique.id && (
                        <DeleteVoucherButton voucher={voucher} onDeleted={() => {
                          setVouchers((prev) => prev.filter((v) => v.id !== voucher.id));
                        }} />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-ink-100">
              <h2 className="text-sm font-medium text-ink-900">Recent Redemptions</h2>
            </div>
            <div className="divide-y divide-ink-100">
              {redemptions.length === 0 ? (
                <div className="p-6 text-center">
                  <Clock className="w-8 h-8 text-ink-300 mx-auto mb-2" />
                  <p className="text-xs text-ink-500">No redemptions yet</p>
                </div>
              ) : (
                redemptions.map((redemption) => (
                  <div key={redemption.id} className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-semibold text-ink-900">-{formatPrice(Number(redemption.discount_amount))}</p>
                      <span className="text-xs text-ink-400">
                        {new Date(redemption.redeemed_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-ink-500">Cart: {formatPrice(Number(redemption.cart_total_at_redemption))}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card p-4 mt-4">
            <h3 className="text-sm font-medium text-ink-900 mb-3">Available Test Codes</h3>
            <div className="space-y-2">
              {['WELCOME10', 'VINTAGE15', 'SAVE25', 'APPAREL10', 'CARTSAVE'].map((code) => (
                <button
                  key={code}
                  onClick={() => copyCode(code)}
                  className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-ink-50 transition-colors text-sm text-ink-700"
                >
                  <code className="font-medium tracking-wide">{code}</code>
                  {copiedCode === code ? (
                    <Check className="w-4 h-4 text-sage-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-ink-400" />
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-400 mt-3">Use these at checkout to test the discount engine.</p>
          </div>
        </div>
      </div>

      {showCreate && boutique && (
        <CreateVoucherModal
          boutique={boutique}
          userId={user!.id}
          onClose={() => setShowCreate(false)}
          onCreated={(voucher) => {
            setVouchers((prev) => [voucher, ...prev]);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

function DeleteVoucherButton({ voucher, onDeleted }: { voucher: Voucher; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    await supabase.from('vouchers').delete().eq('id', voucher.id);
    onDeleted();
    setDeleting(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="p-2 rounded-lg hover:bg-terracotta-50 transition-colors shrink-0"
      aria-label="Delete voucher"
    >
      <Trash2 className="w-4 h-4 text-terracotta-500" />
    </button>
  );
}

function CreateVoucherModal({
  boutique,
  userId,
  onClose,
  onCreated,
}: {
  boutique: Boutique;
  userId: string;
  onClose: () => void;
  onCreated: (voucher: Voucher) => void;
}) {
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [discountValue, setDiscountValue] = useState('10');
  const [minSpend, setMinSpend] = useState('0');
  const [maxUses, setMaxUses] = useState('100');
  const [maxUsesPerUser, setMaxUsesPerUser] = useState('1');
  const [auctionEligible, setAuctionEligible] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      code: code.toUpperCase().trim(),
      description: description.trim() || null,
      discount_type: discountType,
      discount_value: Number(discountValue),
      scope: 'BOUTIQUE' as const,
      boutique_id: boutique.id,
      auction_eligible: auctionEligible,
      min_spend: Number(minSpend) || 0,
      max_uses: maxUses ? Number(maxUses) : null,
      max_uses_per_user: Number(maxUsesPerUser) || 1,
      is_single_use: Number(maxUsesPerUser) === 1,
      trigger_type: 'MANUAL' as const,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      status: 'ACTIVE' as const,
      created_by: userId,
    };

    const { data, error: insertError } = await supabase
      .from('vouchers')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (insertError) {
      setError(insertError.message.includes('duplicate') ? 'A code with this name already exists' : insertError.message);
      setSaving(false);
      return;
    }

    if (data) onCreated(data as Voucher);
  }

  function generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
    setCode(result);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 backdrop-blur-sm animate-fade-in p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-slide-down">
        <div className="flex items-center justify-between p-5 border-b border-ink-100 sticky top-0 bg-white rounded-t-2xl">
          <h2 className="font-serif text-lg font-bold text-ink-900">Create Promo Code</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-ink-50 transition-colors">
            <X className="w-5 h-5 text-ink-500" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-ink-700 mb-1.5 block">Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. SUMMER20"
                className="input-field flex-1 uppercase tracking-wide"
                required
              />
              <button type="button" onClick={generateCode} className="btn-secondary px-3 text-xs whitespace-nowrap">
                Generate
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-ink-700 mb-1.5 block">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="20% off summer collection"
              className="input-field"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Discount Type</label>
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as 'PERCENTAGE' | 'FIXED_AMOUNT')}
                className="input-field"
              >
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED_AMOUNT">Fixed Amount</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">
                {discountType === 'PERCENTAGE' ? 'Percentage (%)' : 'Amount ($)'}
              </label>
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                min="1"
                max={discountType === 'PERCENTAGE' ? '100' : undefined}
                className="input-field"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Min Spend ($)</label>
              <input
                type="number"
                value={minSpend}
                onChange={(e) => setMinSpend(e.target.value)}
                min="0"
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Max Total Uses</label>
              <input
                type="number"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                min="1"
                className="input-field"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Max Uses Per User</label>
              <input
                type="number"
                value={maxUsesPerUser}
                onChange={(e) => setMaxUsesPerUser(e.target.value)}
                min="1"
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Expires (optional)</label>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={auctionEligible}
              onChange={(e) => setAuctionEligible(e.target.checked)}
              className="w-4 h-4 rounded border-ink-300 text-terracotta-500 focus:ring-terracotta-400"
            />
            <span className="text-sm text-ink-700">Allow on auction items</span>
          </label>

          {error && (
            <p className="text-sm text-terracotta-600 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />{error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving || !code.trim()} className="btn-primary flex-1">
              {saving ? 'Creating...' : 'Create Code'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: 'sage' | 'ink' | 'gold' | 'terracotta' }) {
  const colors = {
    sage: 'bg-sage-50 text-sage-700',
    ink: 'bg-ink-100 text-ink-700',
    gold: 'bg-gold-50 text-gold-700',
    terracotta: 'bg-terracotta-50 text-terracotta-700',
  };
  return (
    <div className="card p-4">
      <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center mb-3', colors[color])}>
        {icon}
      </div>
      <p className="font-serif text-xl font-bold text-ink-900">{value}</p>
      <p className="text-xs text-ink-500">{label}</p>
    </div>
  );
}
