import { getAccessToken, getSupabaseClient, refreshAccessToken } from '../lib/supabase';
import {
  AccountType,
  AvailabilitySlot,
  Booking,
  BookingStatus,
  CurrencyCode,
  Listing,
  ListingCategory,
  ListingPaymentDestination,
  PaymentMethod,
  PaymentMode,
  PreferredPaymentApp,
  UnitLabel,
  UserPrivateInfo,
  UserProfile,
} from '../types';

export class AuthSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthSessionError';
  }
}

class BackendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnavailableError';
  }
}

export interface HostPayoutSettingsInput {
  email: string;
  phone: string;
  payoutUpiId: string;
  payeeName: string;
  preferredPaymentApp: PreferredPaymentApp;
  paymentQrUrl?: string;
  syncExistingListings?: boolean;
}

export interface ListingPaymentInput {
  payeeName: string;
  paymentPhone: string;
  upiId: string;
  preferredApp: PreferredPaymentApp;
  paymentQrUrl?: string;
}

export interface CreateListingInput {
  category: ListingCategory;
  title: string;
  description: string;
  locationName: string;
  country: string;
  lat: number;
  lng: number;
  pricePerUnitInr: number;
  unitLabel: UnitLabel;
  maxGuests: number;
  amenities: string[];
  photos: string[];
  blockedDates: string[];
  isPublished: boolean;
  paymentDestination?: ListingPaymentInput;
}

export interface CreateBookingPayload {
  listing: Listing;
  travellerId: string;
  travellerName: string;
  checkInDate: string;
  checkOutDate: string;
  nightsOrUnits: number;
  guests: number;
  subtotalInr: number;
  serviceFeeInr: number;
  totalAmountInr: number;
  displayCurrency: CurrencyCode;
  paymentMethod: PaymentMethod;
  paymentMode: PaymentMode;
  upiHandle: string;
  transactionRef: string;
  hostPayeeName: string;
  hostPaymentPhone: string;
  hostUpiId: string;
}

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

function emitBackendChange(): void {
  for (const fn of changeListeners) {
    fn();
  }
}

const HOST_QR_STORAGE_KEY = 'tourx_host_qr_fallback';
const LISTING_QR_STORAGE_KEY = 'tourx_listing_qr_fallback';

function readQrMap(storageKey: string): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeQrEntry(storageKey: string, id: string, value: string): void {
  try {
    const map = readQrMap(storageKey);
    if (value) {
      map[id] = value;
    } else {
      delete map[id];
    }
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function getHostQrLocal(uid: string): string {
  return readQrMap(HOST_QR_STORAGE_KEY)[uid] || '';
}

function getListingQrLocal(listingId: string): string {
  return readQrMap(LISTING_QR_STORAGE_KEY)[listingId] || '';
}

function isMissingPaymentQrColumnError(msg: string | undefined): boolean {
  const lower = (msg || '').toLowerCase();
  return lower.includes('payment_qr_url') && (lower.includes('column') || lower.includes('schema cache'));
}

function clampString(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
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
    paymentQrUrl: qrFromRow || (uid ? getHostQrLocal(uid) : ''),
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
    paymentQrUrl: qrFromRow || getListingQrLocal(listingId) || getHostQrLocal(hostId),
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

async function apiJson<T>(
  url: string,
  init?: RequestInit,
  explicitToken?: string,
  hasRetried = false,
): Promise<T> {
  const token = explicitToken || (await getAccessToken());
  if (!token) {
    throw new AuthSessionError('Authentication required. Please sign in to continue.');
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
      ...init,
    });
  } catch {
    throw new BackendUnavailableError('Backend server unreachable.');
  }

  if (res.status === 401 && !hasRetried) {
    const refreshed = await refreshAccessToken();
    if (refreshed && refreshed !== token) {
      return apiJson<T>(url, init, refreshed, true);
    }
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (
    res.status === 404 ||
    res.status === 405 ||
    res.status === 501 ||
    ((res.status === 502 || res.status === 504 || !res.ok) && !isJson)
  ) {
    throw new BackendUnavailableError(`API endpoint unavailable (${res.status}).`);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (isJson) {
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // Ignore malformed JSON error bodies
      }
    }
    if (res.status === 401) {
      throw new AuthSessionError(message);
    }
    throw new Error(message);
  }

  if (!isJson) {
    throw new BackendUnavailableError('Backend API returned HTML instead of JSON.');
  }

  return (await res.json()) as T;
}

async function withBackendFallback<T>(
  apiFn: () => Promise<T>,
  supabaseFn: () => Promise<T>,
): Promise<T> {
  try {
    return await apiFn();
  } catch (err) {
    if (err instanceof BackendUnavailableError) {
      return await supabaseFn();
    }
    throw err;
  }
}

async function ensureProfileViaSupabase(explicitToken?: string): Promise<{
  profile: UserProfile;
  privateInfo: UserPrivateInfo;
}> {
  const supabase = await getSupabaseClient();
  const { data: userData, error: userErr } = explicitToken
    ? await supabase.auth.getUser(explicitToken)
    : await supabase.auth.getUser();

  if (userErr || !userData?.user) {
    throw new AuthSessionError('Session expired or invalid. Please sign in again.');
  }

  const authUser = userData.user;
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

  const { data: existingProfile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('uid', authUser.id)
    .maybeSingle();

  let profileRow = existingProfile as Record<string, unknown> | null;
  if (!profileRow) {
    const { data: inserted } = await supabase
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
      .maybeSingle();

    profileRow = (inserted as Record<string, unknown> | null) || {
      uid: authUser.id,
      display_name: fallbackName,
      account_type: fallbackRole,
      avatar_url: clampString(meta.avatar_url, 500),
      bio: '',
    };
  }

  const { data: existingPrivate } = await supabase
    .from('user_private_info')
    .select('*')
    .eq('uid', authUser.id)
    .maybeSingle();

  let privateRow = existingPrivate as Record<string, unknown> | null;
  if (!privateRow) {
    const { data: insertedPriv } = await supabase
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
      .maybeSingle();

    privateRow = (insertedPriv as Record<string, unknown> | null) || {
      uid: authUser.id,
      email: authUser.email || '',
      phone: '',
      payout_upi_id: '',
      payee_name: String(profileRow.display_name || fallbackName),
      preferred_payment_app: 'both',
    };
  }

  return {
    profile: mapUserProfile(profileRow),
    privateInfo: mapUserPrivateInfo(privateRow),
  };
}

export async function fetchAuthenticatedProfile(explicitToken?: string): Promise<{
  profile: UserProfile;
  privateInfo: UserPrivateInfo;
}> {
  return withBackendFallback(
    () =>
      apiJson<{ profile: UserProfile; privateInfo: UserPrivateInfo }>(
        '/api/auth/me',
        undefined,
        explicitToken,
      ),
    () => ensureProfileViaSupabase(explicitToken),
  );
}

export async function switchUserAccountRole(
  accountType: AccountType,
): Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }> {
  const nextRole: AccountType = accountType === 'host' ? 'host' : 'traveller';
  const data = await withBackendFallback(
    () =>
      apiJson<{ profile: UserProfile; privateInfo: UserPrivateInfo }>('/api/auth/role', {
        method: 'PATCH',
        body: JSON.stringify({ accountType: nextRole }),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const ensured = await ensureProfileViaSupabase();
      const { data: updated, error } = await supabase
        .from('user_profiles')
        .upsert(
          {
            uid: ensured.profile.uid,
            display_name: ensured.profile.displayName,
            account_type: nextRole,
            avatar_url: ensured.profile.avatarUrl || '',
            bio: ensured.profile.bio || '',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'uid' },
        )
        .select('*')
        .maybeSingle();

      await supabase.auth
        .updateUser({ data: { account_type: nextRole } })
        .catch(() => undefined);

      if (error) {
        console.warn('Role switch DB warning (using session metadata):', error.message);
      }

      return {
        profile: updated
          ? mapUserProfile(updated as Record<string, unknown>)
          : { ...ensured.profile, accountType: nextRole },
        privateInfo: ensured.privateInfo,
      };
    },
  );
  emitBackendChange();
  return data;
}

function createPollingSubscription<T>(
  fetcher: () => Promise<T>,
  onData: (data: T) => void,
  intervalMs = 5000,
): () => void {
  let active = true;
  let inFlight = false;

  const refresh = async () => {
    if (!active || inFlight) return;
    inFlight = true;
    try {
      const data = await fetcher();
      if (active) {
        onData(data);
      }
    } catch (err) {
      if (!(err instanceof AuthSessionError)) {
        console.warn('Supabase sync warning:', err instanceof Error ? err.message : err);
      }
    } finally {
      inFlight = false;
    }
  };

  void refresh();
  const timer = window.setInterval(() => {
    void refresh();
  }, intervalMs);

  const onLocalChange = () => {
    void refresh();
  };
  changeListeners.add(onLocalChange);

  return () => {
    active = false;
    window.clearInterval(timer);
    changeListeners.delete(onLocalChange);
  };
}

export function subscribePublicListings(onData: (items: Listing[]) => void): () => void {
  return createPollingSubscription(
    () =>
      withBackendFallback(
        () => apiJson<Listing[]>('/api/listings'),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('listings')
            .select('*')
            .eq('is_published', true)
            .order('created_at', { ascending: false });
          if (error) throw new Error(error.message);
          return (data || []).map((row) => mapListing(row as Record<string, unknown>));
        },
      ),
    onData,
  );
}

export function subscribeHostListings(
  hostId: string,
  onData: (items: Listing[]) => void,
): () => void {
  return createPollingSubscription(
    () =>
      withBackendFallback(
        () => apiJson<Listing[]>(`/api/hosts/${encodeURIComponent(hostId)}/listings`),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('listings')
            .select('*')
            .eq('host_id', hostId)
            .order('created_at', { ascending: false });
          if (error) throw new Error(error.message);
          return (data || []).map((row) => mapListing(row as Record<string, unknown>));
        },
      ),
    onData,
  );
}

export function subscribeActiveAvailability(
  onData: (slots: AvailabilitySlot[]) => void,
): () => void {
  return createPollingSubscription(
    () =>
      withBackendFallback(
        () => apiJson<AvailabilitySlot[]>('/api/availability'),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('availability_slots')
            .select('*')
            .eq('status', 'active');
          if (error) throw new Error(error.message);
          return (data || []).map((row) => mapAvailabilitySlot(row as Record<string, unknown>));
        },
      ),
    onData,
  );
}

export function subscribeTravellerBookings(
  travellerId: string,
  onData: (bookings: Booking[]) => void,
): () => void {
  return createPollingSubscription(
    () =>
      withBackendFallback(
        () => apiJson<Booking[]>(`/api/travellers/${encodeURIComponent(travellerId)}/bookings`),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('traveller_id', travellerId)
            .order('created_at', { ascending: false });
          if (error) throw new Error(error.message);
          return (data || []).map((row) => mapBooking(row as Record<string, unknown>));
        },
      ),
    onData,
  );
}

export function subscribeHostBookings(
  hostId: string,
  onData: (bookings: Booking[]) => void,
): () => void {
  return createPollingSubscription(
    () =>
      withBackendFallback(
        () => apiJson<Booking[]>(`/api/hosts/${encodeURIComponent(hostId)}/bookings`),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('host_id', hostId)
            .order('created_at', { ascending: false });
          if (error) throw new Error(error.message);
          return (data || []).map((row) => mapBooking(row as Record<string, unknown>));
        },
      ),
    onData,
  );
}

export function subscribeUserPrivateInfo(
  uid: string,
  onData: (info: UserPrivateInfo | null) => void,
): () => void {
  return createPollingSubscription(
    () =>
      withBackendFallback(
        () => apiJson<UserPrivateInfo | null>(`/api/users/${encodeURIComponent(uid)}/private`),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('user_private_info')
            .select('*')
            .eq('uid', uid)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return data ? mapUserPrivateInfo(data as Record<string, unknown>) : null;
        },
      ),
    onData,
  );
}

export async function saveHostPayoutSettings(
  hostId: string,
  input: HostPayoutSettingsInput,
): Promise<void> {
  await withBackendFallback(
    () =>
      apiJson<UserPrivateInfo>(`/api/users/${encodeURIComponent(hostId)}/private`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const paymentQrUrl = clampString(input.paymentQrUrl || '', 750000);
      writeQrEntry(HOST_QR_STORAGE_KEY, hostId, paymentQrUrl);

      const basePayload = {
        uid: hostId,
        email: clampString(input.email, 160),
        phone: clampString(input.phone, 32),
        payout_upi_id: clampString(input.payoutUpiId, 80),
        payee_name: clampString(input.payeeName, 80),
        preferred_payment_app:
          input.preferredPaymentApp === 'phonepe' || input.preferredPaymentApp === 'gpay'
            ? input.preferredPaymentApp
            : 'both',
        updated_at: new Date().toISOString(),
      };

      let { data, error } = await supabase
        .from('user_private_info')
        .upsert({ ...basePayload, payment_qr_url: paymentQrUrl }, { onConflict: 'uid' })
        .select('*')
        .single();

      if (error && isMissingPaymentQrColumnError(error.message)) {
        const retry = await supabase
          .from('user_private_info')
          .upsert(basePayload, { onConflict: 'uid' })
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error || !data) {
        throw new Error(error?.message || 'Failed to save payout settings.');
      }

      if (input.syncExistingListings) {
        const destBase = {
          payee_name: basePayload.payee_name,
          payment_phone: basePayload.phone,
          upi_id: basePayload.payout_upi_id,
          preferred_app: basePayload.preferred_payment_app,
          updated_at: new Date().toISOString(),
        };
        const syncRes = await supabase
          .from('listing_payment_destinations')
          .update({ ...destBase, payment_qr_url: paymentQrUrl })
          .eq('host_id', hostId);
        if (syncRes.error && isMissingPaymentQrColumnError(syncRes.error.message)) {
          await supabase
            .from('listing_payment_destinations')
            .update(destBase)
            .eq('host_id', hostId);
        }
      }

      return mapUserPrivateInfo(data as Record<string, unknown>);
    },
  );
  emitBackendChange();
}

export async function getListingPaymentDestination(
  listingId: string,
): Promise<ListingPaymentDestination | null> {
  return withBackendFallback(
    () =>
      apiJson<ListingPaymentDestination | null>(
        `/api/listings/${encodeURIComponent(listingId)}/payment-destination`,
      ),
    async () => {
      const supabase = await getSupabaseClient();
      const { data: destRow } = await supabase
        .from('listing_payment_destinations')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();

      if (destRow) {
        return mapListingPaymentDestination(destRow as Record<string, unknown>);
      }

      const { data: listingRow } = await supabase
        .from('listings')
        .select('id, host_id, host_name')
        .eq('id', listingId)
        .maybeSingle();

      if (!listingRow) return null;
      const hostId = String((listingRow as Record<string, unknown>).host_id);
      const { data: privRow } = await supabase
        .from('user_private_info')
        .select('*')
        .eq('uid', hostId)
        .maybeSingle();

      if (!privRow) return null;
      const priv = privRow as Record<string, unknown>;
      const app = priv.preferred_payment_app;
      return {
        listingId,
        hostId,
        payeeName: String(priv.payee_name || (listingRow as Record<string, unknown>).host_name || 'Tourx Host'),
        paymentPhone: String(priv.phone || ''),
        upiId: String(priv.payout_upi_id || ''),
        preferredApp: app === 'phonepe' || app === 'gpay' ? app : 'both',
        paymentQrUrl:
          (typeof priv.payment_qr_url === 'string' ? priv.payment_qr_url : '') ||
          getListingQrLocal(listingId) ||
          getHostQrLocal(hostId),
      };
    },
  );
}

export async function createHostListing(
  hostId: string,
  hostName: string,
  input: CreateListingInput,
): Promise<string> {
  const res = await withBackendFallback(
    () =>
      apiJson<{ id: string }>('/api/listings', {
        method: 'POST',
        body: JSON.stringify({ hostId, hostName, input }),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const listingId = `lst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();

      const { error } = await supabase.from('listings').insert({
        id: listingId,
        host_id: hostId,
        host_name: clampString(hostName, 80) || 'Tourx Host',
        category: input.category,
        title: clampString(input.title, 140),
        description: clampString(input.description, 2000),
        location_name: clampString(input.locationName, 140),
        country: clampString(input.country, 80),
        lat: Number(input.lat),
        lng: Number(input.lng),
        price_per_unit_inr: Math.max(100, Math.round(Number(input.pricePerUnitInr))),
        unit_label: input.unitLabel,
        max_guests: Math.max(1, Math.min(30, Math.round(Number(input.maxGuests)))),
        amenities: (input.amenities || []).slice(0, 15).map((a) => clampString(a, 60)),
        photos: (input.photos || []).slice(0, 6),
        blocked_dates: (input.blockedDates || []).slice(0, 365),
        is_published: Boolean(input.isPublished),
        rating: 5.0,
        review_count: 0,
        created_at: now,
        updated_at: now,
      });

      if (error) throw new Error(error.message || 'Failed to create listing.');

      if (input.paymentDestination) {
        const paymentQrUrl = clampString(input.paymentDestination.paymentQrUrl || '', 750000);
        writeQrEntry(LISTING_QR_STORAGE_KEY, listingId, paymentQrUrl);
        const destBase = {
          listing_id: listingId,
          host_id: hostId,
          payee_name: clampString(input.paymentDestination.payeeName, 80),
          payment_phone: clampString(input.paymentDestination.paymentPhone, 32),
          upi_id: clampString(input.paymentDestination.upiId, 80),
          preferred_app:
            input.paymentDestination.preferredApp === 'phonepe' ||
            input.paymentDestination.preferredApp === 'gpay'
              ? input.paymentDestination.preferredApp
              : 'both',
          created_at: now,
          updated_at: now,
        };
        const destRes = await supabase
          .from('listing_payment_destinations')
          .upsert({ ...destBase, payment_qr_url: paymentQrUrl }, { onConflict: 'listing_id' });
        if (destRes.error && isMissingPaymentQrColumnError(destRes.error.message)) {
          await supabase
            .from('listing_payment_destinations')
            .upsert(destBase, { onConflict: 'listing_id' });
        }
      }

      return { id: listingId };
    },
  );
  emitBackendChange();
  return res.id;
}

export async function updateHostListing(
  listingId: string,
  hostId: string,
  hostName: string,
  input: Omit<CreateListingInput, 'blockedDates'>,
): Promise<void> {
  await withBackendFallback(
    () =>
      apiJson<Listing>(`/api/listings/${encodeURIComponent(listingId)}`, {
        method: 'PUT',
        body: JSON.stringify({ hostId, hostName, input }),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('listings')
        .update({
          host_name: clampString(hostName, 80) || 'Tourx Host',
          category: input.category,
          title: clampString(input.title, 140),
          description: clampString(input.description, 2000),
          location_name: clampString(input.locationName, 140),
          country: clampString(input.country, 80),
          lat: Number(input.lat),
          lng: Number(input.lng),
          price_per_unit_inr: Math.max(100, Math.round(Number(input.pricePerUnitInr))),
          unit_label: input.unitLabel,
          max_guests: Math.max(1, Math.min(30, Math.round(Number(input.maxGuests)))),
          amenities: (input.amenities || []).slice(0, 15).map((a) => clampString(a, 60)),
          photos: (input.photos || []).slice(0, 6),
          is_published: Boolean(input.isPublished),
          updated_at: now,
        })
        .eq('id', listingId)
        .eq('host_id', hostId)
        .select('*')
        .single();

      if (error || !data) throw new Error(error?.message || 'Failed to update listing.');

      if (input.paymentDestination) {
        const paymentQrUrl = clampString(input.paymentDestination.paymentQrUrl || '', 750000);
        writeQrEntry(LISTING_QR_STORAGE_KEY, listingId, paymentQrUrl);
        const destBase = {
          listing_id: listingId,
          host_id: hostId,
          payee_name: clampString(input.paymentDestination.payeeName, 80),
          payment_phone: clampString(input.paymentDestination.paymentPhone, 32),
          upi_id: clampString(input.paymentDestination.upiId, 80),
          preferred_app:
            input.paymentDestination.preferredApp === 'phonepe' ||
            input.paymentDestination.preferredApp === 'gpay'
              ? input.paymentDestination.preferredApp
              : 'both',
          updated_at: now,
        };
        const destRes = await supabase
          .from('listing_payment_destinations')
          .upsert({ ...destBase, payment_qr_url: paymentQrUrl }, { onConflict: 'listing_id' });
        if (destRes.error && isMissingPaymentQrColumnError(destRes.error.message)) {
          await supabase
            .from('listing_payment_destinations')
            .upsert(destBase, { onConflict: 'listing_id' });
        }
      }

      return mapListing(data as Record<string, unknown>);
    },
  );
  emitBackendChange();
}

export async function updateListingBlockedDates(
  listingId: string,
  blockedDates: string[],
): Promise<void> {
  await withBackendFallback(
    () =>
      apiJson<Listing>(`/api/listings/${encodeURIComponent(listingId)}/blocked-dates`, {
        method: 'PATCH',
        body: JSON.stringify({ blockedDates }),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('listings')
        .update({
          blocked_dates: blockedDates.slice(0, 365),
          updated_at: new Date().toISOString(),
        })
        .eq('id', listingId)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message || 'Failed to update blocked dates.');
      return mapListing(data as Record<string, unknown>);
    },
  );
  emitBackendChange();
}

export async function deleteHostListing(listingId: string): Promise<void> {
  await withBackendFallback(
    () =>
      apiJson<{ ok: boolean }>(`/api/listings/${encodeURIComponent(listingId)}`, {
        method: 'DELETE',
      }),
    async () => {
      const supabase = await getSupabaseClient();
      await supabase.from('listing_payment_destinations').delete().eq('listing_id', listingId);
      const { error } = await supabase.from('listings').delete().eq('id', listingId);
      if (error) throw new Error(error.message || 'Failed to delete listing.');
      return { ok: true };
    },
  );
  emitBackendChange();
}

export async function createBookingAtomic(payload: CreateBookingPayload): Promise<Booking> {
  const booking = await withBackendFallback(
    () =>
      apiJson<Booking>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const requestedDays = expandRange(payload.checkInDate, payload.checkOutDate);

      const { data: listingRow, error: listingErr } = await supabase
        .from('listings')
        .select('*')
        .eq('id', payload.listing.id)
        .maybeSingle();

      if (listingErr || !listingRow) {
        throw new Error('Listing could not be found.');
      }

      const liveListing = mapListing(listingRow as Record<string, unknown>);
      const blockedSet = new Set(liveListing.blockedDates || []);
      if (requestedDays.some((day) => blockedSet.has(day))) {
        throw new Error('Selected dates include host-blocked dates. Please pick another range.');
      }

      const { data: existingSlots } = await supabase
        .from('availability_slots')
        .select('*')
        .eq('listing_id', liveListing.id)
        .eq('status', 'active');

      const takenDays = new Set<string>();
      for (const slot of existingSlots || []) {
        const s = slot as Record<string, unknown>;
        for (const d of expandRange(String(s.check_in_date), String(s.check_out_date))) {
          takenDays.add(d);
        }
      }
      if (requestedDays.some((day) => takenDays.has(day))) {
        throw new Error(
          'Those dates were just reserved by another traveller. Please choose different dates.',
        );
      }

      const bookingId = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const totalAmt = Math.max(100, Math.round(payload.totalAmountInr));
      const serviceFee = Math.max(0, Math.round(payload.serviceFeeInr));

      const { data: insertedBooking, error: insertErr } = await supabase
        .from('bookings')
        .insert({
          id: bookingId,
          listing_id: liveListing.id,
          listing_title: liveListing.title,
          listing_location: liveListing.locationName,
          listing_category: liveListing.category,
          listing_photo: liveListing.photos[0] || '',
          host_id: liveListing.hostId,
          host_name: liveListing.hostName,
          host_payee_name: clampString(payload.hostPayeeName || liveListing.hostName, 80) || 'Tourx Host',
          host_payment_phone: clampString(payload.hostPaymentPhone || '', 32),
          host_upi_id: clampString(payload.hostUpiId || 'host@ybl', 80),
          traveller_id: payload.travellerId,
          traveller_name: clampString(payload.travellerName, 80) || 'Tourx Traveller',
          check_in_date: payload.checkInDate,
          check_out_date: payload.checkOutDate,
          nights_or_units: Math.max(1, Math.min(90, payload.nightsOrUnits)),
          guests: Math.max(1, Math.min(30, payload.guests)),
          subtotal_inr: Math.max(100, Math.round(payload.subtotalInr)),
          service_fee_inr: serviceFee,
          total_amount_inr: totalAmt,
          host_net_payout_inr: Math.max(90, totalAmt - serviceFee),
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

      if (insertErr || !insertedBooking) {
        throw new Error(insertErr?.message || 'Unable to complete booking right now.');
      }

      const { error: slotErr } = await supabase.from('availability_slots').insert({
        id: bookingId,
        listing_id: liveListing.id,
        host_id: liveListing.hostId,
        traveller_id: payload.travellerId,
        check_in_date: payload.checkInDate,
        check_out_date: payload.checkOutDate,
        status: 'active',
      });

      if (slotErr) {
        await supabase.from('bookings').delete().eq('id', bookingId);
        throw new Error(slotErr.message || 'Unable to lock booking dates.');
      }

      return mapBooking(insertedBooking as Record<string, unknown>);
    },
  );
  emitBackendChange();
  return booking;
}

export async function updateBookingStatusAtomic(
  bookingId: string,
  newStatus: Exclude<BookingStatus, 'confirmed'>,
): Promise<void> {
  await withBackendFallback(
    () =>
      apiJson<Booking>(`/api/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ newStatus }),
      }),
    async () => {
      const supabase = await getSupabaseClient();
      const { data, error } = await supabase
        .from('bookings')
        .update({
          booking_status: newStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', bookingId)
        .select('*')
        .single();

      if (error || !data) {
        throw new Error(error?.message || 'Failed to update booking status.');
      }

      if (newStatus === 'cancelled') {
        await supabase
          .from('availability_slots')
          .update({ status: 'cancelled' })
          .eq('id', bookingId);
      }

      return mapBooking(data as Record<string, unknown>);
    },
  );
  emitBackendChange();
}
