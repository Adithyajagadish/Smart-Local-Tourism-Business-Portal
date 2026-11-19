import React, { useState } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Compass,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User,
} from 'lucide-react';
import {
  getSupabaseInitState,
  signInWithSupabaseEmail,
  signUpWithSupabaseEmail,
} from '../lib/supabase';
import type { AccountType } from '../types';

interface AuthGateViewProps {
  supabaseConfigured: boolean;
  configError?: string;
  onAuthenticated: (accessToken?: string, preferredRole?: AccountType) => Promise<void>;
}

export const AuthGateView: React.FC<AuthGateViewProps> = ({
  supabaseConfigured,
  configError,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('traveller');
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    if (!supabaseConfigured) {
      const refreshed = await getSupabaseInitState(true).catch(() => null);
      if (!refreshed?.configured) {
        setErrorMsg(
          refreshed?.errorMessage ||
            configError ||
            'Supabase environment variables are missing. Configure your Supabase project URL and public anon key in environment secrets.',
        );
        return;
      }
    }

    const cleanedEmail = email.trim();
    if (!cleanedEmail || !cleanedEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'signup' && displayName.trim().length < 2) {
      setErrorMsg('Please enter your full name (at least 2 characters).');
      return;
    }

    setSubmitting(true);
    try {
      try {
        window.sessionStorage.setItem('tourx_pending_portal_role', accountType);
      } catch {
        // Ignore sessionStorage errors
      }
      if (mode === 'signin') {
        const session = await signInWithSupabaseEmail({ email: cleanedEmail, password });
        await onAuthenticated(session.access_token, accountType);
      } else {
        const result = await signUpWithSupabaseEmail({
          displayName: displayName.trim(),
          email: cleanedEmail,
          password,
          accountType,
        });

        if (result.requiresEmailConfirmation) {
          setInfoMsg(
            `Account created for ${cleanedEmail}. Please verify your email using the link sent to your inbox, then sign in here.`,
          );
          setMode('signin');
          setPassword('');
        } else {
          await onAuthenticated(result.session?.access_token, accountType);
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07141A] text-white flex flex-col lg:flex-row">
      {/* Left Brand Showcase */}
      <div className="lg:w-[46%] xl:w-[48%] p-8 sm:p-12 lg:p-16 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-white/10 bg-gradient-to-br from-[#07141A] via-[#0B222C] to-[#081A22]">
        <div>
          <div className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <Compass className="w-6 h-6 text-teal-400" />
            <span>Tourx</span>
          </div>

          <div className="mt-12 lg:mt-20 max-w-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300 mb-4">
              Members-Only Travel Marketplace
            </p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-tight text-white">
              Authentic homestays, local guides &amp; cultural workshops.
            </h1>
            <p className="mt-5 text-sm sm:text-base text-slate-300 leading-relaxed">
              Sign in with your Tourx account or create a free member profile to browse verified
              stays on the interactive World Map, reserve dates, and talk with Live Voice Concierge.
            </p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-4 pt-8 border-t border-white/10 text-sm text-slate-300">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <span>Real-time date availability with conflict-free booking protection</span>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <span>Direct PhonePe &amp; Google Pay UPI checkout for stays and local guides</span>
          </div>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <span>Dedicated Host Studio to publish listings and track payouts</span>
          </div>
        </div>
      </div>

      {/* Right Authentication Card */}
      <div className="flex-1 bg-slate-50 text-slate-900 flex items-center justify-center p-6 sm:p-10 pb-24 sm:pb-20">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-xl p-6 sm:p-8">
          <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode('signin');
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signin'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                mode === 'signup'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              {mode === 'signin' ? 'Welcome back' : 'Create your Tourx account'}
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              {mode === 'signin'
                ? 'Sign in with the email and password registered on your account.'
                : 'Sign up once to explore, book experiences, or host your property.'}
            </p>
          </div>

          {(!supabaseConfigured || configError) && (
            <div className="mb-5 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {!supabaseConfigured
                    ? 'Supabase secrets not detected yet'
                    : 'Supabase server configuration needs attention'}
                </p>
                <p className="mt-0.5 text-amber-800">
                  {configError ||
                    'Configure your Supabase project URL, public anon key, and server admin key in environment secrets.'}
                </p>
              </div>
            </div>
          )}

          {infoMsg && (
            <div className="mb-5 p-3.5 rounded-xl bg-teal-50 border border-teal-200 text-xs text-teal-900 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span>{infoMsg}</span>
            </div>
          )}

          {errorMsg && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label
                  htmlFor="gate-display-name"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="gate-display-name"
                    type="text"
                    required
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g., Aarav Sharma"
                    className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="gate-email"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="gate-email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={160}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="gate-password"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="gate-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={6}
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signin' ? 'Enter your password' : 'At least 6 characters'}
                  className="w-full pl-10 pr-10 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700 mb-1.5">
                {mode === 'signin' ? 'Sign In Into Portal' : 'Start Using Tourx As'}
              </span>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setAccountType('traveller')}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    accountType === 'traveller'
                      ? 'border-teal-600 bg-teal-50/70 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Compass className="w-4 h-4 text-teal-700 mb-1.5" />
                  <p className="text-xs font-bold text-slate-900">Traveller</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Book stays &amp; guides</p>
                </button>

                <button
                  type="button"
                  onClick={() => setAccountType('host')}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    accountType === 'host'
                      ? 'border-teal-600 bg-teal-50/70 text-slate-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Building2 className="w-4 h-4 text-teal-700 mb-1.5" />
                  <p className="text-xs font-bold text-slate-900">Host &amp; Owner</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">List &amp; earn via UPI</p>
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              {submitting
                ? mode === 'signin'
                  ? 'Signing in...'
                  : 'Creating account...'
                : mode === 'signin'
                  ? 'Sign In to Tourx'
                  : 'Create Account & Continue'}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-500">
            {mode === 'signin' ? (
              <>
                Don&apos;t have an account yet?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setErrorMsg(null);
                  }}
                  className="font-semibold text-teal-700 hover:text-teal-800 underline"
                >
                  Create one now
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setErrorMsg(null);
                  }}
                  className="font-semibold text-teal-700 hover:text-teal-800 underline"
                >
                  Sign in instead
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
};
