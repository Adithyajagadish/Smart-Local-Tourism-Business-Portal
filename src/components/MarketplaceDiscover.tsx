import React, { useMemo, useState } from 'react';
import { AudioLines, Globe2, MapPin, Search, SlidersHorizontal, Star, Users } from 'lucide-react';
import { AMENITY_OPTIONS, HERO_IMAGE } from '../data/featuredListings';
import { CurrencyCode, Listing, ListingCategory } from '../types';
import { formatCurrency } from '../utils/currency';

interface MarketplaceDiscoverProps {
  listings: Listing[];
  currency: CurrencyCode;
  onSelectListing: (listing: Listing) => void;
  onOpenWorldMap: () => void;
  onOpenHostPortal: () => void;
  onOpenVoice: () => void;
}

export const MarketplaceDiscover: React.FC<MarketplaceDiscoverProps> = ({
  listings,
  currency,
  onSelectListing,
  onOpenWorldMap,
  onOpenHostPortal,
  onOpenVoice,
}) => {
  const [category, setCategory] = useState<'all' | ListingCategory>('all');
  const [locationQuery, setLocationQuery] = useState('');
  const [minGuests, setMinGuests] = useState(1);
  const [customMaxPriceInr, setCustomMaxPriceInr] = useState<number | null>(null);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(true);

  const sliderMaxInr = useMemo(() => {
    const highest = listings.reduce((max, item) => Math.max(max, item.pricePerUnitInr || 0), 25000);
    return Math.max(25000, Math.ceil(highest / 500) * 500);
  }, [listings]);

  const maxPriceInr = customMaxPriceInr ?? sliderMaxInr;

  const toggleAmenity = (amenity: string) => {
    setSelectedAmenities((prev) =>
      prev.includes(amenity) ? prev.filter((a) => a !== amenity) : [...prev, amenity],
    );
  };

  const resetAllFilters = () => {
    setCategory('all');
    setLocationQuery('');
    setMinGuests(1);
    setCustomMaxPriceInr(null);
    setSelectedAmenities([]);
  };

  const filteredListings = useMemo(() => {
    const q = locationQuery.trim().toLowerCase();
    return listings.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (item.maxGuests < minGuests) return false;
      if (customMaxPriceInr !== null && item.pricePerUnitInr > customMaxPriceInr) return false;
      if (q) {
        const hay = `${item.locationName} ${item.country} ${item.title} ${item.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (selectedAmenities.length > 0) {
        const hasAll = selectedAmenities.every((am) => item.amenities.includes(am));
        if (!hasAll) return false;
      }
      return true;
    });
  }, [listings, category, minGuests, customMaxPriceInr, locationQuery, selectedAmenities]);

  return (
    <div className="bg-white">
      {/* 1. Dark Oceanic Hero (Hybrid visual direction) */}
      <section className="relative bg-[#07141A] text-white overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={HERO_IMAGE}
            alt="Coastal peninsula homestays and turquoise waters"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-70"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#07141A] via-[#07141A]/55 to-[#07141A]/40" />
        </div>

        <div className="relative max-w-[1380px] mx-auto px-4 sm:px-8 pt-16 pb-14 sm:pt-24 sm:pb-20">
          <div className="max-w-2xl">
            <p className="text-xs sm:text-sm font-medium text-teal-300 mb-3">
              Homestays · Local Guides · Cultural Businesses
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.08] [text-wrap:balance]">
              Your Next Authentic Journey Starts Here
            </h1>
            <p className="mt-4 text-base sm:text-lg text-slate-200 leading-relaxed max-w-xl">
              Discover family-run homestays, neighborhood storytellers, and artisan workshops. Explore anywhere on the globe and book seamlessly with PhonePe or Google Pay.
            </p>
          </div>

          {/* Glassmorphic Search Dock inspired by first reference */}
          <div className="mt-10 bg-slate-950/75 backdrop-blur-md border border-white/15 rounded-2xl p-4 sm:p-5 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-white/10">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All Stays & Culture' },
                    { id: 'homestay', label: 'Homestays' },
                    { id: 'guide', label: 'Local Guides' },
                    { id: 'cultural', label: 'Cultural Businesses' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCategory(tab.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                      category === tab.id
                        ? 'bg-teal-500 text-slate-950'
                        : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onOpenVoice}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-teal-500/20 border border-teal-400/40 text-xs font-semibold text-teal-200 hover:bg-teal-500/30 transition-colors whitespace-nowrap shrink-0"
                >
                  <AudioLines className="w-4 h-4 text-teal-300" />
                  Talk to Voice Guide
                </button>
                <button
                  type="button"
                  onClick={onOpenWorldMap}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white/10 border border-white/20 text-xs font-semibold text-white hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
                >
                  <Globe2 className="w-4 h-4 text-teal-300" />
                  Explore Anywhere Map
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-5">
                <label htmlFor="hero-location" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Destination or Region
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="hero-location"
                    type="text"
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    placeholder="Coorg, Kyoto, Rajasthan, Amalfi, Ladakh..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  />
                </div>
              </div>

              <div className="md:col-span-3">
                <label htmlFor="hero-guests" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Travellers
                </label>
                <div className="relative">
                  <Users className="w-4 h-4 text-teal-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <select
                    id="hero-guests"
                    value={minGuests}
                    onChange={(e) => setMinGuests(Number(e.target.value))}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-400"
                  >
                    {[1, 2, 4, 6, 8].map((n) => (
                      <option key={n} value={n} className="text-slate-900 bg-white">
                        {n}+ Guests
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="md:col-span-2">
                <label htmlFor="hero-budget" className="block text-[11px] font-medium text-slate-300 mb-1">
                  Max Price
                </label>
                <div className="px-3 py-2.5 rounded-xl bg-white/10 border border-white/15 text-sm font-mono-nums text-white">
                  {formatCurrency(maxPriceInr, currency)}
                </div>
              </div>

              <div className="md:col-span-2">
                <a
                  href="#marketplace-catalog"
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-teal-500 text-slate-950 text-sm font-bold hover:bg-teal-400 transition-colors whitespace-nowrap"
                >
                  <Search className="w-4 h-4" />
                  Search
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Bright Marketplace Catalog & Filters */}
      <section id="marketplace-catalog" className="max-w-[1380px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Curated Stays, Local Guides &amp; Cultural Businesses
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Filter by location, amenities, and price range. Pay directly via PhonePe or Google Pay.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
            <button
              type="button"
              onClick={onOpenWorldMap}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
            >
              <Globe2 className="w-3.5 h-3.5 text-teal-400" />
              World Map
            </button>
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="mb-8 p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
              <div className="md:col-span-5">
                <label htmlFor="filter-location" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Location Keyword
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="filter-location"
                    type="text"
                    value={locationQuery}
                    onChange={(e) => setLocationQuery(e.target.value)}
                    placeholder="Filter by city, state, country, or experience..."
                    className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              </div>

              <div className="md:col-span-5">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1.5">
                  <label htmlFor="filter-price-range">Price Ceiling</label>
                  <span className="font-mono-nums text-teal-700">
                    Up to {formatCurrency(maxPriceInr, currency)}
                  </span>
                </div>
                <input
                  id="filter-price-range"
                  type="range"
                  min={1500}
                  max={sliderMaxInr}
                  step={500}
                  value={Math.min(maxPriceInr, sliderMaxInr)}
                  onChange={(e) => setCustomMaxPriceInr(Number(e.target.value))}
                  className="w-full accent-teal-600 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-mono-nums text-slate-400 mt-0.5">
                  <span>{formatCurrency(1500, currency)}</span>
                  <span>{formatCurrency(sliderMaxInr, currency)}</span>
                </div>
              </div>

              <div className="md:col-span-2 flex justify-end">
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 underline"
                >
                  Reset Filters
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2">Filter by Amenities</p>
              <div className="flex flex-wrap gap-2">
                {AMENITY_OPTIONS.map((amenity) => {
                  const active = selectedAmenities.includes(amenity);
                  return (
                    <button
                      key={amenity}
                      type="button"
                      onClick={() => toggleAmenity(amenity)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {amenity}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Results Grid */}
        {listings.length === 0 ? (
          <div className="py-16 px-6 text-center border border-slate-200 rounded-2xl bg-slate-50/50">
            <h3 className="text-lg font-bold text-slate-900">No host listings published yet</h3>
            <p className="text-sm text-slate-600 mt-1 mb-5">
              Only listings uploaded by verified hosts appear here. Open Host Studio to publish a homestay, local guide, or cultural business.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onOpenHostPortal}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Open Host Studio
              </button>
              <button
                type="button"
                onClick={onOpenWorldMap}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50"
              >
                Explore World Map
              </button>
            </div>
          </div>
        ) : filteredListings.length === 0 ? (
          <div className="py-16 px-6 text-center border border-slate-200 rounded-2xl bg-slate-50/50">
            <h3 className="text-lg font-bold text-slate-900">No matching listings found</h3>
            <p className="text-sm text-slate-600 mt-1 mb-5">
              Try raising your price ceiling, clearing amenity filters, or exploring anywhere on the world map.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={resetAllFilters}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
              >
                Reset All Filters
              </button>
              <button
                type="button"
                onClick={onOpenWorldMap}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-sm font-semibold hover:bg-slate-50"
              >
                Open World Map
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
            {filteredListings.map((item) => (
              <article
                key={item.id}
                onClick={() => onSelectListing(item)}
                className="group cursor-pointer rounded-2xl border border-slate-200 bg-white overflow-hidden hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 flex flex-col"
              >
                <div className="aspect-[4/3] w-full overflow-hidden bg-slate-100 relative">
                  <img
                    src={item.photos[0]}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  />
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    {/* Zero-pill clean metadata */}
                    <div className="text-xs text-slate-500 flex items-center justify-between gap-2 mb-1.5">
                      <span className="truncate">
                        {item.category === 'homestay'
                          ? 'Homestay'
                          : item.category === 'guide'
                            ? 'Local Guide'
                            : 'Cultural Business'}{' '}
                        · {item.locationName}, {item.country}
                      </span>
                      <span className="flex items-center gap-1 text-slate-800 font-medium shrink-0">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="font-mono-nums">{item.rating.toFixed(1)}</span>
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 leading-snug group-hover:text-teal-700 transition-colors">
                      {item.title}
                    </h3>

                    <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3.5 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-base font-bold font-mono-nums text-slate-900">
                        {formatCurrency(item.pricePerUnitInr, currency)}
                      </span>
                      <span className="text-xs text-slate-500"> / {item.unitLabel}</span>
                    </div>
                    <span className="text-xs font-semibold text-teal-700">
                      Check Dates →
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 3. Host Invitation Band (inspired by second SaaS attachment) */}
      <section className="border-t border-slate-200 bg-slate-50 py-14 sm:py-16">
        <div className="max-w-[1380px] mx-auto px-4 sm:px-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold text-teal-700 mb-2">
              For Property Owners, Local Guides &amp; Cultural Artisans
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight [text-wrap:balance]">
              Start Hosting Local Tourism Without the Complexity
            </h2>
            <p className="text-sm sm:text-base text-slate-600 mt-2 leading-relaxed">
              Sign in to the dedicated Host Studio to upload photos, pin your exact coordinates, block availability dates, manage bookings, and track real-time PhonePe &amp; Google Pay earnings.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenHostPortal}
            className="px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Open Host Studio
          </button>
        </div>
      </section>
    </div>
  );
};
