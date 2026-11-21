import { useEffect, useState } from 'react';
import { Gavel, Search, Heart, ShoppingBag, Menu, X, Store, User, LayoutDashboard, Package, Tag, MapPin, Lock, ShieldCheck, MessageCircle, Bell, ArrowLeftRight, Truck } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { useCart } from '@/lib/cart';
import { supabase, type AuctionWinnerNotification, type TradeNotification } from '@/lib/supabase';
import { cn } from '@/lib/utils';

type AppNotification = (AuctionWinnerNotification & { source: 'auction' }) | (TradeNotification & { source: 'trade' });

export function Header() {
  const { route, navigate } = useRouter();
  const { user, profile, signOut } = useAuth();
  const { itemCount } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setNotifications([]);
      setNotificationError(null);
      return;
    }

    async function loadNotifications() {
      const [auctionResult, tradeResult] = await Promise.all([
        supabase
          .from('auction_winner_notifications')
          .select('*')
          .eq('recipient_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('trade_notifications')
          .select('*')
          .eq('recipient_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      if (auctionResult.error || tradeResult.error) {
        const error = auctionResult.error || tradeResult.error;
        setNotificationError('Could not load notifications.');
        console.error('Notification load error:', error);
        return;
      }

      setNotificationError(null);
      const auctionNotifications = ((auctionResult.data as AuctionWinnerNotification[]) || [])
        .map((notification) => ({ ...notification, source: 'auction' as const }));
      const tradeNotifications = ((tradeResult.data as TradeNotification[]) || [])
        .map((notification) => ({ ...notification, source: 'trade' as const }));
      setNotifications([...auctionNotifications, ...tradeNotifications]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
        .slice(0, 20));
    }

    void loadNotifications();
    const interval = setInterval(() => void loadNotifications(), 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setUserMenuOpen(false);
    setNotificationMenuOpen(false);
  }, [route]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    navigate({ name: 'browse', q: searchValue || undefined });
  }

  async function openNotification(notification: AppNotification) {
    const { error } = notification.source === 'trade'
      ? await supabase.rpc('mark_trade_notification_read', { p_notification_id: notification.id })
      : await supabase.rpc('mark_auction_winner_notification_read', { p_notification_id: notification.id });
    if (error) {
      setNotificationError('Could not update this notification. Please try again.');
      console.error('Notification update error:', error);
      return;
    }

    setNotifications((current) => current.map((item) => item.id === notification.id
      ? { ...item, read_at: item.read_at || new Date().toISOString() }
      : item));
    setNotificationMenuOpen(false);
    navigate(notification.source === 'trade' ? { name: 'trades' } : { name: 'orders' });
  }

  const isActive = (name: string) => route.name === name;
  const unreadNotificationCount = notifications.filter((notification) => !notification.read_at).length;
  const canAccessModeration = profile?.role === 'admin' || profile?.role === 'moderator';
  const moderationLinkLabel = profile?.role === 'admin' ? 'Admin' : 'Moderation';
  const isCourier = profile?.role === 'courier';

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
              {isCourier && (
                <NavLink active={isActive('courier-deliveries')} onClick={() => navigate({ name: 'courier-deliveries' })}>
                  Deliveries
                </NavLink>
              )}
              {canAccessModeration && (
                <NavLink active={isActive('admin')} onClick={() => navigate({ name: 'admin' })}>
                  {moderationLinkLabel}
                </NavLink>
              )}
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
                title="Cart"
              >
                <ShoppingBag className={cn('w-5 h-5', isActive('cart') ? 'text-ink-900' : 'text-ink-700')} />
                {itemCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-terracotta-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-scale-in">
                    {itemCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => navigate({ name: 'orders' })}
                className="p-2 rounded-lg hover:bg-ink-100 transition-colors"
                aria-label="My Orders"
                title="My Orders"
              >
                <Package className={cn('w-5 h-5', isActive('orders') ? 'text-terracotta-600' : 'text-ink-700')} />
              </button>
              <button
                onClick={() => navigate({ name: 'trades' })}
                className="p-2 rounded-lg hover:bg-ink-100 transition-colors"
                aria-label="My Trades"
                title="My Trades"
              >
                <ArrowLeftRight className={cn('w-5 h-5', isActive('trades') ? 'text-terracotta-600' : 'text-ink-700')} />
              </button>
              {user && (
                <>
                  <div className="relative">
                    <button
                      onClick={() => setNotificationMenuOpen((open) => !open)}
                      className="p-2 rounded-lg hover:bg-ink-100 transition-colors relative"
                      aria-label={unreadNotificationCount ? `Notifications, ${unreadNotificationCount} unread` : 'Notifications'}
                      title="Notifications"
                    >
                      <Bell className={cn('w-5 h-5', notificationMenuOpen ? 'text-terracotta-600' : 'text-ink-700')} />
                      {unreadNotificationCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-terracotta-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                          {unreadNotificationCount}
                        </span>
                      )}
                    </button>
                    {notificationMenuOpen && (
                      <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-lg border border-ink-100 py-2">
                        <p className="px-4 py-2 text-sm font-medium text-ink-900 border-b border-ink-100">Notifications</p>
                        {notificationError && (
                          <p role="alert" className="px-4 py-3 text-xs text-terracotta-600">{notificationError}</p>
                        )}
                        {!notificationError && notifications.length === 0 && (
                          <p className="px-4 py-3 text-xs text-ink-500">You’re all caught up.</p>
                        )}
                        {notifications.map((notification) => (
                          <button
                            key={notification.id}
                            onClick={() => void openNotification(notification)}
                            className={cn(
                              'w-full text-left px-4 py-3 hover:bg-ink-50 transition-colors',
                              !notification.read_at && 'bg-terracotta-50/60',
                            )}
                          >
                            <span className="block text-sm font-medium text-ink-900">{notification.title}</span>
                            <span className="block mt-1 text-xs text-ink-500">{notification.body}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => navigate({ name: 'messages' })}
                    className="p-2 rounded-lg hover:bg-ink-100 transition-colors"
                    aria-label="Messages"
                    title="Messages"
                  >
                    <MessageCircle className={cn('w-5 h-5', isActive('messages') ? 'text-terracotta-600' : 'text-ink-700')} />
                  </button>
                </>
              )}

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
                      {isCourier && (
                        <MenuItem icon={<Truck className="w-4 h-4" />} onClick={() => navigate({ name: 'courier-deliveries' })}>
                          Courier Deliveries
                        </MenuItem>
                      )}
                      <MenuItem icon={<MapPin className="w-4 h-4" />} onClick={() => navigate({ name: 'thrift-crawl' })}>
                        Thrift Crawl Planner
                      </MenuItem>
                      <MenuItem icon={<Lock className="w-4 h-4" />} onClick={() => navigate({ name: 'lockers' })}>
                        Locker Network
                      </MenuItem>
                      <MenuItem icon={<Package className="w-4 h-4" />} onClick={() => navigate({ name: 'orders' })}>
                        My Orders
                      </MenuItem>
                      <MenuItem icon={<ArrowLeftRight className="w-4 h-4" />} onClick={() => navigate({ name: 'trades' })}>
                        My Trades
                      </MenuItem>
                      <MenuItem icon={<MessageCircle className="w-4 h-4" />} onClick={() => navigate({ name: 'messages' })}>
                        Messages
                      </MenuItem>
                      <MenuItem icon={<Tag className="w-4 h-4" />} onClick={() => navigate({ name: 'vouchers' })}>
                        Promo Codes
                      </MenuItem>
                      <MenuItem icon={<Heart className="w-4 h-4" />} onClick={() => navigate({ name: 'wishlist' })}>
                        Wishlist
                      </MenuItem>
                      {canAccessModeration && (
                        <MenuItem icon={<ShieldCheck className="w-4 h-4" />} onClick={() => navigate({ name: 'admin' })}>
                          {profile?.role === 'admin' ? 'System Administration' : 'Content Moderation'}
                        </MenuItem>
                      )}
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
              {isCourier && (
                <MobileNavLink onClick={() => navigate({ name: 'courier-deliveries' })} icon={<Truck className="w-4 h-4" />}>
                  Courier Deliveries
                </MobileNavLink>
              )}
              <MobileNavLink onClick={() => navigate({ name: 'orders' })} icon={<Package className="w-4 h-4" />}>
                My Orders
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'trades' })} icon={<ArrowLeftRight className="w-4 h-4" />}>
                My Trades
              </MobileNavLink>
              <MobileNavLink onClick={() => navigate({ name: 'vouchers' })} icon={<Tag className="w-4 h-4" />}>
                Promo Codes
              </MobileNavLink>
              {canAccessModeration && (
                <MobileNavLink onClick={() => navigate({ name: 'admin' })} icon={<ShieldCheck className="w-4 h-4" />}>
                  {profile?.role === 'admin' ? 'System Administration' : 'Content Moderation'}
                </MobileNavLink>
              )}
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
