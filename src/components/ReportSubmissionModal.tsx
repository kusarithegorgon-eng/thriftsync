import { useMemo, useState } from 'react';
import { AlertTriangle, FileImage, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase, type ReportCategory } from '@/lib/supabase';

type ReportSubmissionModalProps = {
  open: boolean;
  onClose: () => void;
  listingId?: string | null;
  sellerId: string;
  orderId?: string | null;
  defaultCategory?: ReportCategory;
  title?: string;
  fraudEligible?: boolean;
};

export function ReportSubmissionModal({
  open,
  onClose,
  listingId,
  sellerId,
  orderId,
  defaultCategory = 'illegal_item',
  title = 'Report Listing',
  fraudEligible = false,
}: ReportSubmissionModalProps) {
  const { user } = useAuth();
  const [category, setCategory] = useState<ReportCategory>(defaultCategory);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const isFraudReport = category === 'product_fraud';
  const canSubmitProductFraud = useMemo(
    () => Boolean(user && orderId && sellerId && fraudEligible),
    [fraudEligible, orderId, sellerId, user],
  );

  if (!open) return null;

  function resetForm() {
    setCategory(defaultCategory);
    setDescription('');
    setFiles([]);
    setResult(null);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function buildSignedEvidenceUrls(selectedFiles: File[]) {
    return selectedFiles.map((file, index) => {
      const encodedName = encodeURIComponent(`${Date.now()}-${index}-${file.name}`);
      const query = new URLSearchParams({
        category,
        listing_id: listingId ?? '',
        order_id: orderId ?? '',
        seller_id: sellerId,
        file_name: file.name,
      }).toString();

      return `https://storage.thriftsync.app/signed-url/${encodedName}?${query}`;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!user) {
      setResult({ success: false, message: 'Please sign in before submitting a report.' });
      return;
    }

    if (isFraudReport && !canSubmitProductFraud) {
      setResult({
        success: false,
        message: 'Product fraud reports are restricted to verified buyers with a completed order that was delivered or is still in escrow.',
      });
      return;
    }

    if (files.length === 0) {
      setResult({ success: false, message: 'Upload at least one photo or video clip to support this report.' });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const evidenceUrls = buildSignedEvidenceUrls(files);
      const { data, error } = await supabase.rpc('submit_report', {
        p_reporter_id: user.id,
        p_reported_user_id: sellerId,
        p_listing_id: listingId ?? null,
        p_order_id: orderId ?? null,
        p_category: category,
        p_description: description || null,
        p_evidence_urls: evidenceUrls,
      });

      if (error) throw error;

      const response = data?.[0];
      const successMessage = isFraudReport
        ? 'Fraud report submitted successfully. Escrow has been frozen and an admin is reviewing the case.'
        : 'Report submitted successfully. Our team will review the evidence and respond next.';

      setResult({
        success: true,
        message: response?.message || successMessage,
      });

      setDescription('');
      setFiles([]);
      setCategory(defaultCategory);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit report.';
      setResult({ success: false, message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-ink-950/60 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="bg-cream rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-100 p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-terracotta-100 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-terracotta-700" />
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-ink-900">{title}</h2>
              <p className="text-xs text-ink-500">Escrow-protected marketplace reporting</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} className="p-2 rounded-lg hover:bg-ink-100 text-ink-500">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setCategory('illegal_item')}
              className={category === 'illegal_item' ? 'border border-ink-900 bg-ink-900 text-white' : 'border border-ink-200 bg-white text-ink-700'}
            >
              Illegal / Stolen Item
            </button>
            <button
              type="button"
              onClick={() => setCategory('product_fraud')}
              disabled={!canSubmitProductFraud}
              className={category === 'product_fraud' ? 'border border-terracotta-600 bg-terracotta-50 text-terracotta-700' : 'border border-ink-200 bg-white text-ink-700 disabled:opacity-40'}
            >
              Product Fraud
            </button>
          </div>

          {isFraudReport && !canSubmitProductFraud && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Product fraud reports require an order tied to your buyer account that is still in escrow, shipped, or delivered.
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink-900 mb-1">What happened?</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={
                isFraudReport
                  ? 'Describe the received item problem, missing authenticity, or misleading condition.'
                  : 'Describe the prohibited, counterfeit, or suspicious item details.'
              }
              className="input-field min-h-[110px] resize-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-900 mb-2">Evidence Upload</label>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-200 bg-white p-5 text-center hover:border-ink-400 transition-colors">
              <FileImage className="w-6 h-6 text-ink-400" />
              <span className="text-sm font-medium text-ink-700">Add photos or video evidence</span>
              <span className="text-xs text-ink-500">PNG, JPG, MP4, and other support files</span>
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(event) => setFiles(Array.from(event.target.files || []))}
              />
            </label>
            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {files.map((file) => (
                  <span key={file.name + file.size} className="rounded-full bg-ink-100 px-2.5 py-1 text-[11px] text-ink-700">
                    {file.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {result && (
            <div className={result.success ? 'rounded-lg border border-sage-200 bg-sage-50 p-3 text-sm text-sage-700' : 'rounded-lg border border-terracotta-200 bg-terracotta-50 p-3 text-sm text-terracotta-700'}>
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 w-4 h-4 shrink-0" />
                <span>{result.message}</span>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={handleClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1">
              {submitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
