import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useRouter, type Route } from '@/lib/router';

type LegalDocument = Extract<Route, { name: 'legal' }>['document'];

const titles: Record<LegalDocument, string> = {
  privacy: 'Privacy Notice',
  terms: 'Terms of Use',
  cookies: 'Cookie Notice',
};

export function LegalPage({ document }: { document: LegalDocument }) {
  const { navigate } = useRouter();

  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <button
        onClick={() => navigate({ name: 'home' })}
        className="inline-flex items-center gap-2 text-sm text-ink-500 hover:text-ink-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4" /> Back to ThriftSync
      </button>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-sage-100 flex items-center justify-center">
          <ShieldCheck className="w-5 h-5 text-sage-700" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-400">ThriftSync · Philippines</p>
          <h1 className="font-serif text-3xl font-bold text-ink-900">{titles[document]}</h1>
        </div>
      </div>
      <p className="text-sm text-ink-400 mb-8">Effective date: 11 October 2026 · Last updated: 11 October 2026</p>

      <div className="space-y-8 text-sm leading-7 text-ink-600">
        {document === 'privacy' && <PrivacyNotice />}
        {document === 'terms' && <TermsOfUse />}
        {document === 'cookies' && <CookieNotice />}
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-serif text-xl font-bold text-ink-900 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function PrivacyNotice() {
  return (
    <>
      <p>
        This notice explains how <strong>[LEGAL BUSINESS NAME]</strong> (“ThriftSync,” “we,” “us”)
        collects and uses personal information when you use this marketplace. ThriftSync is designed
        for Cebu-based boutiques and buyers in the Philippines. Replace the bracketed business and
        contact details below before publishing this service.
      </p>
      <Section title="Who is responsible and how to contact us">
        <p>
          The personal information controller is <strong>[LEGAL BUSINESS NAME]</strong>, operating
          ThriftSync in the Philippines. For privacy questions, requests, or complaints, contact our
          privacy lead at <strong>[PRIVACY CONTACT EMAIL]</strong>. Do not include passwords or
          payment credentials in a privacy request. We will verify your identity before acting on a
          request.
        </p>
      </Section>
      <Section title="Information we handle">
        <ul className="list-disc pl-5 space-y-1">
          <li>Account details such as email address, display name, account ID, and seller/buyer role.</li>
          <li>Store and product details, product photos, messages, reviews, bids, and wishlist activity.</li>
          <li>Order details, delivery or pickup address details, voucher use, and trade or locker activity you submit.</li>
          <li>Location details, such as a boutique location or delivery coordinates, when you provide them.</li>
          <li>Basic technical and diagnostic information needed to operate and protect the service.</li>
          <li>Browser storage used to keep your Supabase sign-in session and remember your cart and voucher selection.</li>
        </ul>
        <p className="mt-2">
          Please do not put sensitive personal information in public product descriptions, reviews, or
          messages unless it is necessary. Product images uploaded to the public listing-images bucket
          can be viewed by anyone who has the public image URL.
        </p>
      </Section>
      <Section title="Why we use information">
        <p>
          We use information to create and secure accounts, display boutiques and listings, support
          marketplace features, route orders and messages, prevent fraud and abuse, provide customer
          support, meet legal obligations, and resolve disputes. Location and contact details are used
          to support local pickup and delivery workflows. We do not use information for targeted
          advertising through this application.
        </p>
      </Section>
      <Section title="Sharing and service providers">
        <p>
          Information is available to other users when you choose to publish it (for example, public
          store profiles, listings, reviews, and listing photos). We use Supabase for authentication,
          database, and file storage infrastructure. We may disclose information where necessary to
          operate the service, comply with a lawful request, protect users or rights, or handle a
          business transfer. We do not sell personal information.
        </p>
      </Section>
      <Section title="Storage, retention, and security">
        <p>
          Information is stored in the Supabase project configured for ThriftSync. We retain it while
          needed to provide the service and for legitimate records, security, dispute-resolution, and
          legal purposes. Retention periods depend on the record and applicable law. We use access
          controls and other reasonable safeguards, but no online service can guarantee absolute
          security. Contact us promptly if you believe your account has been compromised.
        </p>
      </Section>
      <Section title="Your privacy rights">
        <p>
          Subject to the Philippine Data Privacy Act of 2012 (Republic Act No. 10173), its
          implementing rules, and applicable exceptions, you may request access to or correction of
          your personal information, object to or restrict certain processing, request erasure or
          blocking, withdraw consent where processing relies on consent, or seek applicable remedies.
          Send requests to <strong>[PRIVACY CONTACT EMAIL]</strong>. You may also raise a concern
          with the National Privacy Commission. We will respond within the period required by
          applicable law.
        </p>
      </Section>
      <Section title="Children and updates">
        <p>
          ThriftSync is not directed to children under 18. Do not create an account or submit another
          person’s information without authority. We may update this notice as the service or
          applicable requirements change; the effective date above shows the latest revision.
        </p>
      </Section>
    </>
  );
}

function TermsOfUse() {
  const { navigate } = useRouter();

  return (
    <>
      <p>
        These Terms govern your use of ThriftSync, a marketplace intended for Cebu-based boutiques
        and buyers in the Philippines. By using the service, you agree to these Terms. The service
        operator is <strong>[LEGAL BUSINESS NAME]</strong>; contact <strong>[PRIVACY CONTACT EMAIL]</strong>
        for questions or notices. Have the final terms reviewed for your business and operating model
        before launch.
      </p>
      <Section title="Eligibility and accounts">
        <p>
          You must be at least 18 and able to enter a binding agreement to use ThriftSync. Keep your
          account information accurate, safeguard your sign-in credentials, and promptly tell us if
          you suspect unauthorized access. You are responsible for activity under your account.
        </p>
      </Section>
      <Section title="Marketplace listings and conduct">
        <p>
          Sellers must have the right to offer each item, provide accurate descriptions and condition
          details, disclose known flaws, and use images they are permitted to upload. Do not list
          counterfeit, stolen, illegal, unsafe, or otherwise prohibited goods. Do not misrepresent
          authenticity, manipulate bids, harass users, evade moderation, or misuse another person’s
          personal information. We may remove content, restrict accounts, or suspend access when
          reasonably necessary to enforce these Terms or protect users.
        </p>
      </Section>
      <Section title="Orders, auctions, and payments">
        <p>
          Product listings are offers from individual sellers, not guarantees by ThriftSync.
          Ascending auctions use bids and descending auctions show a price that falls over time until
          claimed or the auction ends; auction rules and displayed timing apply to each listing.
          Checkout payments are processed by PayMongo. Card and e-wallet details are entered on
          PayMongo’s hosted page, not in ThriftSync forms. Seeing an “escrow” status in the interface
          means the order is recorded as unpaid-to-the-seller until you confirm delivery; it does not
          mean ThriftSync is a licensed escrow agent or insurer. Test-mode PayMongo keys do not
          capture live funds. Confirm delivery, returns, and dispute arrangements with the seller
          after a successful payment.
        </p>
      </Section>
      <Section title="Content and service availability">
        <p>
          You retain rights in content you submit and give ThriftSync permission to host, store,
          display, and format it as needed to operate the marketplace. Public listings and their
          photos may be visible to anyone. We do not guarantee uninterrupted service, listing
          availability, seller performance, product authenticity, or that every user-submitted
          statement is accurate. Nothing in these Terms removes rights or remedies that cannot
          lawfully be excluded.
        </p>
      </Section>
      <Section title="Privacy, suspension, and changes">
        <p>
          Our{' '}
          <button onClick={() => navigate({ name: 'legal', document: 'privacy' })} className="text-terracotta-700 underline">
            Privacy Notice
          </button>
          {' '}and{' '}
          <button onClick={() => navigate({ name: 'legal', document: 'cookies' })} className="text-terracotta-700 underline">
            Cookie Notice
          </button>
          {' '}explain how information and browser storage are handled. We may update these Terms by
          publishing a revised version with a new effective date. If you materially breach them, we
          may suspend or terminate access, subject to applicable law.
        </p>
      </Section>
      <Section title="Applicable law and contact">
        <p>
          These Terms are governed by the laws of the Republic of the Philippines, without limiting
          mandatory consumer or privacy rights. Contact <strong>[PRIVACY CONTACT EMAIL]</strong> for
          notices. A legal adviser should confirm the appropriate venue and required consumer
          disclosures for the final business structure.
        </p>
      </Section>
    </>
  );
}

function CookieNotice() {
  const { navigate } = useRouter();

  return (
    <>
      <p>
        ThriftSync currently uses browser storage for features you request; this application does not
        currently load analytics, advertising, or cross-site tracking cookies. This notice describes
        the storage used by the current app, not every service that may be added in the future.
      </p>
      <Section title="Essential browser storage">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Supabase authentication stores your sign-in session in browser local storage so you remain
            signed in between visits.
          </li>
          <li>
            The cart stores selected listings and an applied voucher in local storage so they remain
            available when you return.
          </li>
          <li>
            These are browser storage entries, not advertising cookies. They support core features
            and are not used for targeted advertising.
          </li>
        </ul>
      </Section>
      <Section title="Your choices">
        <p>
          You can sign out to clear the Supabase session and remove cart data through the app. You can
          also clear this site’s storage in your browser settings; doing so may sign you out and empty
          your cart. Blocking essential storage may prevent sign-in and cart features from working.
          Use the “Cookie settings” link in the footer to reopen the storage notice.
        </p>
      </Section>
      <Section title="Future technologies and contact">
        <p>
          If we introduce optional analytics, advertising, or other non-essential tracking, we will
          update this notice and provide any choices or consent required by applicable law before
          enabling it. Questions can be sent to <strong>[PRIVACY CONTACT EMAIL]</strong>. See the{' '}
          <button onClick={() => navigate({ name: 'legal', document: 'privacy' })} className="text-terracotta-700 underline">
            Privacy Notice
          </button>
          {' '}for information about personal data.
        </p>
      </Section>
    </>
  );
}
