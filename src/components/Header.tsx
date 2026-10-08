import { useEffect, useState } from 'react';
import { Gavel, Search, Heart, ShoppingBag, Menu, X, Store, User, LayoutDashboard, Package, Tag, MapPin, Lock } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { cn } from '@/lib/utils';

export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, signOut } = useAuth();
  const { itemCount } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
  }, [route]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ name: 'browse', q: searchValue || undefined });
  }

  const isActive = (name: string) => route.name === name;

  return (
    <>
      <header
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
          scrolled ? 'bg-cream/95 backdrop-blur-md shadow-sm border-b border-ink-100' : 'bg-transparent'
        )}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo */}
            <button
              onClick={() => navigate({ name: 'home' })}
              className="flex items-center gap-2 shrink-0 group"
            >
              <div className="w-9 h-9 rounded-lg bg-ink-900 flex items-center justify-center group-hover:bg-terracotta-500 transition-colors duration-300">
                <Gavel className="w-5 h-5 text-cream" strokeWidth={2.2} />
              </div>
              <span className="font-serif text-xl font-bold text-ink-900 tracking-tight hidden sm:block">
                ThriftSync
              </span>
            </button>

            {/* Search bar - desktop */}
            <form onSubmit={handleSearch} className="hidden md:flex flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  type="text"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  placeholder="Search vintage, era, boutique..."
                  className="w-full pl-10 pr-4 py-2 bg-ink-50 border border-ink-100 rounded-full text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:border-ink-300 focus:bg-white transition-all"
                />
              </div>
            </form>

            {/* Nav links - desktop */}
            <nav className="hidden lg:flex items-center gap-1">
              <NavLink active={isActive('browse')} onClick={() => navigate({ name: 'browse' })}>
                Browse
              </NavLink>
              <NavLink active={isActive('thrift-crawl')} onClick={() => navigate({ name: 'thrift-crawl' })}>
                Thrift Crawl
              </NavLink>
              <NavLink active={isActive('lockers')} onClick={() => navigate({ name: 'lockers' })}>
                Lockers
              </NavLink>
              <NavLink active={isActive('sell')} onClick={() => navigate({ name: 'sell' })}>
                Sell
              </NavLink>
              <NavLink active={isActive('dashboard')} onClick={() => navigate({ name: 'dashboard' })}>
                Dashboard
              </NavLink>
            </nav>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigate({ name: 'wishlist' })}
                className="p-2 rounded-lg hover:bg-ink-100 transition-colors relative"
                aria-label="Wishlist"
              >
                <Heart className={cn('w-5 h-5', isActive('wishlist') ? 'text-terracotta-500 fill-terracotta-500' : 'text-ink-700')} />
              </button>

              <button
                onClick={() => navigate({ name: 'cart' })}
                className="p-2 rounded-lg hover:bg-ink-100 transition-colors relative"
                aria-label="Cart"
              >
                <ShoppingBag className={cn('w-5 h-5', isActive('cart') ? 'text-ink-900' : 'text-ink-700')} />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-terracotta-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-scale-in">
                    {itemCount}
                  </span>
                )}
              </button>

              {user ? (
                <div className="relative">
                  <button
                    onClick={() => setUserMenuOpen(!userMenuOpen)}
                    className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-ink-100 transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-sage-500 text-cream flex items-center justify-center text-xs font-bold">
                      {profile?.display_name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
                    </div>
                  </button>
                  {userMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-lg border border-ink-100 py-2 animate-slide-down">
                      <div className="px-4 py-2 border-b border-ink-100">
                        <p className="text-sm font-medium text-ink-900 truncate">{profile?.display_name || 'User'}</p>
                        <p className="text-xs text-ink-500 truncate">{user.email}</p>
                      </div>
                      <MenuItem icon={<LayoutDashboard className="w-4 h-4" />} onClick={() => navigate({ name: 'dashboard' })}>
                        Seller Dashboard
                      </MenuItem>
                      <MenuItem icon={<MapPin className="w-4 h-4" />} onClick={() => navigate({ name: 'thrift-crawl' })}>
                        Thrift Crawl Planner
                      </MenuItem>
                      <MenuItem icon={<Lock className="w-4 h-4" />} onClick={() => navigate({ name: 'lockers' })}>
                        Locker Network
                      </MenuItem>
                      <MenuItem icon={<Package className="w-4 h-4" />} onClick={() => navigate({ name: 'orders' })}>
                        My Orders
                      </MenuItem>
                      <MenuItem icon={<Tag className="w-4 h-4" />} onClick={() => navigate({ name: 'vouchers' })}>
                        Promo Codes
                      </MenuItem>
                      <MenuItem icon={<Heart className="w-4 h-4" />} onClick={() => navigate({ name: 'wishlist' })}>
                        Wishlist
                      </MenuItem>
                      <div className="border-t border-ink-100 mt-1 pt-1">
                        <MenuItem icon={<X className="w-4 h-4" />} onClick={() => signOut()}>
                          Sign Out
                        </MenuItem>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => navigate({ name: 'auth' })}
                  className="hidden sm:flex items-center gap-1.5 px-4 py-2 bg-ink-900 text-cream rounded-lg text-sm font-medium hover:bg-ink-800 transition-colors"
                >
                  <User className="w-4 h-4" />
                  Sign In
                </button>
              )}

              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="lg:hidden p-2 rounded-lg hover:bg-ink-100 transition-colors"
                aria-label="Menu"
              >
                {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="lg:hidden bg-cream border-t border-ink-100 animate-slide-down">
            <div className="px-4 py-4 space-y-3">
              <form onSubmit={handleSearch} className="md:hidden">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                  <input
                    type="text"
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-ink-900"
                  />
                </div>
              </form>
              <MobileNavLink onClick={() => navigate({ name: 'browse' })} icon={<Search className="w-4 h-4" />}>
                Browse
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'thrift-crawl' })} icon={<MapPin className="w-4 h-4" />}>
                Thrift Crawl
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'lockers' })} icon={<Lock className="w-4 h-4" />}>
                Locker Network
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'sell' })} icon={<Store className="w-4 h-4" />}>
                Sell
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'dashboard' })} icon={<LayoutDashboard className="w-4 h-4" />}>
                Dashboard
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'vouchers' })} icon={<Tag className="w-4 h-4" />}>
                Promo Codes
              </MobileNavLink>
              {!user && (
                <button
                  onClick={() => navigate({ name: 'auth' })}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-ink-900 text-cream rounded-lg text-sm font-medium"
                >
                  <User className="w-4 h-4" />
                  Sign In
                </button>
              )}
            </div>
          </div>
        )}
      </header>
      <div className="h-16" />
    </>
  );
}

function NavLink({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        active ? 'text-ink-900 bg-ink-100' : 'text-ink-600 hover:text-ink-900 hover:bg-ink-50'
      )}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-ink-700 hover:bg-ink-50 hover:text-ink-900 transition-colors text-left"
    >
      {icon}
      {children}
    </button>
  );
}

function MobileNavLink({ children, icon, onClick }: { children: React.ReactNode; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-ink-700 hover:bg-ink-100 transition-colors"
    >
      {icon}
      {children}
    </button>
  );
}
