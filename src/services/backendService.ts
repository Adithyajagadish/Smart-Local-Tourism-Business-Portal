import { getAccessToken, refreshAccessToken } from '../lib/supabase';
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

  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (res.status === 401 && !hasRetried) {
    const refreshed = await refreshAccessToken();
    if (refreshed && refreshed !== token) {
      return apiJson<T>(url, init, refreshed, true);
    }
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

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
    throw new Error(
      'Backend API returned HTML instead of JSON. Ensure the Node server (`npm run start`) is running for `/api/*` routes.',
    );
  }

  return (await res.json()) as T;
}

export async function fetchAuthenticatedProfile(explicitToken?: string): Promise<{
  profile: UserProfile;
  privateInfo: UserPrivateInfo;
}> {
  return apiJson<{ profile: UserProfile; privateInfo: UserPrivateInfo }>(
    '/api/auth/me',
    undefined,
    explicitToken,
  );
}

export async function switchUserAccountRole(
  accountType: AccountType,
): Promise<{ profile: UserProfile; privateInfo: UserPrivateInfo }> {
  const data = await apiJson<{ profile: UserProfile; privateInfo: UserPrivateInfo }>(
    '/api/auth/role',
    {
      method: 'PATCH',
      body: JSON.stringify({ accountType }),
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
  return createPollingSubscription(() => apiJson<Listing[]>('/api/listings'), onData);
}

export function subscribeHostListings(
  hostId: string,
  onData: (items: Listing[]) => void,
): () => void {
  return createPollingSubscription(
    () => apiJson<Listing[]>(`/api/hosts/${encodeURIComponent(hostId)}/listings`),
    onData,
  );
}

export function subscribeActiveAvailability(
  onData: (slots: AvailabilitySlot[]) => void,
): () => void {
  return createPollingSubscription(() => apiJson<AvailabilitySlot[]>('/api/availability'), onData);
}

export function subscribeTravellerBookings(
  travellerId: string,
  onData: (bookings: Booking[]) => void,
): () => void {
  return createPollingSubscription(
    () => apiJson<Booking[]>(`/api/travellers/${encodeURIComponent(travellerId)}/bookings`),
    onData,
  );
}

export function subscribeHostBookings(
  hostId: string,
  onData: (bookings: Booking[]) => void,
): () => void {
  return createPollingSubscription(
    () => apiJson<Booking[]>(`/api/hosts/${encodeURIComponent(hostId)}/bookings`),
    onData,
  );
}

export function subscribeUserPrivateInfo(
  uid: string,
  onData: (info: UserPrivateInfo | null) => void,
): () => void {
  return createPollingSubscription(
    () => apiJson<UserPrivateInfo | null>(`/api/users/${encodeURIComponent(uid)}/private`),
    onData,
  );
}

export async function saveHostPayoutSettings(
  hostId: string,
  input: HostPayoutSettingsInput,
): Promise<void> {
  await apiJson<UserPrivateInfo>(`/api/users/${encodeURIComponent(hostId)}/private`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  emitBackendChange();
}

export async function getListingPaymentDestination(
  listingId: string,
): Promise<ListingPaymentDestination | null> {
  return apiJson<ListingPaymentDestination | null>(
    `/api/listings/${encodeURIComponent(listingId)}/payment-destination`,
  );
}

export async function createHostListing(
  hostId: string,
  hostName: string,
  input: CreateListingInput,
): Promise<string> {
  const res = await apiJson<{ id: string }>('/api/listings', {
    method: 'POST',
    body: JSON.stringify({ hostId, hostName, input }),
  });
  emitBackendChange();
  return res.id;
}

export async function updateHostListing(
  listingId: string,
  hostId: string,
  hostName: string,
  input: Omit<CreateListingInput, 'blockedDates'>,
): Promise<void> {
  await apiJson<Listing>(`/api/listings/${encodeURIComponent(listingId)}`, {
    method: 'PUT',
    body: JSON.stringify({ hostId, hostName, input }),
  });
  emitBackendChange();
}

export async function updateListingBlockedDates(
  listingId: string,
  blockedDates: string[],
): Promise<void> {
  await apiJson<Listing>(`/api/listings/${encodeURIComponent(listingId)}/blocked-dates`, {
    method: 'PATCH',
    body: JSON.stringify({ blockedDates }),
  });
  emitBackendChange();
}

export async function deleteHostListing(listingId: string): Promise<void> {
  await apiJson<{ ok: boolean }>(`/api/listings/${encodeURIComponent(listingId)}`, {
    method: 'DELETE',
  });
  emitBackendChange();
}

export async function createBookingAtomic(payload: CreateBookingPayload): Promise<Booking> {
  const booking = await apiJson<Booking>('/api/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  emitBackendChange();
  return booking;
}

export async function updateBookingStatusAtomic(
  bookingId: string,
  newStatus: Exclude<BookingStatus, 'confirmed'>,
): Promise<void> {
  await apiJson<Booking>(`/api/bookings/${encodeURIComponent(bookingId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ newStatus }),
  });
  emitBackendChange();
}
