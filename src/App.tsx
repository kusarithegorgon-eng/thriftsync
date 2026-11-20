import { AuthProvider, useAuth } from '@/lib/auth';
import { RouterProvider, useRouter } from '@/lib/router';
import { CartProvider } from '@/lib/cart';
import { useEffect } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { HomePage } from '@/pages/HomePage';
import { BrowsePage } from '@/pages/BrowsePage';
import { ListingDetailPage } from '@/pages/ListingDetailPage';
import { BoutiquePage } from '@/pages/BoutiquePage';
import { AuthPage } from '@/pages/AuthPage';
import { CartPage } from '@/pages/CartPage';
import { CheckoutPage } from '@/pages/CheckoutPage';
import { WishlistPage } from '@/pages/WishlistPage';
import { OrdersPage } from '@/pages/OrdersPage';
import { TradesPage } from '@/pages/TradesPage';
import { SellPage } from '@/pages/SellPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { VouchersPage } from '@/pages/VouchersPage';
import { ThriftCrawlPage } from '@/pages/ThriftCrawlPage';
import { LockerNetworkPage } from '@/pages/LockerNetworkPage';
import { AdminPage } from '@/pages/AdminPage';
import { LegalPage } from '@/pages/LegalPage';
import { ContactPage } from '@/pages/ContactPage';
import { MessagesPage } from '@/pages/MessagesPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { CookieNotice } from '@/components/CookieNotice';

function RouteRenderer() {
  const { route, navigate } = useRouter();
  const { passwordRecovery } = useAuth();

  useEffect(() => {
    if (passwordRecovery && route.name !== 'auth') navigate({ name: 'auth' });
  }, [passwordRecovery, route.name, navigate]);

  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'browse':
      return <BrowsePage />;
    case 'listing':
      return <ListingDetailPage listingId={route.id} />;
    case 'boutique':
      return <BoutiquePage slug={route.slug} />;
    case 'auth':
      return <AuthPage />;
    case 'cart':
      return <CartPage />;
    case 'checkout':
      return <CheckoutPage />;
    case 'wishlist':
      return <WishlistPage />;
    case 'orders':
      return <OrdersPage />;
    case 'trades':
      return <TradesPage requestedListingId={route.listingId} />;
    case 'contact':
      return <ContactPage />;
    case 'sell':
      return <SellPage />;
    case 'dashboard':
      return <DashboardPage />;
    case 'vouchers':
      return <VouchersPage />;
    case 'thrift-crawl':
      return <ThriftCrawlPage />;
    case 'messages':
      return <MessagesPage listingId={route.listingId} conversationId={route.conversationId} />;
    case 'profile':
      return <ProfilePage profileId={route.id} />;
    case 'lockers':
      return <LockerNetworkPage />;
    case 'admin':
      return <AdminPage />;
    case 'legal':
      return <LegalPage document={route.document} />;
    default:
      return <HomePage />;
  }
}

function AccountRestrictionNotice() {
  const { profile, restrictionReason } = useAuth();
  const { navigate } = useRouter();
  if (!profile || !profile.account_status || profile.account_status === 'active') return null;

  const isRestricted = profile.account_status === 'restricted';
  return (
    <aside role="alert" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">
            {isRestricted ? 'Some marketplace actions are restricted.' : 'Your account is suspended from new marketplace actions.'}
          </p>
          <p className="text-xs">
            {restrictionReason || 'Contact support if you believe this is a mistake.'}
            {profile.account_restricted_until && ` Ends ${new Date(profile.account_restricted_until).toLocaleString()}.`}
            {' '}Existing orders remain available.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate({ name: 'contact' })}
          className="self-start text-xs font-semibold underline sm:self-auto"
        >
          Contact support
        </button>
      </div>
    </aside>
  );
}

function App() {
  return (
    <AuthProvider>
      <RouterProvider>
        <CartProvider>
          <div className="min-h-screen flex flex-col bg-cream">
            <Header />
            <AccountRestrictionNotice />
            <main className="flex-1">
              <RouteRenderer />
            </main>
            <Footer />
            <CookieNotice />
          </div>
        </CartProvider>
      </RouterProvider>
    </AuthProvider>
  );
}

export default App;
