import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { getMessageSafetyError } from '@/lib/messageSafety';
import { supabase } from '@/lib/supabase';

type DeliveryChatMessage = {
  id: string;
  delivery_job_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

const READABLE_STATUSES = ['accepted', 'picked_up', 'in_transit', 'delivered'];
const SENDABLE_STATUSES = ['accepted', 'picked_up', 'in_transit'];

export function DeliveryChat({
  deliveryJobId,
  participant,
  status,
  title = 'Delivery chat',
  embedded = false,
  showTitle = true,
  onRead,
}: {
  deliveryJobId: string;
  participant: 'buyer' | 'courier';
  status: string;
  title?: string;
  embedded?: boolean;
  showTitle?: boolean;
  onRead?: () => void;
}) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DeliveryChatMessage[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveWarning, setLiveWarning] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const lastReadThroughRef = useRef('');
  const canRead = READABLE_STATUSES.includes(status);
  const canSend = SENDABLE_STATUSES.includes(status);

  const loadMessages = useCallback(async () => {
    if (!user || !canRead) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const { data, error: loadError } = await supabase
      .from('delivery_messages')
      .select('id, delivery_job_id, sender_id, body, created_at')
      .eq('delivery_job_id', deliveryJobId)
      .order('created_at', { ascending: true });

    if (loadError) {
      setError(`Could not load delivery messages: ${loadError.message}`);
    } else {
      const loadedMessages = (data as DeliveryChatMessage[]) || [];
      setMessages(loadedMessages);
      const latestMessageAt = loadedMessages[loadedMessages.length - 1]?.created_at;
      if (latestMessageAt && latestMessageAt > lastReadThroughRef.current) {
        const previousReadThrough = lastReadThroughRef.current;
        lastReadThroughRef.current = latestMessageAt;
        const { error: readError } = await supabase.rpc('mark_delivery_chat_read', {
          p_delivery_job_id: deliveryJobId,
          p_read_through: latestMessageAt,
        });
        if (readError) {
          lastReadThroughRef.current = previousReadThrough;
          setError(`Could not update unread messages: ${readError.message}`);
        } else {
          setError(null);
          onRead?.();
        }
      } else {
        setError(null);
      }
    }
    setLoading(false);
  }, [canRead, deliveryJobId, onRead, user]);

  useEffect(() => {
    if (!user || !canRead) return undefined;

    void loadMessages();
    const channel = supabase
      .channel(`delivery-chat-${deliveryJobId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'delivery_messages',
        filter: `delivery_job_id=eq.${deliveryJobId}`,
      }, () => { void loadMessages(); })
      .subscribe((channelStatus) => {
        if (channelStatus === 'CHANNEL_ERROR' || channelStatus === 'TIMED_OUT') {
          setLiveWarning('Live chat updates are unavailable; messages will refresh automatically.');
        } else if (channelStatus === 'SUBSCRIBED') {
          setLiveWarning(null);
        }
      });
    const refreshTimer = window.setInterval(() => { void loadMessages(); }, 8000);

    return () => {
      window.clearInterval(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [canRead, deliveryJobId, loadMessages, user]);

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!user || !canSend || !trimmedBody || sending) return;

    const safetyError = getMessageSafetyError(trimmedBody);
    if (safetyError) {
      setError(safetyError);
      return;
    }
    if (/\b[A-F0-9]{12}\b/i.test(trimmedBody)) {
      setError('Do not send pickup or delivery codes in chat. Share the code directly at handoff.');
      return;
    }

    setSending(true);
    setError(null);
    const { error: sendError } = await supabase.from('delivery_messages').insert({
      delivery_job_id: deliveryJobId,
      sender_id: user.id,
      body: trimmedBody,
    });
    if (sendError) {
      setError(`Could not send your message: ${sendError.message}`);
    } else {
      setBody('');
      await loadMessages();
    }
    setSending(false);
  }

  if (!user || !canRead) return null;

  const otherParticipant = participant === 'buyer' ? 'Courier' : 'Buyer';

  return (
    <section className={embedded ? 'flex min-h-0 flex-1 flex-col' : 'mt-4 border-t border-ink-100 pt-4'}>
      {showTitle && (
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-800">
          <MessageCircle className="h-4 w-4" /> {title}
        </h3>
      )}
      <p className="mt-1 text-[11px] text-ink-500">
        Only you and the assigned {participant === 'buyer' ? 'courier' : 'buyer'} can read this. Don’t send pickup or delivery codes here.
      </p>
      {liveWarning && <p role="status" className="mt-2 text-[11px] text-gold-700">{liveWarning}</p>}
      <div
        ref={messageListRef}
        role="log"
        aria-label="Delivery chat messages"
        aria-live="polite"
        className={`mt-3 space-y-2 overflow-y-auto rounded-lg bg-ink-50 p-3 ${
          embedded ? 'min-h-0 flex-1' : 'max-h-56'
        }`}
      >
        {loading && messages.length === 0 ? (
          <p className="text-xs text-ink-500">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-ink-500">No messages yet. Coordinate arrival time or delivery directions here.</p>
        ) : messages.map((message) => {
          const isOwnMessage = message.sender_id === user.id;
          return (
            <div key={message.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 ${
                isOwnMessage ? 'bg-ink-900 text-white' : 'bg-white text-ink-800'
              }`}>
                <p className="mb-1 text-[10px] opacity-70">{isOwnMessage ? 'You' : otherParticipant}</p>
                <p className="whitespace-pre-wrap break-words text-xs">{message.body}</p>
                <p className="mt-1 text-right text-[9px] opacity-60">
                  {new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-terracotta-700">{error}</p>}
      {canSend ? (
        <form onSubmit={(event) => void sendMessage(event)} className="mt-2 flex gap-2">
          <input
            value={body}
            onChange={(event) => setBody(event.target.value.slice(0, 1000))}
            placeholder="Message about arrival or directions"
            aria-label="Delivery chat message"
            maxLength={1000}
            required
            className="input-field min-w-0 flex-1 text-xs"
          />
          <button
            type="submit"
            aria-label="Send delivery message"
            disabled={sending || !body.trim()}
            className="btn-primary inline-flex items-center justify-center gap-1.5 text-xs"
          >
            <Send className="h-3.5 w-3.5" /> {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      ) : (
        <p className="mt-2 text-[11px] text-ink-500">This chat is read-only because the delivery is complete.</p>
      )}
    </section>
  );
}
