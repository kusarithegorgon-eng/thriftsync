import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, CheckCircle2, Clock, KeyRound, MapPin, Package, Truck } from 'lucide-react';
import { DeliveryChat } from '@/components/DeliveryChat';
import { DeliveryProofImage } from '@/components/DeliveryProofImage';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import { supabase, type DeliveryJob, type DeliveryJobEvent } from '@/lib/supabase';
import { formatPrice, formatTimeAgo, cn, resizeImage } from '@/lib/utils';

type CourierOrder = {
  id: string;
  amount: number;
  payment_method: string;
  shipping_address: string | null;
  status: string;
  listings: { title: string }[] | null;
  boutiques: { name: string }[] | null;
};
type CourierJob = Pick<DeliveryJob, 'id' | 'order_id' | 'status' | 'tracking_code' | 'created_at' | 'delivery_proof_path'> & {
  order: CourierOrder;
  events: Pick<DeliveryJobEvent, 'id' | 'event_type' | 'note' | 'created_at'>[];
};
type ActionResult = { success: boolean; message: string };
type RpcResponse = { data: unknown; error: { message: string } | null };

const EVENT_LABELS: Record<DeliveryJobEvent['event_type'], string> = {
  assigned: 'Courier assigned',
  reassigned: 'Courier assignment changed',
  accepted: 'Delivery accepted',
  picked_up: 'Parcel picked up',
  in_transit: 'Delivery started',
  pickup_code_failed: 'Pickup code check failed',
  delivery_code_failed: 'Delivery code check failed',
  delivered: 'Delivery confirmed',
};

const STATUS_LABELS: Record<DeliveryJob['status'], string> = {
  assigned: 'Awaiting your acceptance',
  accepted: 'Accepted — collect the parcel',
  picked_up: 'Parcel picked up',
  in_transit: 'On the way to the buyer',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export function CourierDeliveriesPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const [jobs, setJobs] = useState<CourierJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [deliveryCodes, setDeliveryCodes] = useState<Record<string, string>>({});
  const [deliveryProofs, setDeliveryProofs] = useState<Record<string, File | undefined>>({});
  const [cashCollected, setCashCollected] = useState<Record<string, boolean>>({});
  const [cameraJobId, setCameraJobId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState('');
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    if (!cameraJobId) {
      stopCamera();
      return;
    }

    let cancelled = false;
    setCameraError('');

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('A live camera is not available in this browser. Use HTTPS or open Thriftsync in a supported browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          await cameraVideoRef.current.play();
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'Camera permission is required. Allow camera access, then try again.'
          : 'Could not start the rear camera. Check that it is not being used by another app.';
        setCameraError(message);
      }
    }

    void startCamera();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [cameraJobId, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const loadJobs = useCallback(async () => {
    if (!user || profile?.role !== 'courier') {
      setJobs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const { data: jobData, error: jobError } = await supabase
      .from('delivery_jobs')
      .select('id, order_id, status, tracking_code, created_at, delivery_proof_path')
      .eq('courier_id', user.id)
      .order('created_at', { ascending: false });
    if (jobError) {
      setLoadError(`Could not load assigned deliveries: ${jobError.message}`);
      setLoading(false);
      return;
    }

    const assignedJobs = (jobData || []) as Pick<DeliveryJob, 'id' | 'order_id' | 'status' | 'tracking_code' | 'created_at' | 'delivery_proof_path'>[];
    if (assignedJobs.length === 0) {
      setJobs([]);
      setLoading(false);
      return;
    }

    const orderIds = assignedJobs.map((job) => job.order_id);
    const jobIds = assignedJobs.map((job) => job.id);
    const [{ data: orderData, error: orderError }, { data: eventData, error: eventError }] = await Promise.all([
      supabase
        .from('orders')
        .select('id, amount, payment_method, shipping_address, status, listings(title), boutiques(name)')
        .in('id', orderIds),
      supabase
        .from('delivery_job_events')
        .select('id, delivery_job_id, event_type, note, created_at')
        .in('delivery_job_id', jobIds)
        .order('created_at', { ascending: true }),
    ]);

    if (orderError || eventError) {
      setLoadError(`Could not load delivery details: ${(orderError || eventError)?.message}`);
      setLoading(false);
      return;
    }

    const orderMap = new Map((orderData as CourierOrder[] || []).map((order) => [order.id, order]));
    const eventsByJob = new Map<string, CourierJob['events']>();
    (eventData || []).forEach((event) => {
      const current = eventsByJob.get(event.delivery_job_id) || [];
      current.push(event as CourierJob['events'][number]);
      eventsByJob.set(event.delivery_job_id, current);
    });

    setJobs(assignedJobs.flatMap((job) => {
      const order = orderMap.get(job.order_id);
      return order ? [{ ...job, order, events: eventsByJob.get(job.id) || [] }] : [];
    }));
    setLoading(false);
  }, [user, profile?.role]);

  useEffect(() => {
    if (!authLoading) void loadJobs();
  }, [authLoading, loadJobs]);

  async function runAction(jobId: string, operation: () => PromiseLike<RpcResponse>) {
    setActionLoadingId(jobId);
    setActionErrors((current) => ({ ...current, [jobId]: '' }));
    try {
      const { data, error } = await operation();
      if (error) throw new Error(error.message);
      const result = (data as ActionResult[] | null)?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not update this delivery.');
      await loadJobs();
      setPickupCodes((current) => ({ ...current, [jobId]: '' }));
      setDeliveryCodes((current) => ({ ...current, [jobId]: '' }));
    } catch (error) {
      setActionErrors((current) => ({
        ...current,
        [jobId]: error instanceof Error ? error.message : 'Could not update this delivery.',
      }));
    } finally {
      setActionLoadingId(null);
    }
  }

  function closeCamera() {
    stopCamera();
    setCameraJobId(null);
  }

  async function captureDeliveryProof(jobId: string) {
    const video = cameraVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      setCameraError('The camera is still starting. Wait a moment, then capture.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Could not capture the photo in this browser.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) {
      setCameraError('Could not capture the photo. Try again.');
      return;
    }

    const photo = new File([blob], `delivery-proof-${Date.now()}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
    setDeliveryProofs((current) => ({ ...current, [jobId]: photo }));
    setActionErrors((current) => ({ ...current, [jobId]: '' }));
    closeCamera();
  }

  async function confirmDelivery(event: FormEvent<HTMLFormElement>, job: CourierJob) {
    event.preventDefault();
    const proofFile = deliveryProofs[job.id];
    if (!user || !proofFile) {
      setActionErrors((current) => ({ ...current, [job.id]: 'Take a delivery proof photo before confirming.' }));
      return;
    }

    setActionLoadingId(job.id);
    setActionErrors((current) => ({ ...current, [job.id]: '' }));
    let uploadedPath: string | null = null;
    const proofPath = `${job.id}/${user.id}/${crypto.randomUUID()}.jpg`;

    try {
      const proofImage = await resizeImage(proofFile, 1200, 1600, 0.82);
      if (proofImage.size > 8 * 1024 * 1024) {
        throw new Error('The photo is too large after compression. Take another photo and try again.');
      }

      const { error: uploadError } = await supabase.storage
        .from('delivery-proof')
        .upload(proofPath, proofImage, { contentType: 'image/jpeg', upsert: false });
      if (uploadError) throw new Error(`Could not upload the delivery photo: ${uploadError.message}`);
      uploadedPath = proofPath;

      const { data, error } = await supabase.rpc('courier_confirm_delivery_with_proof', {
        p_delivery_job_id: job.id,
        p_delivery_code: deliveryCodes[job.id] || '',
        p_cash_collected: job.order.payment_method === 'cash_on_delivery' && !!cashCollected[job.id],
        p_proof_path: proofPath,
      });
      if (error) throw new Error(error.message);
      const result = (data as ActionResult[] | null)?.[0];
      if (!result?.success) throw new Error(result?.message || 'Could not confirm this delivery.');

      uploadedPath = null;
      await loadJobs();
      setDeliveryCodes((current) => ({ ...current, [job.id]: '' }));
      setDeliveryProofs((current) => ({ ...current, [job.id]: undefined }));
    } catch (error) {
      let message = error instanceof Error ? error.message : 'Could not confirm this delivery.';
      if (uploadedPath) {
        try {
          const { error: cleanupError } = await supabase.storage.from('delivery-proof').remove([uploadedPath]);
          if (cleanupError) {
            message = `${message} The uploaded photo could not be removed: ${cleanupError.message}`;
          }
        } catch (cleanupError) {
          message = `${message} The uploaded photo could not be removed: ${
            cleanupError instanceof Error ? cleanupError.message : 'Unexpected storage error.'
          }`;
        }
      }
      setActionErrors((current) => ({ ...current, [job.id]: message }));
    } finally {
      setActionLoadingId(null);
    }
  }

  if (authLoading) {
    return <div className="mx-auto max-w-4xl px-4 py-16 text-center text-ink-500">Loading…</div>;
  }
  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <Truck className="mx-auto mb-4 h-12 w-12 text-ink-300" />
        <h1 className="mb-2 font-serif text-xl font-bold text-ink-900">Courier sign-in required</h1>
        <p className="mb-4 text-sm text-ink-500">Sign in with the driver account linked by your seller.</p>
        <button type="button" onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }
  if (profile?.role !== 'courier') {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <Truck className="mx-auto mb-4 h-12 w-12 text-ink-300" />
        <h1 className="mb-2 font-serif text-xl font-bold text-ink-900">Courier access required</h1>
        <p className="text-sm text-ink-500">Only courier accounts invited or linked by a seller can open assigned deliveries.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-terracotta-600">Courier workspace</p>
          <h1 className="font-serif text-3xl font-bold text-ink-900">My Deliveries</h1>
          <p className="mt-1 text-sm text-ink-500">Accept your seller’s job, verify the pickup code, then confirm handoff with the buyer’s code.</p>
        </div>
        <button type="button" onClick={() => void loadJobs()} disabled={loading} className="btn-secondary text-sm">
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {loadError && <p role="alert" className="mb-4 rounded-lg bg-terracotta-50 p-3 text-sm text-terracotta-700">{loadError}</p>}
      {loading && jobs.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-500">Loading assigned deliveries…</p>
      ) : jobs.length === 0 ? (
        <div className="card py-12 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-ink-300" />
          <p className="font-medium text-ink-800">No deliveries assigned</p>
          <p className="mt-1 text-sm text-ink-500">New assignments from your seller will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <article key={job.id} className="card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-ink-400">{formatTimeAgo(job.created_at)}</p>
                  <h2 className="mt-1 font-serif text-xl font-bold text-ink-900">{job.order.listings?.[0]?.title || 'Marketplace item'}</h2>
                  <p className="mt-1 text-sm text-ink-600">
                    {job.order.boutiques?.[0]?.name || 'Seller'} · {formatPrice(Number(job.order.amount))}
                  </p>
                </div>
                <span className={cn(
                  'badge',
                  job.status === 'delivered' ? 'bg-sage-100 text-sage-700' : 'bg-gold-50 text-gold-700',
                )}>
                  {STATUS_LABELS[job.status]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-y border-ink-100 py-3 text-xs text-ink-600">
                <span className="font-mono">Tracking: {job.tracking_code}</span>
                <span>Order total: {formatPrice(Number(job.order.amount))}</span>
                {job.order.payment_method === 'cash_on_delivery' && <span className="font-semibold text-blue-700">Cash on delivery</span>}
              </div>
              {job.order.shipping_address && (
                <p className="mt-3 flex items-start gap-2 text-sm text-ink-700">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  <span>{job.order.shipping_address}</span>
                </p>
              )}
              {job.order.payment_method === 'cash_on_delivery' && (
                <p className="mt-2 text-xs text-ink-500">
                  If the buyer pays cash, confirm collection at handoff. This records collection for the order; it does not transfer or remit funds.
                </p>
              )}

              {job.status === 'assigned' && (
                <button
                  type="button"
                  onClick={() => void runAction(job.id, () => supabase.rpc('courier_accept_delivery', { p_delivery_job_id: job.id }))}
                  disabled={actionLoadingId === job.id}
                  className="btn-primary mt-4 inline-flex items-center gap-2 text-sm"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {actionLoadingId === job.id ? 'Saving…' : 'Accept delivery'}
                </button>
              )}

              {job.status === 'accepted' && (
                <form
                  className="mt-4 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void runAction(job.id, () => supabase.rpc('courier_confirm_delivery_pickup', {
                      p_delivery_job_id: job.id,
                      p_pickup_code: pickupCodes[job.id] || '',
                    }));
                  }}
                >
                  <input
                    value={pickupCodes[job.id] || ''}
                    onChange={(event) => setPickupCodes((current) => ({
                      ...current,
                      [job.id]: event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12),
                    }))}
                    placeholder="12-character seller pickup code"
                    aria-label="Seller pickup code"
                    pattern="[A-F0-9]{12}"
                    maxLength={12}
                    required
                    className="input-field min-w-0 flex-1 font-mono text-sm uppercase"
                  />
                  <button type="submit" disabled={actionLoadingId === job.id} className="btn-primary inline-flex items-center justify-center gap-2 text-sm">
                    <KeyRound className="h-4 w-4" />
                    {actionLoadingId === job.id ? 'Verifying…' : 'Confirm parcel pickup'}
                  </button>
                </form>
              )}

              {job.status === 'picked_up' && (
                <button
                  type="button"
                  onClick={() => void runAction(job.id, () => supabase.rpc('courier_start_delivery', { p_delivery_job_id: job.id }))}
                  disabled={actionLoadingId === job.id}
                  className="btn-primary mt-4 inline-flex items-center gap-2 text-sm"
                >
                  <Truck className="h-4 w-4" />
                  {actionLoadingId === job.id ? 'Saving…' : 'Start delivery'}
                </button>
              )}

              {job.status === 'in_transit' && (
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(event) => void confirmDelivery(event, job)}
                >
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraError('');
                        setCameraJobId(job.id);
                      }}
                      className="btn-secondary inline-flex items-center gap-2 text-sm"
                    >
                      <Camera className="h-4 w-4" />
                      {deliveryProofs[job.id] ? 'Retake delivery photo' : 'Take delivery proof photo'}
                    </button>
                    <p className="mt-1 text-xs text-ink-500">
                      A fresh photo is required and must be taken with this device camera. Gallery photos are not accepted.
                    </p>
                    {deliveryProofs[job.id] && (
                      <p className="mt-1 text-xs text-sage-700">Camera photo ready</p>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={deliveryCodes[job.id] || ''}
                      onChange={(event) => setDeliveryCodes((current) => ({
                        ...current,
                        [job.id]: event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12),
                      }))}
                      placeholder="12-character buyer delivery code"
                      aria-label="Buyer delivery code"
                      pattern="[A-F0-9]{12}"
                      maxLength={12}
                      required
                      className="input-field min-w-0 flex-1 font-mono text-sm uppercase"
                    />
                    <button
                      type="submit"
                      disabled={actionLoadingId === job.id || !deliveryProofs[job.id]}
                      className="btn-primary inline-flex items-center justify-center gap-2 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {actionLoadingId === job.id ? 'Uploading and confirming…' : 'Confirm delivery'}
                    </button>
                  </div>
                  {job.order.payment_method === 'cash_on_delivery' && (
                    <label className="flex items-start gap-2 text-xs text-ink-600">
                      <input
                        type="checkbox"
                        checked={!!cashCollected[job.id]}
                        onChange={(event) => setCashCollected((current) => ({ ...current, [job.id]: event.target.checked }))}
                        required
                        className="mt-0.5"
                      />
                      I collected {formatPrice(Number(job.order.amount))} from the buyer.
                    </label>
                  )}
                </form>
              )}

              {job.delivery_proof_path && <DeliveryProofImage path={job.delivery_proof_path} />}

              <DeliveryChat
                deliveryJobId={job.id}
                participant="courier"
                status={job.status}
              />

              {actionErrors[job.id] && (
                <p role="alert" className="mt-3 rounded-lg bg-terracotta-50 p-3 text-xs text-terracotta-700">
                  {actionErrors[job.id]}
                </p>
              )}

              {job.events.length > 0 && (
                <div className="mt-4 border-t border-ink-100 pt-3">
                  <h3 className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                    <Clock className="h-3.5 w-3.5" /> Delivery progress
                  </h3>
                  <ol className="space-y-2">
                    {job.events.map((event) => (
                      <li key={event.id} className="text-xs text-ink-600">
                        <span className="font-medium">{EVENT_LABELS[event.event_type]}</span>
                        <span className="ml-2 text-ink-400">{new Date(event.created_at).toLocaleString()}</span>
                        {event.note && <p className="mt-0.5 text-ink-500">{event.note}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {cameraJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4" role="dialog" aria-modal="true" aria-label="Delivery proof camera">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-ink-900">Take delivery proof photo</h2>
              <button type="button" onClick={closeCamera} className="btn-secondary px-3 py-1 text-sm">
                Cancel
              </button>
            </div>
            <video
              ref={cameraVideoRef}
              autoPlay
              muted
              playsInline
              className="aspect-[4/3] w-full rounded-xl bg-ink-950 object-cover"
            />
            {cameraError && (
              <p role="alert" className="mt-3 rounded-lg bg-terracotta-50 p-3 text-xs text-terracotta-700">
                {cameraError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void captureDeliveryProof(cameraJobId)}
              disabled={!!cameraError}
              className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2"
            >
              <Camera className="h-4 w-4" />
              Capture photo
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
