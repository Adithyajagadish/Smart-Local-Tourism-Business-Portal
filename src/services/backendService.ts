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
  ListingReview,
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

class RlsPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RlsPermissionError';
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

export interface SubmitReviewInput {
  listingId: string;
  hostId: string;
  bookingId?: string;
  rating: number;
  comment: string;
  travellerName: string;
  verifiedStay?: boolean;
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
const PORTAL_ROLE_OVERRIDE_KEY = 'tourx_portal_role_override';
const LOCAL_BOOKINGS_STORAGE_KEY = 'tourx_local_test_bookings_v1';
const LOCAL_SLOTS_STORAGE_KEY = 'tourx_local_test_slots_v1';
const LOCAL_LISTINGS_STORAGE_KEY = 'tourx_local_listings_v1';
const LOCAL_LISTING_DESTS_STORAGE_KEY = 'tourx_local_listing_dests_v1';
const LOCAL_REVIEWS_STORAGE_KEY = 'tourx_local_reviews_v1';

let apiBackendMode: 'unknown' | 'server' | 'supabase-direct' = 'unknown';

function isRlsOrPermissionError(err: unknown): boolean {
  if (err instanceof RlsPermissionError) return true;
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('row-level security') ||
    msg.includes('permission denied') ||
    msg.includes('42501') ||
    msg.includes('service_role')
  );
}

function isMissingReviewsTableError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toLowerCase();
  return (
    msg.includes('listing_reviews') &&
    (msg.includes('does not exist') ||
      msg.includes('schema cache') ||
      msg.includes('could not find the table') ||
      msg.includes('relation'))
  );
}

function readLocalReviews(): ListingReview[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_REVIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ListingReview[]) : [];
  } catch {
    return [];
  }
}

function writeLocalReviews(items: ListingReview[]): void {
  try {
    window.localStorage.setItem(LOCAL_REVIEWS_STORAGE_KEY, JSON.stringify(items.slice(0, 300)));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function mergeReviewsWithLocal(remote: ListingReview[]): ListingReview[] {
  const local = readLocalReviews();
  if (local.length === 0) return remote;
  const byId = new Map<string, ListingReview>();
  for (const item of remote) {
    byId.set(item.id, item);
  }
  for (const item of local) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      const localTs = Date.parse(String(item.updatedAt || item.createdAt || '')) || 0;
      const remoteTs = Date.parse(String(existing.updatedAt || existing.createdAt || '')) || 0;
      if (localTs > remoteTs) {
        byId.set(item.id, item);
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const ta = Date.parse(String(a.updatedAt || a.createdAt || '')) || 0;
    const tb = Date.parse(String(b.updatedAt || b.createdAt || '')) || 0;
    return tb - ta;
  });
}

function readLocalListings(): Listing[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_LISTINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Listing[]) : [];
  } catch {
    return [];
  }
}

function writeLocalListings(items: Listing[]): void {
  try {
    window.localStorage.setItem(LOCAL_LISTINGS_STORAGE_KEY, JSON.stringify(items.slice(0, 60)));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function readLocalListingDestinations(): Record<string, ListingPaymentDestination> {
  try {
    const raw = window.localStorage.getItem(LOCAL_LISTING_DESTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, ListingPaymentDestination>)
      : {};
  } catch {
    return {};
  }
}

function writeLocalListingDestination(
  listingId: string,
  dest: ListingPaymentDestination | null,
): void {
  try {
    const map = readLocalListingDestinations();
    if (dest) {
      map[listingId] = dest;
    } else {
      delete map[listingId];
    }
    window.localStorage.setItem(LOCAL_LISTING_DESTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function mergeListingsWithLocal(
  remote: Listing[],
  filterFn: (item: Listing) => boolean,
): Listing[] {
  const local = readLocalListings().filter(filterFn);
  if (local.length === 0) return remote;
  const byId = new Map<string, Listing>();
  for (const item of remote) {
    byId.set(item.id, item);
  }
  for (const item of local) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

function readLocalTestBookings(): Booking[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_BOOKINGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Booking[]) : [];
  } catch {
    return [];
  }
}

function writeLocalTestBookings(items: Booking[]): void {
  try {
    window.localStorage.setItem(LOCAL_BOOKINGS_STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function readLocalTestSlots(): AvailabilitySlot[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_SLOTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AvailabilitySlot[]) : [];
  } catch {
    return [];
  }
}

function writeLocalTestSlots(items: AvailabilitySlot[]): void {
  try {
    window.localStorage.setItem(LOCAL_SLOTS_STORAGE_KEY, JSON.stringify(items.slice(0, 200)));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

function saveLocalTestBooking(booking: Booking): void {
  const existingBookings = readLocalTestBookings().filter((b) => b.id !== booking.id);
  writeLocalTestBookings([booking, ...existingBookings]);

  const existingSlots = readLocalTestSlots().filter((s) => s.id !== booking.id);
  const slot: AvailabilitySlot = {
    id: booking.id,
    listingId: booking.listingId,
    hostId: booking.hostId,
    travellerId: booking.travellerId,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    status: booking.bookingStatus === 'cancelled' ? 'cancelled' : 'active',
  };
  writeLocalTestSlots([slot, ...existingSlots]);
}

function mergeBookingsWithLocal(remote: Booking[], filterFn: (b: Booking) => boolean): Booking[] {
  const local = readLocalTestBookings().filter(filterFn);
  if (local.length === 0) return remote;
  const byId = new Map<string, Booking>();
  for (const item of remote) {
    byId.set(item.id, item);
  }
  for (const item of local) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

function mergeSlotsWithLocal(remote: AvailabilitySlot[]): AvailabilitySlot[] {
  const local = readLocalTestSlots().filter((s) => s.status === 'active');
  if (local.length === 0) return remote;
  const byId = new Map<string, AvailabilitySlot>();
  for (const item of remote) {
    byId.set(item.id, item);
  }
  for (const item of local) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values());
}

function readPortalRoleOverride(uid: string): AccountType | null {
  try {
    const raw = window.localStorage.getItem(PORTAL_ROLE_OVERRIDE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const val = parsed?.[uid];
    if (val === 'host' || val === 'traveller') {
      return val;
    }
    return null;
  } catch {
    return null;
  }
}

function writePortalRoleOverride(uid: string, role: AccountType | null): void {
  try {
    const raw = window.localStorage.getItem(PORTAL_ROLE_OVERRIDE_KEY);
    const parsed: Record<string, string> = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (role) {
      parsed[uid] = role;
    } else {
      delete parsed[uid];
    }
    window.localStorage.setItem(PORTAL_ROLE_OVERRIDE_KEY, JSON.stringify(parsed));
  } catch {
    // Ignore localStorage quota/private-mode errors
  }
}

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
    apiBackendMode = 'supabase-direct';
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
    apiBackendMode = 'supabase-direct';
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
    if (res.status === 503 && isRlsOrPermissionError(message)) {
      throw new RlsPermissionError(message);
    }
    throw new Error(message);
  }

  if (!isJson) {
    apiBackendMode = 'supabase-direct';
    throw new BackendUnavailableError('Backend API returned HTML instead of JSON.');
  }

  apiBackendMode = 'server';
  return (await res.json()) as T;
}

async function withBackendFallback<T>(
  apiFn: () => Promise<T>,
  supabaseFn: () => Promise<T>,
): Promise<T> {
  if (apiBackendMode === 'supabase-direct') {
    return await supabaseFn();
  }
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
  const result = await withBackendFallback(
    () =>
      apiJson<{ profile: UserProfile; privateInfo: UserPrivateInfo }>(
        '/api/auth/me',
        undefined,
        explicitToken,
      ),
    () => ensureProfileViaSupabase(explicitToken),
  );

  const overrideRole = readPortalRoleOverride(result.profile.uid);
  if (overrideRole && result.profile.accountType !== overrideRole) {
    return {
      profile: { ...result.profile, accountType: overrideRole },
      privateInfo: result.privateInfo,
    };
  }
  return result;
}

export async function switchUserAccountRole(
  accountType: AccountType,
): Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }> {
  const nextRole: AccountType = accountType === 'host' ? 'host' : 'traveller';
  const data = await withBackendFallback(
    async () => {
      const serverRes = await apiJson<{
        profile: UserProfile;
        privateInfo: UserPrivateInfo;
        rolePersistedInDb?: boolean;
      }>('/api/auth/role', {
        method: 'PATCH',
        body: JSON.stringify({ accountType: nextRole }),
      });

      if (serverRes.rolePersistedInDb === false) {
        writePortalRoleOverride(serverRes.profile.uid, nextRole);
        const supabase = await getSupabaseClient().catch(() => null);
        await supabase?.auth.updateUser({ data: { account_type: nextRole } }).catch(() => undefined);
      } else {
        writePortalRoleOverride(serverRes.profile.uid, null);
      }

      return {
        profile: { ...serverRes.profile, accountType: nextRole },
        privateInfo: serverRes.privateInfo,
      };
    },
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

      if (error || !updated) {
        if (error) {
          console.warn('Role switch DB warning (using persisted override):', error.message);
        }
        writePortalRoleOverride(ensured.profile.uid, nextRole);
      } else {
        writePortalRoleOverride(ensured.profile.uid, null);
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
  let pendingRefresh = false;

  const refresh = async () => {
    if (!active) return;
    if (inFlight) {
      pendingRefresh = true;
      return;
    }
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
      if (active && pendingRefresh) {
        pendingRefresh = false;
        void refresh();
      }
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
    async () => {
      const remote = await withBackendFallback(
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
      );
      return mergeListingsWithLocal(remote, (l) => l.isPublished);
    },
    onData,
  );
}

export function subscribeHostListings(
  hostId: string,
  onData: (items: Listing[]) => void,
): () => void {
  return createPollingSubscription(
    async () => {
      const remote = await withBackendFallback(
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
      );
      return mergeListingsWithLocal(remote, (l) => l.hostId === hostId);
    },
    onData,
  );
}

export function subscribeActiveAvailability(
  onData: (slots: AvailabilitySlot[]) => void,
): () => void {
  return createPollingSubscription(
    async () => {
      const remote = await withBackendFallback(
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
      );
      return mergeSlotsWithLocal(remote);
    },
    onData,
  );
}

export function subscribeTravellerBookings(
  travellerId: string,
  onData: (bookings: Booking[]) => void,
): () => void {
  return createPollingSubscription(
    async () => {
      const remote = await withBackendFallback(
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
      );
      return mergeBookingsWithLocal(remote, (b) => b.travellerId === travellerId);
    },
    onData,
  );
}

export function subscribeHostBookings(
  hostId: string,
  onData: (bookings: Booking[]) => void,
): () => void {
  return createPollingSubscription(
    async () => {
      const remote = await withBackendFallback(
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
      );
      return mergeBookingsWithLocal(remote, (b) => b.hostId === hostId);
    },
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
        const { data: hostListings } = await supabase
          .from('listings')
          .select('id')
          .eq('host_id', hostId);

        if (hostListings && hostListings.length > 0) {
          const nowIso = new Date().toISOString();
          for (const item of hostListings) {
            writeQrEntry(LISTING_QR_STORAGE_KEY, String((item as { id: string }).id), paymentQrUrl);
          }
          const destRows = hostListings.map((item) => ({
            listing_id: String((item as { id: string }).id),
            host_id: hostId,
            payee_name: basePayload.payee_name,
            payment_phone: basePayload.phone,
            upi_id: basePayload.payout_upi_id,
            preferred_app: basePayload.preferred_payment_app,
            created_at: nowIso,
            updated_at: nowIso,
          }));
          const syncRes = await supabase
            .from('listing_payment_destinations')
            .upsert(
              destRows.map((row) => ({ ...row, payment_qr_url: paymentQrUrl })),
              { onConflict: 'listing_id' },
            );
          if (syncRes.error && isMissingPaymentQrColumnError(syncRes.error.message)) {
            await supabase
              .from('listing_payment_destinations')
              .upsert(destRows, { onConflict: 'listing_id' });
          } else if (syncRes.error) {
            console.warn('Payment destination sync warning:', syncRes.error.message);
          }
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
  const localDest = readLocalListingDestinations()[listingId];
  if (listingId.startsWith('lst-local-') && localDest) {
    return localDest;
  }

  const remoteDest = await withBackendFallback<ListingPaymentDestination | null>(
    () =>
      apiJson<ListingPaymentDestination | null>(
        `/api/listings/${encodeURIComponent(listingId)}/payment-destination`,
      ),
    async (): Promise<ListingPaymentDestination | null> => {
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
      const hostName = String((listingRow as Record<string, unknown>).host_name || 'Tourx Host');
      const fallbackQr = getListingQrLocal(listingId) || getHostQrLocal(hostId);

      const { data: privRow } = await supabase
        .from('user_private_info')
        .select('*')
        .eq('uid', hostId)
        .maybeSingle();

      if (!privRow) {
        if (!fallbackQr) return null;
        return {
          listingId,
          hostId,
          payeeName: hostName,
          paymentPhone: '',
          upiId: '',
          preferredApp: 'both',
          paymentQrUrl: fallbackQr,
        };
      }
      const priv = privRow as Record<string, unknown>;
      const app = priv.preferred_payment_app;
      return {
        listingId,
        hostId,
        payeeName: String(priv.payee_name || hostName),
        paymentPhone: String(priv.phone || ''),
        upiId: String(priv.payout_upi_id || ''),
        preferredApp: app === 'phonepe' || app === 'gpay' ? app : 'both',
        paymentQrUrl:
          (typeof priv.payment_qr_url === 'string' ? priv.payment_qr_url : '') || fallbackQr,
      };
    },
  );
  return remoteDest || localDest || null;
}

export async function createHostListing(
  hostId: string,
  hostName: string,
  input: CreateListingInput,
): Promise<string> {
  const buildLocalListingRecord = (listingId: string, ownerId: string): Listing => {
    const now = new Date().toISOString();
    return {
      id: listingId,
      hostId: ownerId,
      hostName: clampString(hostName, 80) || 'Tourx Host',
      category: input.category,
      title: clampString(input.title, 140),
      description: clampString(input.description, 2000),
      locationName: clampString(input.locationName, 140),
      country: clampString(input.country, 80),
      lat: Number.isFinite(Number(input.lat)) ? Number(input.lat) : 15.2993,
      lng: Number.isFinite(Number(input.lng)) ? Number(input.lng) : 74.124,
      pricePerUnitInr: Number.isFinite(Number(input.pricePerUnitInr))
        ? Math.max(100, Math.round(Number(input.pricePerUnitInr)))
        : 1000,
      unitLabel: input.unitLabel,
      maxGuests: Number.isFinite(Number(input.maxGuests))
        ? Math.max(1, Math.min(30, Math.round(Number(input.maxGuests))))
        : 2,
      amenities: (input.amenities || []).slice(0, 15).map((a) => clampString(a, 60)),
      photos: (input.photos || []).slice(0, 6),
      blockedDates: (input.blockedDates || []).slice(0, 365),
      isPublished: Boolean(input.isPublished),
      rating: 5.0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  };

  let res: { id: string };
  try {
    res = await withBackendFallback(
      () =>
        apiJson<{ id: string }>('/api/listings', {
          method: 'POST',
          body: JSON.stringify({ hostId, hostName, input }),
        }),
      async () => {
        const supabase = await getSupabaseClient();
        const { data: authData } = await supabase.auth
          .getUser()
          .catch(() => ({ data: { user: null } }));
        const verifiedHostId = authData?.user?.id || hostId;
        const listingId = `lst-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
        const now = new Date().toISOString();

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

        const { error } = await supabase.from('listings').insert({
          id: listingId,
          host_id: verifiedHostId,
          host_name: clampString(hostName, 80) || 'Tourx Host',
          category: input.category,
          title: clampString(input.title, 140),
          description: clampString(input.description, 2000),
          location_name: clampString(input.locationName, 140),
          country: clampString(input.country, 80),
          lat: safeLat,
          lng: safeLng,
          price_per_unit_inr: safePrice,
          unit_label: input.unitLabel,
          max_guests: safeGuests,
          amenities: (input.amenities || []).slice(0, 15).map((a) => clampString(a, 60)),
          photos: (input.photos || []).slice(0, 6),
          blocked_dates: (input.blockedDates || []).slice(0, 365),
          is_published: Boolean(input.isPublished),
          rating: 5.0,
          review_count: 0,
          created_at: now,
          updated_at: now,
        });

        if (error) {
          if (isRlsOrPermissionError(error.message)) {
            throw new RlsPermissionError(error.message);
          }
          throw new Error(error.message || 'Failed to create listing.');
        }

        if (input.paymentDestination) {
          const paymentQrUrl = clampString(input.paymentDestination.paymentQrUrl || '', 750000);
          writeQrEntry(LISTING_QR_STORAGE_KEY, listingId, paymentQrUrl);
          const destBase = {
            listing_id: listingId,
            host_id: verifiedHostId,
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
  } catch (err) {
    if (isRlsOrPermissionError(err)) {
      const localId = `lst-local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const localListing = buildLocalListingRecord(localId, hostId);
      writeLocalListings([localListing, ...readLocalListings().filter((l) => l.id !== localId)]);
      if (input.paymentDestination) {
        const paymentQrUrl = clampString(input.paymentDestination.paymentQrUrl || '', 750000);
        writeQrEntry(LISTING_QR_STORAGE_KEY, localId, paymentQrUrl);
        writeLocalListingDestination(localId, {
          listingId: localId,
          hostId,
          payeeName: clampString(input.paymentDestination.payeeName, 80) || localListing.hostName,
          paymentPhone: clampString(input.paymentDestination.paymentPhone, 32),
          upiId: clampString(input.paymentDestination.upiId, 80),
          preferredApp: input.paymentDestination.preferredApp || 'both',
          paymentQrUrl,
        });
      }
      emitBackendChange();
      return localId;
    }
    throw err;
  }

  emitBackendChange();
  return res.id;
}

export async function updateHostListing(
  listingId: string,
  hostId: string,
  hostName: string,
  input: Omit<CreateListingInput, 'blockedDates'>,
): Promise<void> {
  const localListings = readLocalListings();
  const existingLocal = localListings.find((l) => l.id === listingId);
  if (existingLocal) {
    const updated: Listing = {
      ...existingLocal,
      hostName: clampString(hostName, 80) || existingLocal.hostName,
      category: input.category,
      title: clampString(input.title, 140),
      description: clampString(input.description, 2000),
      locationName: clampString(input.locationName, 140),
      country: clampString(input.country, 80),
      lat: Number(input.lat),
      lng: Number(input.lng),
      pricePerUnitInr: Math.max(100, Math.round(Number(input.pricePerUnitInr))),
      unitLabel: input.unitLabel,
      maxGuests: Math.max(1, Math.min(30, Math.round(Number(input.maxGuests)))),
      amenities: (input.amenities || []).slice(0, 15).map((a) => clampString(a, 60)),
      photos: (input.photos || []).slice(0, 6),
      isPublished: Boolean(input.isPublished),
      updatedAt: new Date().toISOString(),
    };
    writeLocalListings(localListings.map((l) => (l.id === listingId ? updated : l)));
    if (input.paymentDestination) {
      const paymentQrUrl = clampString(input.paymentDestination.paymentQrUrl || '', 750000);
      writeQrEntry(LISTING_QR_STORAGE_KEY, listingId, paymentQrUrl);
      writeLocalListingDestination(listingId, {
        listingId,
        hostId,
        payeeName: clampString(input.paymentDestination.payeeName, 80) || updated.hostName,
        paymentPhone: clampString(input.paymentDestination.paymentPhone, 32),
        upiId: clampString(input.paymentDestination.upiId, 80),
        preferredApp: input.paymentDestination.preferredApp || 'both',
        paymentQrUrl,
      });
    }
    emitBackendChange();
    return;
  }

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
  const localListings = readLocalListings();
  const existingLocal = localListings.find((l) => l.id === listingId);
  if (existingLocal) {
    writeLocalListings(
      localListings.map((l) =>
        l.id === listingId
          ? { ...l, blockedDates: blockedDates.slice(0, 365), updatedAt: new Date().toISOString() }
          : l,
      ),
    );
    emitBackendChange();
    return;
  }

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
  const localListings = readLocalListings();
  if (localListings.some((l) => l.id === listingId)) {
    writeLocalListings(localListings.filter((l) => l.id !== listingId));
    writeLocalListingDestination(listingId, null);
    emitBackendChange();
    return;
  }

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
  const buildLocalBookingRecord = (bookingId: string, travellerId: string): Booking => {
    const now = new Date().toISOString();
    const totalAmt = Math.max(100, Math.round(payload.totalAmountInr));
    const serviceFee = Math.max(0, Math.round(payload.serviceFeeInr));
    return {
      id: bookingId,
      listingId: payload.listing.id,
      listingTitle: payload.listing.title,
      listingLocation: payload.listing.locationName,
      listingCategory: payload.listing.category,
      listingPhoto: payload.listing.photos[0] || '',
      hostId: payload.listing.hostId,
      hostName: payload.listing.hostName,
      hostPayeeName: clampString(payload.hostPayeeName || payload.listing.hostName, 80) || 'Tourx Host',
      hostPaymentPhone: clampString(payload.hostPaymentPhone || '', 32),
      hostUpiId: clampString(payload.hostUpiId || 'host@ybl', 80),
      travellerId,
      travellerName: clampString(payload.travellerName, 80) || 'Tourx Traveller',
      checkInDate: payload.checkInDate,
      checkOutDate: payload.checkOutDate,
      nightsOrUnits: Math.max(1, Math.min(90, payload.nightsOrUnits)),
      guests: Math.max(1, Math.min(30, payload.guests)),
      subtotalInr: Math.max(100, Math.round(payload.subtotalInr)),
      serviceFeeInr: serviceFee,
      totalAmountInr: totalAmt,
      hostNetPayoutInr: Math.max(90, totalAmt - serviceFee),
      displayCurrency: payload.displayCurrency,
      paymentMethod: payload.paymentMethod,
      paymentMode: payload.paymentMode,
      upiHandle: clampString(payload.upiHandle, 80),
      transactionRef: clampString(payload.transactionRef, 64),
      paymentStatus: 'paid',
      bookingStatus: 'confirmed',
      createdAt: now,
      updatedAt: now,
    };
  };

  const localFallbackListing = readLocalListings().find((l) => l.id === payload.listing.id);
  if (localFallbackListing) {
    const requestedDays = expandRange(payload.checkInDate, payload.checkOutDate);
    const blockedSet = new Set(localFallbackListing.blockedDates || []);
    if (requestedDays.some((day) => blockedSet.has(day))) {
      throw new Error('Selected dates include host-blocked dates. Please pick another range.');
    }
    const takenDays = new Set<string>();
    for (const s of readLocalTestSlots()) {
      if (s.listingId !== localFallbackListing.id || s.status !== 'active') continue;
      for (const d of expandRange(s.checkInDate, s.checkOutDate)) {
        takenDays.add(d);
      }
    }
    if (requestedDays.some((day) => takenDays.has(day))) {
      throw new Error('Those dates were just reserved. Please choose different dates.');
    }
    const localId = `bk-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const localBooking = buildLocalBookingRecord(localId, payload.travellerId);
    saveLocalTestBooking(localBooking);
    emitBackendChange();
    return localBooking;
  }

  let booking: Booking;
  try {
    booking = await withBackendFallback(
      () =>
        apiJson<Booking>('/api/bookings', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      async () => {
        const supabase = await getSupabaseClient();
        const { data: authData } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
        const verifiedTravellerId = authData?.user?.id || payload.travellerId;
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

        const mergedSlots = mergeSlotsWithLocal(
          (existingSlots || []).map((row) => mapAvailabilitySlot(row as Record<string, unknown>)),
        );
        const takenDays = new Set<string>();
        for (const s of mergedSlots) {
          if (s.listingId !== liveListing.id || s.status !== 'active') continue;
          for (const d of expandRange(s.checkInDate, s.checkOutDate)) {
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
            host_payee_name:
              clampString(payload.hostPayeeName || liveListing.hostName, 80) || 'Tourx Host',
            host_payment_phone: clampString(payload.hostPaymentPhone || '', 32),
            host_upi_id: clampString(payload.hostUpiId || 'host@ybl', 80),
            traveller_id: verifiedTravellerId,
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
          if (isRlsOrPermissionError(insertErr?.message)) {
            throw new RlsPermissionError(insertErr?.message || 'Booking insert restricted by RLS.');
          }
          throw new Error(insertErr?.message || 'Unable to complete booking right now.');
        }

        const { error: slotErr } = await supabase.from('availability_slots').insert({
          id: bookingId,
          listing_id: liveListing.id,
          host_id: liveListing.hostId,
          traveller_id: verifiedTravellerId,
          check_in_date: payload.checkInDate,
          check_out_date: payload.checkOutDate,
          status: 'active',
        });

        const mappedBooking = mapBooking(insertedBooking as Record<string, unknown>);
        if (slotErr) {
          if (isRlsOrPermissionError(slotErr.message)) {
            writeLocalTestSlots([
              {
                id: bookingId,
                listingId: liveListing.id,
                hostId: liveListing.hostId,
                travellerId: verifiedTravellerId,
                checkInDate: payload.checkInDate,
                checkOutDate: payload.checkOutDate,
                status: 'active',
              },
              ...readLocalTestSlots().filter((s) => s.id !== bookingId),
            ]);
          } else {
            await supabase.from('bookings').delete().eq('id', bookingId);
            throw new Error(slotErr.message || 'Unable to lock booking dates.');
          }
        }

        return mappedBooking;
      },
    );
  } catch (err) {
    if (isRlsOrPermissionError(err)) {
      if (payload.paymentMode === 'simulated') {
        const localId = `bk-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const localBooking = buildLocalBookingRecord(localId, payload.travellerId);
        saveLocalTestBooking(localBooking);
        emitBackendChange();
        return localBooking;
      }
      throw new Error(
        'Database booking permission is restricted by Supabase RLS. Run the SQL in supabase_rls_setup.sql inside your Supabase SQL Editor, or use Test Mode to reserve.',
      );
    }
    throw err;
  }

  emitBackendChange();
  return booking;
}

export async function updateBookingStatusAtomic(
  bookingId: string,
  newStatus: Exclude<BookingStatus, 'confirmed'>,
): Promise<void> {
  const localBookings = readLocalTestBookings();
  const existingLocal = localBookings.find((b) => b.id === bookingId);
  if (existingLocal) {
    const updatedBooking: Booking = {
      ...existingLocal,
      bookingStatus: newStatus,
      updatedAt: new Date().toISOString(),
    };
    writeLocalTestBookings(localBookings.map((b) => (b.id === bookingId ? updatedBooking : b)));
    if (newStatus === 'cancelled') {
      writeLocalTestSlots(
        readLocalTestSlots().map((s) => (s.id === bookingId ? { ...s, status: 'cancelled' } : s)),
      );
    }
    emitBackendChange();
    return;
  }

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
        if (isRlsOrPermissionError(error?.message)) {
          throw new Error(
            'Updating booking status is restricted by Supabase RLS. Run supabase_rls_setup.sql in Supabase SQL Editor to enable status updates.',
          );
        }
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

export function subscribeListingReviews(onData: (reviews: ListingReview[]) => void): () => void {
  return createPollingSubscription(
    async () => {
      const remote = await withBackendFallback(
        () => apiJson<ListingReview[]>('/api/reviews'),
        async () => {
          const supabase = await getSupabaseClient();
          const { data, error } = await supabase
            .from('listing_reviews')
            .select('*')
            .order('updated_at', { ascending: false });
          if (error) {
            if (isMissingReviewsTableError(error.message) || isRlsOrPermissionError(error.message)) {
              return [];
            }
            throw new Error(error.message);
          }
          return (data || []).map((row) => mapListingReview(row as Record<string, unknown>));
        },
      );
      return mergeReviewsWithLocal(remote);
    },
    onData,
  );
}

export async function submitTravellerReview(
  travellerId: string,
  input: SubmitReviewInput,
): Promise<ListingReview> {
  const cleanRating = Math.max(1, Math.min(5, Math.round(Number(input.rating))));
  const cleanComment = clampString(input.comment, 600);
  const now = new Date().toISOString();

  const buildLocalReview = (ownerId: string): ListingReview => ({
    id: `rv_${input.listingId}_${ownerId}`,
    listingId: input.listingId,
    bookingId: input.bookingId || '',
    hostId: input.hostId,
    travellerId: ownerId,
    travellerName: clampString(input.travellerName, 80) || 'Tourx Traveller',
    rating: cleanRating,
    comment: cleanComment,
    verifiedStay: Boolean(input.verifiedStay),
    createdAt: now,
    updatedAt: now,
  });

  if (input.listingId.startsWith('lst-local-')) {
    const localReview = buildLocalReview(travellerId);
    writeLocalReviews([
      localReview,
      ...readLocalReviews().filter((r) => r.id !== localReview.id),
    ]);
    emitBackendChange();
    return localReview;
  }

  let saved: ListingReview;
  try {
    saved = await withBackendFallback(
      () =>
        apiJson<ListingReview>('/api/reviews', {
          method: 'POST',
          body: JSON.stringify({
            listingId: input.listingId,
            hostId: input.hostId,
            bookingId: input.bookingId,
            rating: cleanRating,
            comment: cleanComment,
            travellerName: input.travellerName,
            verifiedStay: input.verifiedStay,
          }),
        }),
      async () => {
        const supabase = await getSupabaseClient();
        const { data: authData } = await supabase.auth
          .getUser()
          .catch(() => ({ data: { user: null } }));
        const verifiedTravellerId = authData?.user?.id || travellerId;
        const verifiedReviewId = `rv_${input.listingId}_${verifiedTravellerId}`;

        const { data, error } = await supabase
          .from('listing_reviews')
          .upsert(
            {
              id: verifiedReviewId,
              listing_id: input.listingId,
              booking_id: clampString(input.bookingId || '', 120),
              host_id: input.hostId,
              traveller_id: verifiedTravellerId,
              traveller_name: clampString(input.travellerName, 80) || 'Tourx Traveller',
              rating: cleanRating,
              comment: cleanComment,
              verified_stay: Boolean(input.verifiedStay),
              updated_at: now,
            },
            { onConflict: 'id' },
          )
          .select('*')
          .single();

        if (error || !data) {
          const msg = error?.message || 'Unable to save rating.';
          if (isMissingReviewsTableError(msg) || isRlsOrPermissionError(msg)) {
            throw new RlsPermissionError(msg);
          }
          throw new Error(msg);
        }

        return mapListingReview(data as Record<string, unknown>);
      },
    );
  } catch (err) {
    if (isRlsOrPermissionError(err) || isMissingReviewsTableError(err) || (err instanceof Error && err.message.includes('(503)'))) {
      const localReview = buildLocalReview(travellerId);
      writeLocalReviews([
        localReview,
        ...readLocalReviews().filter((r) => r.id !== localReview.id),
      ]);
      emitBackendChange();
      return localReview;
    }
    throw err;
  }

  emitBackendChange();
  return saved;
}

export function applyReviewMetricsToListings(
  listings: Listing[],
  reviews: ListingReview[],
): Listing[] {
  if (reviews.length === 0) return listings;
  const stats = new Map<string, { sum: number; count: number }>();
  for (const rev of reviews) {
    const prev = stats.get(rev.listingId) || { sum: 0, count: 0 };
    prev.sum += rev.rating;
    prev.count += 1;
    stats.set(rev.listingId, prev);
  }
  return listings.map((item) => {
    const stat = stats.get(item.id);
    if (!stat || stat.count === 0) return item;
    return {
      ...item,
      rating: Math.round((stat.sum / stat.count) * 10) / 10,
      reviewCount: stat.count,
    };
  });
}

