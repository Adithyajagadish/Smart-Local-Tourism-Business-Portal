import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  Lock,
  Phone,
  PlusCircle,
  QrCode,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import { AMENITY_OPTIONS, PHOTO_PRESETS } from '../data/featuredListings';
import {
  getListingPaymentDestination,
  HostPayoutSettingsInput,
  ListingPaymentInput,
} from '../services/backendService';
import {
  AvailabilitySlot,
  Booking,
  BookingStatus,
  CurrencyCode,
  Listing,
  ListingCategory,
  PreferredPaymentApp,
  UnitLabel,
  UserPrivateInfo,
  UserProfile,
} from '../types';
import { formatCurrency } from '../utils/currency';
import { buildUnavailableDateSet, formatReadableDate } from '../utils/dates';
import { compressImageFile } from '../utils/imageCompress';
import {
  buildUpiLinks,
  generateUpiQrDataUrl,
  isValidPhoneInput,
  isValidUpiId,
  processUploadedQrImage,
  suggestUpiIdFromPhone,
} from '../utils/upi';
import { AvailabilityCalendar } from './AvailabilityCalendar';
import { MapCoordinatePicker } from './MapCoordinatePicker';

type HostTab = 'overview' | 'listings' | 'editor' | 'bookings' | 'payout';

interface HostStudioViewProps {
  userProfile: UserProfile | null;
  hostPrivateInfo: UserPrivateInfo | null;
  hostListings: Listing[];
  hostBookings: Booking[];
  availabilitySlots: AvailabilitySlot[];
  currency: CurrencyCode;
  onOpenHostAuth: () => void;
  onSavePayoutSettings: (input: HostPayoutSettingsInput) => Promise<void>;
  onCreateListing: (input: {
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
    paymentDestination: ListingPaymentInput;
  }) => Promise<string>;
  onUpdateListing: (
    listingId: string,
    input: {
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
      isPublished: boolean;
      paymentDestination?: ListingPaymentInput;
    },
  ) => Promise<void>;
  onUpdateBlockedDates: (listingId: string, blockedDates: string[]) => Promise<void>;
  onDeleteListing: (listingId: string) => Promise<void>;
  onUpdateBookingStatus: (bookingId: string, status: Exclude<BookingStatus, 'confirmed'>) => Promise<void>;
}

const DEFAULT_FORM = {
  category: 'homestay' as ListingCategory,
  title: '',
  description: '',
  locationName: '',
  country: 'India',
  lat: 15.2993,
  lng: 74.124,
  pricePerUnitInr: 4200,
  unitLabel: 'night' as UnitLabel,
  maxGuests: 4,
  amenities: ['High-Speed Wi-Fi', 'Home-Cooked Meals'],
  photos: [PHOTO_PRESETS[0].url],
  blockedDates: [] as string[],
  isPublished: true,
  payeeName: '',
  paymentPhone: '',
  upiId: '',
  preferredApp: 'both' as PreferredPaymentApp,
  paymentQrUrl: '',
};

export const HostStudioView: React.FC<HostStudioViewProps> = ({
  userProfile,
  hostPrivateInfo,
  hostListings,
  hostBookings,
  availabilitySlots,
  currency,
  onOpenHostAuth,
  onSavePayoutSettings,
  onCreateListing,
  onUpdateListing,
  onUpdateBlockedDates,
  onDeleteListing,
  onUpdateBookingStatus,
}) => {
  const [activeTab, setActiveTab] = useState<HostTab>('overview');
  const [editingListingId, setEditingListingId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [calendarModalListing, setCalendarModalListing] = useState<Listing | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);

  // Payout settings state
  const [payoutPhone, setPayoutPhone] = useState('');
  const [payoutUpiId, setPayoutUpiId] = useState('');
  const [payoutPayeeName, setPayoutPayeeName] = useState('');
  const [payoutApp, setPayoutApp] = useState<PreferredPaymentApp>('both');
  const [payoutQrUrl, setPayoutQrUrl] = useState('');
  const [payoutQrNotice, setPayoutQrNotice] = useState<string | null>(null);
  const [listingQrNotice, setListingQrNotice] = useState<string | null>(null);
  const [syncExisting, setSyncExisting] = useState(true);
  const [savingPayout, setSavingPayout] = useState(false);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [sampleQrUrl, setSampleQrUrl] = useState<string | null>(null);
  const payoutDirtyRef = useRef(false);
  const lastSyncedPayoutKeyRef = useRef<string | null>(null);
  const lastUserUidRef = useRef<string | null>(null);

  useEffect(() => {
    const uid = userProfile?.uid || null;
    if (lastUserUidRef.current !== uid) {
      lastUserUidRef.current = uid;
      payoutDirtyRef.current = false;
      lastSyncedPayoutKeyRef.current = null;
    }

    if (payoutDirtyRef.current) return;

    const serverPhone = hostPrivateInfo?.phone || '';
    const serverUpiId = hostPrivateInfo?.payoutUpiId || '';
    const serverPayeeName = hostPrivateInfo?.payeeName || userProfile?.displayName || '';
    const serverApp = hostPrivateInfo?.preferredPaymentApp || 'both';
    const serverQrUrl = hostPrivateInfo?.paymentQrUrl || '';
    const serverKey = `${uid || ''}|${serverPhone}|${serverUpiId}|${serverPayeeName}|${serverApp}|${serverQrUrl.length}`;

    if (lastSyncedPayoutKeyRef.current === serverKey) return;
    lastSyncedPayoutKeyRef.current = serverKey;

    setPayoutPhone(serverPhone);
    setPayoutUpiId(serverUpiId);
    setPayoutPayeeName(serverPayeeName);
    setPayoutApp(serverApp);
    setPayoutQrUrl(serverQrUrl);
  }, [hostPrivateInfo, userProfile?.displayName, userProfile?.uid]);

  useEffect(() => {
    if (!isValidUpiId(payoutUpiId)) {
      setSampleQrUrl(null);
      return;
    }
    let cancelled = false;
    const { genericUri } = buildUpiLinks({
      upiId: payoutUpiId,
      payeeName: payoutPayeeName || userProfile?.displayName || 'Tourx Host',
      amountInr: 0,
      transactionNote: 'Tourx Host Payment',
      transactionRef: 'TOURXHOST',
    });
    void generateUpiQrDataUrl(genericUri)
      .then((url) => {
        if (!cancelled) setSampleQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setSampleQrUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [payoutUpiId, payoutPayeeName, userProfile?.displayName]);

  // Earnings KPIs (strictly computed from non-cancelled bookings)
  const metrics = useMemo(() => {
    const activeBookings = hostBookings.filter((b) => b.bookingStatus !== 'cancelled');
    const grossInr = activeBookings.reduce((sum, b) => sum + b.totalAmountInr, 0);
    const netInr = activeBookings.reduce((sum, b) => sum + b.hostNetPayoutInr, 0);
    const confirmedCount = hostBookings.filter((b) => b.bookingStatus === 'confirmed').length;
    const activeListingsCount = hostListings.filter((l) => l.isPublished).length;
    return { grossInr, netInr, confirmedCount, activeListingsCount, activeBookings };
  }, [hostBookings, hostListings]);

  // Monthly revenue chart buckets (last 6 months)
  const monthlySeries = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; amountInr: number }[] = [];
    for (let i = 5; i >= 0; i -= 1) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      const label = dt.toLocaleDateString('en-US', { month: 'short' });
      buckets.push({ key, label, amountInr: 0 });
    }
    for (const bk of metrics.activeBookings) {
      const monthKey = bk.checkInDate.slice(0, 7);
      const found = buckets.find((b) => b.key === monthKey);
      if (found) {
        found.amountInr += bk.hostNetPayoutInr;
      }
    }
    const maxVal = Math.max(1000, ...buckets.map((b) => b.amountInr));
    return { buckets, maxVal };
  }, [metrics.activeBookings]);

  const hasConfiguredPayout = Boolean(
    hostPrivateInfo?.paymentQrUrl ||
      (hostPrivateInfo?.phone &&
        isValidPhoneInput(hostPrivateInfo.phone) &&
        hostPrivateInfo?.payoutUpiId &&
        isValidUpiId(hostPrivateInfo.payoutUpiId)),
  );

  // Strict Owner-Only Gate
  if (!userProfile || userProfile.accountType !== 'host') {
    return (
      <div className="max-w-2xl mx-auto my-20 px-4">
        <div className="p-8 sm:p-10 rounded-2xl border border-slate-200 bg-white text-center space-y-4">
          <div className="w-12 h-12 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Owner-Only Host Studio</h1>
          <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
            {userProfile
              ? `You are currently signed in as a Traveller (${userProfile.displayName}). Switch to a Host account to upload property listings, configure your receiving payment number, manage bookings, and track rental earnings.`
              : 'Only registered property owners, local guides, and cultural business hosts can upload listings, configure receiving UPI numbers, manage availability calendars, and track earnings.'}
          </p>
          <button
            type="button"
            onClick={onOpenHostAuth}
            className="px-6 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
          >
            Sign in as Host
          </button>
        </div>
      </div>
    );
  }

  const handlePayoutQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPayoutError(null);
    setPayoutQrNotice(null);
    try {
      const result = await processUploadedQrImage(file);
      payoutDirtyRef.current = true;
      setPayoutQrUrl(result.dataUrl);
      if (result.decodedUpiId) {
        setPayoutUpiId(result.decodedUpiId);
        if (result.decodedPayeeName && !payoutPayeeName.trim()) {
          setPayoutPayeeName(result.decodedPayeeName);
        }
        if (result.decodedPhone && !payoutPhone.trim()) {
          setPayoutPhone(result.decodedPhone);
        }
        setPayoutQrNotice(`QR verified — detected UPI ID: ${result.decodedUpiId}`);
      } else {
        setPayoutQrNotice(
          'Payment QR uploaded! Travellers can scan this QR directly at checkout.',
        );
      }
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'Unable to process QR code image.');
    }
  };

  const handleListingQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFormError(null);
    setListingQrNotice(null);
    try {
      const result = await processUploadedQrImage(file);
      setForm((prev) => ({
        ...prev,
        paymentQrUrl: result.dataUrl,
        upiId: result.decodedUpiId || prev.upiId,
        payeeName: prev.payeeName.trim() ? prev.payeeName : result.decodedPayeeName || prev.payeeName,
        paymentPhone: prev.paymentPhone.trim()
          ? prev.paymentPhone
          : result.decodedPhone || prev.paymentPhone,
      }));
      if (result.decodedUpiId) {
        setListingQrNotice(`QR verified — detected UPI ID: ${result.decodedUpiId}`);
      } else {
        setListingQrNotice('Payment QR uploaded for this listing.');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to process QR code image.');
    }
  };

  const handleSavePayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayoutError(null);
    setFormSuccess(null);

    const hasQr = Boolean(payoutQrUrl);
    if (payoutPhone.trim() && !isValidPhoneInput(payoutPhone)) {
      setPayoutError('Enter a valid 10-digit mobile number linked to PhonePe or Google Pay.');
      return;
    }
    if (payoutUpiId.trim() && !isValidUpiId(payoutUpiId)) {
      setPayoutError('Enter a valid UPI ID (e.g., 9876543210@ybl or name@okicici).');
      return;
    }
    if (!hasQr && (!isValidPhoneInput(payoutPhone) || !isValidUpiId(payoutUpiId))) {
      setPayoutError(
        'Upload your Payment QR code image OR enter both your mobile number and UPI ID.',
      );
      return;
    }
    if (payoutPayeeName.trim().length < 2) {
      setPayoutError('Enter your account holder or business name.');
      return;
    }

    setSavingPayout(true);
    try {
      await onSavePayoutSettings({
        email: hostPrivateInfo?.email || 'host@tourx.app',
        phone: payoutPhone.trim(),
        payoutUpiId: payoutUpiId.trim(),
        payeeName: payoutPayeeName.trim(),
        preferredPaymentApp: payoutApp,
        paymentQrUrl: payoutQrUrl,
        syncExistingListings: syncExisting,
      });
      payoutDirtyRef.current = false;
      lastSyncedPayoutKeyRef.current = `${userProfile?.uid || ''}|${payoutPhone.trim()}|${payoutUpiId.trim()}|${payoutPayeeName.trim()}|${payoutApp}|${payoutQrUrl.length}`;
      setFormSuccess(
        'Your receiving payment details and QR code have been saved. Travellers will pay directly to your account.',
      );
    } catch (err) {
      setPayoutError(err instanceof Error ? err.message : 'Unable to save payout details.');
    } finally {
      setSavingPayout(false);
    }
  };

  const startNewListing = () => {
    setEditingListingId(null);
    setListingQrNotice(null);
    setForm({
      ...DEFAULT_FORM,
      payeeName: hostPrivateInfo?.payeeName || userProfile.displayName,
      paymentPhone: hostPrivateInfo?.phone || '',
      upiId: hostPrivateInfo?.payoutUpiId || '',
      preferredApp: hostPrivateInfo?.preferredPaymentApp || 'both',
      paymentQrUrl: hostPrivateInfo?.paymentQrUrl || '',
    });
    setFormError(null);
    setFormSuccess(null);
    setActiveTab('editor');
  };

  const startEditListing = async (item: Listing) => {
    setEditingListingId(item.id);
    setListingQrNotice(null);
    setFormError(null);
    setFormSuccess(null);
    let dest = null;
    try {
      dest = await getListingPaymentDestination(item.id);
    } catch {
      dest = null;
    }
    setForm({
      category: item.category,
      title: item.title,
      description: item.description,
      locationName: item.locationName,
      country: item.country,
      lat: item.lat,
      lng: item.lng,
      pricePerUnitInr: item.pricePerUnitInr,
      unitLabel: item.unitLabel,
      maxGuests: item.maxGuests,
      amenities: [...item.amenities],
      photos: [...item.photos],
      blockedDates: [...item.blockedDates],
      isPublished: item.isPublished,
      payeeName: dest?.payeeName || hostPrivateInfo?.payeeName || userProfile.displayName,
      paymentPhone: dest?.paymentPhone || hostPrivateInfo?.phone || '',
      upiId: dest?.upiId || hostPrivateInfo?.payoutUpiId || '',
      preferredApp: dest?.preferredApp || hostPrivateInfo?.preferredPaymentApp || 'both',
      paymentQrUrl: dest?.paymentQrUrl || hostPrivateInfo?.paymentQrUrl || '',
    });
    setActiveTab('editor');
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setFormError(null);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files).slice(0, 6 - form.photos.length)) {
        const compressed = await compressImageFile(file);
        uploaded.push(compressed);
      }
      setForm((prev) => ({
        ...prev,
        photos: [...prev.photos, ...uploaded].slice(0, 6),
      }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to process image upload.');
    }
    e.target.value = '';
  };

  const handleSubmitListing = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (form.title.trim().length < 3) {
      setFormError('Title must be at least 3 characters.');
      return;
    }
    if (form.description.trim().length < 10) {
      setFormError('Description must be at least 10 characters.');
      return;
    }
    if (form.locationName.trim().length < 2) {
      setFormError('City / Neighborhood must be at least 2 characters.');
      return;
    }
    if (form.country.trim().length < 2) {
      setFormError('Country must be at least 2 characters.');
      return;
    }
    if (
      !Number.isFinite(form.pricePerUnitInr) ||
      form.pricePerUnitInr < 100 ||
      form.pricePerUnitInr > 500000
    ) {
      setFormError('Price must be between ₹100 and ₹5,00,000.');
      return;
    }
    if (!Number.isFinite(form.maxGuests) || form.maxGuests < 1 || form.maxGuests > 30) {
      setFormError('Max guests must be between 1 and 30.');
      return;
    }
    if (form.photos.length === 0) {
      setFormError('Please include at least 1 property or experience photo.');
      return;
    }
    const hasListingQr = Boolean(form.paymentQrUrl);
    if (form.paymentPhone.trim() && !isValidPhoneInput(form.paymentPhone)) {
      setFormError('Enter a valid mobile number for PhonePe / Google Pay payments.');
      return;
    }
    if (form.upiId.trim() && !isValidUpiId(form.upiId)) {
      setFormError('Enter a valid receiving UPI ID (e.g., 9876543210@ybl or name@okicici).');
      return;
    }
    if (!hasListingQr && (!isValidPhoneInput(form.paymentPhone) || !isValidUpiId(form.upiId))) {
      setFormError(
        'Upload your Payment QR code OR enter both your mobile number and UPI ID.',
      );
      return;
    }
    if (form.payeeName.trim().length < 1 && userProfile.displayName.trim().length < 1) {
      setFormError('Enter your payee / account holder name.');
      return;
    }

    const paymentDestination: ListingPaymentInput = {
      payeeName: form.payeeName.trim() || userProfile.displayName,
      paymentPhone: form.paymentPhone.trim(),
      upiId: form.upiId.trim(),
      preferredApp: form.preferredApp,
      paymentQrUrl: form.paymentQrUrl,
    };

    const cleanedPayload = {
      category: form.category,
      title: form.title.trim(),
      description: form.description.trim(),
      locationName: form.locationName.trim(),
      country: form.country.trim(),
      lat: form.lat,
      lng: form.lng,
      pricePerUnitInr: form.pricePerUnitInr,
      unitLabel: form.unitLabel,
      maxGuests: form.maxGuests,
      amenities: form.amenities,
      photos: form.photos,
      isPublished: form.isPublished,
      paymentDestination,
    };

    setSaving(true);
    try {
      // Also keep host's default private payout info updated if it wasn't set yet
      if (!hasConfiguredPayout) {
        await onSavePayoutSettings({
          email: hostPrivateInfo?.email || 'host@tourx.app',
          phone: paymentDestination.paymentPhone,
          payoutUpiId: paymentDestination.upiId,
          payeeName: paymentDestination.payeeName,
          preferredPaymentApp: paymentDestination.preferredApp,
          paymentQrUrl: paymentDestination.paymentQrUrl,
          syncExistingListings: false,
        });
      }

      if (editingListingId) {
        await onUpdateListing(editingListingId, cleanedPayload);
        setFormSuccess('Listing and receiving payment details updated.');
      } else {
        await onCreateListing({
          ...cleanedPayload,
          blockedDates: form.blockedDates,
        });
        setFormSuccess('Listing published to Tourx Marketplace and World Map with your UPI number.');
      }
      setActiveTab('listings');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save listing.');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePublish = async (item: Listing) => {
    setActionError(null);
    try {
      await onUpdateListing(item.id, {
        category: item.category,
        title: item.title,
        description: item.description,
        locationName: item.locationName,
        country: item.country,
        lat: item.lat,
        lng: item.lng,
        pricePerUnitInr: item.pricePerUnitInr,
        unitLabel: item.unitLabel,
        maxGuests: item.maxGuests,
        amenities: item.amenities,
        photos: item.photos,
        isPublished: !item.isPublished,
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to update listing publish status.',
      );
    }
  };

  const handleDeleteListing = async (listingId: string) => {
    setActionError(null);
    setDeletingId(listingId);
    try {
      await onDeleteListing(listingId);
      setConfirmDeleteId(null);
      if (editingListingId === listingId) {
        setEditingListingId(null);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to delete listing.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleCalendarModalDate = async (iso: string) => {
    if (!calendarModalListing) return;
    setCalendarError(null);
    const previous = calendarModalListing.blockedDates;
    const exists = previous.includes(iso);
    if (!exists && previous.length >= 120) {
      setCalendarError('You can block up to 120 dates per listing.');
      return;
    }
    const next = exists ? previous.filter((d) => d !== iso) : [...previous, iso];
    setCalendarModalListing({ ...calendarModalListing, blockedDates: next });
    try {
      await onUpdateBlockedDates(calendarModalListing.id, next);
    } catch (err) {
      setCalendarModalListing((curr) =>
        curr && curr.id === calendarModalListing.id ? { ...curr, blockedDates: previous } : curr,
      );
      setCalendarError(
        err instanceof Error ? err.message : 'Unable to update availability dates.',
      );
    }
  };

  const handleBookingAction = async (
    bookingId: string,
    status: Exclude<BookingStatus, 'confirmed'>,
  ) => {
    setActionError(null);
    setBusyBookingId(bookingId);
    try {
      await onUpdateBookingStatus(bookingId, status);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to update booking status.',
      );
    } finally {
      setBusyBookingId(null);
    }
  };

  return (
    <div className="min-h-[calc(100vh-64px)] bg-slate-50 flex flex-col lg:flex-row">
      {/* Left SaaS Sidebar */}
      <aside className="w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-4 lg:p-6 shrink-0 flex flex-col justify-between">
        <div>
          <div className="mb-6">
            <p className="text-xs font-medium text-slate-500">Host Studio</p>
            <p className="text-base font-bold text-slate-900 truncate mt-0.5">
              {userProfile.displayName}
            </p>
            <p className="text-[11px] text-slate-500 mt-1 font-mono-nums truncate">
              {hasConfiguredPayout
                ? `Pay to: ${hostPrivateInfo?.phone}`
                : 'Receiving number not set'}
            </p>
          </div>

          <nav className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'overview'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Wallet className="w-4 h-4 shrink-0" />
              Earnings &amp; Overview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('payout')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'payout'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Phone className="w-4 h-4 shrink-0" />
              Payout Number &amp; UPI
              {!hasConfiguredPayout && (
                <span className="ml-auto w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('listings')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'listings'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Building2 className="w-4 h-4 shrink-0" />
              My Listings ({hostListings.length})
            </button>
            <button
              type="button"
              onClick={startNewListing}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'editor'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <PlusCircle className="w-4 h-4 shrink-0" />
              {editingListingId ? 'Edit Listing' : 'Upload Listing'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bookings')}
              className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === 'bookings'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <CalendarDays className="w-4 h-4 shrink-0" />
              Bookings ({hostBookings.length})
            </button>
          </nav>
        </div>

        <div className="hidden lg:block pt-6 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <div>
            Payout split: <span className="font-mono-nums font-semibold text-slate-800">95%</span> to owner via UPI
          </div>
          {hasConfiguredPayout && (
            <div className="font-mono-nums text-[11px] text-teal-700 truncate">
              UPI: {hostPrivateInfo?.payoutUpiId}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-5 sm:p-8 max-w-[1140px]">
        {formSuccess && (
          <div className="mb-6 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {formSuccess}
            </span>
            <button
              type="button"
              onClick={() => setFormSuccess(null)}
              className="text-xs font-semibold hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {actionError && (
          <div className="mb-6 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-xs font-semibold hover:underline shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Payout Setup Prompt if not yet configured */}
        {!hasConfiguredPayout && activeTab !== 'payout' && (
          <div className="mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-amber-950">
                Set your PhonePe / Google Pay receiving number
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Tell travellers which mobile number and UPI ID to pay when booking your listings. Your QR code and checkout links will route payments directly to this number.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('payout')}
              className="px-4 py-2 rounded-lg bg-amber-900 text-white text-xs font-semibold hover:bg-amber-800 whitespace-nowrap self-start sm:self-auto"
            >
              Add Payment Number
            </button>
          </div>
        )}

        {/* TAB 1: EARNINGS & OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Rental Earnings &amp; Overview</h1>
                <p className="text-sm text-slate-600 mt-0.5">
                  Live updates whenever travellers pay your PhonePe or Google Pay number.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setActiveTab('payout')}
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  {hasConfiguredPayout ? 'Edit Payout Number' : 'Set Payout Number'}
                </button>
                <button
                  type="button"
                  onClick={startNewListing}
                  className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors whitespace-nowrap"
                >
                  + Upload Property / Experience
                </button>
              </div>
            </div>

            {/* Active Receiving Account Summary Strip */}
            {hasConfiguredPayout && (
              <div className="p-4 rounded-xl bg-white border border-slate-200 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center shrink-0">
                    <Phone className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Traveller Payments Routed To</p>
                    <p className="text-sm font-bold text-slate-900 font-mono-nums">
                      {hostPrivateInfo?.phone} · {hostPrivateInfo?.payoutUpiId}
                    </p>
                  </div>
                </div>
                <div className="text-xs text-slate-600">
                  Payee: <span className="font-semibold text-slate-900">{hostPrivateInfo?.payeeName || userProfile.displayName}</span>
                </div>
              </div>
            )}

            {/* 4 KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="p-5 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500">Net Owner Earnings (95%)</p>
                <p className="text-2xl font-bold font-mono-nums text-slate-900 mt-1.5">
                  {formatCurrency(metrics.netInr, currency)}
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500">Gross Booking Volume</p>
                <p className="text-2xl font-bold font-mono-nums text-slate-900 mt-1.5">
                  {formatCurrency(metrics.grossInr, currency)}
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500">Confirmed Reservations</p>
                <p className="text-2xl font-bold font-mono-nums text-slate-900 mt-1.5">
                  {metrics.confirmedCount}
                </p>
              </div>
              <div className="p-5 rounded-xl bg-white border border-slate-200">
                <p className="text-xs font-medium text-slate-500">Published Listings</p>
                <p className="text-2xl font-bold font-mono-nums text-slate-900 mt-1.5">
                  {metrics.activeListingsCount}
                </p>
              </div>
            </div>

            {/* Monthly Rental Earnings Chart */}
            <div className="p-6 rounded-xl bg-white border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-teal-600" />
                  <h2 className="text-base font-bold text-slate-900">Monthly Net Payouts</h2>
                </div>
                <span className="text-xs text-slate-500 font-mono-nums">6-month window</span>
              </div>

              <div className="grid grid-cols-6 gap-3 sm:gap-5 items-end h-44 pt-4">
                {monthlySeries.buckets.map((bucket) => {
                  const pct = Math.max(6, Math.round((bucket.amountInr / monthlySeries.maxVal) * 100));
                  return (
                    <div key={bucket.key} className="flex flex-col items-center h-full justify-end gap-2">
                      <span className="text-[11px] font-mono-nums text-slate-600 truncate max-w-full">
                        {bucket.amountInr > 0 ? formatCurrency(bucket.amountInr, currency) : '—'}
                      </span>
                      <div className="w-full max-w-[44px] bg-slate-100 rounded-t-lg h-28 flex items-end overflow-hidden">
                        <div
                          className={`w-full rounded-t-lg transition-all ${
                            bucket.amountInr > 0 ? 'bg-teal-600' : 'bg-slate-200'
                          }`}
                          style={{ height: `${bucket.amountInr > 0 ? pct : 6}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-slate-600">{bucket.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payout Ledger */}
            <div className="rounded-xl bg-white border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-slate-900">
                  Incoming Traveller Payments &amp; Payout Ledger
                </h2>
                <span className="text-xs text-slate-500">Updates automatically on payment</span>
              </div>
              {hostBookings.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No bookings received yet. Once a traveller pays your PhonePe / Google Pay number or QR code, the payment details, UTR reference, and net amount will appear here automatically.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                      <tr>
                        <th className="py-3 px-4 font-semibold">Listing</th>
                        <th className="py-3 px-4 font-semibold">Traveller &amp; Payer UPI</th>
                        <th className="py-3 px-4 font-semibold">Paid To Host Number</th>
                        <th className="py-3 px-4 font-semibold">Schedule</th>
                        <th className="py-3 px-4 font-semibold">Gateway &amp; UTR</th>
                        <th className="py-3 px-4 font-semibold">Status</th>
                        <th className="py-3 px-4 font-semibold text-right">Total / Net</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {hostBookings.map((bk) => (
                        <tr key={bk.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 font-medium text-slate-900 max-w-[180px] truncate">
                            {bk.listingTitle}
                          </td>
                          <td className="py-3 px-4">
                            <p className="text-slate-900 font-medium">{bk.travellerName}</p>
                            <p className="text-[11px] font-mono-nums text-slate-500">{bk.upiHandle}</p>
                          </td>
                          <td className="py-3 px-4 font-mono-nums text-xs">
                            <p className="text-slate-900 font-semibold">
                              {bk.hostPaymentPhone || 'Host UPI'}
                            </p>
                            <p className="text-[11px] text-slate-500">{bk.hostUpiId}</p>
                          </td>
                          <td className="py-3 px-4 font-mono-nums text-xs text-slate-600 whitespace-nowrap">
                            {formatReadableDate(bk.checkInDate)}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">
                            <p className="font-semibold">
                              {bk.paymentMethod === 'phonepe' ? 'PhonePe' : 'Google Pay'} ·{' '}
                              {bk.paymentMode === 'live_upi' ? 'Live UPI' : 'Test Mode'}
                            </p>
                            <p className="font-mono-nums text-[11px] text-slate-500">
                              Ref: {bk.transactionRef}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-xs font-semibold">
                            <span
                              className={
                                bk.bookingStatus === 'confirmed'
                                  ? 'text-emerald-700'
                                  : bk.bookingStatus === 'completed'
                                    ? 'text-sky-700'
                                    : 'text-slate-400'
                              }
                            >
                              {bk.bookingStatus}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono-nums">
                            {bk.bookingStatus === 'cancelled' ? (
                              '—'
                            ) : (
                              <>
                                <p className="font-bold text-slate-900">
                                  {formatCurrency(bk.hostNetPayoutInr, currency)}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  of {formatCurrency(bk.totalAmountInr, currency)}
                                </p>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: PAYOUT NUMBER & UPI SETTINGS */}
        {activeTab === 'payout' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                Receiving Payment Number &amp; UPI Setup
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Specify the mobile number and UPI ID where travellers should send PhonePe or Google Pay payments. Every reservation paid to this number automatically updates your dashboard.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleSavePayout}
                className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
              >
                {payoutError && (
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                    {payoutError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Which Mobile Number Should Travellers Pay? (PhonePe / Google Pay)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={32}
                      value={payoutPhone}
                      onChange={(e) => {
                        payoutDirtyRef.current = true;
                        const val = e.target.value;
                        setPayoutPhone(val);
                        if (!payoutUpiId.trim()) {
                          const suggested = suggestUpiIdFromPhone(val, payoutApp);
                          if (suggested) setPayoutUpiId(suggested);
                        }
                      }}
                      placeholder="+91 98765 43210"
                      className="flex-1 px-3 py-2 text-sm font-mono-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      required={!payoutQrUrl}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        payoutDirtyRef.current = true;
                        const suggested = suggestUpiIdFromPhone(payoutPhone, payoutApp);
                        if (suggested) setPayoutUpiId(suggested);
                      }}
                      className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                    >
                      Auto-fill UPI
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Host Receiving UPI ID (VPA)
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={payoutUpiId}
                    onChange={(e) => {
                      payoutDirtyRef.current = true;
                      setPayoutUpiId(e.target.value);
                    }}
                    placeholder="9876543210@ybl or business@okicici"
                    className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    required={!payoutQrUrl}
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Examples: PhonePe (<span className="font-mono-nums">@ybl</span>,{' '}
                    <span className="font-mono-nums">@ibl</span>), Google Pay (
                    <span className="font-mono-nums">@okaxis</span>,{' '}
                    <span className="font-mono-nums">@okicici</span>,{' '}
                    <span className="font-mono-nums">@oksbi</span>).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Account Holder / Business Name (Displayed in PhonePe &amp; Google Pay)
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={payoutPayeeName}
                    onChange={(e) => {
                      payoutDirtyRef.current = true;
                      setPayoutPayeeName(e.target.value);
                    }}
                    placeholder="e.g., Kavya Heritage Homestay"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    Preferred Payment Software
                  </label>
                  <select
                    value={payoutApp}
                    onChange={(e) => {
                      payoutDirtyRef.current = true;
                      setPayoutApp(e.target.value as PreferredPaymentApp);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="both">Both PhonePe &amp; Google Pay</option>
                    <option value="phonepe">PhonePe Preferred</option>
                    <option value="gpay">Google Pay Preferred</option>
                  </select>
                </div>

                {/* Host Payment QR Upload */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <QrCode className="w-3.5 h-3.5 text-teal-700" />
                        Upload Your Payment QR Code (PhonePe / GPay / Paytm)
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Upload a screenshot of your UPI QR code. We auto-read your UPI ID and show this QR to travellers.
                      </p>
                    </div>
                    <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      {payoutQrUrl ? 'Replace QR' : 'Upload QR'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => void handlePayoutQrUpload(e)}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {payoutQrNotice && (
                    <p className="text-[11px] font-medium text-teal-700">{payoutQrNotice}</p>
                  )}

                  {payoutQrUrl && (
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="flex items-center gap-3">
                        <img
                          src={payoutQrUrl}
                          alt="Uploaded host payment QR"
                          className="w-16 h-16 rounded-lg border border-slate-200 bg-white object-contain p-1"
                        />
                        <span className="text-xs text-slate-700 font-medium">
                          Custom Payment QR active
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          payoutDirtyRef.current = true;
                          setPayoutQrUrl('');
                          setPayoutQrNotice(null);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        <X className="w-3.5 h-3.5" />
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={syncExisting}
                    onChange={(e) => setSyncExisting(e.target.checked)}
                    className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                  />
                  Apply this payment number, UPI ID &amp; QR code to all my existing listings
                </label>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={savingPayout}
                    className="px-6 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 transition-colors"
                  >
                    {savingPayout ? 'Saving Payment Details...' : 'Save Receiving Payment Details'}
                  </button>
                </div>
              </form>

              {/* Live QR Preview Card */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 flex flex-col items-center text-center space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-700">
                  <QrCode className="w-4 h-4" />
                  {payoutQrUrl ? 'Your Uploaded Payment QR' : 'Live Traveller Payment QR Preview'}
                </div>
                <div className="w-48 h-48 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center p-2">
                  {payoutQrUrl ? (
                    <img
                      src={payoutQrUrl}
                      alt="Uploaded Host Payment QR"
                      className="w-full h-full object-contain"
                    />
                  ) : sampleQrUrl ? (
                    <img
                      src={sampleQrUrl}
                      alt="Host UPI QR preview"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400 px-4">
                      Upload your Payment QR image or enter a valid UPI ID to preview
                    </span>
                  )}
                </div>
                <div className="text-xs space-y-1">
                  <p className="font-bold text-slate-900">
                    {payoutPayeeName || userProfile.displayName}
                  </p>
                  <p className="font-mono-nums text-slate-700">{payoutPhone || 'No number set'}</p>
                  <p className="font-mono-nums text-teal-700">{payoutUpiId || 'No UPI ID set'}</p>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  {payoutQrUrl
                    ? 'Travellers will see this uploaded QR code directly at checkout along with PhonePe / Google Pay options.'
                    : 'When a traveller books your listing, Tourx embeds the exact booking amount into this QR code and PhonePe / Google Pay deep links.'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MY LISTINGS & CALENDAR */}
        {activeTab === 'listings' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">My Properties &amp; Experiences</h1>
                <p className="text-sm text-slate-600 mt-0.5">
                  Manage pricing, photos, receiving payment numbers, publishing status, and date availability calendars.
                </p>
              </div>
              <button
                type="button"
                onClick={startNewListing}
                className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors whitespace-nowrap self-start sm:self-auto"
              >
                + Upload New Listing
              </button>
            </div>

            {hostListings.length === 0 ? (
              <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center space-y-3">
                <Building2 className="w-10 h-10 text-slate-400 mx-auto" />
                <h2 className="text-lg font-bold text-slate-900">No listings uploaded yet</h2>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  Publish your homestay, local guiding tour, or cultural workshop so travellers worldwide can find and book it.
                </p>
                <button
                  type="button"
                  onClick={startNewListing}
                  className="px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
                >
                  Create First Listing
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {hostListings.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-white border border-slate-200 overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <div className="aspect-[16/10] bg-slate-100 relative">
                        <img
                          src={item.photos[0]}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-5">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                          <span>
                            {item.category} · {item.locationName}, {item.country}
                          </span>
                          <span
                            className={`font-semibold ${
                              item.isPublished ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {item.isPublished ? 'Published' : 'Paused'}
                          </span>
                        </div>
                        <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                        <p className="text-sm font-mono-nums font-bold text-slate-900 mt-2">
                          {formatCurrency(item.pricePerUnitInr, currency)}{' '}
                          <span className="text-xs font-normal text-slate-500">/ {item.unitLabel}</span>
                        </p>
                      </div>
                    </div>

                    <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCalendarError(null);
                            setCalendarModalListing(item);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          <CalendarDays className="w-3.5 h-3.5 text-teal-600" />
                          Calendar ({item.blockedDates.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => void startEditListing(item)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleTogglePublish(item)}
                          className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-slate-900"
                          title={item.isPublished ? 'Pause listing' : 'Publish listing'}
                        >
                          {item.isPublished ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>

                        {confirmDeleteId === item.id ? (
                          <button
                            type="button"
                            disabled={deletingId === item.id}
                            onClick={() => void handleDeleteListing(item.id)}
                            className="px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 disabled:opacity-60"
                          >
                            {deletingId === item.id ? 'Deleting...' : 'Confirm Delete'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(item.id)}
                            className="p-1.5 rounded-lg border border-slate-200 bg-white text-red-600 hover:bg-red-50"
                            title="Delete listing"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: UPLOAD / EDIT LISTING FORM */}
        {activeTab === 'editor' && (
          <form onSubmit={handleSubmitListing} className="space-y-6 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  {editingListingId ? 'Edit Property / Experience' : 'Upload New Listing'}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  All details publish directly to the Tourx Marketplace and Explore Anywhere world map.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('listings')}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {formError}
              </div>
            )}

            {/* Category & Title */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Category</label>
                <select
                  value={form.category}
                  onChange={(e) => {
                    const cat = e.target.value as ListingCategory;
                    const unit: UnitLabel =
                      cat === 'homestay' ? 'night' : cat === 'guide' ? 'person' : 'session';
                    setForm((prev) => ({ ...prev, category: cat, unitLabel: unit }));
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="homestay">Homestay</option>
                  <option value="guide">Local Guide</option>
                  <option value="cultural">Cultural Business</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Listing Title</label>
                <input
                  type="text"
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Heritage Courtyard Homestay in Fort Kochi"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  required
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
              <textarea
                rows={4}
                maxLength={1500}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Describe what makes your homestay, guided walk, or cultural craft authentic..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                required
              />
            </div>

            {/* Receiving Payment Number & UPI Details */}
            <div className="p-4 sm:p-5 rounded-xl bg-teal-50/40 border border-teal-200 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Phone className="w-4 h-4 text-teal-700" />
                  Which Number Should Travellers Pay? (PhonePe / Google Pay)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Travellers will scan a live UPI QR or tap PhonePe / Google Pay to send money directly to this number and UPI ID.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Host Receiving Mobile Number
                  </label>
                  <input
                    type="tel"
                    maxLength={32}
                    value={form.paymentPhone}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((prev) => ({
                        ...prev,
                        paymentPhone: val,
                        upiId:
                          prev.upiId.trim() === ''
                            ? suggestUpiIdFromPhone(val, prev.preferredApp)
                            : prev.upiId,
                      }));
                    }}
                    placeholder="+91 98765 43210"
                    className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-200 rounded-lg bg-white"
                    required={!form.paymentQrUrl}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Host Receiving UPI ID
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={form.upiId}
                    onChange={(e) => setForm((prev) => ({ ...prev, upiId: e.target.value }))}
                    placeholder="9876543210@ybl or name@okicici"
                    className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-200 rounded-lg bg-white"
                    required={!form.paymentQrUrl}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Payee / Account Holder Name
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={form.payeeName}
                    onChange={(e) => setForm((prev) => ({ ...prev, payeeName: e.target.value }))}
                    placeholder={userProfile.displayName}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Preferred Payment App
                  </label>
                  <select
                    value={form.preferredApp}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        preferredApp: e.target.value as PreferredPaymentApp,
                      }))
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="both">PhonePe &amp; Google Pay</option>
                    <option value="phonepe">PhonePe Preferred</option>
                    <option value="gpay">Google Pay Preferred</option>
                  </select>
                </div>
              </div>

              {/* Listing Payment QR Code Uploader */}
              <div className="p-3.5 rounded-xl bg-white border border-teal-200/80 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <QrCode className="w-3.5 h-3.5 text-teal-700" />
                      Upload Payment QR Code (PhonePe / Google Pay / Paytm)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Optional: upload your own QR screenshot for this listing. We automatically extract your UPI ID if readable.
                    </p>
                  </div>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    {form.paymentQrUrl ? 'Replace QR' : 'Upload QR'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => void handleListingQrUpload(e)}
                      className="hidden"
                    />
                  </label>
                </div>

                {listingQrNotice && (
                  <p className="text-[11px] font-medium text-teal-700">{listingQrNotice}</p>
                )}

                {form.paymentQrUrl && (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3">
                      <img
                        src={form.paymentQrUrl}
                        alt="Listing payment QR"
                        className="w-16 h-16 rounded-lg border border-slate-200 bg-white object-contain p-1"
                      />
                      <span className="text-xs text-slate-700 font-medium">
                        Listing Payment QR attached
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setForm((prev) => ({ ...prev, paymentQrUrl: '' }));
                        setListingQrNotice(null);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <X className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Location & Coordinates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">City / Neighborhood</label>
                <input
                  type="text"
                  maxLength={120}
                  value={form.locationName}
                  onChange={(e) => setForm((prev) => ({ ...prev, locationName: e.target.value }))}
                  placeholder="e.g., Fort Kochi, Kerala"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Country</label>
                <input
                  type="text"
                  maxLength={80}
                  value={form.country}
                  onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))}
                  placeholder="e.g., India"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Pin Exact Location on Map
              </label>
              <MapCoordinatePicker
                lat={form.lat}
                lng={form.lng}
                onChange={(lat, lng, resolved) =>
                  setForm((prev) => ({
                    ...prev,
                    lat,
                    lng,
                    locationName: prev.locationName || resolved || prev.locationName,
                  }))
                }
              />
            </div>

            {/* Pricing & Capacity */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Price in INR (₹ / {form.unitLabel})
                </label>
                <input
                  type="number"
                  min={100}
                  max={500000}
                  value={form.pricePerUnitInr}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, pricePerUnitInr: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-200 rounded-lg"
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1 font-mono-nums">
                  Displays as {formatCurrency(form.pricePerUnitInr || 0, currency)}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Pricing Unit</label>
                <select
                  value={form.unitLabel}
                  onChange={(e) => setForm((prev) => ({ ...prev, unitLabel: e.target.value as UnitLabel }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="night">Per Night</option>
                  <option value="person">Per Person</option>
                  <option value="session">Per Session</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Max Guests</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={form.maxGuests}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxGuests: Number(e.target.value) }))}
                  className="w-full px-3 py-2 text-sm font-mono-nums border border-slate-200 rounded-lg"
                  required
                />
              </div>
            </div>

            {/* Amenities */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Amenities</label>
              <div className="flex flex-wrap gap-2">
                {AMENITY_OPTIONS.map((am) => {
                  const selected = form.amenities.includes(am);
                  return (
                    <button
                      key={am}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          amenities: selected
                            ? prev.amenities.filter((x) => x !== am)
                            : [...prev.amenities, am].slice(0, 12),
                        }))
                      }
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {am}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Photos Uploader */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-semibold text-slate-700">
                  Property / Experience Photos ({form.photos.length}/6)
                </label>
                <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800">
                  <Upload className="w-3.5 h-3.5" />
                  Upload Photos
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={(e) => void handlePhotoUpload(e)}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {form.photos.map((src, idx) => (
                  <div key={`form-photo-${idx}`} className="relative aspect-[4/3] rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                    <img src={src} alt={`Upload ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          photos: prev.photos.filter((_, i) => i !== idx),
                        }))
                      }
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-slate-900/80 text-white hover:bg-red-600"
                      aria-label="Remove photo"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[11px] text-slate-500 mb-1.5">Or quick-add curated photography:</p>
                <div className="flex flex-wrap gap-1.5">
                  {PHOTO_PRESETS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() =>
                        setForm((prev) =>
                          prev.photos.includes(preset.url) || prev.photos.length >= 6
                            ? prev
                            : { ...prev, photos: [...prev.photos, preset.url] },
                        )
                      }
                      className="px-2.5 py-1 rounded border border-slate-200 text-[11px] text-slate-700 hover:bg-slate-50"
                    >
                      + {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Initial Availability Calendar (for new listings) */}
            {!editingListingId && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Initial Availability Calendar (Optional: click dates to mark unavailable)
                </label>
                <div className="max-w-sm">
                  <AvailabilityCalendar
                    mode="host-block"
                    unavailableDates={{}}
                    blockedDates={form.blockedDates}
                    selectedStart={null}
                    selectedEnd={null}
                    onToggleBlockDate={(iso) =>
                      setForm((prev) => ({
                        ...prev,
                        blockedDates: prev.blockedDates.includes(iso)
                          ? prev.blockedDates.filter((d) => d !== iso)
                          : [...prev.blockedDates, iso],
                      }))
                    }
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-200">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isPublished}
                  onChange={(e) => setForm((prev) => ({ ...prev, isPublished: e.target.checked }))}
                  className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
                />
                Publish live on Tourx Marketplace &amp; World Map
              </label>

              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 transition-colors"
              >
                {saving
                  ? 'Saving...'
                  : editingListingId
                    ? 'Save Changes'
                    : 'Publish Listing'}
              </button>
            </div>
          </form>
        )}

        {/* TAB 4: MANAGE BOOKINGS */}
        {activeTab === 'bookings' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Manage Guest Bookings</h1>
              <p className="text-sm text-slate-600 mt-0.5">
                View every PhonePe and Google Pay payment made to your number, verify UTR references, and manage reservations.
              </p>
            </div>

            {hostBookings.length === 0 ? (
              <div className="p-12 rounded-2xl bg-white border border-slate-200 text-center text-sm text-slate-500">
                No guest bookings yet. Publish a listing and share it on the Tourx World Map to start receiving bookings.
              </div>
            ) : (
              <div className="space-y-3">
                {hostBookings.map((bk) => (
                  <div
                    key={bk.id}
                    className="p-5 rounded-xl bg-white border border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
                        <span>
                          Guest: <strong className="text-slate-900">{bk.travellerName}</strong> ({bk.guests} guests)
                        </span>
                        <span>·</span>
                        <span className="font-mono-nums">From: {bk.upiHandle}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900">{bk.listingTitle}</h3>
                      <div className="text-xs font-mono-nums text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          {formatReadableDate(bk.checkInDate)}
                          {bk.listingCategory === 'homestay'
                            ? ` → ${formatReadableDate(bk.checkOutDate)}`
                            : ''}
                        </span>
                        <span>·</span>
                        <span>
                          Paid to: <strong className="text-slate-800">{bk.hostPaymentPhone || bk.hostUpiId}</strong> ({bk.hostUpiId})
                        </span>
                        <span>·</span>
                        <span>
                          {bk.paymentMethod === 'phonepe' ? 'PhonePe' : 'Google Pay'} Ref:{' '}
                          <strong className="text-slate-800">{bk.transactionRef}</strong>
                        </span>
                        <span>·</span>
                        <span className="text-teal-700 font-semibold">
                          Net: {formatCurrency(bk.hostNetPayoutInr, currency)} (Gross{' '}
                          {formatCurrency(bk.totalAmountInr, currency)})
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                          bk.paymentMode === 'live_upi'
                            ? 'bg-teal-50 border-teal-200 text-teal-800'
                            : 'bg-slate-100 border-slate-200 text-slate-600'
                        }`}
                      >
                        {bk.paymentMode === 'live_upi' ? 'Live UPI Paid' : 'Test Mode'}
                      </span>

                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                          bk.bookingStatus === 'confirmed'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                            : bk.bookingStatus === 'completed'
                              ? 'bg-sky-50 border-sky-200 text-sky-700'
                              : 'bg-slate-100 border-slate-200 text-slate-500'
                        }`}
                      >
                        {bk.bookingStatus}
                      </span>

                      {bk.bookingStatus === 'confirmed' && (
                        <>
                          <button
                            type="button"
                            disabled={busyBookingId === bk.id}
                            onClick={() => void handleBookingAction(bk.id, 'completed')}
                            className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50"
                          >
                            Mark Completed
                          </button>
                          <button
                            type="button"
                            disabled={busyBookingId === bk.id}
                            onClick={() => void handleBookingAction(bk.id, 'cancelled')}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Host Calendar Modal */}
      {calendarModalListing && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Availability Calendar</h3>
                <p className="text-xs text-slate-600 mt-0.5">{calendarModalListing.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setCalendarModalListing(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {calendarError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {calendarError}
              </div>
            )}

            <AvailabilityCalendar
              mode="host-block"
              unavailableDates={buildUnavailableDateSet(
                [],
                availabilitySlots.filter((s) => s.listingId === calendarModalListing.id),
              )}
              blockedDates={calendarModalListing.blockedDates}
              selectedStart={null}
              selectedEnd={null}
              onToggleBlockDate={(iso) => void handleToggleCalendarModalDate(iso)}
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setCalendarError(null);
                  setCalendarModalListing(null);
                }}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
