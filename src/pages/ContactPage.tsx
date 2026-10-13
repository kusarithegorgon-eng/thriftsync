import { useState, type FormEvent } from 'react';
import { ArrowLeft, CheckCircle2, Mail, Send } from 'lucide-react';
import { useRouter } from '@/lib/router';

const emailJsEndpoint = 'https://api.emailjs.com/api/v1.0/email/send';

export function ContactPage() {
  const { navigate } = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function submitContactForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSent(false);

    const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
    const templateId = import.meta.env.VITE_EMAILJS_CONTACT_TEMPLATE_ID;
    const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
    if (!serviceId || !templateId || !publicKey) {
      setError('The contact form is not configured yet. Please try again later.');
      return;
    }

    setSending(true);
    try {
      const response = await fetch(emailJsEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: serviceId,
          template_id: templateId,
          user_id: publicKey,
          template_params: {
            name: name.trim(),
            email: email.trim(),
            title: subject.trim(),
            message: message.trim(),
          },
        }),
      });
      if (!response.ok) throw new Error('EmailJS did not accept the message.');

      setSent(true);
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch {
      setError('Your message could not be sent. Please try again later.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 animate-fade-in">
      <button
        onClick={() => navigate({ name: 'home' })}
        className="inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4" /> Back to ThriftSync
      </button>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] lg:gap-16">
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-terracotta-100 text-terracotta-700 flex items-center justify-center">
              <Mail className="w-5 h-5" />
            </div>
            <p className="text-xs uppercase tracking-wide text-ink-500">ThriftSync Support</p>
          </div>
          <h1 className="font-serif text-3xl font-bold text-ink-900 mb-3">Contact Us</h1>
          <p className="max-w-md text-sm leading-6 text-ink-600">
            Send a message to the ThriftSync team. We will reply to the email address you provide.
          </p>
        </div>

        <form onSubmit={submitContactForm} className="space-y-4">
          <div>
            <label htmlFor="contact-name" className="block text-sm font-medium text-ink-800 mb-1.5">Name</label>
            <input
              id="contact-name"
              name="name"
              autoComplete="name"
              maxLength={120}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label htmlFor="contact-email" className="block text-sm font-medium text-ink-800 mb-1.5">Email</label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label htmlFor="contact-subject" className="block text-sm font-medium text-ink-800 mb-1.5">Subject</label>
            <input
              id="contact-subject"
              name="title"
              maxLength={160}
              required
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <label htmlFor="contact-message" className="block text-sm font-medium text-ink-800 mb-1.5">Message</label>
            <textarea
              id="contact-message"
              name="message"
              rows={6}
              maxLength={5000}
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="input-field resize-y"
            />
          </div>
          {error && <p role="alert" className="text-sm text-terracotta-700">{error}</p>}
          {sent && (
            <p role="status" className="inline-flex items-center gap-2 text-sm text-sage-700">
              <CheckCircle2 className="w-4 h-4" /> Message sent. Thank you for contacting us.
            </p>
          )}
          <button type="submit" disabled={sending} className="btn-primary inline-flex items-center gap-2">
            <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send message'}
          </button>
        </form>
      </div>
    </div>
  );
}
