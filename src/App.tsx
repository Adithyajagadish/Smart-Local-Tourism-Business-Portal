import React, { useCallback, useEffect, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { Compass } from 'lucide-react';
import { AuthGateView } from './components/AuthGateView';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExploreAnywhereMap } from './components/ExploreAnywhereMap';
import { HostStudioView } from './components/HostStudioView';
import { ListingDetailModal } from './components/ListingDetailModal';
import { LiveVoiceModal } from './components/LiveVoiceModal';
import { MarketplaceDiscover } from './components/MarketplaceDiscover';
import { Navbar } from './components/Navbar';
import { TravellerTripsView } from './components/TravellerTripsView';
import { getSupabaseInitState, signOutSupabase } from './lib/supabase';
import {
  AuthSessionError,
  createBookingAtomic,
  createHostListing,
  deleteHostListing,
  fetchAuthenticatedProfile,
  saveHostPayoutSettings,
  subscribeActiveAvailability,
  subscribeHostBookings,
  subscribeHostListings,
  subscribePublicListings,
  subscribeTravellerBookings,
  subscribeUserPrivateInfo,
  switchUserAccountRole,
  updateBookingStatusAtomic,
  updateHostListing,
  updateListingBlockedDates,
} from './services/backendService';
import {
  AccountType,
  AppView,
  AvailabilitySlot,
  Booking,
  CurrencyCode,
  Listing,
  PaymentMethod,
  PaymentMode,
  UserPrivateInfo,
  UserProfile,
} from './types';
import { GOOGLE_MAPS_API_KEY } from './utils/mapsConfig';

function TourxAppInner() {
  const [activeView, setActiveView] = useState<AppView>('discover');
  const [currency, setCurrency] = useState<CurrencyCode>('INR');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [hostPrivateInfo, setHostPrivateInfo] = useState<UserPrivateInfo | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [supabaseConfigured, setSupabaseConfigured] = useState(true);
  const [supabaseConfigError, setSupabaseConfigError] = useState<string | undefined>(undefined);

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalFocus, setAuthModalFocus] = useState<AccountType>('traveller');

  const [publicListings, setPublicListings] = useState<Listing[]>([]);
  const [hostListings, setHostListings] = useState<Listing[]>([]);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);
  const [travellerBookings, setTravellerBookings] = useState<Booking[]>([]);
  const [hostBookings, setHostBookings] = useState<Booking[]>([]);

  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);
  const [liveVoiceOpen, setLiveVoiceOpen] = useState(false);
  const [voiceContext, setVoiceContext] = useState<{
    destination?: string;
    listing?: string;
  }>({});

  const activeUidRef = useRef<string | null>(null);

  const clearAuthenticatedState = useCallback(() => {
    activeUidRef.current = null;
    setUserProfile(null);
    setHostPrivateInfo(null);
    setPublicListings([]);
    setAvailabilitySlots([]);
    setTravellerBookings([]);
    setHostBookings([]);
    setHostListings([]);
    setSelectedListing(null);
    setLiveVoiceOpen(false);
    setAuthModalOpen(false);
  }, []);

  const syncProfileFromBackend = useCallback(
    async (accessToken?: string, preferredRole?: AccountType) => {
      let targetRole = preferredRole;
      try {
        const pending = window.sessionStorage.getItem('tourx_pending_portal_role');
        if (pending === 'host' || pending === 'traveller') {
          targetRole = targetRole || pending;
          window.sessionStorage.removeItem('tourx_pending_portal_role');
        }
      } catch {
        // Ignore sessionStorage errors
      }

      let { profile, privateInfo } = await fetchAuthenticatedProfile(accessToken);
      if (targetRole && profile.accountType !== targetRole) {
        try {
          const switched = await switchUserAccountRole(targetRole);
          profile = switched.profile;
          privateInfo = switched.privateInfo;
        } catch {
          // Proceed with loaded profile if role switch fails silently during auth
        }
      }
      activeUidRef.current = profile.uid;
      setUserProfile(profile);
      setHostPrivateInfo(privateInfo);
      if (targetRole === 'host' && profile.accountType === 'host') {
        setActiveView('host');
      }
    },
    [],
  );

  // Listen for Google Maps Platform Case A quota exceeded events
  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  // Initialize Supabase Auth & restore session
  useEffect(() => {
    let active = true;
    let subscription: { unsubscribe: () => void } | null = null;
    let initialResolved = false;

    const handleInvalidSession = async () => {
      await signOutSupabase(true).catch(() => undefined);
      if (active) {
        clearAuthenticatedState();
      }
    };

    const initAuth = async () => {
      try {
        const initState = await getSupabaseInitState();
        if (!active) return;

        setSupabaseConfigured(initState.configured);
        setSupabaseConfigError(initState.errorMessage);

        if (!initState.client) {
          setAuthReady(true);
          return;
        }

        const { data } = await initState.client.auth.getSession();
        if (!active) return;

        if (data.session?.access_token) {
          try {
            await syncProfileFromBackend(data.session.access_token);
          } catch (err) {
            if (err instanceof AuthSessionError) {
              await handleInvalidSession();
            } else if (err instanceof Error && err.message) {
              setSupabaseConfigError(err.message);
            }
          }
        }
        initialResolved = true;

        const { data: listenerData } = initState.client.auth.onAuthStateChange(
          (event, session) => {
            if (!active) return;
            if (event === 'INITIAL_SESSION' && initialResolved) {
              return;
            }
            if (!session?.access_token) {
              clearAuthenticatedState();
              return;
            }
            if (
              (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') &&
              activeUidRef.current === session.user.id
            ) {
              return;
            }
            void syncProfileFromBackend(session.access_token).catch((err) => {
              if (err instanceof AuthSessionError) {
                void handleInvalidSession();
              }
            });
          },
        );
        subscription = listenerData.subscription;
      } catch {
        setSupabaseConfigured(false);
      } finally {
        if (active) {
          setAuthReady(true);
        }
      }
    };

    void initAuth();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [clearAuthenticatedState, syncProfileFromBackend]);

  // Authenticated Marketplace & User Listeners
  useEffect(() => {
    if (!authReady || !userProfile) {
      return;
    }

    const unsubListings = subscribePublicListings(setPublicListings);
    const unsubAvailability = subscribeActiveAvailability(setAvailabilitySlots);
    const unsubTraveller = subscribeTravellerBookings(userProfile.uid, setTravellerBookings);
    const unsubPrivate = subscribeUserPrivateInfo(userProfile.uid, setHostPrivateInfo);

    let unsubHostListings: (() => void) | null = null;
    let unsubHostBookings: (() => void) | null = null;

    if (userProfile.accountType === 'host') {
      unsubHostListings = subscribeHostListings(userProfile.uid, setHostListings);
      unsubHostBookings = subscribeHostBookings(userProfile.uid, setHostBookings);
    } else {
      setHostListings([]);
      setHostBookings([]);
    }

    return () => {
      unsubListings();
      unsubAvailability();
      unsubTraveller();
      unsubPrivate();
      unsubHostListings?.();
      unsubHostBookings?.();
    };
  }, [authReady, userProfile]);

  const handleSwitchRole = async (role: AccountType) => {
    const { profile, privateInfo } = await switchUserAccountRole(role);
    activeUidRef.current = profile.uid;
    setUserProfile(profile);
    setHostPrivateInfo(privateInfo);
    if (role === 'host') {
      setActiveView('host');
    } else if (activeView === 'host') {
      setActiveView('discover');
    }
  };

  const handleSignOut = async () => {
    await signOutSupabase();
    clearAuthenticatedState();
    setActiveView('discover');
  };

  const handleCompleteBooking = async (payload: {
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
  }) => {
    if (!userProfile) {
      throw new Error('Please sign in to complete your booking.');
    }
    return createBookingAtomic({
      ...payload,
      travellerId: userProfile.uid,
      travellerName: userProfile.displayName,
      displayCurrency: currency,
    });
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#07141A] text-white flex flex-col items-center justify-center p-6">
        <Compass className="w-8 h-8 text-teal-400 animate-spin mb-4" />
        <p className="text-sm font-medium text-slate-300">Connecting to Tourx...</p>
      </div>
    );
  }

  if (!userProfile) {
    return (
      <AuthGateView
        supabaseConfigured={supabaseConfigured}
        configError={supabaseConfigError}
        onAuthenticated={syncProfileFromBackend}
      />
    );
  }

  const allCatalogListings = publicListings;
  const activeSelectedListing = selectedListing
    ? allCatalogListings.find((item) => item.id === selectedListing.id) || selectedListing
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      {/* Case A Google Maps Quota Banner */}
      {gmpQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      <Navbar
        activeView={activeView}
        onNavigate={setActiveView}
        currency={currency}
        onCurrencyChange={setCurrency}
        userProfile={userProfile}
        onOpenAuth={(focus) => {
          setAuthModalFocus(focus || userProfile.accountType);
          setAuthModalOpen(true);
        }}
        onOpenVoice={() => {
          setVoiceContext({});
          setLiveVoiceOpen(true);
        }}
        onSignOut={() => {
          void handleSignOut();
        }}
        tripCount={travellerBookings.filter((b) => b.bookingStatus === 'confirmed').length}
      />

      <div className="flex-1">
        {activeView === 'discover' && (
          <MarketplaceDiscover
            listings={allCatalogListings}
            currency={currency}
            onSelectListing={setSelectedListing}
            onOpenWorldMap={() => setActiveView('map')}
            onOpenHostPortal={() => setActiveView('host')}
            onOpenVoice={() => {
              setVoiceContext({});
              setLiveVoiceOpen(true);
            }}
          />
        )}

        {activeView === 'map' && (
          <ExploreAnywhereMap
            listings={allCatalogListings}
            currency={currency}
            onSelectListing={setSelectedListing}
            onOpenVoice={(destination) => {
              setVoiceContext({ destination });
              setLiveVoiceOpen(true);
            }}
          />
        )}

        {activeView === 'trips' && (
          <TravellerTripsView
            userProfile={userProfile}
            bookings={travellerBookings}
            currency={currency}
            onOpenAuth={() => {
              setAuthModalFocus('traveller');
              setAuthModalOpen(true);
            }}
            onExplore={() => setActiveView('discover')}
            onCancelBooking={(id) => updateBookingStatusAtomic(id, 'cancelled')}
          />
        )}

        {activeView === 'host' && (
          <HostStudioView
            userProfile={userProfile}
            hostPrivateInfo={hostPrivateInfo}
            hostListings={hostListings}
            hostBookings={hostBookings}
            availabilitySlots={availabilitySlots}
            currency={currency}
            onOpenHostAuth={() => {
              setAuthModalFocus('host');
              setAuthModalOpen(true);
            }}
            onSwitchToHost={() => handleSwitchRole('host')}
            onSignOut={() => {
              void handleSignOut();
            }}
            onSavePayoutSettings={async (input) => {
              return saveHostPayoutSettings(userProfile.uid, input);
            }}
            onCreateListing={async (input) => {
              return createHostListing(userProfile.uid, userProfile.displayName, input);
            }}
            onUpdateListing={async (listingId, input) => {
              return updateHostListing(
                listingId,
                userProfile.uid,
                userProfile.displayName,
                input,
              );
            }}
            onUpdateBlockedDates={updateListingBlockedDates}
            onDeleteListing={deleteHostListing}
            onUpdateBookingStatus={updateBookingStatusAtomic}
          />
        )}
      </div>

      {/* Quiet Editorial Footer on non-map pages */}
      {activeView !== 'map' && (
        <footer className="border-t border-slate-200 bg-white py-8 px-4 sm:px-8">
          <div className="max-w-[1380px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-3">
              <span className="font-bold text-slate-900">Tourx</span>
              <span>·</span>
              <span>Local Homestays, Guides &amp; Cultural Businesses</span>
            </div>
            <div className="flex items-center gap-5">
              <button type="button" onClick={() => setActiveView('discover')} className="hover:text-slate-900">
                Explore
              </button>
              <button type="button" onClick={() => setActiveView('map')} className="hover:text-slate-900">
                World Map
              </button>
              <button type="button" onClick={() => setActiveView('host')} className="hover:text-slate-900">
                Host Studio
              </button>
            </div>
          </div>
        </footer>
      )}

      {/* Dual Role Portal Switcher Modal */}
      <AuthModal
        isOpen={authModalOpen}
        initialFocus={authModalFocus}
        userProfile={userProfile}
        onClose={() => setAuthModalOpen(false)}
        onSwitchRole={handleSwitchRole}
      />

      {/* Listing Detail, Availability Calendar & UPI Payment Modal */}
      <ListingDetailModal
        listing={activeSelectedListing}
        availabilitySlots={availabilitySlots}
        currency={currency}
        userProfile={userProfile}
        onClose={() => setSelectedListing(null)}
        onRequireSignIn={() => {
          setAuthModalFocus('traveller');
          setAuthModalOpen(true);
        }}
        onOpenVoice={(destination, listingTitle) => {
          setVoiceContext({ destination, listing: listingTitle });
          setLiveVoiceOpen(true);
        }}
        onCompleteBooking={handleCompleteBooking}
        onViewTrips={() => setActiveView('trips')}
      />

      {/* Real-Time Gemini Live API Voice Conversation Modal */}
      <LiveVoiceModal
        isOpen={liveVoiceOpen}
        contextDestination={voiceContext.destination}
        contextListing={voiceContext.listing}
        onClose={() => setLiveVoiceOpen(false)}
      />
    </div>
  );
}

export default function App() {
  const content = <TourxAppInner />;

  return (
    <ErrorBoundary>
      {GOOGLE_MAPS_API_KEY ? (
        <APIProvider apiKey={GOOGLE_MAPS_API_KEY} language="en" region="IN">
          {content}
        </APIProvider>
      ) : (
        content
      )}
    </ErrorBoundary>
  );
}
