import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { DeliveryChat } from '@/components/DeliveryChat';

const READABLE_STATUSES = ['accepted', 'picked_up', 'in_transit', 'delivered'];

export function DeliveryChatDrawer({
  deliveryJobId,
  status,
}: {
  deliveryJobId: string;
  status: string;
}) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadError, setUnreadError] = useState<string | null>(null);
  const canRead = READABLE_STATUSES.includes(status);

  const refreshUnreadCount = useCallback(async () => {
    if (!user || !canRead || isOpen) {
      setUnreadCount(0);
      setUnreadError(null);
      return;
    }

    const { data: readState, error: readError } = await supabase
      .from('delivery_chat_reads')
      .select('last_read_at')
      .eq('delivery_job_id', deliveryJobId)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (readError) {
      setUnreadError(`Could not check unread messages: ${readError.message}`);
      return;
    }

    let unreadQuery = supabase
      .from('delivery_messages')
      .select('id', { count: 'exact', head: true })
      .eq('delivery_job_id', deliveryJobId)
      .neq('sender_id', user.id);
    const lastReadAt = (readState as { last_read_at: string } | null)?.last_read_at;
    if (lastReadAt) unreadQuery = unreadQuery.gt('created_at', lastReadAt);

    const { count, error: countError } = await unreadQuery;
    if (countError) {
      setUnreadError(`Could not check unread messages: ${countError.message}`);
      return;
    }
    setUnreadError(null);
    setUnreadCount(count || 0);
  }, [canRead, deliveryJobId, isOpen, user]);

  useEffect(() => {
    if (!user || !canRead) {
      setUnreadCount(0);
      return undefined;
    }

    void refreshUnreadCount();
    const channel = supabase
      .channel(`delivery-chat-unread-${deliveryJobId}-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'delivery_messages',
        filter: `delivery_job_id=eq.${deliveryJobId}`,
      }, () => { void refreshUnreadCount(); })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'delivery_chat_reads',
        filter: `delivery_job_id=eq.${deliveryJobId}`,
      }, () => { void refreshUnreadCount(); })
      .subscribe();
    const refreshTimer = window.setInterval(() => { void refreshUnreadCount(); }, 8000);

    return () => {
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [canRead, deliveryJobId, refreshUnreadCount, user]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
    setUnreadError(null);
  }, []);

  if (!user || !canRead) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUnreadCount(0);
          setIsOpen(true);
        }}
        aria-haspopup="dialog"
        className="relative mt-3 inline-flex items-center gap-2 rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-medium text-sky-900 hover:bg-sky-50"
      >
        <MessageCircle className="h-4 w-4" />
        Chat with Courier
        {unreadCount > 0 && (
          <span
            aria-label={`${unreadCount} unread messages`}
            className="inline-flex min-w-5 items-center justify-center rounded-full bg-terracotta-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      {unreadError && (
        <p role="alert" className="mt-2 text-xs text-terracotta-700">{unreadError}</p>
      )}
      {isOpen && (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <button
            type="button"
            aria-label="Close courier chat"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-ink-900/40"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delivery-chat-title-${deliveryJobId}`}
            className="relative z-10 flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-ink-100 px-4 py-4">
              <h2 id={`delivery-chat-title-${deliveryJobId}`} className="font-serif text-lg font-bold text-ink-900">
                Chat with Courier
              </h2>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close courier chat"
                className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex min-h-0 flex-1 flex-col p-4">
              <DeliveryChat
                deliveryJobId={deliveryJobId}
                participant="buyer"
                status={status}
                embedded
                showTitle={false}
                onRead={clearUnread}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
