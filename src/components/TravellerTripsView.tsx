import React, { useState } from 'react';
import { Calendar, CheckCircle2, Compass, Receipt, Star, XCircle } from 'lucide-react';
import { Booking, CurrencyCode, ListingReview, UserProfile } from '../types';
import { formatCurrency } from '../utils/currency';
import { formatReadableDate } from '../utils/dates';
import { StarRatingInput } from './StarRatingInput';

interface TravellerTripsViewProps {
  userProfile: UserProfile | null;
  bookings: Booking[];
  reviews: ListingReview[];
  currency: CurrencyCode;
  onOpenAuth: () => void;
  onExplore: () => void;
  onCancelBooking: (bookingId: string) => Promise<void>;
  onSubmitReview: (input: {
    listingId: string;
    hostId: string;
    bookingId?: string;
    rating: number;
    comment: string;
    verifiedStay?: boolean;
  }) => Promise<ListingReview>;
}

export const TravellerTripsView: React.FC<TravellerTripsViewProps> = ({
  userProfile,
  bookings,
  reviews,
  currency,
  onOpenAuth,
  onExplore,
  onCancelBooking,
  onSubmitReview,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [ratingBookingId, setRatingBookingId] = useState<string | null>(null);
  const [draftRating, setDraftRating] = useState(5);
  const [draftComment, setDraftComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingError, setRatingError] = useState<string | null>(null);

  if (!userProfile) {
    return (
      <div className="max-w-2xl mx-auto my-20 px-4 text-center">
        <div className="p-8 rounded-2xl border border-slate-200 bg-white space-y-4">
          <Compass className="w-10 h-10 text-teal-600 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-900">Sign in to view your trips</h1>
          <p className="text-sm text-slate-600">
            Access your confirmed homestays, local guide bookings, and PhonePe / Google Pay payment receipts.
          </p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-6 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
          >
            Sign in as Traveller
          </button>
        </div>
      </div>
    );
  }

  const handleCancel = async (id: string) => {
    setCancelError(null);
    setBusyId(id);
    try {
      await onCancelBooking(id);
    } catch (err) {
      setCancelError(
        err instanceof Error ? err.message : 'Unable to cancel booking. Please try again.',
      );
    } finally {
      setBusyId(null);
    }
  };

  const openRatingForm = (bk: Booking, existingReview: ListingReview | undefined) => {
    if (ratingBookingId === bk.id) {
      setRatingBookingId(null);
      setRatingError(null);
      return;
    }
    setRatingBookingId(bk.id);
    setDraftRating(existingReview ? existingReview.rating : 5);
    setDraftComment(existingReview ? existingReview.comment : '');
    setRatingError(null);
  };

  const handleSaveTripRating = async (e: React.FormEvent, bk: Booking) => {
    e.preventDefault();
    setRatingError(null);
    setSubmittingRating(true);
    try {
      await onSubmitReview({
        listingId: bk.listingId,
        hostId: bk.hostId,
        bookingId: bk.id,
        rating: draftRating,
        comment: draftComment,
        verifiedStay: true,
      });
      setRatingBookingId(null);
    } catch (err) {
      setRatingError(err instanceof Error ? err.message : 'Unable to save rating right now.');
    } finally {
      setSubmittingRating(false);
    }
  };

  return (
    <div className="max-w-[1120px] mx-auto px-4 sm:px-8 py-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Trips &amp; Receipts</h1>
          <p className="text-sm text-slate-600 mt-0.5">
            All bookings made by {userProfile.displayName} with instant UPI verification and trip ratings.
          </p>
        </div>
        <button
          type="button"
          onClick={onExplore}
          className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors whitespace-nowrap self-start sm:self-auto"
        >
          Explore More Places
        </button>
      </div>

      {cancelError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between gap-3">
          <span>{cancelError}</span>
          <button
            type="button"
            onClick={() => setCancelError(null)}
            className="font-semibold hover:underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {bookings.length === 0 ? (
        <div className="p-12 text-center border border-slate-200 rounded-2xl bg-slate-50/50 space-y-3">
          <Calendar className="w-9 h-9 text-slate-400 mx-auto" />
          <h2 className="text-lg font-bold text-slate-900">No reservations yet</h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Browse local homestays, guided walks, or cultural workshops and check out in seconds using PhonePe or Google Pay.
          </p>
          <button
            type="button"
            onClick={onExplore}
            className="px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            Browse Destinations
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {bookings.map((bk) => {
            const existingReview = reviews.find(
              (r) => r.listingId === bk.listingId && r.travellerId === userProfile.uid,
            );
            const isRatingOpen = ratingBookingId === bk.id;

            return (
              <div
                key={bk.id}
                className="p-5 rounded-2xl border border-slate-200 bg-white space-y-4"
              >
                <div className="flex flex-col md:flex-row gap-5 items-start md:items-center justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <img
                      src={bk.listingPhoto}
                      alt={bk.listingTitle}
                      referrerPolicy="no-referrer"
                      className="w-24 h-20 rounded-xl object-cover shrink-0 bg-slate-100"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">
                        {bk.listingLocation} · Hosted by {bk.hostName}
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-0.5 truncate">
                        {bk.listingTitle}
                      </h3>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-slate-600 font-mono-nums">
                        <span>
                          {formatReadableDate(bk.checkInDate)}
                          {bk.listingCategory === 'homestay'
                            ? ` → ${formatReadableDate(bk.checkOutDate)}`
                            : ''}
                        </span>
                        <span>·</span>
                        <span>{bk.guests} guests</span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Receipt className="w-3.5 h-3.5 text-slate-400" />
                          {bk.paymentMethod === 'phonepe' ? 'PhonePe' : 'Google Pay'} (
                          {bk.transactionRef})
                        </span>
                        {bk.hostUpiId && (
                          <>
                            <span>·</span>
                            <span className="text-teal-700">
                              Paid to {bk.hostPaymentPhone ? `${bk.hostPaymentPhone} · ` : ''}
                              {bk.hostUpiId}
                            </span>
                          </>
                        )}
                      </div>
                      {existingReview && (
                        <div className="flex items-center gap-1.5 mt-2 text-xs text-amber-700 font-medium">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span className="font-mono-nums">
                            You rated {existingReview.rating}/5
                          </span>
                          {existingReview.comment && (
                            <span className="text-slate-500 font-normal truncate max-w-md">
                              · &ldquo;{existingReview.comment}&rdquo;
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between md:justify-end gap-3 w-full md:w-auto pt-3 md:pt-0 border-t md:border-t-0 border-slate-100 shrink-0">
                    <div className="text-left md:text-right mr-2">
                      <p className="text-base font-bold font-mono-nums text-slate-900">
                        {formatCurrency(bk.totalAmountInr, currency)}
                      </p>
                      <p
                        className={`text-xs font-semibold flex items-center md:justify-end gap-1 mt-0.5 ${
                          bk.bookingStatus === 'confirmed'
                            ? 'text-emerald-700'
                            : bk.bookingStatus === 'completed'
                              ? 'text-sky-700'
                              : 'text-slate-500'
                        }`}
                      >
                        {bk.bookingStatus === 'cancelled' ? (
                          <XCircle className="w-3.5 h-3.5" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        )}
                        {bk.bookingStatus === 'confirmed'
                          ? 'Confirmed'
                          : bk.bookingStatus === 'completed'
                            ? 'Completed'
                            : 'Cancelled'}
                      </p>
                    </div>

                    {bk.bookingStatus !== 'cancelled' && (
                      <button
                        type="button"
                        onClick={() => openRatingForm(bk, existingReview)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-200 bg-amber-50/70 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors whitespace-nowrap"
                      >
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />
                        {isRatingOpen
                          ? 'Close'
                          : existingReview
                            ? 'Edit Rating'
                            : 'Rate Experience'}
                      </button>
                    )}

                    {bk.bookingStatus === 'confirmed' && (
                      <button
                        type="button"
                        disabled={busyId === bk.id}
                        onClick={() => void handleCancel(bk.id)}
                        className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {busyId === bk.id ? 'Cancelling...' : 'Cancel Booking'}
                      </button>
                    )}
                  </div>
                </div>

                {isRatingOpen && (
                  <form
                    onSubmit={(e) => void handleSaveTripRating(e, bk)}
                    className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Rate {bk.listingTitle}
                      </span>
                      <StarRatingInput
                        value={draftRating}
                        onChange={setDraftRating}
                        disabled={submittingRating}
                      />
                    </div>
                    <textarea
                      rows={2}
                      maxLength={600}
                      value={draftComment}
                      onChange={(e) => setDraftComment(e.target.value)}
                      placeholder="Write a quick review about the stay, guide, or local hospitality..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                    {ratingError && (
                      <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                        {ratingError}
                      </div>
                    )}
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setRatingBookingId(null)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={submittingRating}
                        className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700 disabled:opacity-60 transition-colors"
                      >
                        {submittingRating
                          ? 'Saving...'
                          : existingReview
                            ? 'Update Rating'
                            : 'Submit Rating'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
