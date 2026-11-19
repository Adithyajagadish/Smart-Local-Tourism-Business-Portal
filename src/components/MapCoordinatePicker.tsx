import React, { useEffect, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { MapPin, Search } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions';
import { GMP_ATTRIBUTION_IDS, GOOGLE_MAP_ID, GOOGLE_MAPS_API_KEY } from '../utils/mapsConfig';

interface MapCoordinatePickerProps {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number, resolvedLocation?: string) => void;
}

export const MapCoordinatePicker: React.FC<MapCoordinatePickerProps> = ({
  lat,
  lng,
  onChange,
}) => {
  const map = useMap('host-picker-map');
  const placesLib = useMapsLibrary('places');
  const [queryText, setQueryText] = useState('');
  const { suggestions, resetSession } = useAutocompleteSuggestions(queryText);

  useEffect(() => {
    if (map) {
      map.panTo({ lat, lng });
    }
  }, [map, lat, lng]);

  const handleSelectSuggestion = async (sug: google.maps.places.AutocompleteSuggestion) => {
    if (!placesLib || !sug.placePrediction) return;
    try {
      const place = sug.placePrediction.toPlace();
      await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress'] });
      if (place.location) {
        const nextLat = Number(place.location.lat().toFixed(5));
        const nextLng = Number(place.location.lng().toFixed(5));
        onChange(nextLat, nextLng, place.displayName || place.formattedAddress || undefined);
        map?.setCenter({ lat: nextLat, lng: nextLng });
        map?.setZoom(12);
      }
      setQueryText('');
      resetSession();
    } catch (err) {
      console.error('Place lookup failed:', err);
    }
  };

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="p-4 border border-slate-200 rounded-xl bg-slate-50 text-xs text-slate-600">
        Map coordinate picker requires Google Maps API key. You can enter Latitude and Longitude manually below.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder="Search city or neighborhood to drop property pin..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        {suggestions.length > 0 && queryText.trim().length >= 2 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-30 max-h-44 overflow-y-auto">
            {suggestions.map((sug, idx) => (
              <button
                key={`picker-sug-${idx}`}
                type="button"
                onClick={() => void handleSelectSuggestion(sug)}
                className="w-full text-left px-3 py-2 text-xs text-slate-800 hover:bg-teal-50 border-b border-slate-100 last:border-b-0 flex items-center gap-2"
              >
                <MapPin className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                <span className="truncate">{sug.placePrediction?.text.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="h-60 w-full rounded-xl overflow-hidden border border-slate-200 relative">
        <GoogleMap
          id="host-picker-map"
          mapId={GOOGLE_MAP_ID}
          defaultCenter={{ lat, lng }}
          defaultZoom={5}
          gestureHandling="greedy"
          disableDefaultUI={true}
          internalUsageAttributionIds={GMP_ATTRIBUTION_IDS}
          onClick={(ev) => {
            if (ev.detail.latLng) {
              onChange(
                Number(ev.detail.latLng.lat.toFixed(5)),
                Number(ev.detail.latLng.lng.toFixed(5)),
              );
            }
          }}
          className="w-full h-full"
        >
          <AdvancedMarker position={{ lat, lng }}>
            <Pin background="#0D9488" borderColor="#115E59" glyphColor="#FFFFFF" />
          </AdvancedMarker>
        </GoogleMap>
      </div>
      <p className="text-[11px] text-slate-500 font-mono-nums">
        Click anywhere on the map to adjust coordinates · Selected: {lat.toFixed(4)}, {lng.toFixed(4)}
      </p>
    </div>
  );
};
