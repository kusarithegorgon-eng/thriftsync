import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'browse'; category?: string; era?: string; q?: string }
  | { name: 'listing'; id: string }
  | { name: 'boutique'; slug: string }
  | { name: 'sell' }
  | { name: 'dashboard' }
  | { name: 'wishlist' }
  | { name: 'cart' }
  | { name: 'checkout' }
  | { name: 'auth' }
  | { name: 'orders' }
  | { name: 'vouchers' }
  | { name: 'thrift-crawl' }
  | { name: 'lockers' }
  | { name: 'admin' }
  | { name: 'legal'; document: 'privacy' | 'terms' | 'cookies' };

type RouterContextValue = {
  route: Route;
  navigate: (route: Route) => void;
};

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => {
    const handlePop = () => parseAndSet();
    window.addEventListener('popstate', handlePop);
    parseAndSet();
    return () => window.removeEventListener('popstate', handlePop);
  }, []);

  function parseAndSet() {
    const hash = window.location.hash.slice(1) || '/';
    const parts = hash.split('/').filter(Boolean);
    const params = new URLSearchParams(hash.split('?')[1] || '');

    if (parts.length === 0 || parts[0] === '') {
      setRoute({ name: 'home' });
    } else if (parts[0] === 'browse') {
      setRoute({ name: 'browse', category: params.get('category') || undefined, era: params.get('era') || undefined, q: params.get('q') || undefined });
    } else if (parts[0] === 'listing' && parts[1]) {
      setRoute({ name: 'listing', id: parts[1] });
    } else if (parts[0] === 'boutique' && parts[1]) {
      setRoute({ name: 'boutique', slug: parts[1] });
    } else if (parts[0] === 'sell') {
      setRoute({ name: 'sell' });
    } else if (parts[0] === 'dashboard') {
      setRoute({ name: 'dashboard' });
    } else if (parts[0] === 'wishlist') {
      setRoute({ name: 'wishlist' });
    } else if (parts[0] === 'cart') {
      setRoute({ name: 'cart' });
    } else if (parts[0] === 'checkout') {
      setRoute({ name: 'checkout' });
    } else if (parts[0] === 'auth') {
      setRoute({ name: 'auth' });
    } else if (parts[0] === 'orders') {
      setRoute({ name: 'orders' });
    } else if (parts[0] === 'vouchers') {
      setRoute({ name: 'vouchers' });
    } else if (parts[0] === 'thrift-crawl') {
      setRoute({ name: 'thrift-crawl' });
    } else if (parts[0] === 'lockers') {
      setRoute({ name: 'lockers' });
    } else if (parts[0] === 'admin') {
      setRoute({ name: 'admin' });
    } else if (parts[0] === 'privacy' || parts[0] === 'terms' || parts[0] === 'cookies') {
      setRoute({ name: 'legal', document: parts[0] });
    } else {
      setRoute({ name: 'home' });
    }
  }

  function navigate(newRoute: Route) {
    let hash = '#/';
    if (newRoute.name === 'browse') {
      const params = new URLSearchParams();
      if (newRoute.category) params.set('category', newRoute.category);
      if (newRoute.era) params.set('era', newRoute.era);
      if (newRoute.q) params.set('q', newRoute.q);
      const qs = params.toString();
      hash = `#/browse${qs ? '?' + qs : ''}`;
    } else if (newRoute.name === 'listing') {
      hash = `#/listing/${newRoute.id}`;
    } else if (newRoute.name === 'boutique') {
      hash = `#/boutique/${newRoute.slug}`;
    } else if (newRoute.name === 'legal') {
      hash = `#/${newRoute.document}`;
    } else if (newRoute.name !== 'home') {
      hash = `#/${newRoute.name}`;
    }
    window.location.hash = hash;
    setRoute(newRoute);
    window.scrollTo(0, 0);
  }

  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used within RouterProvider');
  return ctx;
}
