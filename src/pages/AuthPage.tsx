import { useState } from 'react';
import { Gavel, Mail, Lock, User, Store, ShoppingBag } from 'lucide-react';
import { useRouter } from '@/lib/router';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function AuthPage() {
  const { navigate } = useRouter();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === 'signin') {
      const { error: signInError } = await signIn(email, password);
      if (signInError) setError(signInError);
      else navigate({ name: 'home' });
    } else {
      const { error: signUpError } = await signUp(email, password, displayName, role);
      if (signUpError) setError(signUpError);
      else navigate({ name: 'home' });
    }
    setLoading(false);
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12 animate-fade-in">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-ink-900 mb-4">
            <Gavel className="w-7 h-7 text-cream" strokeWidth={2.2} />
          </div>
          <h1 className="font-serif text-2xl font-bold text-ink-900">
            {mode === 'signin' ? 'Welcome back' : 'Join ThriftSync'}
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            {mode === 'signin' ? 'Sign in to your account to continue' : 'Create an account to start buying and selling'}
          </p>
        </div>

        <div className="card p-6">
          {/* Mode toggle */}
          <div className="flex gap-1 p-1 bg-ink-50 rounded-lg mb-5">
            <button
              onClick={() => setMode('signin')}
              className={cn(
                'flex-1 py-2 rounded-md text-sm font-medium transition-colors',
                mode === 'signin' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              )}
            >
              Sign In
            </button>
            <button
              onClick={() => setMode('signup')}
              className={cn(
                'flex-1 py-2 rounded-md text-sm font-medium transition-colors',
                mode === 'signup' ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
              )}
            >
              Sign Up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="text-xs font-medium text-ink-700 mb-1.5 block">Display Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="input-field pl-10"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-ink-700 mb-1.5 block">I want to</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setRole('buyer')}
                      className={cn(
                        'flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-sm font-medium',
                        role === 'buyer' ? 'border-ink-900 bg-ink-50 text-ink-900' : 'border-ink-200 text-ink-500 hover:border-ink-300'
                      )}
                    >
                      <ShoppingBag className="w-4 h-4" /> Buy
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('seller')}
                      className={cn(
                        'flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-sm font-medium',
                        role === 'seller' ? 'border-ink-900 bg-ink-50 text-ink-900' : 'border-ink-200 text-ink-500 hover:border-ink-300'
                      )}
                    >
                      <Store className="w-4 h-4" /> Sell
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="input-field pl-10"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-ink-700 mb-1.5 block">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field pl-10"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="p-3 bg-terracotta-50 border border-terracotta-200 rounded-lg text-sm text-terracotta-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-3"
            >
              {loading ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-xs text-ink-400 text-center mt-4">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              className="text-ink-900 font-medium hover:text-terracotta-600 transition-colors"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
