import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { AudioLines, Compass, Globe2, LocateFixed, MapPin, Search, Star } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { CurrencyCode, Listing, ListingCategory } from '../types';
import { formatCurrency } from '../utils/currency';
import { GMP_ATTRIBUTION_IDS, GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY } from '../utils/mapsConfig';

interface ExploreAnywhereMapProps {
  listings: Listing[];
  currency: CurrencyCode;
  onSelectListing: (listing: Listing) => void;
  onOpenVoice?: (destination?: string) => void;
}

const QUICK_REGIONS: { label: string; center: { lat: number; lng: number }; zoom: number }[] = [
  { label: 'World', center: { lat: 22, lng: 45 }, zoom: 2.4 },
  { label: 'India', center: { lat: 21.1458, lng: 79.0882 }, zoom: 4.8 },
  { label: 'Japan', center: { lat: 35.6762, lng: 136.8 }, zoom: 5.8 },
  { label: 'Mediterranean', center: { lat: 41.2, lng: 13.5 }, zoom: 5.5 },
];

interface MarkerItemProps {
  listing: Listing;
  currency: CurrencyCode;
  isSelected: boolean;
  onRegisterMarker: (listingId: string, marker: google.maps.marker.AdvancedMarkerElement | null) => void;
  onMarkerClick: (listing: Listing, marker: google.maps.marker.AdvancedMarkerElement) => void;
}

const ListingMapMarker: React.FC<MarkerItemProps> = ({
  listing,
  currency,
  isSelected,
  onRegisterMarker,
  onMarkerClick,
}) => {
  const [markerRef, marker] = useAdvancedMarkerRef();

  useEffect(() => {
    onRegisterMarker(listing.id, marker);
    return () => {
      onRegisterMarker(listing.id, null);
    };
  }, [listing.id, marker, onRegisterMarker]);

  const badgeColors =
    listing.category === 'homestay'
      ? isSelected
        ? 'bg-teal-700 text-white border-teal-900'
        : 'bg-white text-slate-900 border-slate-300 hover:border-teal-600'
      : listing.category === 'guide'
        ? isSelected
          ? 'bg-amber-600 text-white border-amber-800'
          : 'bg-white text-slate-900 border-amber-300 hover:border-amber-600'
        : isSelected
          ? 'bg-sky-700 text-white border-sky-900'
          : 'bg-white text-slate-900 border-sky-300 hover:border-sky-600';

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{ lat: listing.lat, lng: listing.lng }}
      zIndex={isSelected ? 1000 : 10}
      onClick={() => {
        if (marker) {
          onMarkerClick(listing, marker);
        }
      }}
    >
      <div
        className={`px-2.5 py-1 rounded-full border shadow-md text-xs font-mono-nums font-bold transition-transform cursor-pointer ${
          isSelected ? 'scale-110' : 'hover:scale-105'
        } ${badgeColors}`}
      >
        {formatCurrency(listing.pricePerUnitInr, currency)}
      </div>
    </AdvancedMarker>
  );
};

interface MapWorkspaceInnerProps {
  listings: Listing[];
  currency: CurrencyCode;
  onSelectListing: (listing: Listing) => void;
  onOpenVoice?: (destination?: string) => void;
}

const MapWorkspaceInner: React.FC<MapWorkspaceInnerProps> = ({
  listings,
  currency,
  onSelectListing,
  onOpenVoice,
}) => {
  const map = useMap();
  const placesLib = useMapsLibrary('places');

  const [categoryFilter, setCategoryFilter] = useState<'all' | ListingCategory>('all');
  const [searchText, setSearchText] = useState('');
  const [filterByBounds, setFilterByBounds] = useState(false);
  const [boundsBox, setBoundsBox] = useState<google.maps.LatLngBoundsLiteral | null>(null);
  const [selectedListing, setSelectedListing] = useState<Listing | null>(null);
  const [selectedMarker, setSelectedMarker] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [exploredPlaceLabel, setExploredPlaceLabel] = useState<string | null>(null);
  const markerMapRef = useRef<Record<string, google.maps.marker.AdvancedMarkerElement | null>>({});

  const registerMarker = useCallback(
    (listingId: string, marker: google.maps.marker.AdvancedMarkerElement | null) => {
      if (marker) {
        markerMapRef.current[listingId] = marker;
      } else {
        delete markerMapRef.current[listingId];
      }
    },
    [],
  );

  const { suggestions, isLoading: suggestionsLoading, resetSession } =
    useAutocompleteSuggestions(searchText);

  const handleBoundsSync = useCallback(() => {
    if (!map) return;
    const b = map.getBounds();
    if (b) {
      setBoundsBox(b.toJSON());
    }
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('idle', handleBoundsSync);
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, handleBoundsSync]);

  const handleSuggestionPick = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!placesLib || !suggestion.placePrediction || !map) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'viewport'],
      });
      if (place.viewport) {
        map.fitBounds(place.viewport);
      } else if (place.location) {
        map.setCenter(place.location);
        map.setZoom(11);
      }
      setExploredPlaceLabel(place.displayName || place.formattedAddress || searchText);
      setSearchText('');
      resetSession();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
    }
  };

  const handleLocateMe = () => {
    if (!map || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.setCenter(coords);
        map.setZoom(10);
        setExploredPlaceLabel('Your current area');
      },
      () => {
        // Ignore geolocation denial silently
      },
    );
  };

  const handleJumpRegion = (center: { lat: number; lng: number }, zoom: number, label: string) => {
    if (!map) return;
    map.setCenter(center);
    map.setZoom(zoom);
    setExploredPlaceLabel(label === 'World' ? null : label);
  };

  const visibleListings = useMemo(() => {
    return listings.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }
      if (filterByBounds && boundsBox) {
        const inLat = item.lat >= boundsBox.south && item.lat <= boundsBox.north;
        const inLng =
          boundsBox.west <= boundsBox.east
            ? item.lng >= boundsBox.west && item.lng <= boundsBox.east
            : item.lng >= boundsBox.west || item.lng <= boundsBox.east;
        if (!inLat || !inLng) return false;
      }
      return true;
    });
  }, [listings, categoryFilter, filterByBounds, boundsBox]);

  useEffect(() => {
    if (selectedListing && !visibleListings.some((l) => l.id === selectedListing.id)) {
      setSelectedListing(null);
      setSelectedMarker(null);
    }
  }, [selectedListing, visibleListings]);

  const handleFocusListingOnMap = (item: Listing) => {
    setSelectedListing(item);
    setSelectedMarker(markerMapRef.current[item.id] ?? null);
    if (map) {
      map.panTo({ lat: item.lat, lng: item.lng });
      if ((map.getZoom() || 2) < 9) {
        map.setZoom(10);
      }
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-64px)] min-h-[620px] bg-white">
      {/* Left Interactive Directory Panel */}
      <aside className="w-full lg:w-[420px] xl:w-[460px] border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col h-[42vh] lg:h-full bg-white shrink-0">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Explore Anywhere</h1>
              <p className="text-xs text-slate-500">
                Pan the globe or search any city to discover local stays &amp; culture
              </p>
            </div>
            <button
              type="button"
              onClick={handleLocateMe}
              className="p-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
              title="Center near my location"
            >
              <LocateFixed className="w-4 h-4" />
            </button>
          </div>

          {/* Places API Autocomplete Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search any place worldwide (e.g. Kyoto, Goa, Bali)..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            {(suggestions.length > 0 || suggestionsLoading) && searchText.trim().length >= 2 && (
              <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-56 overflow-y-auto">
                {suggestionsLoading && suggestions.length === 0 ? (
                  <div className="px-3.5 py-2.5 text-xs text-slate-500">Searching places...</div>
                ) : (
                  suggestions.map((sug, i) => (
                    <button
                      key={`sug-${i}`}
                      type="button"
                      onClick={() => void handleSuggestionPick(sug)}
                      className="w-full text-left px-3.5 py-2.5 text-xs text-slate-800 hover:bg-teal-50 border-b border-slate-100 last:border-b-0 flex items-center gap-2"
                    >
                      <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                      <span className="truncate">{sug.placePrediction?.text.text}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Category + Bounds Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['all', 'homestay', 'guide', 'cultural'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    categoryFilter === cat
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {cat === 'all'
                    ? 'All'
                    : cat === 'homestay'
                      ? 'Homestays'
                      : cat === 'guide'
                        ? 'Guides'
                        : 'Cultural'}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={filterByBounds}
                onChange={(e) => setFilterByBounds(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-600"
              />
              Search map area
            </label>
          </div>
        </div>

        {/* Listing Results Drawer */}
        <div className="flex-1 overflow-y-auto tourx-scroll p-4 space-y-3">
          {exploredPlaceLabel && (
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 flex items-center justify-between gap-2">
              <span className="truncate">
                Exploring <strong className="text-slate-900">{exploredPlaceLabel}</strong>
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {onOpenVoice && (
                  <button
                    type="button"
                    onClick={() => onOpenVoice(exploredPlaceLabel)}
                    className="inline-flex items-center gap-1 text-teal-700 font-semibold hover:underline"
                  >
                    <AudioLines className="w-3 h-3" />
                    Voice
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleJumpRegion({ lat: 22, lng: 45 }, 2.4, 'World')}
                  className="text-slate-600 font-medium hover:underline"
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {visibleListings.length === 0 ? (
            <div className="py-10 px-4 text-center border border-dashed border-slate-200 rounded-xl">
              <Globe2 className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-900">
                {listings.length === 0
                  ? 'No published host listings yet'
                  : 'No stays in this map window yet'}
              </p>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                {listings.length === 0
                  ? 'Search any destination worldwide above, or publish a listing from Host Studio.'
                  : 'Pan out to see global Tourx hosts or uncheck “Search map area”.'}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilterByBounds(false);
                  handleJumpRegion({ lat: 22, lng: 45 }, 2.4, 'World');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800"
              >
                Show All Worldwide
              </button>
            </div>
          ) : (
            visibleListings.map((item) => (
              <div
                key={item.id}
                onClick={() => handleFocusListingOnMap(item)}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex gap-3 ${
                  selectedListing?.id === item.id
                    ? 'border-teal-600 bg-teal-50/40'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
              >
                <img
                  src={item.photos[0]}
                  alt={item.title}
                  referrerPolicy="no-referrer"
                  className="w-24 h-20 rounded-lg object-cover shrink-0 bg-slate-100"
                />
                <div className="min-w-0 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {item.category === 'homestay'
                        ? 'Homestay'
                        : item.category === 'guide'
                          ? 'Local Guide'
                          : 'Cultural'}{' '}
                      · {item.locationName}, {item.country}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 truncate mt-0.5">{item.title}</h3>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs font-mono-nums font-bold text-slate-900">
                      {formatCurrency(item.pricePerUnitInr, currency)}
                      <span className="text-slate-500 font-normal"> / {item.unitLabel}</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectListing(item);
                      }}
                      className="text-xs font-semibold text-teal-700 hover:text-teal-800 hover:underline"
                    >
                      View &amp; Book →
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Right Full Interactive World Map */}
      <div className="flex-1 relative h-[50vh] lg:h-full">
        {/* Quick Region Jump Floating Bar */}
        <div className="absolute top-4 left-4 z-20 flex flex-wrap items-center gap-1.5 bg-white/95 backdrop-blur-sm border border-slate-200 rounded-xl p-1.5 shadow-md">
          {QUICK_REGIONS.map((region) => (
            <button
              key={region.label}
              type="button"
              onClick={() => handleJumpRegion(region.center, region.zoom, region.label)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
            >
              {region.label}
            </button>
          ))}
        </div>

        <GoogleMap
          mapId={GOOGLE_MAP_ID}
          defaultCenter={{ lat: 22, lng: 45 }}
          defaultZoom={2.4}
          minZoom={2}
          gestureHandling="greedy"
          disableDefaultUI={false}
          internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
          className="w-full h-full"
        >
          {visibleListings.map((item) => (
            <ListingMapMarker
              key={item.id}
              listing={item}
              currency={currency}
              isSelected={selectedListing?.id === item.id}
              onRegisterMarker={registerMarker}
              onMarkerClick={(clicked, marker) => {
                setSelectedListing(clicked);
                setSelectedMarker(marker);
              }}
            />
          ))}

          {selectedListing && selectedMarker && (
            <InfoWindow
              anchor={selectedMarker}
              onCloseClick={() => {
                setSelectedListing(null);
                setSelectedMarker(null);
              }}
            >
              <div className="w-60 p-1">
                <img
                  src={selectedListing.photos[0]}
                  alt={selectedListing.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-28 object-cover rounded-lg mb-2"
                />
                <div className="text-[11px] text-slate-500">
                  {selectedListing.locationName}, {selectedListing.country}
                </div>
                <h4 className="text-sm font-bold text-slate-900 leading-snug mt-0.5">
                  {selectedListing.title}
                </h4>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center gap-1 text-xs text-slate-700">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span className="font-mono-nums">{selectedListing.rating.toFixed(1)}</span>
                    <span className="text-slate-400">·</span>
                    <span className="font-mono-nums font-bold text-slate-900">
                      {formatCurrency(selectedListing.pricePerUnitInr, currency)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectListing(selectedListing)}
                    className="px-2.5 py-1 rounded-md bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700"
                  >
                    Book
                  </button>
                </div>
              </div>
            </InfoWindow>
          )}
        </GoogleMap>
      </div>
    </div>
  );
};

export const ExploreAnywhereMap: React.FC<ExploreAnywhereMapProps> = (props) => {
  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="max-w-3xl mx-auto my-16 p-8 bg-white border border-slate-200 rounded-2xl text-center space-y-3">
        <Compass className="w-10 h-10 text-teal-600 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900">Google Maps API Key Initializing</h2>
        <p className="text-sm text-slate-600">
          Ensure <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">VITE_GOOGLE_MAPS_API_KEY</code> is available in the environment and refresh the preview to load the Explore Anywhere world map.
        </p>
      </div>
    );
  }

  return <MapWorkspaceInner {...props} />;
};
