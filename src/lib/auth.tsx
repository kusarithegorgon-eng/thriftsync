import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, type Profile } from './supabase';

type AuthContextValue = {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  restrictionReason: string | null;
  loading: boolean;
  passwordRecovery: boolean;
  signUp: (email: string, password: string, displayName: string, role: 'buyer' | 'seller') => Promise<{ error: string | null; verificationRequired: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  requestPasswordReset: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (password: string) => Promise<{ error: string | null }>;
  clearPasswordRecovery: () => void;
  verifySignupOtp: (email: string, token: string) => Promise<{ error: string | null }>;
  resendSignupOtp: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [restrictionReason, setRestrictionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  async function fetchProfile(userId: string) {
    const profileResult = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (profileResult.error) {
      console.error('Error fetching profile:', profileResult.error);
      return;
    }
    if (!profileResult.data) return;
    const nextProfile = profileResult.data as Profile;
    setProfile(nextProfile);
    if (!nextProfile.account_status || nextProfile.account_status === 'active') {
      setRestrictionReason(null);
      return;
    }

    const restrictionResult = await supabase
      .from('account_restrictions')
      .select('reason')
      .eq('profile_id', userId)
      .maybeSingle();
    if (restrictionResult.error) {
      console.error('Error fetching account restriction reason:', restrictionResult.error);
      setRestrictionReason(null);
    } else {
      setRestrictionReason(restrictionResult.data?.reason || null);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session?.user) {
        setUser({ id: session.user.id, email: session.user.email || '' });
        fetchProfile(session.user.id);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
        if (session?.user) {
          setUser({ id: session.user.id, email: session.user.email || '' });
          await fetchProfile(session.user.id);
        } else {
          setUser(null);
          setProfile(null);
          setRestrictionReason(null);
        }
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          setRestrictionReason(null);
          setPasswordRecovery(false);
        }
      })();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signUp(email: string, password: string, displayName: string, role: 'buyer' | 'seller') {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: displayName, role },
      },
    });

    if (error) return { error: error.message, verificationRequired: false };

    if (data.session) {
      await supabase.auth.signOut();
      return {
        error: 'Email verification is disabled for this project. Enable Confirm email in Supabase Auth settings, then try again.',
        verificationRequired: false,
      };
    }

    return { error: null, verificationRequired: true };
  }

  async function verifySignupOtp(email: string, token: string) {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
    return { error: error?.message || null };
  }

  async function resendSignupOtp(email: string) {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    return { error: error?.message || null };
  }

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      setUser({ id: data.user.id, email: data.user.email || '' });
      await fetchProfile(data.user.id);
    }
    return { error: null };
  }

  async function requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    return { error: error?.message || null };
  }

  async function updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    return { error: error?.message || null };
  }

  function clearPasswordRecovery() {
    setPasswordRecovery(false);
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setRestrictionReason(null);
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      restrictionReason,
      loading,
      passwordRecovery,
      signUp,
      signIn,
      requestPasswordReset,
      updatePassword,
      clearPasswordRecovery,
      verifySignupOtp,
      resendSignupOtp,
      signOut,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
