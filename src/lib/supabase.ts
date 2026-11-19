import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { AccountType } from '../types';

export interface SupabaseInitState {
  client: SupabaseClient | null;
  configured: boolean;
  serverConfigured: boolean;
  serverDbOk: boolean;
  errorMessage?: string;
}

let cachedInitPromise: Promise<SupabaseInitState> | null = null;
let cachedClient: SupabaseClient | null = null;

function cleanPublicValue(val: unknown): string {
  if (typeof val !== 'string') return '';
  const trimmed = val.trim();
  if (
    !trimmed ||
    trimmed === 'https://your-project-ref.supabase.co' ||
    trimmed === 'MY_SUPABASE_ANON_KEY'
  ) {
    return '';
  }
  return trimmed.replace(/\/+$/, '');
}

export async function getSupabaseInitState(): Promise<SupabaseInitState> {
  if (!cachedInitPromise) {
    cachedInitPromise = (async () => {
      let url = cleanPublicValue(
        typeof __SUPABASE_URL__ !== 'undefined'
          ? __SUPABASE_URL__
          : import.meta.env.VITE_SUPABASE_URL,
      );
      let anonKey = cleanPublicValue(
        typeof __SUPABASE_ANON_KEY__ !== 'undefined'
          ? __SUPABASE_ANON_KEY__
          : import.meta.env.VITE_SUPABASE_ANON_KEY,
      );
      let serverConfigured = false;
      let serverDbOk = false;
      let serverDbError: string | undefined;

      try {
        const res = await fetch('/api/public-config');
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = (await res.json()) as {
            supabaseUrl?: string;
            supabaseAnonKey?: string;
            configured?: boolean;
            serverDbOk?: boolean;
            serverDbError?: string;
          };
          if (data.supabaseUrl) {
            url = cleanPublicValue(data.supabaseUrl) || url;
          }
          if (data.supabaseAnonKey) {
            anonKey = cleanPublicValue(data.supabaseAnonKey) || anonKey;
          }
          serverConfigured = Boolean(data.configured);
          serverDbOk = Boolean(data.serverDbOk);
          serverDbError = data.serverDbError;
        }
      } catch {
        // Fall back to build-time constants if runtime config endpoint fails
      }

      if (!url || !anonKey) {
        return {
          client: null,
          configured: false,
          serverConfigured,
          serverDbOk: false,
          errorMessage:
            'Supabase credentials are missing. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, and VITE_SUPABASE_ANON_KEY in Settings > Secrets.',
        };
      }

      if (!cachedClient) {
        cachedClient = createClient(url, anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
      }

      let dbDiagnostic: string | undefined;
      if (!serverDbOk && serverDbError) {
        if (serverDbError.toLowerCase().includes('invalid api key')) {
          dbDiagnostic =
            'Your SUPABASE_SERVICE_ROLE_KEY secret was rejected by Supabase (Invalid API key). Copy the service_role secret key from Supabase Dashboard → Project Settings → API and update SUPABASE_SERVICE_ROLE_KEY in Settings > Secrets.';
        } else {
          dbDiagnostic = `Supabase database check failed: ${serverDbError}`;
        }
      }

      return {
        client: cachedClient,
        configured: true,
        serverConfigured,
        serverDbOk,
        errorMessage: dbDiagnostic,
      };
    })();
  }
  return cachedInitPromise;
}

export async function getSupabaseClient(): Promise<SupabaseClient> {
  const state = await getSupabaseInitState();
  if (!state.client) {
    throw new Error(
      state.errorMessage || 'Supabase authentication is not configured yet.',
    );
  }
  return state.client;
}

export async function getCurrentSession(): Promise<Session | null> {
  const state = await getSupabaseInitState();
  if (!state.client) return null;
  const { data } = await state.client.auth.getSession();
  const session = data.session;
  if (!session) return null;

  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs > 0 && expiresAtMs <= Date.now() + 30_000) {
    const refreshed = await state.client.auth.refreshSession();
    if (refreshed.error || !refreshed.data.session) {
      await state.client.auth.signOut({ scope: 'local' });
      return null;
    }
    return refreshed.data.session;
  }

  return session;
}

export async function refreshAccessToken(): Promise<string | null> {
  const state = await getSupabaseInitState();
  if (!state.client) return null;
  const { data, error } = await state.client.auth.refreshSession();
  if (error || !data.session?.access_token) {
    return null;
  }
  return data.session.access_token;
}

export async function getAccessToken(): Promise<string | null> {
  const session = await getCurrentSession();
  return session?.access_token || null;
}

export async function signUpWithSupabaseEmail(input: {
  displayName: string;
  email: string;
  password: string;
  accountType: AccountType;
}): Promise<{ session: Session | null; requiresEmailConfirmation: boolean }> {
  const client = await getSupabaseClient();
  const redirectUrl = `${window.location.origin}/`;

  const { data, error } = await client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      emailRedirectTo: redirectUrl,
      data: {
        display_name: input.displayName.trim(),
        account_type: input.accountType,
      },
    },
  });

  if (error) {
    throw new Error(error.message || 'Unable to create account.');
  }

  return {
    session: data.session,
    requiresEmailConfirmation: Boolean(data.user && !data.session),
  };
}

export async function signInWithSupabaseEmail(input: {
  email: string;
  password: string;
}): Promise<Session> {
  const client = await getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password,
  });

  if (error) {
    if (error.message.toLowerCase().includes('email not confirmed')) {
      throw new Error(
        'Please confirm your email address via the link sent to your inbox before signing in.',
      );
    }
    if (error.message.toLowerCase().includes('invalid login credentials')) {
      throw new Error('Incorrect email or password. Please check your credentials and try again.');
    }
    throw new Error(error.message || 'Unable to sign in.');
  }

  if (!data.session) {
    throw new Error('Sign-in did not return an active session. Please try again.');
  }

  return data.session;
}

export async function signOutSupabase(localOnly = false): Promise<void> {
  const state = await getSupabaseInitState();
  if (!state.client) return;
  await state.client.auth.signOut(localOnly ? { scope: 'local' } : undefined);
}
