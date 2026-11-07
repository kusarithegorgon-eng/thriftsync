import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Send, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useRouter } from '@/lib/router';
import { getMessageSafetyError } from '@/lib/messageSafety';
import { supabase, type Conversation, type Listing, type Message } from '@/lib/supabase';
import { formatPrice, formatTimeAgo } from '@/lib/utils';

type ConversationSummary = Conversation & {
  listing: Pick<Listing, 'id' | 'title' | 'price' | 'status' | 'listing_type'> | null;
  buyer: { display_name: string } | null;
  seller: { display_name: string } | null;
};

const ESCROW_WARNING = 'Keep all payments inside ThriftSync to stay protected by our Escrow Vault and Admin Dispute Guarantee.';

export function MessagesPage({
  listingId,
  conversationId,
}: {
  listingId?: string;
  conversationId?: string;
}) {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState(conversationId || '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listingOrderStatus, setListingOrderStatus] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    async function loadInbox() {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      let requestedConversationId = conversationId;
      if (listingId) {
        const { data: listing, error: listingError } = await supabase
          .from('listings')
          .select('id, boutiques(seller_id)')
          .eq('id', listingId)
          .maybeSingle();
        if (listingError) {
          if (active) setError(listingError.message);
          setLoading(false);
          return;
        }
        const sellerId = (listing?.boutiques as { seller_id?: string } | null)?.seller_id;
        if (!listing || !sellerId) {
          if (active) setError('This listing or its seller could not be found.');
          setLoading(false);
          return;
        }
        const { data: newConversationId, error: conversationError } = await supabase.rpc('get_or_create_listing_conversation', {
          p_listing_id: listingId,
          p_seller_id: sellerId,
        });
        if (conversationError) {
          if (active) setError(conversationError.message);
          setLoading(false);
          return;
        }
        requestedConversationId = newConversationId;
      }

      const { data, error: inboxError } = await supabase
        .from('conversations')
        .select('*, listing:listings(id, title, price, status, listing_type), buyer:profiles!conversations_buyer_id_fkey(display_name), seller:profiles!conversations_seller_id_fkey(display_name)')
        .order('updated_at', { ascending: false });
      if (!active) return;
      if (inboxError) {
        setError(inboxError.message);
      } else {
        const rows = (data as ConversationSummary[]) || [];
        setConversations(rows);
        setActiveId(requestedConversationId || rows[0]?.id || '');
      }
      setLoading(false);
    }
    void loadInbox();
    return () => { active = false; };
  }, [conversationId, listingId, user]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) || null,
    [activeId, conversations],
  );

  useEffect(() => {
    if (!activeConversation || !user) {
      setMessages([]);
      setListingOrderStatus(null);
      return;
    }
    let active = true;
    const conversation = activeConversation;

    async function loadMessages() {
      const { data, error: messageError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (!active) return;
      if (messageError) {
        setError(messageError.message);
        return;
      }
      setMessages((data as Message[]) || []);
    }

    void loadMessages();
    const channel = supabase
      .channel(`conversation-messages-${conversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversation.id}`,
      }, () => { void loadMessages(); })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' && active) {
          setError('Live chat is unavailable. Try reloading this conversation.');
        }
      });

    void supabase
      .from('orders')
      .select('status')
      .eq('listing_id', conversation.listing_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error: orderError }) => {
        if (!active) return;
        if (orderError && orderError.code !== 'PGRST116') {
          setError(orderError.message);
          return;
        }
        setListingOrderStatus(data?.status || null);
      });

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [activeConversation, user]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!user || !activeConversation || !body.trim()) return;
    const safetyError = getMessageSafetyError(body);
    if (safetyError) {
      setError(safetyError);
      return;
    }

    setSending(true);
    setError(null);
    const receiverId = user.id === activeConversation.buyer_id
      ? activeConversation.seller_id
      : activeConversation.buyer_id;
    const { error: sendError } = await supabase.from('messages').insert({
      conversation_id: activeConversation.id,
      listing_id: activeConversation.listing_id,
      sender_id: user.id,
      receiver_id: receiverId,
      body: body.trim(),
    });
    if (sendError) {
      setError(sendError.message);
    } else {
      setBody('');
    }
    setSending(false);
  }

  function getListingStatus(conversation: ConversationSummary) {
    if (conversation.listing?.listing_type === 'auction' && conversation.listing.status === 'active') return 'Auction Live';
    const status = conversation.id === activeId ? listingOrderStatus : null;
    if (status === 'escrow_held' || status === 'in_escrow') return 'In Escrow';
    if (status) return status.replace(/_/g, ' ');
    return conversation.listing?.status === 'active' ? 'In Stock' : 'Unavailable';
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="mb-4 text-sm text-ink-500">Sign in to view your ThriftSync messages.</p>
        <button onClick={() => navigate({ name: 'auth' })} className="btn-primary">Sign In</button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">Messages</h1>
          <p className="text-sm text-ink-500">Buyer and seller conversations stay protected in ThriftSync.</p>
        </div>
        <button onClick={() => navigate({ name: 'browse' })} className="btn-secondary inline-flex items-center gap-2 text-xs">
          <ArrowLeft className="h-4 w-4" /> Browse
        </button>
      </div>
      <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-ink-200 bg-white lg:grid-cols-[320px_1fr]">
        <aside className={`border-b border-ink-200 lg:border-b-0 lg:border-r ${activeConversation ? 'hidden lg:block' : ''}`}>
          <div className="border-b border-ink-100 p-4">
            <h2 className="text-sm font-semibold text-ink-900">Your conversations</h2>
          </div>
          {loading ? (
            <p className="p-5 text-sm text-ink-500">Loading conversations…</p>
          ) : conversations.length === 0 ? (
            <div className="p-6 text-center">
              <MessageCircle className="mx-auto mb-2 h-8 w-8 text-ink-300" />
              <p className="text-sm text-ink-500">No conversations yet.</p>
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {conversations.map((conversation) => {
                const otherName = user.id === conversation.buyer_id
                  ? conversation.seller?.display_name
                  : conversation.buyer?.display_name;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    onClick={() => {
                      setActiveId(conversation.id);
                      setError(null);
                    }}
                    className={`w-full border-b border-ink-100 p-4 text-left hover:bg-ink-50 ${activeId === conversation.id ? 'bg-sage-50' : ''}`}
                  >
                    <p className="truncate text-sm font-medium text-ink-900">{otherName || 'ThriftSync member'}</p>
                    <p className="mt-1 truncate text-xs text-ink-500">{conversation.listing?.title || 'Listing conversation'}</p>
                    <p className="mt-1 text-[10px] text-ink-400">{getListingStatus(conversation)}</p>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className={activeConversation ? 'flex min-h-[620px] flex-col' : 'hidden lg:flex lg:items-center lg:justify-center'}>
          {!activeConversation ? (
            <div className="text-center text-sm text-ink-400">
              <MessageCircle className="mx-auto mb-3 h-10 w-10" />
              Choose a conversation to view messages.
            </div>
          ) : (
            <>
              <header className="border-b border-ink-100 p-4">
                <button type="button" onClick={() => setActiveId('')} className="mb-2 inline-flex items-center gap-1 text-xs text-ink-500 lg:hidden">
                  <ArrowLeft className="h-3 w-3" /> All conversations
                </button>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-ink-900">{activeConversation.listing?.title || 'Listing conversation'}</h2>
                    <p className="mt-1 text-xs text-ink-500">
                      {activeConversation.listing ? formatPrice(Number(activeConversation.listing.price)) : 'Listing'} · {getListingStatus(activeConversation)}
                    </p>
                  </div>
                  <ShieldCheck className="h-5 w-5 shrink-0 text-sage-700" />
                </div>
              </header>
              <div role="note" className="border-b border-sage-200 bg-sage-50 px-4 py-3 text-xs leading-relaxed text-sage-800">
                {ESCROW_WARNING}
              </div>
              {error && <p role="alert" className="mx-4 mt-3 rounded-lg bg-terracotta-50 p-3 text-xs text-terracotta-700">{error}</p>}
              <div ref={messageListRef} className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-400">Start the conversation with a question about this listing.</p>
                ) : messages.map((message) => (
                  <div key={message.id} className={`flex ${message.sender_id === user.id ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${message.sender_id === user.id ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-900'}`}>
                      <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p>
                      <p className={`mt-1 text-[9px] ${message.sender_id === user.id ? 'text-white/60' : 'text-ink-400'}`}>{formatTimeAgo(message.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={sendMessage} className="flex items-end gap-2 border-t border-ink-100 p-3">
                <textarea
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Write a message…"
                  maxLength={4000}
                  rows={2}
                  className="input-field min-h-[48px] flex-1 resize-none text-sm"
                  required
                />
                <button type="submit" disabled={sending || !body.trim()} aria-label="Send message" className="btn-primary inline-flex h-11 w-11 shrink-0 items-center justify-center p-0 disabled:opacity-50">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
