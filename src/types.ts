export type AccountType = 'traveller' | 'host';

export type ListingCategory = 'homestay' | 'guide' | 'cultural';

export type CurrencyCode = 'INR' | 'USD' | 'EUR';

export type PaymentMethod = 'phonepe' | 'gpay';

export type PreferredPaymentApp = 'phonepe' | 'gpay' | 'both';

export type PaymentMode = 'live_upi' | 'simulated';

export type BookingStatus = 'confirmed' | 'completed' | 'cancelled';

export type UnitLabel = 'night' | 'session' | 'person';

export interface UserProfile {
  uid: string;
  displayName: string;
  accountType: AccountType;
  avatarUrl?: string;
  bio?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserPrivateInfo {
  email: string;
  phone?: string;
  payoutUpiId?: string;
  payeeName?: string;
  preferredPaymentApp?: PreferredPaymentApp;
  paymentQrUrl?: string;
  updatedAt?: unknown;
}

export interface ListingPaymentDestination {
  listingId: string;
  hostId: string;
  payeeName: string;
  paymentPhone: string;
  upiId: string;
  preferredApp: PreferredPaymentApp;
  paymentQrUrl?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Listing {
  id: string;
  hostId: string;
  hostName: string;
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
  rating: number;
  reviewCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Booking {
  id: string;
  listingId: string;
  listingTitle: string;
  listingLocation: string;
  listingCategory: ListingCategory;
  listingPhoto: string;
  hostId: string;
  hostName: string;
  hostPayeeName: string;
  hostPaymentPhone: string;
  hostUpiId: string;
  travellerId: string;
  travellerName: string;
  checkInDate: string;
  checkOutDate: string;
  nightsOrUnits: number;
  guests: number;
  subtotalInr: number;
  serviceFeeInr: number;
  totalAmountInr: number;
  hostNetPayoutInr: number;
  displayCurrency: CurrencyCode;
  paymentMethod: PaymentMethod;
  paymentMode: PaymentMode;
  upiHandle: string;
  transactionRef: string;
  paymentStatus: 'paid';
  bookingStatus: BookingStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AvailabilitySlot {
  id: string;
  listingId: string;
  hostId: string;
  travellerId: string;
  checkInDate: string;
  checkOutDate: string;
  status: 'active' | 'cancelled';
}

export interface ListingReview {
  id: string;
  listingId: string;
  bookingId?: string;
  hostId: string;
  travellerId: string;
  travellerName: string;
  rating: number;
  comment: string;
  verifiedStay: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AppView = 'discover' | 'map' | 'trips' | 'host';
