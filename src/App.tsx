import { AuthProvider } from '@/lib/auth';
import { RouterProvider, useRouter } from '@/lib/router';
import { CartProvider } from '@/lib/cart';
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
import { SellPage } from '@/pages/SellPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { VouchersPage } from '@/pages/VouchersPage';
import { ThriftCrawlPage } from '@/pages/ThriftCrawlPage';
import { LockerNetworkPage } from '@/pages/LockerNetworkPage';
import { AdminPage } from '@/pages/AdminPage';

function RouteRenderer() {
  const { route } = useRouter();

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
    case 'sell':
      return <SellPage />;
    case 'dashboard':
      return <DashboardPage />;
    case 'vouchers':
      return <VouchersPage />;
    case 'thrift-crawl':
      return <ThriftCrawlPage />;
    case 'lockers':
      return <LockerNetworkPage />;
    case 'admin':
      return <AdminPage />;
    default:
      return <HomePage />;
  }
}

function App() {
  return (
    <AuthProvider>
      <RouterProvider>
        <CartProvider>
          <div className="min-h-screen flex flex-col bg-cream">
            <Header />
            <main className="flex-1">
              <RouteRenderer />
            </main>
            <Footer />
          </div>
        </CartProvider>
      </RouterProvider>
    </AuthProvider>
  );
}

export default App;
