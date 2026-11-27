import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocket, WebSocketServer } from 'ws';
import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type {
  AccountType,
  AvailabilitySlot,
  Booking,
  BookingStatus,
  Listing,
  ListingPaymentDestination,
  ListingReview,
  PreferredPaymentApp,
  UserPrivateInfo,
  UserProfile,
} from './src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface AuthedRequest extends Request {
  authUser?: User;
  dbClient?: SupabaseClient;
  isAdminClient?: boolean;
}

function cleanEnvValue(value: string | undefined, placeholders: string[] = []): string {
  const trimmed = (value?.trim() || '').replace(/^["']|["']$/g, '').trim();
  if (!trimmed || placeholders.includes(trimmed)) {
    return '';
  }
  return trimmed;
}

const QR_FALLBACK_PATH = path.join(os.tmpdir(), 'tourx-payment-qrs.json');

interface QrFallbackStore {
  hosts: Record<string, string>;
  listings: Record<string, string>;
}

function readQrFallbackStore(): QrFallbackStore {
  try {
    if (!fs.existsSync(QR_FALLBACK_PATH)) {
      return { hosts: {}, listings: {} };
    }
    const raw = fs.readFileSync(QR_FALLBACK_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<QrFallbackStore>;
    return {
      hosts: parsed.hosts && typeof parsed.hosts === 'object' ? parsed.hosts : {},
      listings: parsed.listings && typeof parsed.listings === 'object' ? parsed.listings : {},
    };
  } catch {
    return { hosts: {}, listings: {} };
  }
}

function writeQrFallbackStore(store: QrFallbackStore): void {
  try {
    fs.writeFileSync(QR_FALLBACK_PATH, JSON.stringify(store), 'utf8');
  } catch {
    // Ignore ephemeral filesystem errors
  }
}

function getHostQrFallback(uid: string): string {
  return readQrFallbackStore().hosts[uid] || '';
}

function setHostQrFallback(uid: string, qrUrl: string): void {
  const store = readQrFallbackStore();
  if (qrUrl) {
    store.hosts[uid] = qrUrl;
  } else {
    delete store.hosts[uid];
  }
  writeQrFallbackStore(store);
}

function getListingQrFallback(listingId: string): string {
  return readQrFallbackStore().listings[listingId] || '';
}

function setListingQrFallback(listingId: string, qrUrl: string): void {
  const store = readQrFallbackStore();
  if (qrUrl) {
    store.listings[listingId] = qrUrl;
  } else {
    delete store.listings[listingId];
  }
  writeQrFallbackStore(store);
}

function cleanQrDataUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return trimmed.slice(0, 360000);
  }
  return '';
}

function isMissingPaymentQrColumnError(msg: string | undefined): boolean {
  const lower = (msg || '').toLowerCase();
  return lower.includes('payment_qr_url') && (lower.includes('column') || lower.includes('schema cache'));
}

function isMissingReviewsTableError(msg: string | undefined): boolean {
  const lower = (msg || '').toLowerCase();
  return (
    lower.includes('listing_reviews') &&
    (lower.includes('does not exist') ||
      lower.includes('schema cache') ||
      lower.includes('could not find the table') ||
      lower.includes('relation'))
  );
}

function resolveSupabaseConfig() {
  const rawUrl = cleanEnvValue(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    ['https://your-project-ref.supabase.co'],
  );
  const url = rawUrl.replace(/\/+$/, '');
  const serviceRoleKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY, [
    'MY_SUPABASE_SERVICE_ROLE_KEY',
  ]);
  const anonKey = cleanEnvValue(
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
    ['MY_SUPABASE_ANON_KEY'],
  );
  return { url, serviceRoleKey, anonKey };
}

function createSupabaseAdmin(): SupabaseClient | null {
  const { url, serviceRoleKey } = resolveSupabaseConfig();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createUserSupabaseClient(accessToken: string): SupabaseClient | null {
  const { url, anonKey } = resolveSupabaseConfig();
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

let cachedAdminHealthy: boolean | null = null;
let cachedAdminCheckedAt = 0;

async function isAdminClientHealthy(admin: SupabaseClient | null): Promise<boolean> {
  if (!admin) return false;
  const now = Date.now();
  if (cachedAdminHealthy !== null && now - cachedAdminCheckedAt < 30000) {
    return cachedAdminHealthy;
  }
  const { error } = await admin.from('user_profiles').select('uid').limit(1);
  if (error && error.message.toLowerCase().includes('invalid api key')) {
    cachedAdminHealthy = false;
  } else {
    cachedAdminHealthy = true;
  }
  cachedAdminCheckedAt = now;
  return cachedAdminHealthy;
}

function clampString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function isStrictUpiPattern(val: string): boolean {
  const cleaned = val.trim();
  return /^[^\s@]+@[^\s@]+$/.test(cleaned) && cleaned.length >= 3 && cleaned.length <= 80;
}

function resolveGeminiApiKey(): string | null {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.API_KEY,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed !== 'MY_GEMINI_API_KEY') {
      return trimmed;
    }
  }
  return null;
}

function createStandardAiClient(): GoogleGenAI {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the deployed server. Add GEMINI_API_KEY in your deployment environment variables / Settings > Secrets and redeploy.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function createLiveAiClient(): GoogleGenAI {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the deployed server. Add GEMINI_API_KEY in your deployment environment variables / Settings > Secrets and redeploy.',
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildVoiceSystemInstruction(destination?: string, listing?: string): string {
  const contextLines: string[] = [
    'You are Tourx Voice Concierge, a warm, concise, real-time local travel & cultural assistant for Tourx.',
    'Help travellers discover homestays, local guides, cultural workshops, destination tips, packing advice, and explain how to book dates and pay securely via PhonePe or Google Pay UPI.',
    'Also help hosts understand how to set their receiving mobile number, UPI ID, or payment QR code, upload listings, and manage availability calendars.',
    'Keep spoken responses natural, conversational, plain text without markdown formatting, and concise (2-4 sentences per turn unless asked for more detail).',
  ];
  if (destination?.trim()) {
    contextLines.push(`The user is currently viewing destination: ${destination.trim()}.`);
  }
  if (listing?.trim()) {
    contextLines.push(`The user is currently inspecting listing: ${listing.trim()}.`);
  }
  return contextLines.join(' ');
}

function extractLiveErrorMessage(error: unknown, fallback: string): string {
  let rawMessage = fallback;
  if (error instanceof Error) {
    rawMessage = error.message;
  } else if (typeof error === 'object' && error !== null) {
    const errObj = error as { message?: unknown; error?: unknown };
    if (errObj.error instanceof Error) {
      rawMessage = errObj.error.message;
    } else if (typeof errObj.message === 'string' && errObj.message.trim()) {
      rawMessage = errObj.message;
    }
  }
  try {
    const parsed = JSON.parse(rawMessage) as {
      error?: { code?: number; message?: string; status?: string };
    };
    if (parsed?.error?.message) {
      if (parsed.error.code === 429 || parsed.error.status === 'RESOURCE_EXHAUSTED') {
        return 'Gemini API quota exceeded for the current key. Please wait a moment or switch to a billing-enabled key in Settings > Secrets.';
      }
      return parsed.error.message;
    }
  } catch {
    // Non-JSON error message
  }
  return rawMessage;
}

function expandRange(startIso: string, endIso: string): string[] {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const start = new Date(sy, (sm || 1) - 1, sd || 1);
  const end = new Date(ey, (em || 1) - 1, ed || 1);
  const nights = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
  const out: string[] = [];
  for (let i = 0; i < nights; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function mapUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    uid: String(row.uid),
    displayName: String(row.display_name || 'Tourx Member'),
    accountType: row.account_type === 'host' ? 'host' : 'traveller',
    avatarUrl: String(row.avatar_url || ''),
    bio: String(row.bio || ''),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapUserPrivateInfo(row: Record<string, unknown>): UserPrivateInfo {
  const app = row.preferred_payment_app;
  const uid = String(row.uid || '');
  const qrFromRow = typeof row.payment_qr_url === 'string' ? row.payment_qr_url : '';
  return {
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    payoutUpiId: String(row.payout_upi_id || ''),
    payeeName: String(row.payee_name || ''),
    preferredPaymentApp: app === 'phonepe' || app === 'gpay' ? app : 'both',
    paymentQrUrl: qrFromRow || (uid ? getHostQrFallback(uid) : ''),
    updatedAt: row.updated_at,
  };
}

function mapListing(row: Record<string, unknown>): Listing {
  return {
    id: String(row.id),
    hostId: String(row.host_id),
    hostName: String(row.host_name || 'Tourx Host'),
    category: (row.category as Listing['category']) || 'homestay',
    title: String(row.title || ''),
    description: String(row.description || ''),
    locationName: String(row.location_name || ''),
    country: String(row.country || ''),
    lat: Number(row.lat ?? 0),
    lng: Number(row.lng ?? 0),
    pricePerUnitInr: Number(row.price_per_unit_inr ?? 100),
    unitLabel: (row.unit_label as Listing['unitLabel']) || 'night',
    maxGuests: Number(row.max_guests ?? 1),
    amenities: Array.isArray(row.amenities) ? row.amenities.map(String) : [],
    photos: Array.isArray(row.photos) ? row.photos.map(String) : [],
    blockedDates: Array.isArray(row.blocked_dates) ? row.blocked_dates.map(String) : [],
    isPublished: Boolean(row.is_published),
    rating: Number(row.rating ?? 5.0),
    reviewCount: Number(row.review_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapListingPaymentDestination(row: Record<string, unknown>): ListingPaymentDestination {
  const app = row.preferred_app;
  const listingId = String(row.listing_id);
  const hostId = String(row.host_id);
  const qrFromRow = typeof row.payment_qr_url === 'string' ? row.payment_qr_url : '';
  return {
    listingId,
    hostId,
    payeeName: String(row.payee_name || 'Tourx Host'),
    paymentPhone: String(row.payment_phone || ''),
    upiId: String(row.upi_id || ''),
    preferredApp: app === 'phonepe' || app === 'gpay' ? app : 'both',
    paymentQrUrl: qrFromRow || getListingQrFallback(listingId) || getHostQrFallback(hostId),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBooking(row: Record<string, unknown>): Booking {
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    listingTitle: String(row.listing_title),
    listingLocation: String(row.listing_location),
    listingCategory: (row.listing_category as Booking['listingCategory']) || 'homestay',
    listingPhoto: String(row.listing_photo || ''),
    hostId: String(row.host_id),
    hostName: String(row.host_name),
    hostPayeeName: String(row.host_payee_name),
    hostPaymentPhone: String(row.host_payment_phone || ''),
    hostUpiId: String(row.host_upi_id),
    travellerId: String(row.traveller_id),
    travellerName: String(row.traveller_name),
    checkInDate: String(row.check_in_date),
    checkOutDate: String(row.check_out_date),
    nightsOrUnits: Number(row.nights_or_units ?? 1),
    guests: Number(row.guests ?? 1),
    subtotalInr: Number(row.subtotal_inr ?? 0),
    serviceFeeInr: Number(row.service_fee_inr ?? 0),
    totalAmountInr: Number(row.total_amount_inr ?? 0),
    hostNetPayoutInr: Number(row.host_net_payout_inr ?? 0),
    displayCurrency: (row.display_currency as Booking['displayCurrency']) || 'INR',
    paymentMethod: (row.payment_method as Booking['paymentMethod']) || 'phonepe',
    paymentMode: (row.payment_mode as Booking['paymentMode']) || 'simulated',
    upiHandle: String(row.upi_handle || ''),
    transactionRef: String(row.transaction_ref || ''),
    paymentStatus: 'paid',
    bookingStatus: (row.booking_status as BookingStatus) || 'confirmed',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAvailabilitySlot(row: Record<string, unknown>): AvailabilitySlot {
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    hostId: String(row.host_id),
    travellerId: String(row.traveller_id),
    checkInDate: String(row.check_in_date),
    checkOutDate: String(row.check_out_date),
    status: row.status === 'cancelled' ? 'cancelled' : 'active',
  };
}

function mapListingReview(row: Record<string, unknown>): ListingReview {
  return {
    id: String(row.id),
    listingId: String(row.listing_id),
    bookingId: row.booking_id ? String(row.booking_id) : '',
    hostId: String(row.host_id),
    travellerId: String(row.traveller_id),
    travellerName: String(row.traveller_name || 'Tourx Traveller'),
    rating: Math.max(1, Math.min(5, Math.round(Number(row.rating ?? 5)))),
    comment: String(row.comment || ''),
    verifiedStay: Boolean(row.verified_stay),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureUserProfile(
  db: SupabaseClient,
  authUser: User,
  isAdminClient = true,
): Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }> {
  const meta = (authUser.user_metadata || {}) as {
    display_name?: string;
    full_name?: string;
    name?: string;
    account_type?: string;
    avatar_url?: string;
  };
  const fallbackName =
    clampString(meta.display_name || meta.full_name || meta.name, 80) ||
    authUser.email?.split('@')[0] ||
    'Tourx Member';
  const fallbackRole: AccountType = meta.account_type === 'host' ? 'host' : 'traveller';

  const { data: existingProfile, error: profileErr } = await db
    .from('user_profiles')
    .select('*')
    .eq('uid', authUser.id)
    .maybeSingle();

  if (profileErr) {
    if (!isAdminClient) {
      return {
        profile: {
          uid: authUser.id,
          displayName: fallbackName,
          accountType: fallbackRole,
          avatarUrl: clampString(meta.avatar_url, 500),
          bio: '',
        },
        privateInfo: {
          email: authUser.email || '',
          phone: '',
          payoutUpiId: '',
          payeeName: fallbackName,
          preferredPaymentApp: 'both',
          paymentQrUrl: getHostQrFallback(authUser.id),
        },
      };
    }
    throw new Error(`Failed to fetch user profile: ${profileErr.message}`);
  }

  let profileRow = existingProfile as Record<string, unknown> | null;
  if (!profileRow) {
    const { data: inserted, error: insertErr } = await db
      .from('user_profiles')
      .upsert(
        {
          uid: authUser.id,
          display_name: fallbackName,
          account_type: fallbackRole,
          avatar_url: clampString(meta.avatar_url, 500),
          bio: '',
        },
        { onConflict: 'uid' },
      )
      .select('*')
      .single();

    if (insertErr || !inserted) {
      if (!isAdminClient) {
        profileRow = {
          uid: authUser.id,
          display_name: fallbackName,
          account_type: fallbackRole,
          avatar_url: clampString(meta.avatar_url, 500),
          bio: '',
        };
      } else {
        throw new Error(`Failed to create user profile: ${insertErr?.message || 'Unknown error'}`);
      }
    } else {
      profileRow = inserted as Record<string, unknown>;
    }
  }

  const { data: existingPrivate, error: privateErr } = await db
    .from('user_private_info')
    .select('*')
    .eq('uid', authUser.id)
    .maybeSingle();

  if (privateErr && isAdminClient) {
    throw new Error(`Failed to fetch private info: ${privateErr.message}`);
  }

  let privateRow = existingPrivate as Record<string, unknown> | null;
  if (!privateRow) {
    const { data: insertedPriv, error: insertPrivErr } = await db
      .from('user_private_info')
      .upsert(
        {
          uid: authUser.id,
          email: authUser.email || '',
          phone: '',
          payout_upi_id: '',
          payee_name: String(profileRow.display_name || fallbackName),
          preferred_payment_app: 'both',
        },
        { onConflict: 'uid' },
      )
      .select('*')
      .single();

    if (insertPrivErr || !insertedPriv) {
      if (!isAdminClient) {
        privateRow = {
          uid: authUser.id,
          email: authUser.email || '',
          phone: '',
          payout_upi_id: '',
          payee_name: String(profileRow.display_name || fallbackName),
          preferred_payment_app: 'both',
        };
      } else {
        throw new Error(
          `Failed to create private info: ${insertPrivErr?.message || 'Unknown error'}`,
        );
      }
    } else {
      privateRow = insertedPriv as Record<string, unknown>;
    }
  }

  return {
    profile: mapUserProfile(profileRow),
    privateInfo: mapUserPrivateInfo(privateRow),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  const requireSupabaseAuth = async (
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { url, anonKey } = resolveSupabaseConfig();
    if (!url || !anonKey) {
      res.status(503).json({
        error:
          'Supabase backend is not configured. Add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, and VITE_SUPABASE_ANON_KEY in Settings > Secrets.',
      });
      return;
    }

    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required. Please sign in.' });
      return;
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Missing Supabase session token.' });
      return;
    }

    try {
      const supabaseAdmin = createSupabaseAdmin();
      const adminHealthy = await isAdminClientHealthy(supabaseAdmin);

      let data: { user: User | null } = { user: null };
      let error: { message?: string } | null = null;

      if (adminHealthy && supabaseAdmin) {
        const resAdmin = await supabaseAdmin.auth.getUser(token);
        data = resAdmin.data;
        error = resAdmin.error;
      }

      if (error || !data?.user) {
        const anonClient = createClient(url, anonKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const fallback = await anonClient.auth.getUser(token);
        if (!fallback.error && fallback.data?.user) {
          data = fallback.data;
          error = null;
        } else if (fallback.error) {
          error = fallback.error;
        }
      }

      if (error || !data?.user) {
        const rawMsg = error?.message || 'Unknown auth verification error';
        console.warn('[Auth] Token verification rejected:', rawMsg);
        if (rawMsg.toLowerCase().includes('api key')) {
          res.status(500).json({
            error:
              'Supabase API key rejected by Auth service. Please verify SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and VITE_SUPABASE_ANON_KEY in Settings > Secrets.',
          });
          return;
        }
        res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
        return;
      }

      const dbClient =
        adminHealthy && supabaseAdmin ? supabaseAdmin : createUserSupabaseClient(token);
      if (!dbClient) {
        res.status(503).json({ error: 'Unable to initialize Supabase client.' });
        return;
      }

      req.authUser = data.user;
      req.dbClient = dbClient;
      req.isAdminClient = adminHealthy;
      next();
    } catch (err) {
      console.warn('[Auth] Token verification failed:', err instanceof Error ? err.message : err);
      res.status(401).json({ error: 'Unable to verify authentication session.' });
    }
  };

  app.get('/api/health', async (_req, res) => {
    const { url, serviceRoleKey, anonKey } = resolveSupabaseConfig();
    const supabaseReady = Boolean(url && serviceRoleKey && anonKey);
    let dbCheck: { ok: boolean; error?: string } = { ok: false };
    const admin = createSupabaseAdmin();
    if (admin) {
      const { error } = await admin.from('user_profiles').select('uid').limit(1);
      dbCheck = error ? { ok: false, error: error.message } : { ok: true };
    }
    res.json({
      ok: true,
      liveVoiceConfigured: Boolean(resolveGeminiApiKey()),
      supabaseConfigured: supabaseReady,
      supabaseDbOk: dbCheck.ok,
      supabaseDbError: dbCheck.error,
      storage: supabaseReady ? 'supabase' : 'unconfigured',
    });
  });

  app.get('/api/public-config', async (_req, res) => {
    const { url, anonKey } = resolveSupabaseConfig();
    let serverDbError: string | undefined;
    let serverDbOk = false;

    const admin = createSupabaseAdmin();
    if (admin) {
      const { error } = await admin.from('user_profiles').select('uid').limit(1);
      if (!error) {
        serverDbOk = true;
      } else {
        serverDbError = error.message;
      }
    }

    if (!serverDbOk && url && anonKey) {
      const anonClient = createClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await anonClient.from('user_profiles').select('uid').limit(1);
      if (!error) {
        serverDbOk = true;
        serverDbError = undefined;
      } else if (!serverDbError) {
        serverDbError = error.message;
      }
    }

    res.json({
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      configured: Boolean(url && anonKey),
      serverDbOk,
      serverDbError,
    });
  });

  app.get('/api/live/status', (_req, res) => {
    const configured = Boolean(resolveGeminiApiKey());
    res.json({
      ok: true,
      liveVoiceConfigured: configured,
      fallbackSupported: true,
      message: configured
        ? 'Live Voice server is configured.'
        : 'GEMINI_API_KEY is missing in the server environment variables.',
    });
  });

  app.post('/api/live/turn', async (req, res) => {
    try {
      const { text, audioBase64, audioMimeType, history, destination, listing } = (req.body ||
        {}) as {
        text?: string;
        audioBase64?: string;
        audioMimeType?: string;
        history?: Array<{ role?: string; text?: string }>;
        destination?: string;
        listing?: string;
      };

      const ai = createStandardAiClient();
      let userText = typeof text === 'string' ? text.trim().slice(0, 2000) : '';

      if (!userText && typeof audioBase64 === 'string' && audioBase64.trim().length > 0) {
        const rawMime = typeof audioMimeType === 'string' ? audioMimeType : 'audio/webm';
        const cleanMime = rawMime.split(';')[0]?.trim() || 'audio/webm';
        const transcribeRes = await ai.models.generateContent({
          model: 'gemini-3.5-transcribe',
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: cleanMime,
                  data: audioBase64.trim(),
                },
              },
              {
                text: 'Transcribe this spoken user request accurately into plain text. Return only the transcription, or an empty string if silent.',
              },
            ],
          },
        });
        userText = (transcribeRes.text || '').trim().slice(0, 2000);
      }

      if (!userText) {
        res.json({
          userText: '',
          replyText:
            "I didn't catch any speech in that clip. Please speak closer to your mic or type a question below.",
          audioBase64Wav: null,
        });
        return;
      }

      const systemInstruction = buildVoiceSystemInstruction(destination, listing);
      const historyContents = Array.isArray(history)
        ? history
            .slice(-8)
            .filter(
              (item): item is { role?: string; text: string } =>
                Boolean(item && typeof item.text === 'string' && item.text.trim().length > 0),
            )
            .map((item) => ({
              role: item.role === 'assistant' ? ('model' as const) : ('user' as const),
              parts: [{ text: item.text.trim().slice(0, 1500) }],
            }))
        : [];

      const textModels = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite'];
      let replyRes: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
      let lastTextErr: unknown = null;
      for (let attempt = 0; attempt < textModels.length; attempt += 1) {
        try {
          replyRes = await ai.models.generateContent({
            model: textModels[attempt],
            contents: [
              ...historyContents,
              { role: 'user', parts: [{ text: userText }] },
            ],
            config: {
              systemInstruction,
            },
          });
          break;
        } catch (err) {
          lastTextErr = err;
          if (attempt < textModels.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 600));
          }
        }
      }
      if (!replyRes) {
        throw lastTextErr instanceof Error
          ? lastTextErr
          : new Error('Voice assistant model is temporarily busy.');
      }

      const replyText =
        (replyRes.text || '').trim() ||
        'I can help you explore Tourx homestays, local guides, or PhonePe and Google Pay bookings. What would you like to know?';

      let audioBase64Wav: string | null = null;
      let ttsFallbackReason: string | null = null;
      try {
        const ttsAi = createLiveAiClient();
        const ttsRes = await ttsAi.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [{ text: replyText }],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
          },
        });
        const parts = ttsRes.candidates?.[0]?.content?.parts ?? [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            audioBase64Wav = part.inlineData.data;
            break;
          }
        }
      } catch (ttsErr) {
        ttsFallbackReason = extractLiveErrorMessage(ttsErr, 'TTS unavailable');
        console.warn('[Voice Turn] TTS synthesis fallback to text/browser speech:', ttsFallbackReason);
      }

      res.json({
        userText,
        replyText,
        audioBase64Wav,
        ttsFallbackReason,
      });
    } catch (err) {
      const msg = extractLiveErrorMessage(err, 'Voice assistant request failed.');
      console.error('[Voice Turn] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // --- Authenticated Profile & Role Routes (Supabase) ---
  app.get('/api/auth/me', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    try {
      const data = await ensureUserProfile(req.dbClient, req.authUser, Boolean(req.isAdminClient));
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Auth] Failed loading profile:', msg);
      res.status(500).json({ error: 'Failed to load member profile from Supabase.' });
    }
  });

  app.patch('/api/auth/role', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    const { accountType } = req.body as { accountType?: AccountType };
    const nextRole: AccountType = accountType === 'host' ? 'host' : 'traveller';

    const meta = (req.authUser.user_metadata || {}) as {
      display_name?: string;
      full_name?: string;
      name?: string;
      avatar_url?: string;
    };
    const fallbackName =
      clampString(meta.display_name || meta.full_name || meta.name, 80) ||
      req.authUser.email?.split('@')[0] ||
      'Tourx Member';

    try {
      const ensured = await ensureUserProfile(
        req.dbClient,
        req.authUser,
        Boolean(req.isAdminClient),
      );
      const { data: updatedRow, error } = await req.dbClient
        .from('user_profiles')
        .upsert(
          {
            uid: req.authUser.id,
            display_name: ensured.profile.displayName || fallbackName,
            account_type: nextRole,
            avatar_url: ensured.profile.avatarUrl || clampString(meta.avatar_url, 500),
            bio: ensured.profile.bio || '',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'uid' },
        )
        .select('*')
        .maybeSingle();

      if (error && req.isAdminClient) {
        throw new Error(error.message);
      }
      if (error) {
        console.warn('[Auth] Role DB update limited by RLS; using fallback state:', error.message);
      }

      const { data: privateRow } = await req.dbClient
        .from('user_private_info')
        .select('*')
        .eq('uid', req.authUser.id)
        .maybeSingle();

      const rolePersistedInDb = Boolean(!error && updatedRow);

      res.json({
        profile:
          updatedRow && !error
            ? mapUserProfile(updatedRow as Record<string, unknown>)
            : {
                ...ensured.profile,
                accountType: nextRole,
              },
        privateInfo: privateRow
          ? mapUserPrivateInfo(privateRow as Record<string, unknown>)
          : ensured.privateInfo,
        rolePersistedInDb,
      });
    } catch (err) {
      console.warn('[Auth] Failed switching role:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Unable to switch portal role.' });
    }
  });

  app.get('/api/users/:uid/private', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    if (req.params.uid !== req.authUser.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    try {
      const { data, error } = await req.dbClient
        .from('user_private_info')
        .select('*')
        .eq('uid', req.authUser.id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      res.json(data ? mapUserPrivateInfo(data as Record<string, unknown>) : null);
    } catch (err) {
      console.warn('[Users] Failed reading private info:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to load payout settings.' });
    }
  });

  app.put('/api/users/:uid/private', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    if (req.params.uid !== req.authUser.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const body = req.body as {
      email?: string;
      phone?: string;
      payoutUpiId?: string;
      payeeName?: string;
      preferredPaymentApp?: PreferredPaymentApp;
      paymentQrUrl?: string;
      syncExistingListings?: boolean;
    };

    try {
      const { privateInfo } = await ensureUserProfile(
        req.dbClient,
        req.authUser,
        Boolean(req.isAdminClient),
      );

      const cleanedPhone = clampString(body.phone, 32);
      const cleanedUpi = clampString(body.payoutUpiId, 80);
      const cleanedPayeeName = clampString(body.payeeName, 80) || 'Tourx Host';
      const cleanedEmail =
        clampString(body.email || privateInfo.email || req.authUser.email, 160) ||
        'host@tourx.app';
      const preferredApp: PreferredPaymentApp =
        body.preferredPaymentApp === 'phonepe' || body.preferredPaymentApp === 'gpay'
          ? body.preferredPaymentApp
          : 'both';
      const cleanedQrUrl =
        typeof body.paymentQrUrl === 'string'
          ? cleanQrDataUrl(body.paymentQrUrl)
          : (privateInfo.paymentQrUrl || '');
      const now = new Date().toISOString();

      setHostQrFallback(req.authUser.id, cleanedQrUrl);

      const basePayload = {
        uid: req.authUser.id,
        email: cleanedEmail,
        phone: cleanedPhone,
        payout_upi_id: cleanedUpi,
        payee_name: cleanedPayeeName,
        preferred_payment_app: preferredApp,
        updated_at: now,
      };

      let { data: updatedRow, error } = await req.dbClient
        .from('user_private_info')
        .upsert({ ...basePayload, payment_qr_url: cleanedQrUrl }, { onConflict: 'uid' })
        .select('*')
        .single();

      if (error && isMissingPaymentQrColumnError(error.message)) {
        const retry = await req.dbClient
          .from('user_private_info')
          .upsert(basePayload, { onConflict: 'uid' })
          .select('*')
          .single();
        updatedRow = retry.data;
        error = retry.error;
      }

      if (error || !updatedRow) {
        throw new Error(error?.message || 'Payout settings save failed.');
      }

      if (
        body.syncExistingListings &&
        ((cleanedPhone.length >= 7 && isStrictUpiPattern(cleanedUpi)) ||
          isStrictUpiPattern(cleanedUpi) ||
          Boolean(cleanedQrUrl))
      ) {
        const { data: hostListings } = await req.dbClient
          .from('listings')
          .select('id')
          .eq('host_id', req.authUser.id);

        if (hostListings && hostListings.length > 0) {
          for (const l of hostListings) {
            setListingQrFallback(String((l as { id: string }).id), cleanedQrUrl);
          }

          const baseRows = hostListings.map((l) => ({
            listing_id: String((l as { id: string }).id),
            host_id: req.authUser!.id,
            payee_name: cleanedPayeeName,
            payment_phone: cleanedPhone,
            upi_id: cleanedUpi,
            preferred_app: preferredApp,
            updated_at: now,
          }));
          let { error: destSyncErr } = await req.dbClient
            .from('listing_payment_destinations')
            .upsert(
              baseRows.map((r) => ({ ...r, payment_qr_url: cleanedQrUrl })),
              { onConflict: 'listing_id' },
            );

          if (destSyncErr && isMissingPaymentQrColumnError(destSyncErr.message)) {
            const retrySync = await req.dbClient
              .from('listing_payment_destinations')
              .upsert(baseRows, { onConflict: 'listing_id' });
            destSyncErr = retrySync.error;
          }

          if (destSyncErr) {
            console.warn('[Users] Skipping payment destination sync:', destSyncErr.message);
          }
        }
      }

      const mapped = mapUserPrivateInfo(updatedRow as Record<string, unknown>);
      res.json({
        ...mapped,
        paymentQrUrl: cleanedQrUrl || mapped.paymentQrUrl || '',
      });
    } catch (err) {
      console.warn('[Users] Failed saving payout settings:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to save payout settings.' });
    }
  });

  // --- Listings & Payment Destinations (Authenticated Only) ---
  app.get('/api/listings', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient) return;

    try {
      const { data, error } = await req.dbClient
        .from('listings')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      res.json((data || []).map((r) => mapListing(r as Record<string, unknown>)));
    } catch (err) {
      console.warn('[Listings] Fetch error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to load marketplace listings.' });
    }
  });

  app.get('/api/hosts/:hostId/listings', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    if (req.params.hostId !== req.authUser.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    try {
      const { data, error } = await req.dbClient
        .from('listings')
        .select('*')
        .eq('host_id', req.authUser.id)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      res.json((data || []).map((r) => mapListing(r as Record<string, unknown>)));
    } catch (err) {
      console.warn('[Listings] Host listings fetch error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to load host listings.' });
    }
  });

  app.get(
    '/api/listings/:listingId/payment-destination',
    requireSupabaseAuth,
    async (req: AuthedRequest, res) => {
      if (!req.dbClient) return;

      try {
        const { data, error } = await req.dbClient
          .from('listing_payment_destinations')
          .select('*')
          .eq('listing_id', req.params.listingId)
          .maybeSingle();

        if (error && req.isAdminClient) {
          throw new Error(error.message);
        }

        if (data && !error) {
          res.json(mapListingPaymentDestination(data as Record<string, unknown>));
          return;
        }

        // Fall back to the listing's QR store or the host's configured payout UPI/QR
        const { data: listingRow } = await req.dbClient
          .from('listings')
          .select('host_id, host_name')
          .eq('id', req.params.listingId)
          .maybeSingle();

        const hostId = listingRow ? String((listingRow as { host_id: string }).host_id) : '';
        const hostName = listingRow ? String((listingRow as { host_name?: string }).host_name || 'Tourx Host') : 'Tourx Host';
        const fallbackQr =
          getListingQrFallback(req.params.listingId) || (hostId ? getHostQrFallback(hostId) : '');

        if (hostId && (req.isAdminClient || hostId === req.authUser?.id)) {
          const { data: privateRow } = await req.dbClient
            .from('user_private_info')
            .select('*')
            .eq('uid', hostId)
            .maybeSingle();

          const payoutUpi = privateRow
            ? String((privateRow as { payout_upi_id?: string }).payout_upi_id || '')
            : '';
          const rowQr =
            privateRow && typeof (privateRow as { payment_qr_url?: unknown }).payment_qr_url === 'string'
              ? String((privateRow as { payment_qr_url: string }).payment_qr_url)
              : '';
          const resolvedQr = rowQr || fallbackQr;

          if (privateRow && (isStrictUpiPattern(payoutUpi) || resolvedQr)) {
            res.json({
              listingId: req.params.listingId,
              hostId,
              payeeName: String((privateRow as { payee_name?: string }).payee_name || hostName),
              paymentPhone: String((privateRow as { phone?: string }).phone || ''),
              upiId: payoutUpi,
              preferredApp:
                ((privateRow as { preferred_payment_app?: PreferredPaymentApp })
                  .preferred_payment_app || 'both'),
              paymentQrUrl: resolvedQr,
            });
            return;
          }
        }

        if (fallbackQr && hostId) {
          res.json({
            listingId: req.params.listingId,
            hostId,
            payeeName: hostName,
            paymentPhone: '',
            upiId: '',
            preferredApp: 'both',
            paymentQrUrl: fallbackQr,
          });
          return;
        }

        res.json(null);
      } catch (err) {
        console.warn('[Listings] Payment destination error:', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'Failed to fetch host payment destination.' });
      }
    },
  );

  app.post('/api/listings', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    const { hostName, input } = req.body as {
      hostId?: string;
      hostName?: string;
      input?: {
        category: Listing['category'];
        title: string;
        description: string;
        locationName: string;
        country: string;
        lat: number;
        lng: number;
        pricePerUnitInr: number;
        unitLabel: Listing['unitLabel'];
        maxGuests: number;
        amenities: string[];
        photos: string[];
        blockedDates: string[];
        isPublished: boolean;
        paymentDestination?: {
          payeeName: string;
          paymentPhone: string;
          upiId: string;
          preferredApp: PreferredPaymentApp;
          paymentQrUrl?: string;
        };
      };
    };

    if (!input) {
      res.status(400).json({ error: 'Missing listing payload.' });
      return;
    }

    const title = clampString(input.title, 120);
    const description = clampString(input.description, 1500);
    const locationName = clampString(input.locationName, 120);
    const country = clampString(input.country, 80);

    if (title.length < 3 || description.length < 10 || locationName.length < 2 || country.length < 2) {
      res.status(400).json({ error: 'Please complete all required listing text fields.' });
      return;
    }
    if (!Array.isArray(input.photos) || input.photos.length === 0) {
      res.status(400).json({ error: 'Please upload at least 1 listing photo.' });
      return;
    }

    try {
      let profileDisplayName = '';
      try {
        const { profile } = await ensureUserProfile(
          req.dbClient,
          req.authUser,
          Boolean(req.isAdminClient),
        );
        profileDisplayName = profile.displayName;
      } catch (profileLoadErr) {
        if (req.isAdminClient) {
          throw profileLoadErr;
        }
        profileDisplayName = req.authUser.email?.split('@')[0] || 'Tourx Host';
      }

      const listingId = `lst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const cleanedHostName = clampString(hostName || profileDisplayName, 80) || 'Tourx Host';
      const safeLat = Number.isFinite(Number(input.lat))
        ? Math.max(-90, Math.min(90, Number(input.lat)))
        : 15.2993;
      const safeLng = Number.isFinite(Number(input.lng))
        ? Math.max(-180, Math.min(180, Number(input.lng)))
        : 74.124;
      const safePrice = Number.isFinite(Number(input.pricePerUnitInr))
        ? Math.max(100, Math.min(500000, Math.round(Number(input.pricePerUnitInr))))
        : 1000;
      const safeGuests = Number.isFinite(Number(input.maxGuests))
        ? Math.max(1, Math.min(30, Math.round(Number(input.maxGuests))))
        : 2;

      const { data: createdRow, error } = await req.dbClient
        .from('listings')
        .insert({
          id: listingId,
          host_id: req.authUser.id,
          host_name: cleanedHostName,
          category: input.category,
          title,
          description,
          location_name: locationName,
          country,
          lat: safeLat,
          lng: safeLng,
          price_per_unit_inr: safePrice,
          unit_label: input.unitLabel,
          max_guests: safeGuests,
          amenities: (input.amenities || []).slice(0, 12).map((a) => clampString(a, 60)),
          photos: input.photos.slice(0, 6),
          blocked_dates: (input.blockedDates || []).slice(0, 120),
          is_published: Boolean(input.isPublished),
          rating: 5.0,
          review_count: 0,
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();

      if (error || !createdRow) {
        throw new Error(error?.message || 'Listing insert failed.');
      }

      if (input.paymentDestination) {
        const destPhone = clampString(input.paymentDestination.paymentPhone, 32);
        const destUpi = clampString(input.paymentDestination.upiId, 80);
        const destQr = cleanQrDataUrl(input.paymentDestination.paymentQrUrl);
        if ((destPhone.length >= 7 && isStrictUpiPattern(destUpi)) || isStrictUpiPattern(destUpi) || destQr) {
          setListingQrFallback(listingId, destQr);
          const baseDestPayload = {
            listing_id: listingId,
            host_id: req.authUser.id,
            payee_name:
              clampString(input.paymentDestination.payeeName || cleanedHostName, 80) ||
              'Tourx Host',
            payment_phone: destPhone,
            upi_id: destUpi,
            preferred_app: input.paymentDestination.preferredApp || 'both',
            created_at: now,
            updated_at: now,
          };
          let { error: destErr } = await req.dbClient
            .from('listing_payment_destinations')
            .upsert({ ...baseDestPayload, payment_qr_url: destQr }, { onConflict: 'listing_id' });
          if (destErr && isMissingPaymentQrColumnError(destErr.message)) {
            const retryDest = await req.dbClient
              .from('listing_payment_destinations')
              .upsert(baseDestPayload, { onConflict: 'listing_id' });
            destErr = retryDest.error;
          }
          if (destErr) {
            console.warn('[Listings] Payment destination save skipped:', destErr.message);
          }
        }
      }

      res.json({ id: listingId, listing: mapListing(createdRow as Record<string, unknown>) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create listing in Supabase.';
      console.warn('[Listings] Create error:', msg);
      const isRls =
        msg.toLowerCase().includes('row-level security') ||
        msg.toLowerCase().includes('permission denied') ||
        msg.includes('42501');
      res.status(isRls ? 503 : 500).json({ error: msg });
    }
  });

  app.put('/api/listings/:listingId', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    const listingId = req.params.listingId;
    const { hostName, input } = req.body as {
      hostName?: string;
      input?: {
        category: Listing['category'];
        title: string;
        description: string;
        locationName: string;
        country: string;
        lat: number;
        lng: number;
        pricePerUnitInr: number;
        unitLabel: Listing['unitLabel'];
        maxGuests: number;
        amenities: string[];
        photos: string[];
        isPublished: boolean;
        paymentDestination?: {
          payeeName: string;
          paymentPhone: string;
          upiId: string;
          preferredApp: PreferredPaymentApp;
          paymentQrUrl?: string;
        };
      };
    };

    if (!input) {
      res.status(400).json({ error: 'Missing listing payload.' });
      return;
    }

    try {
      const { data: existing, error: fetchErr } = await req.dbClient
        .from('listings')
        .select('*')
        .eq('id', listingId)
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);
      if (!existing) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
      }
      if ((existing as { host_id: string }).host_id !== req.authUser.id) {
        res.status(403).json({ error: 'Not authorized to modify this listing.' });
        return;
      }

      const now = new Date().toISOString();
      const cleanedHostName =
        clampString(hostName || (existing as { host_name: string }).host_name, 80) || 'Tourx Host';

      const { data: updatedRow, error: updateErr } = await req.dbClient
        .from('listings')
        .update({
          host_name: cleanedHostName,
          category: input.category,
          title: clampString(input.title, 120),
          description: clampString(input.description, 1500),
          location_name: clampString(input.locationName, 120),
          country: clampString(input.country, 80),
          lat: Math.max(-90, Math.min(90, Number(input.lat))),
          lng: Math.max(-180, Math.min(180, Number(input.lng))),
          price_per_unit_inr: Math.max(100, Math.min(500000, Math.round(Number(input.pricePerUnitInr)))),
          unit_label: input.unitLabel,
          max_guests: Math.max(1, Math.min(30, Math.round(Number(input.maxGuests)))),
          amenities: (input.amenities || []).slice(0, 12).map((a) => clampString(a, 60)),
          photos: (input.photos || ((existing as { photos: string[] }).photos)).slice(0, 6),
          is_published: Boolean(input.isPublished),
          updated_at: now,
        })
        .eq('id', listingId)
        .select('*')
        .single();

      if (updateErr || !updatedRow) {
        throw new Error(updateErr?.message || 'Listing update failed.');
      }

      if (input.paymentDestination) {
        const destPhone = clampString(input.paymentDestination.paymentPhone, 32);
        const destUpi = clampString(input.paymentDestination.upiId, 80);
        const destQr = cleanQrDataUrl(input.paymentDestination.paymentQrUrl);
        if ((destPhone.length >= 7 && isStrictUpiPattern(destUpi)) || isStrictUpiPattern(destUpi) || destQr) {
          setListingQrFallback(listingId, destQr);
          const baseDestPayload = {
            listing_id: listingId,
            host_id: req.authUser.id,
            payee_name:
              clampString(input.paymentDestination.payeeName || cleanedHostName, 80) ||
              'Tourx Host',
            payment_phone: destPhone,
            upi_id: destUpi,
            preferred_app: input.paymentDestination.preferredApp || 'both',
            updated_at: now,
          };
          let { error: destErr } = await req.dbClient
            .from('listing_payment_destinations')
            .upsert({ ...baseDestPayload, payment_qr_url: destQr }, { onConflict: 'listing_id' });
          if (destErr && isMissingPaymentQrColumnError(destErr.message)) {
            const retryDest = await req.dbClient
              .from('listing_payment_destinations')
              .upsert(baseDestPayload, { onConflict: 'listing_id' });
            destErr = retryDest.error;
          }
          if (destErr) {
            console.warn('[Listings] Payment destination update skipped:', destErr.message);
          }
        }
      }

      res.json(mapListing(updatedRow as Record<string, unknown>));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update listing.';
      console.warn('[Listings] Update error:', msg);
      const isRls =
        msg.toLowerCase().includes('row-level security') ||
        msg.toLowerCase().includes('permission denied') ||
        msg.includes('42501');
      res.status(isRls ? 503 : 500).json({ error: msg });
    }
  });

  app.patch(
    '/api/listings/:listingId/blocked-dates',
    requireSupabaseAuth,
    async (req: AuthedRequest, res) => {
      if (!req.dbClient || !req.authUser) return;

      const listingId = req.params.listingId;
      const { blockedDates } = req.body as { blockedDates?: string[] };

      try {
        const { data: existing, error: fetchErr } = await req.dbClient
          .from('listings')
          .select('id, host_id')
          .eq('id', listingId)
          .maybeSingle();

        if (fetchErr) throw new Error(fetchErr.message);
        if (!existing) {
          res.status(404).json({ error: 'Listing not found.' });
          return;
        }
        if ((existing as { host_id: string }).host_id !== req.authUser.id) {
          res.status(403).json({ error: 'Not authorized to update blocked dates.' });
          return;
        }

        const { data: updatedRow, error: updateErr } = await req.dbClient
          .from('listings')
          .update({
            blocked_dates: Array.isArray(blockedDates) ? blockedDates.slice(0, 120) : [],
            updated_at: new Date().toISOString(),
          })
          .eq('id', listingId)
          .select('*')
          .single();

        if (updateErr || !updatedRow) {
          throw new Error(updateErr?.message || 'Blocked dates update failed.');
        }

        res.json(mapListing(updatedRow as Record<string, unknown>));
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update blocked dates.';
        console.warn('[Listings] Blocked dates error:', msg);
        const isRls =
          msg.toLowerCase().includes('row-level security') ||
          msg.toLowerCase().includes('permission denied') ||
          msg.includes('42501');
        res.status(isRls ? 503 : 500).json({ error: msg });
      }
    },
  );

  app.delete('/api/listings/:listingId', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    const listingId = req.params.listingId;

    try {
      const { data: existing, error: fetchErr } = await req.dbClient
        .from('listings')
        .select('id, host_id')
        .eq('id', listingId)
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);
      if (!existing) {
        res.status(404).json({ error: 'Listing not found.' });
        return;
      }
      if ((existing as { host_id: string }).host_id !== req.authUser.id) {
        res.status(403).json({ error: 'Not authorized to delete this listing.' });
        return;
      }

      const { error: delErr } = await req.dbClient.from('listings').delete().eq('id', listingId);
      if (delErr) throw new Error(delErr.message);
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete listing.';
      console.warn('[Listings] Delete error:', msg);
      const isRls =
        msg.toLowerCase().includes('row-level security') ||
        msg.toLowerCase().includes('permission denied') ||
        msg.includes('42501');
      res.status(isRls ? 503 : 500).json({ error: msg });
    }
  });

  // --- Availability & Bookings (Authenticated Only) ---
  app.get('/api/availability', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient) return;

    try {
      const { data, error } = await req.dbClient
        .from('availability_slots')
        .select('*')
        .eq('status', 'active');

      if (error) throw new Error(error.message);
      res.json((data || []).map((r) => mapAvailabilitySlot(r as Record<string, unknown>)));
    } catch (err) {
      console.warn('[Availability] Fetch error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to load availability calendar.' });
    }
  });

  app.get(
    '/api/travellers/:travellerId/bookings',
    requireSupabaseAuth,
    async (req: AuthedRequest, res) => {
      if (!req.dbClient || !req.authUser) return;

      if (req.params.travellerId !== req.authUser.id) {
        res.status(403).json({ error: 'Forbidden.' });
        return;
      }

      try {
        const { data, error } = await req.dbClient
          .from('bookings')
          .select('*')
          .eq('traveller_id', req.authUser.id)
          .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);
        res.json((data || []).map((r) => mapBooking(r as Record<string, unknown>)));
      } catch (err) {
        console.warn('[Bookings] Traveller fetch error:', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'Failed to load your trips.' });
      }
    },
  );

  app.get('/api/hosts/:hostId/bookings', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    if (req.params.hostId !== req.authUser.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    try {
      const { data, error } = await req.dbClient
        .from('bookings')
        .select('*')
        .eq('host_id', req.authUser.id)
        .order('created_at', { ascending: false });

      if (error) throw new Error(error.message);
      res.json((data || []).map((r) => mapBooking(r as Record<string, unknown>)));
    } catch (err) {
      console.warn('[Bookings] Host fetch error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Failed to load host bookings.' });
    }
  });

  app.post('/api/bookings', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    const payload = req.body as {
      listing: Listing;
      travellerId?: string;
      travellerName: string;
      checkInDate: string;
      checkOutDate: string;
      nightsOrUnits: number;
      guests: number;
      subtotalInr: number;
      serviceFeeInr: number;
      totalAmountInr: number;
      displayCurrency: Booking['displayCurrency'];
      paymentMethod: Booking['paymentMethod'];
      paymentMode: Booking['paymentMode'];
      upiHandle: string;
      transactionRef: string;
      hostPayeeName: string;
      hostPaymentPhone: string;
      hostUpiId: string;
    };

    if (!payload?.listing?.id) {
      res.status(400).json({ error: 'Invalid booking payload.' });
      return;
    }

    try {
      const { profile } = await ensureUserProfile(
        req.dbClient,
        req.authUser,
        Boolean(req.isAdminClient),
      );

      const { data: liveRow, error: listingErr } = await req.dbClient
        .from('listings')
        .select('*')
        .eq('id', payload.listing.id)
        .maybeSingle();

      if (listingErr) throw new Error(listingErr.message);
      if (!liveRow) {
        res.status(404).json({ error: 'This listing is no longer available.' });
        return;
      }

      const liveListing = mapListing(liveRow as Record<string, unknown>);
      const requestedDates = expandRange(payload.checkInDate, payload.checkOutDate);
      const blockedSet = new Set(liveListing.blockedDates || []);

      const { data: activeSlots, error: slotsErr } = await req.dbClient
        .from('availability_slots')
        .select('check_in_date, check_out_date')
        .eq('listing_id', liveListing.id)
        .eq('status', 'active');

      if (slotsErr) throw new Error(slotsErr.message);

      for (const slot of activeSlots || []) {
        const s = slot as { check_in_date: string; check_out_date: string };
        for (const d of expandRange(s.check_in_date, s.check_out_date)) {
          blockedSet.add(d);
        }
      }

      if (requestedDates.some((d) => blockedSet.has(d))) {
        res
          .status(409)
          .json({ error: 'Selected dates are no longer available. Please choose another range.' });
        return;
      }

      const bookingId = `bk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const hostNetPayoutInr = Math.round(payload.subtotalInr * 0.95);
      const listingPhoto = clampString(liveListing.photos?.[0] || '', 200000);
      const resolvedTravellerName =
        clampString(payload.travellerName || profile.displayName, 80) || 'Tourx Guest';

      const { data: bookingRow, error: bookingInsertErr } = await req.dbClient
        .from('bookings')
        .insert({
          id: bookingId,
          listing_id: liveListing.id,
          listing_title: clampString(liveListing.title, 120),
          listing_location: clampString(`${liveListing.locationName}, ${liveListing.country}`, 120),
          listing_category: liveListing.category,
          listing_photo: listingPhoto,
          host_id: liveListing.hostId,
          host_name: clampString(liveListing.hostName, 80) || 'Tourx Host',
          host_payee_name:
            clampString(payload.hostPayeeName || liveListing.hostName, 80) || 'Tourx Host',
          host_payment_phone: clampString(payload.hostPaymentPhone || '', 32),
          host_upi_id: isStrictUpiPattern(payload.hostUpiId || '')
            ? clampString(payload.hostUpiId, 80)
            : 'host@ybl',
          traveller_id: req.authUser.id,
          traveller_name: resolvedTravellerName,
          check_in_date: payload.checkInDate,
          check_out_date: payload.checkOutDate,
          nights_or_units: Math.max(1, Math.min(90, payload.nightsOrUnits)),
          guests: Math.max(1, Math.min(30, payload.guests)),
          subtotal_inr: Math.max(100, Math.round(payload.subtotalInr)),
          service_fee_inr: Math.max(0, Math.round(payload.serviceFeeInr)),
          total_amount_inr: Math.max(100, Math.round(payload.totalAmountInr)),
          host_net_payout_inr: Math.max(90, hostNetPayoutInr),
          display_currency: payload.displayCurrency,
          payment_method: payload.paymentMethod,
          payment_mode: payload.paymentMode,
          upi_handle: clampString(payload.upiHandle, 80),
          transaction_ref: clampString(payload.transactionRef, 64),
          payment_status: 'paid',
          booking_status: 'confirmed',
          created_at: now,
          updated_at: now,
        })
        .select('*')
        .single();

      if (bookingInsertErr || !bookingRow) {
        if (!req.isAdminClient) {
          res.status(503).json({
            error:
              'Booking requires a valid SUPABASE_SERVICE_ROLE_KEY in Settings > Secrets. Please update SUPABASE_SERVICE_ROLE_KEY from Supabase Dashboard → Project Settings → API.',
          });
          return;
        }
        throw new Error(bookingInsertErr?.message || 'Booking insert failed.');
      }

      const { error: slotInsertErr } = await req.dbClient.from('availability_slots').insert({
        id: bookingId,
        listing_id: liveListing.id,
        host_id: liveListing.hostId,
        traveller_id: req.authUser.id,
        check_in_date: payload.checkInDate,
        check_out_date: payload.checkOutDate,
        status: 'active',
      });

      if (slotInsertErr) {
        await req.dbClient.from('bookings').delete().eq('id', bookingId);
        throw new Error(slotInsertErr.message);
      }

      res.json(mapBooking(bookingRow as Record<string, unknown>));
    } catch (err) {
      console.warn('[Bookings] Create error:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'Unable to complete booking right now.' });
    }
  });

  app.patch(
    '/api/bookings/:bookingId/status',
    requireSupabaseAuth,
    async (req: AuthedRequest, res) => {
      if (!req.dbClient || !req.authUser) return;

      const bookingId = req.params.bookingId;
      const { newStatus } = req.body as { newStatus?: Exclude<BookingStatus, 'confirmed'> };

      if (newStatus !== 'completed' && newStatus !== 'cancelled') {
        res.status(400).json({ error: 'Invalid booking status.' });
        return;
      }

      try {
        const { data: existing, error: fetchErr } = await req.dbClient
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .maybeSingle();

        if (fetchErr) throw new Error(fetchErr.message);
        if (!existing) {
          res.status(404).json({ error: 'Booking not found.' });
          return;
        }

        const existingBooking = mapBooking(existing as Record<string, unknown>);
        const isHost = existingBooking.hostId === req.authUser.id;
        const isTraveller = existingBooking.travellerId === req.authUser.id;

        if (!isHost && !isTraveller) {
          res.status(403).json({ error: 'Not authorized to update this booking.' });
          return;
        }
        if (newStatus === 'completed' && !isHost) {
          res.status(403).json({ error: 'Only the host can mark a booking as completed.' });
          return;
        }

        const { data: updatedRow, error: updateErr } = await req.dbClient
          .from('bookings')
          .update({
            booking_status: newStatus,
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId)
          .select('*')
          .single();

        if (updateErr || !updatedRow) {
          if (!req.isAdminClient) {
            res.status(503).json({
              error:
                'Updating booking status requires a valid SUPABASE_SERVICE_ROLE_KEY in Settings > Secrets.',
            });
            return;
          }
          throw new Error(updateErr?.message || 'Booking status update failed.');
        }

        if (newStatus === 'cancelled') {
          await req.dbClient
            .from('availability_slots')
            .update({ status: 'cancelled' })
            .eq('id', bookingId);
        }

        res.json(mapBooking(updatedRow as Record<string, unknown>));
      } catch (err) {
        console.warn('[Bookings] Status update error:', err instanceof Error ? err.message : err);
        res.status(500).json({ error: 'Failed to update booking status.' });
      }
    },
  );

  // --- Traveller Ratings & Reviews (Authenticated Only) ---
  app.get('/api/reviews', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient) return;

    try {
      const listingId = typeof req.query.listingId === 'string' ? req.query.listingId.trim() : '';
      let query = req.dbClient
        .from('listing_reviews')
        .select('*')
        .order('updated_at', { ascending: false });

      if (listingId) {
        query = query.eq('listing_id', listingId);
      }

      const { data, error } = await query;
      if (error) {
        if (isMissingReviewsTableError(error.message)) {
          res.json([]);
          return;
        }
        throw new Error(error.message);
      }

      res.json((data || []).map((r) => mapListingReview(r as Record<string, unknown>)));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load reviews.';
      console.warn('[Reviews] Fetch error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/reviews', requireSupabaseAuth, async (req: AuthedRequest, res) => {
    if (!req.dbClient || !req.authUser) return;

    const { listingId, hostId, bookingId, rating, comment, travellerName, verifiedStay } =
      req.body as {
        listingId?: string;
        hostId?: string;
        bookingId?: string;
        rating?: number;
        comment?: string;
        travellerName?: string;
        verifiedStay?: boolean;
      };

    const cleanListingId = clampString(listingId, 120);
    const parsedRating = Math.round(Number(rating));
    if (!cleanListingId || !Number.isFinite(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      res.status(400).json({ error: 'Please select a valid rating between 1 and 5 stars.' });
      return;
    }

    try {
      let resolvedHostId = clampString(hostId, 120);
      const { data: listingRow } = await req.dbClient
        .from('listings')
        .select('id, host_id')
        .eq('id', cleanListingId)
        .maybeSingle();

      if (listingRow && (listingRow as { host_id?: string }).host_id) {
        resolvedHostId = String((listingRow as { host_id: string }).host_id);
      }
      if (!resolvedHostId) {
        resolvedHostId = req.authUser.id;
      }

      let isVerifiedStay = Boolean(verifiedStay);
      if (!isVerifiedStay) {
        const { data: bookingCheck } = await req.dbClient
          .from('bookings')
          .select('id')
          .eq('listing_id', cleanListingId)
          .eq('traveller_id', req.authUser.id)
          .neq('booking_status', 'cancelled')
          .limit(1);
        if (bookingCheck && bookingCheck.length > 0) {
          isVerifiedStay = true;
        }
      }

      const reviewId = `rv_${cleanListingId}_${req.authUser.id}`;
      const now = new Date().toISOString();
      const cleanName =
        clampString(
          travellerName ||
            (req.authUser.user_metadata as { display_name?: string } | undefined)?.display_name ||
            req.authUser.email?.split('@')[0],
          80,
        ) || 'Tourx Traveller';

      const { data: savedRow, error: upsertErr } = await req.dbClient
        .from('listing_reviews')
        .upsert(
          {
            id: reviewId,
            listing_id: cleanListingId,
            booking_id: clampString(bookingId || '', 120),
            host_id: resolvedHostId,
            traveller_id: req.authUser.id,
            traveller_name: cleanName,
            rating: parsedRating,
            comment: clampString(comment || '', 600),
            verified_stay: isVerifiedStay,
            updated_at: now,
          },
          { onConflict: 'id' },
        )
        .select('*')
        .single();

      if (upsertErr || !savedRow) {
        const msg = upsertErr?.message || 'Unable to save review.';
        if (
          isMissingReviewsTableError(msg) ||
          msg.toLowerCase().includes('row-level security') ||
          msg.toLowerCase().includes('permission denied') ||
          msg.includes('42501')
        ) {
          res.status(503).json({ error: msg });
          return;
        }
        throw new Error(msg);
      }

      // Best-effort aggregate sync on listings table
      try {
        const { data: allListingReviews } = await req.dbClient
          .from('listing_reviews')
          .select('rating')
          .eq('listing_id', cleanListingId);
        if (allListingReviews && allListingReviews.length > 0) {
          const count = allListingReviews.length;
          const sum = allListingReviews.reduce(
            (acc, r) => acc + Number((r as { rating: number }).rating || 0),
            0,
          );
          const avg = Math.round((sum / count) * 10) / 10;
          await req.dbClient
            .from('listings')
            .update({ rating: avg, review_count: count, updated_at: now })
            .eq('id', cleanListingId);
        }
      } catch {
        // Non-fatal if RLS prevents updating another host's listing row directly
      }

      res.json(mapListingReview(savedRow as Record<string, unknown>));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to submit rating.';
      console.warn('[Reviews] Submit error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // --- HTTP + WebSocket Server (/api/live Gemini Live API Bridge) ---
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on('error', (err) => {
    console.error('[Live API] WebSocket server error:', err);
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      const host = Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host || 'localhost';
      const reqUrl = new URL(req.url || '/', `http://${host}`);
      if (reqUrl.pathname === '/api/live' || reqUrl.pathname === '/api/live/') {
        wss.handleUpgrade(req, socket, head, (clientWs) => {
          wss.emit('connection', clientWs, req);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs, req) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosed = false;
    const pendingTexts: string[] = [];

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.send(JSON.stringify(payload));
        } catch {
          // Ignore send errors on closing socket
        }
      }
    };

    // Send an immediate frame so deployment reverse proxies do not buffer or idle-drop handshake
    safeSend({ type: 'connecting' });

    const heartbeatTimer = setInterval(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        try {
          clientWs.ping();
          safeSend({ type: 'ping' });
        } catch {
          // Ignore ping failures
        }
      }
    }, 15000);

    clientWs.on('error', (err) => {
      console.error('[Live API] Client WebSocket error:', err.message);
    });

    clientWs.on('close', () => {
      isClosed = true;
      clearInterval(heartbeatTimer);
      try {
        liveSession?.close();
      } catch {
        // Ignore close cleanup errors
      }
    });

    clientWs.on('message', (raw) => {
      if (isClosed) return;
      try {
        const msg = JSON.parse(raw.toString()) as {
          type?: string;
          data?: string;
          text?: string;
        };
        if (msg.type === 'pong') return;
        if (!liveSession) {
          if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
            pendingTexts.push(msg.text.trim());
          }
          return;
        }
        if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim()) {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text.trim() }] }],
            turnComplete: true,
          });
        }
      } catch (err) {
        console.error('[Live API] Incoming message parse error:', err);
      }
    });

    try {
      const host = Array.isArray(req.headers.host)
        ? req.headers.host[0]
        : req.headers.host || 'localhost';
      const reqUrl = new URL(req.url || '/api/live', `http://${host}`);
      const activeDestination = reqUrl.searchParams.get('destination')?.trim() || '';
      const activeListing = reqUrl.searchParams.get('listing')?.trim() || '';
      const systemInstruction = buildVoiceSystemInstruction(activeDestination, activeListing);

      const ai = createLiveAiClient();
      const connectPromise = ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Zephyr' },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              safeSend({ type: 'inputTranscript', text: content.inputTranscription.text });
            }
            if (content?.outputTranscription?.text) {
              safeSend({ type: 'outputTranscript', text: content.outputTranscription.text });
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                safeSend({ type: 'audio', data: part.inlineData.data });
              }
            }
            if (content?.interrupted) {
              safeSend({ type: 'interrupted' });
            }
            if (content?.turnComplete) {
              safeSend({ type: 'turnComplete' });
            }
          },
          onerror: (err) => {
            const msg = extractLiveErrorMessage(err, 'Live voice session error.');
            console.error('[Live API] Session error:', msg);
            safeSend({ type: 'error', error: msg });
          },
          onclose: () => {
            if (!isClosed) {
              safeSend({ type: 'closed' });
            }
          },
        },
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Live Voice connection timed out while handshaking with Gemini.'));
        }, 15000);
      });

      liveSession = await Promise.race([connectPromise, timeoutPromise]);
    } catch (error) {
      const msg = extractLiveErrorMessage(error, 'Failed to connect to Gemini Live API.');
      console.error('[Live API] Connection error:', msg);
      safeSend({ type: 'error', error: msg });
      try {
        clientWs.close();
      } catch {
        // Ignore close error
      }
      return;
    }

    if (isClosed) {
      try {
        liveSession?.close();
      } catch {
        // Ignore close cleanup errors
      }
      return;
    }

    safeSend({ type: 'ready' });

    while (pendingTexts.length > 0 && !isClosed && liveSession) {
      const queuedText = pendingTexts.shift();
      if (queuedText) {
        try {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: queuedText }] }],
            turnComplete: true,
          });
        } catch {
          // Ignore send errors on early queued messages
        }
      }
    }
  });

  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const code = result.code.replace(
          'transport.connect(createHMRHandler(handleMessage));',
          '/* HMR disabled */',
        );
        res.setHeader('Content-Type', 'application/javascript');
        res.send(code);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Tourx server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
