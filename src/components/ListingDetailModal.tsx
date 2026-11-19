import React, { useEffect, useMemo, useState } from 'react';
import { AudioLines, Check, MapPin, Star, Users, X } from 'lucide-react';
import { getListingPaymentDestination } from '../services/backendService';
import {
  AvailabilitySlot,
  Booking,
  CurrencyCode,
  Listing,
  PaymentMethod,
  PaymentMode,
  UserProfile,
} from '../types';
import { formatCurrency } from '../utils/currency';
import {
  buildUnavailableDateSet,
  diffDaysIso,
  formatReadableDate,
  hasConflictInRange,
} from '../utils/dates';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { PaymentGatewayModal, ResolvedPaymentDestination } from './PaymentGatewayModal';

interface ListingDetailModalProps {
  listing: Listing | null;
  availabilitySlots: AvailabilitySlot[];
  currency: CurrencyCode;
  userProfile: UserProfile | null;
  onClose: () => void;
  onRequireSignIn: () => void;
  onOpenVoice: (destination: string, listingTitle: string) => void;
  onCompleteBooking: (payload: {
    listing: Listing;
    checkInDate: string;
    checkOutDate: string;
    nightsOrUnits: number;
    guests: number;
    subtotalInr: number;
    serviceFeeInr: number;
    totalAmountInr: number;
    paymentMethod: PaymentMethod;
    paymentMode: PaymentMode;
    upiHandle: string;
    transactionRef: string;
    hostPayeeName: string;
    hostPaymentPhone: string;
    hostUpiId: string;
  }) => Promise<Booking>;
  onViewTrips: () => void;
}

export const ListingDetailModal: React.FC<ListingDetailModalProps> = ({
  listing,
  availabilitySlots,
  currency,
  userProfile,
  onClose,
  onRequireSignIn,
  onOpenVoice,
  onCompleteBooking,
  onViewTrips,
}) => {
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [guests, setGuests] = useState(2);
  const [showGateway, setShowGateway] = useState(false);
  const [loadingGateway, setLoadingGateway] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [resolvedDestination, setResolvedDestination] = useState<ResolvedPaymentDestination | null>(
    null,
  );

  useEffect(() => {
    setActivePhotoIdx(0);
    setStartDate(null);
    setEndDate(null);
    setGuests(listing ? Math.min(2, Math.max(1, listing.maxGuests)) : 2);
    setShowGateway(false);
    setLoadingGateway(false);
    setGatewayError(null);
    setResolvedDestination(null);
  }, [listing?.id, listing?.maxGuests]);

  const unavailableDates = useMemo(() => {
    if (!listing) return {};
    const listingSlots = availabilitySlots.filter((s) => s.listingId === listing.id);
    return buildUnavailableDateSet(listing.blockedDates, listingSlots);
  }, [listing, availabilitySlots]);

  if (!listing) return null;

  const isSingleDate = listing.category !== 'homestay';
  const units =
    startDate && endDate
      ? isSingleDate
        ? listing.unitLabel === 'person'
          ? guests
          : 1
        : Math.max(1, diffDaysIso(startDate, endDate))
      : 0;

  const subtotalInr = units * listing.pricePerUnitInr;
  const serviceFeeInr = Math.round(subtotalInr * 0.05);
  const totalAmountInr = subtotalInr + serviceFeeInr;

  const dateHasConflict =
    startDate && endDate ? hasConflictInRange(startDate, endDate, unavailableDates) : false;

  const canReserve = Boolean(startDate && endDate && units > 0 && !dateHasConflict);

  const handleProceedToPay = async () => {
    if (!userProfile) {
      onRequireSignIn();
      return;
    }
    if (!canReserve) return;

    setGatewayError(null);
    setLoadingGateway(true);
    try {
      const dest = await getListingPaymentDestination(listing.id);
      const hasValidUpi = Boolean(dest?.upiId && dest.upiId.includes('@'));
      const hasQr = Boolean(dest?.paymentQrUrl);
      if (dest && (hasValidUpi || hasQr)) {
        setResolvedDestination({
          payeeName: dest.payeeName,
          paymentPhone: dest.paymentPhone,
          upiId: dest.upiId,
          preferredApp: dest.preferredApp,
          paymentQrUrl: dest.paymentQrUrl || '',
          isConfigured: true,
        });
      } else {
        setResolvedDestination({
          payeeName: listing.hostName,
          paymentPhone: '',
          upiId: '',
          preferredApp: 'both',
          paymentQrUrl: '',
          isConfigured: false,
        });
      }
      setShowGateway(true);
    } catch (err) {
      setGatewayError(
        err instanceof Error
          ? err.message
          : 'Unable to load host payment details. Please try again.',
      );
    } finally {
      setLoadingGateway(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-detail-title"
      >
        <div className="bg-white border border-slate-200 rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto tourx-scroll shadow-2xl relative">
          <button
            type="button"
            onClick={onClose}
            className="sticky top-4 float-right mr-4 mt-4 z-10 p-2 rounded-full bg-white/90 border border-slate-200 text-slate-700 hover:text-slate-900 hover:bg-white shadow-sm"
            aria-label="Close listing details"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="p-6 sm:p-8">
            {/* Header Metadata */}
            <div className="mb-5 pr-10">
              <div className="text-xs font-medium text-slate-500 mb-1.5">
                {listing.category === 'homestay'
                  ? 'Homestay'
                  : listing.category === 'guide'
                    ? 'Local Guide'
                    : 'Cultural Business'}{' '}
                · {listing.locationName}, {listing.country} · Hosted by {listing.hostName}
              </div>
              <h2
                id="listing-detail-title"
                className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
              >
                {listing.title}
              </h2>
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-600">
                <span className="flex items-center gap-1 font-medium text-slate-900">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span className="font-mono-nums">{listing.rating.toFixed(2)}</span>
                  <span className="text-slate-500 font-normal">({listing.reviewCount} reviews)</span>
                </span>
                <span className="flex items-center gap-1">
                  <MapPin className="w-4 h-4 text-teal-600" />
                  {listing.locationName}, {listing.country}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4 text-slate-500" />
                  Up to {listing.maxGuests} guests
                </span>
              </div>
            </div>

            {/* Main 2-Column Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left: Gallery + Description + Amenities */}
              <div className="lg:col-span-7 space-y-6">
                <div className="space-y-2.5">
                  <div className="aspect-[4/3] w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                    <img
                      src={listing.photos[activePhotoIdx] || listing.photos[0]}
                      alt={listing.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {listing.photos.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {listing.photos.map((photo, idx) => (
                        <button
                          key={`${listing.id}-thumb-${idx}`}
                          type="button"
                          onClick={() => setActivePhotoIdx(idx)}
                          className={`w-20 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
                            activePhotoIdx === idx
                              ? 'border-teal-600'
                              : 'border-transparent opacity-70 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={photo}
                            alt={`${listing.title} ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <h3 className="text-lg font-bold text-slate-900">About this experience</h3>
                    <button
                      type="button"
                      onClick={() =>
                        onOpenVoice(`${listing.locationName}, ${listing.country}`, listing.title)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-800 hover:bg-teal-100 transition-colors"
                    >
                      <AudioLines className="w-3.5 h-3.5" />
                      Ask Live Voice Guide
                    </button>
                  </div>
                  <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                    {listing.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-200">
                  <h3 className="text-base font-bold text-slate-900 mb-3">Included Amenities</h3>
                  <div className="grid grid-cols-2 gap-2.5">
                    {listing.amenities.map((amenity) => (
                      <div key={amenity} className="flex items-center gap-2 text-sm text-slate-700">
                        <Check className="w-4 h-4 text-teal-600 shrink-0" />
                        <span>{amenity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right: Sticky Availability Calendar + Booking Box */}
              <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-baseline justify-between">
                  <div>
                    <span className="text-2xl font-bold font-mono-nums text-slate-900">
                      {formatCurrency(listing.pricePerUnitInr, currency)}
                    </span>
                    <span className="text-sm text-slate-600"> / {listing.unitLabel}</span>
                  </div>
                  <span className="text-xs font-medium text-teal-700">
                    PhonePe &amp; Google Pay accepted
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    {isSingleDate
                      ? '1. Pick your session date'
                      : '1. Select check-in & check-out dates'}
                  </label>
                  <AvailabilityCalendar
                    mode="book"
                    singleDateMode={isSingleDate}
                    unavailableDates={unavailableDates}
                    selectedStart={startDate}
                    selectedEnd={endDate}
                    onSelectBookingRange={(s, e) => {
                      setStartDate(s);
                      setEndDate(e);
                    }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="detail-guests"
                    className="block text-xs font-semibold text-slate-700 mb-1.5"
                  >
                    2. Guests (Max {listing.maxGuests})
                  </label>
                  <div className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-700">Travellers</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setGuests((g) => Math.max(1, g - 1))}
                        className="w-7 h-7 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold"
                      >
                        -
                      </button>
                      <span
                        id="detail-guests"
                        className="text-sm font-mono-nums font-semibold w-5 text-center"
                      >
                        {guests}
                      </span>
                      <button
                        type="button"
                        onClick={() => setGuests((g) => Math.min(listing.maxGuests, g + 1))}
                        className="w-7 h-7 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {startDate && endDate ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-600">
                      <span>Selected</span>
                      <span className="font-mono-nums text-slate-900">
                        {formatReadableDate(startDate)}
                        {!isSingleDate ? ` → ${formatReadableDate(endDate)}` : ''}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>
                        {formatCurrency(listing.pricePerUnitInr, currency)} × {units}{' '}
                        {listing.unitLabel}
                        {units > 1 ? 's' : ''}
                      </span>
                      <span className="font-mono-nums text-slate-900">
                        {formatCurrency(subtotalInr, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-600">
                      <span>Tourx service fee (5%)</span>
                      <span className="font-mono-nums text-slate-900">
                        {formatCurrency(serviceFeeInr, currency)}
                      </span>
                    </div>
                    <div className="flex justify-between pt-2 border-t border-slate-200 font-bold text-slate-900">
                      <span>Total</span>
                      <span className="font-mono-nums">
                        {formatCurrency(totalAmountInr, currency)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    {isSingleDate
                      ? 'Select an available date above to calculate total.'
                      : startDate
                        ? 'Now click a check-out date to complete your range.'
                        : 'Select check-in and check-out dates to see live total.'}
                  </p>
                )}

                {gatewayError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {gatewayError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={!canReserve || loadingGateway}
                  onClick={() => void handleProceedToPay()}
                  className="w-full py-3 px-4 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingGateway
                    ? 'Loading Host Payment Details...'
                    : !userProfile
                      ? canReserve
                        ? 'Sign In to Reserve & Pay'
                        : 'Select Dates to Continue'
                      : canReserve
                        ? `Reserve & Pay (${formatCurrency(totalAmountInr, currency)})`
                        : 'Select Dates to Reserve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showGateway && startDate && endDate && userProfile && resolvedDestination && (
        <PaymentGatewayModal
          isOpen={showGateway}
          listing={listing}
          destination={resolvedDestination}
          checkInDate={startDate}
          checkOutDate={endDate}
          nightsOrUnits={units}
          guests={guests}
          subtotalInr={subtotalInr}
          serviceFeeInr={serviceFeeInr}
          totalAmountInr={totalAmountInr}
          currency={currency}
          travellerName={userProfile.displayName}
          onClose={() => setShowGateway(false)}
          onConfirmPayment={(paymentDetails) =>
            onCompleteBooking({
              listing,
              checkInDate: startDate,
              checkOutDate: endDate,
              nightsOrUnits: units,
              guests,
              subtotalInr,
              serviceFeeInr,
              totalAmountInr,
              ...paymentDetails,
            })
          }
          onViewTrips={() => {
            setShowGateway(false);
            onClose();
            onViewTrips();
          }}
        />
      )}
    </>
  );
};
