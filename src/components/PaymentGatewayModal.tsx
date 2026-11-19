import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Lock,
  Phone,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  Booking,
  CurrencyCode,
  Listing,
  PaymentMethod,
  PaymentMode,
  PreferredPaymentApp,
} from '../types';
import { formatCurrency } from '../utils/currency';
import { formatReadableDate } from '../utils/dates';
import { buildUpiLinks, generateUpiQrDataUrl, isValidUpiId } from '../utils/upi';

export interface ResolvedPaymentDestination {
  payeeName: string;
  paymentPhone: string;
  upiId: string;
  preferredApp: PreferredPaymentApp;
  paymentQrUrl?: string;
  isConfigured: boolean;
}

interface PaymentGatewayModalProps {
  isOpen: boolean;
  listing: Listing;
  destination: ResolvedPaymentDestination;
  checkInDate: string;
  checkOutDate: string;
  nightsOrUnits: number;
  guests: number;
  subtotalInr: number;
  serviceFeeInr: number;
  totalAmountInr: number;
  currency: CurrencyCode;
  travellerName: string;
  onClose: () => void;
  onConfirmPayment: (params: {
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

export const PaymentGatewayModal: React.FC<PaymentGatewayModalProps> = ({
  isOpen,
  listing,
  destination,
  checkInDate,
  checkOutDate,
  nightsOrUnits,
  guests,
  subtotalInr,
  serviceFeeInr,
  totalAmountInr,
  currency,
  travellerName,
  onClose,
  onConfirmPayment,
  onViewTrips,
}) => {
  const [method, setMethod] = useState<PaymentMethod>(
    destination.preferredApp === 'gpay' ? 'gpay' : 'phonepe',
  );
  const [upiHandle, setUpiHandle] = useState(
    destination.preferredApp === 'gpay' ? 'traveller@okicici' : 'traveller@ybl',
  );
  const [utrRef, setUtrRef] = useState('');
  const [lockAmountInQr, setLockAmountInQr] = useState(true);
  const [qrSource, setQrSource] = useState<'custom' | 'generated'>(
    destination.paymentQrUrl ? 'custom' : 'generated',
  );
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'phone' | 'upi' | null>(null);
  const [step, setStep] = useState<'select' | 'verifying' | 'receipt'>('select');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmedBooking, setConfirmedBooking] = useState<Booking | null>(null);

  const hasCustomQr = Boolean(destination.paymentQrUrl);
  const hasLiveUpi = destination.isConfigured && isValidUpiId(destination.upiId);
  const canAcceptLivePayment = destination.isConfigured && (hasCustomQr || hasLiveUpi);

  useEffect(() => {
    setQrSource(destination.paymentQrUrl ? 'custom' : 'generated');
  }, [destination.paymentQrUrl, isOpen]);

  const upiLinks = useMemo(() => {
    if (!hasLiveUpi) {
      return { genericUri: '', phonePeUri: '', gPayUri: '' };
    }
    return buildUpiLinks({
      upiId: destination.upiId,
      payeeName: destination.payeeName,
      amountInr: totalAmountInr,
      transactionNote: `Tourx ${listing.title}`,
      omitAmount: !lockAmountInQr,
    });
  }, [hasLiveUpi, destination.upiId, destination.payeeName, totalAmountInr, listing.title, lockAmountInQr]);

  useEffect(() => {
    if (!isOpen || !hasLiveUpi || !upiLinks.genericUri) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void generateUpiQrDataUrl(upiLinks.genericUri)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, hasLiveUpi, upiLinks.genericUri]);

  if (!isOpen) return null;

  const handleMethodChange = (next: PaymentMethod) => {
    setMethod(next);
    if (upiHandle === 'traveller@ybl' || upiHandle === 'traveller@okicici') {
      setUpiHandle(next === 'phonepe' ? 'traveller@ybl' : 'traveller@okicici');
    }
  };

  const handleCopy = async (field: 'phone' | 'upi', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      // Clipboard blocked in restricted iframe fallback
    }
  };

  const executeBooking = async (mode: PaymentMode, refValue: string, handleValue: string) => {
    setErrorMsg(null);
    setStep('verifying');
    try {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const created = await onConfirmPayment({
        paymentMethod: method,
        paymentMode: mode,
        upiHandle: handleValue,
        transactionRef: refValue,
        hostPayeeName: destination.payeeName,
        hostPaymentPhone: destination.paymentPhone || 'Not provided',
        hostUpiId: hasLiveUpi ? destination.upiId : hasCustomQr ? 'host-qr@upi' : 'test-mode@upi',
      });
      setConfirmedBooking(created);
      setStep('receipt');
    } catch (err) {
      setStep('select');
      setErrorMsg(
        err instanceof Error ? err.message : 'Payment could not be completed. Please try again.',
      );
    }
  };

  const handleConfirmRealUpi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAcceptLivePayment) {
      setErrorMsg(
        'This listing does not have a live host UPI ID or QR code configured yet. Use "Test Mode (No Real Charge)" to confirm this booking.',
      );
      return;
    }
    const cleanedHandle = upiHandle.trim();
    const cleanedUtr = utrRef.trim().toUpperCase();

    if (!isValidUpiId(cleanedHandle)) {
      setErrorMsg('Enter your valid paying UPI ID (e.g., name@ybl or name@okicici).');
      return;
    }
    if (cleanedUtr.length < 6) {
      setErrorMsg(
        'Enter the 12-digit UPI UTR / Transaction Reference ID from PhonePe or Google Pay after paying the host.',
      );
      return;
    }

    await executeBooking('live_upi', cleanedUtr, cleanedHandle);
  };

  const handleDemoTestPayment = async () => {
    const cleanedHandle = upiHandle.trim();
    if (!isValidUpiId(cleanedHandle)) {
      setErrorMsg('Enter a valid payer UPI ID (e.g., traveller@ybl).');
      return;
    }
    const simRef = `${method === 'phonepe' ? 'SIMPPE' : 'SIMGPY'}${Date.now().toString().slice(-8)}`;
    await executeBooking('simulated', simRef, cleanedHandle);
  };

  const appLaunchHref = method === 'phonepe' ? upiLinks.phonePeUri : upiLinks.gPayUri;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-gateway-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full max-h-[94vh] overflow-y-auto tourx-scroll shadow-2xl">
        {/* Top Gateway Bar */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-teal-400" />
            <span id="payment-gateway-title" className="text-sm font-semibold">
              Tourx Direct UPI Checkout (PhonePe &amp; Google Pay)
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close payment gateway"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {step === 'select' && (
          <form onSubmit={handleConfirmRealUpi} className="p-5 sm:p-6 space-y-5">
            {/* Order Summary Strip */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{listing.title}</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  {formatReadableDate(checkInDate)}
                  {listing.category === 'homestay' ? ` – ${formatReadableDate(checkOutDate)}` : ''} ·{' '}
                  {guests} {guests === 1 ? 'guest' : 'guests'} · {nightsOrUnits} {listing.unitLabel}
                  {nightsOrUnits > 1 ? 's' : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold font-mono-nums text-slate-900">
                  {formatCurrency(totalAmountInr, currency)}
                </p>
                {currency !== 'INR' && (
                  <p className="text-[11px] font-mono-nums text-slate-500">
                    UPI transfer: ₹{totalAmountInr.toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            </div>

            {/* Host Receiving Number & UPI Account Details */}
            <div className="p-4 rounded-xl border border-teal-200 bg-teal-50/40 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-800">
                  Direct Host Payment Destination
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-white border border-slate-200 rounded-lg p-2.5">
                  <p className="text-[11px] text-slate-500">Pay To Host</p>
                  <p className="font-semibold text-slate-900 mt-0.5 truncate">
                    {destination.payeeName}
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500 flex items-center gap-1">
                      <Phone className="w-3 h-3 text-teal-600" />
                      Host Mobile Number
                    </p>
                    <p className="font-mono-nums font-bold text-slate-900 mt-0.5 truncate">
                      {destination.paymentPhone || 'Via UPI ID'}
                    </p>
                  </div>
                  {destination.paymentPhone && (
                    <button
                      type="button"
                      onClick={() => void handleCopy('phone', destination.paymentPhone)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500 shrink-0"
                      title="Copy host number"
                    >
                      {copiedField === 'phone' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500">Host UPI ID</p>
                    <p className="font-mono-nums font-bold text-slate-900 mt-0.5 truncate">
                      {hasLiveUpi ? destination.upiId : 'Not configured yet'}
                    </p>
                  </div>
                  {hasLiveUpi && (
                    <button
                      type="button"
                      onClick={() => void handleCopy('upi', destination.upiId)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500 shrink-0"
                      title="Copy host UPI ID"
                    >
                      {copiedField === 'upi' ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Gateway Tabs: PhonePe & Google Pay */}
            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2">
                1. Choose Payment Software
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleMethodChange('phonepe')}
                  className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                    method === 'phonepe'
                      ? 'border-[#5F259F] bg-[#5F259F]/5 ring-1 ring-[#5F259F]'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-[#5F259F] text-white font-bold text-sm flex items-center justify-center shrink-0">
                    Pe
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">PhonePe</p>
                    <p className="text-[11px] text-slate-500">Scan QR or Open PhonePe</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleMethodChange('gpay')}
                  className={`p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                    method === 'gpay'
                      ? 'border-[#1A73E8] bg-[#1A73E8]/5 ring-1 ring-[#1A73E8]'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-[#1A73E8] text-white font-bold text-sm flex items-center justify-center shrink-0">
                    GPay
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Google Pay</p>
                    <p className="text-[11px] text-slate-500">Scan QR or Open GPay</p>
                  </div>
                </button>
              </div>
            </div>

            {/* Live Scannable UPI QR + Deep-Link + UTR Verification */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
              <div className="sm:col-span-5 flex flex-col items-center text-center">
                {hasCustomQr && hasLiveUpi && (
                  <div className="flex rounded-lg bg-slate-100 p-0.5 mb-2 text-[11px] font-semibold">
                    <button
                      type="button"
                      onClick={() => setQrSource('custom')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        qrSource === 'custom'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Host QR
                    </button>
                    <button
                      type="button"
                      onClick={() => setQrSource('generated')}
                      className={`px-2.5 py-1 rounded-md transition-colors ${
                        qrSource === 'generated'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Amount QR
                    </button>
                  </div>
                )}

                <div className="w-44 h-44 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center shadow-xs">
                  {!canAcceptLivePayment ? (
                    <span className="text-xs text-slate-500 px-3 leading-relaxed">
                      Host has not linked a live UPI ID or QR code for this listing yet. Use Test Mode below to reserve.
                    </span>
                  ) : hasCustomQr && (qrSource === 'custom' || !hasLiveUpi) ? (
                    <img
                      src={destination.paymentQrUrl}
                      alt={`Uploaded payment QR code for ${destination.payeeName}`}
                      className="w-full h-full object-contain"
                    />
                  ) : qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={`UPI QR code to pay ${destination.payeeName}`}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">Generating UPI QR...</span>
                  )}
                </div>

                {canAcceptLivePayment && (
                  <>
                    <p className="text-[11px] font-mono-nums text-slate-600 mt-2">
                      {hasCustomQr && (qrSource === 'custom' || !hasLiveUpi)
                        ? `Scan in ${method === 'phonepe' ? 'PhonePe' : 'Google Pay'} & pay ₹${totalAmountInr.toLocaleString('en-IN')}`
                        : lockAmountInQr
                          ? `Scan in ${method === 'phonepe' ? 'PhonePe' : 'Google Pay'} to pay ₹${totalAmountInr.toLocaleString('en-IN')}`
                          : `Scan & enter ₹${totalAmountInr.toLocaleString('en-IN')} in app`}
                    </p>
                    {hasLiveUpi && qrSource === 'generated' && (
                      <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!lockAmountInQr}
                          onChange={(e) => setLockAmountInQr(!e.target.checked)}
                          className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                        />
                        Open-amount QR (if app blocks ₹{totalAmountInr.toLocaleString('en-IN')})
                      </label>
                    )}
                    {hasLiveUpi && (
                      <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                        <a
                          href={appLaunchHref}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-colors ${
                            method === 'phonepe'
                              ? 'bg-[#5F259F] hover:bg-[#4e1d84]'
                              : 'bg-[#1A73E8] hover:bg-[#1557b0]'
                          }`}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open {method === 'phonepe' ? 'PhonePe' : 'Google Pay'}
                        </a>
                        <a
                          href={upiLinks.genericUri}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Any UPI App
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="sm:col-span-7 space-y-3">
                <div>
                  <label
                    htmlFor="upi-handle-input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    2. Your Paying UPI ID ({method === 'phonepe' ? 'PhonePe' : 'Google Pay'})
                  </label>
                  <input
                    id="upi-handle-input"
                    type="text"
                    value={upiHandle}
                    onChange={(e) => setUpiHandle(e.target.value)}
                    placeholder={method === 'phonepe' ? 'yourname@ybl' : 'yourname@okicici'}
                    className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="utr-ref-input"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    3. Enter 12-Digit UTR / UPI Transaction Ref (after paying)
                  </label>
                  <input
                    id="utr-ref-input"
                    type="text"
                    maxLength={64}
                    value={utrRef}
                    onChange={(e) => setUtrRef(e.target.value)}
                    placeholder="e.g., 432198765432"
                    className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    When you pay the QR or host number above, your payment app gives a 12-digit UTR/Ref ID. Submitting it updates the host&apos;s dashboard immediately.
                  </p>
                </div>

                <div className="text-xs text-slate-500 flex items-center justify-between font-mono-nums pt-1 border-t border-slate-100">
                  <span>Base: {formatCurrency(subtotalInr, currency)}</span>
                  <span>Service Fee (5%): {formatCurrency(serviceFeeInr, currency)}</span>
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {errorMsg}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-teal-600 shrink-0" />
                <span>Direct NPCI UPI QR &amp; App Intent</span>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 justify-end">
                <button
                  type="button"
                  onClick={() => void handleDemoTestPayment()}
                  className="px-3.5 py-2.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Test Mode (No Real Charge)
                </button>
                <button
                  type="submit"
                  className={`px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors whitespace-nowrap ${
                    method === 'phonepe'
                      ? 'bg-[#5F259F] hover:bg-[#4e1d84]'
                      : 'bg-[#1A73E8] hover:bg-[#1557b0]'
                  }`}
                >
                  Confirm Paid ₹{totalAmountInr.toLocaleString('en-IN')}
                </button>
              </div>
            </div>
          </form>
        )}

        {step === 'verifying' && (
          <div className="p-10 text-center space-y-4">
            <div
              className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-white animate-pulse ${
                method === 'phonepe' ? 'bg-[#5F259F]' : 'bg-[#1A73E8]'
              }`}
            >
              <Smartphone className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              Recording {method === 'phonepe' ? 'PhonePe' : 'Google Pay'} Transfer to Host
            </h3>
            <p className="text-sm text-slate-600 max-w-sm mx-auto">
              Updating {destination.payeeName}&apos;s account (
              <span className="font-mono-nums font-medium">{destination.paymentPhone || destination.upiId}</span>
              ) and locking your reservation dates...
            </p>
          </div>
        )}

        {step === 'receipt' && confirmedBooking && (
          <div className="p-6 sm:p-7 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Booking &amp; Payment Confirmed
                </h3>
                <p className="text-xs text-slate-600">
                  Paid via {confirmedBooking.paymentMethod === 'phonepe' ? 'PhonePe' : 'Google Pay'} ·{' '}
                  {confirmedBooking.paymentMode === 'live_upi' ? 'Live UPI Transfer' : 'Test Mode'} · Ref{' '}
                  <span className="font-mono-nums font-semibold">{confirmedBooking.transactionRef}</span>
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2.5 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Property / Experience</span>
                <span className="font-semibold text-slate-900 text-right">
                  {confirmedBooking.listingTitle}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Guest (Paid From)</span>
                <span className="text-slate-900 text-right">
                  {travellerName} · <span className="font-mono-nums">{confirmedBooking.upiHandle}</span>
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Paid To Host</span>
                <span className="text-slate-900 text-right font-medium">
                  {confirmedBooking.hostPayeeName}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Host Number / UPI ID</span>
                <span className="font-mono-nums text-slate-900 text-right">
                  {confirmedBooking.hostPaymentPhone ? `${confirmedBooking.hostPaymentPhone} · ` : ''}
                  {confirmedBooking.hostUpiId}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-slate-500">Schedule</span>
                <span className="font-mono-nums text-slate-900">
                  {formatReadableDate(confirmedBooking.checkInDate)}
                  {confirmedBooking.listingCategory === 'homestay'
                    ? ` → ${formatReadableDate(confirmedBooking.checkOutDate)}`
                    : ''}
                </span>
              </div>
              <div className="flex justify-between gap-4 pt-2 border-t border-slate-200">
                <span className="font-semibold text-slate-900">Total Paid</span>
                <span className="font-bold font-mono-nums text-slate-900">
                  {formatCurrency(confirmedBooking.totalAmountInr, currency)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Continue Exploring
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onViewTrips();
                }}
                className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors"
              >
                View My Trips
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
