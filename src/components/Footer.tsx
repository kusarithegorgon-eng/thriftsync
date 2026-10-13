import { Gavel, Instagram, Twitter, Mail } from 'lucide-react';
import { useRouter } from '@/lib/router';

export function Footer() {
  const { navigate } = useRouter();

  return (
    <footer className="bg-ink-900 text-ink-200 mt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-terracotta-500 flex items-center justify-center">
                <Gavel className="w-4 h-4 text-white" strokeWidth={2.2} />
              </div>
              <span className="font-serif text-lg font-bold text-cream">ThriftSync</span>
            </div>
            <p className="text-sm text-ink-400 leading-relaxed">
              The marketplace for vintage boutiques, one-of-a-kind goods, and collectors who care about provenance.
            </p>
            <div className="flex gap-3 mt-4">
              <a href="#" className="w-9 h-9 rounded-lg bg-ink-800 hover:bg-ink-700 flex items-center justify-center transition-colors">
                <Instagram className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-ink-800 hover:bg-ink-700 flex items-center justify-center transition-colors">
                <Twitter className="w-4 h-4" />
              </a>
              <a href="#" className="w-9 h-9 rounded-lg bg-ink-800 hover:bg-ink-700 flex items-center justify-center transition-colors">
                <Mail className="w-4 h-4" />
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-cream mb-3">Explore</h4>
            <ul className="space-y-2 text-sm">
              <li><button onClick={() => navigate({ name: 'browse' })} className="hover:text-cream transition-colors">Browse All</button></li>
              <li><button onClick={() => navigate({ name: 'browse', category: 'Apparel' })} className="hover:text-cream transition-colors">Apparel</button></li>
              <li><button onClick={() => navigate({ name: 'browse', category: 'Jewelry' })} className="hover:text-cream transition-colors">Jewelry</button></li>
              <li><button onClick={() => navigate({ name: 'browse', category: 'Furniture' })} className="hover:text-cream transition-colors">Furniture</button></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-cream mb-3">Sell</h4>
            <ul className="space-y-2 text-sm">
              <li><button onClick={() => navigate({ name: 'sell' })} className="hover:text-cream transition-colors">Open a Boutique</button></li>
              <li><button onClick={() => navigate({ name: 'dashboard' })} className="hover:text-cream transition-colors">Seller Dashboard</button></li>
              <li><a href="#" className="hover:text-cream transition-colors">Seller Guide</a></li>
              <li><a href="#" className="hover:text-cream transition-colors">Fees & Pricing</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-cream mb-3">Support</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#" className="hover:text-cream transition-colors">Help Center</a></li>
              <li><a href="#" className="hover:text-cream transition-colors">Buyer Protection</a></li>
              <li><a href="#" className="hover:text-cream transition-colors">Authenticity</a></li>
              <li><button onClick={() => navigate({ name: 'contact' })} className="hover:text-cream transition-colors">Contact Us</button></li>
            </ul>
          </div>
        </div>

        <div className="border-t border-ink-800 mt-10 pt-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-xs text-ink-500">© 2026 ThriftSync. All rights reserved.</p>
          <div className="flex gap-6 text-xs text-ink-500">
            <button onClick={() => navigate({ name: 'legal', document: 'privacy' })} className="hover:text-cream transition-colors">Privacy</button>
            <button onClick={() => navigate({ name: 'legal', document: 'terms' })} className="hover:text-cream transition-colors">Terms</button>
            <button onClick={() => navigate({ name: 'legal', document: 'cookies' })} className="hover:text-cream transition-colors">Cookies</button>
            <button onClick={() => window.dispatchEvent(new Event('thriftsync:open-cookie-settings'))} className="hover:text-cream transition-colors">Cookie settings</button>
          </div>
        </div>
      </div>
    </footer>
  );
}
