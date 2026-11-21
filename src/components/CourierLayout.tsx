import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function CourierLayout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <header className="border-b border-ink-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <span className="font-serif text-lg font-bold text-ink-900">ThriftSync Courier</span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-50 hover:text-ink-900"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
