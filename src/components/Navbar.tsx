import React from 'react';
import { AudioLines, Compass, LogOut, Menu, User as UserIcon, X } from 'lucide-react';
import { AppView, CurrencyCode, UserProfile } from '../types';

interface NavbarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  currency: CurrencyCode;
  onCurrencyChange: (currency: CurrencyCode) => void;
  userProfile: UserProfile | null;
  onOpenAuth: (defaultTab?: 'traveller' | 'host') => void;
  onOpenVoice: () => void;
  onSignOut: () => void;
  tripCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeView,
  onNavigate,
  currency,
  onCurrencyChange,
  userProfile,
  onOpenAuth,
  onOpenVoice,
  onSignOut,
  tripCount,
}) => {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const isOverDarkHero = activeView === 'discover';

  const navLinkClass = (view: AppView) => {
    const isActive = activeView === view;
    if (isOverDarkHero) {
      return `text-sm font-medium whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors ${
        isActive
          ? 'text-white border-teal-400'
          : 'text-slate-200 border-transparent hover:text-white hover:border-white/40'
      }`;
    }
    return `text-sm font-medium whitespace-nowrap shrink-0 pb-1 border-b-2 transition-colors ${
      isActive
        ? 'text-slate-900 border-teal-600'
        : 'text-slate-600 border-transparent hover:text-slate-900 hover:border-slate-300'
    }`;
  };

  return (
    <header
      className={`w-full z-40 transition-colors ${
        isOverDarkHero
          ? 'bg-[#07141A]/90 backdrop-blur-md border-b border-white/10 text-white sticky top-0'
          : 'bg-white border-b border-slate-200 text-slate-900 sticky top-0'
      }`}
    >
      <div className="max-w-[1380px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand Wordmark (single clean element) */}
        <button
          type="button"
          onClick={() => onNavigate('discover')}
          className="flex items-center gap-2 text-xl font-bold tracking-tight whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 rounded"
        >
          <Compass className={`w-5 h-5 ${isOverDarkHero ? 'text-teal-400' : 'text-teal-600'}`} />
          <span>Tourx</span>
        </button>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="hidden md:flex items-center gap-7">
          <button type="button" onClick={() => onNavigate('discover')} className={navLinkClass('discover')}>
            Explore
          </button>
          <button type="button" onClick={() => onNavigate('map')} className={navLinkClass('map')}>
            World Map
          </button>
          <button type="button" onClick={() => onNavigate('trips')} className={navLinkClass('trips')}>
            My Trips{tripCount > 0 ? ` (${tripCount})` : ''}
          </button>
          <button type="button" onClick={() => onNavigate('host')} className={navLinkClass('host')}>
            Host Studio
          </button>
        </nav>

        {/* Zone 3: Voice Concierge + Currency Switcher + Primary Account Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenVoice}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              isOverDarkHero
                ? 'bg-teal-500/15 border-teal-400/40 text-teal-200 hover:bg-teal-500/25'
                : 'bg-teal-50 border-teal-200 text-teal-800 hover:bg-teal-100'
            }`}
            title="Start real-time voice conversation"
          >
            <AudioLines className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Live Voice</span>
          </button>

          <label className="sr-only" htmlFor="currency-select">
            Select currency
          </label>
          <select
            id="currency-select"
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value as CurrencyCode)}
            className={`text-xs font-mono-nums font-medium rounded-lg px-2.5 py-2 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 cursor-pointer ${
              isOverDarkHero
                ? 'bg-white/10 border-white/20 text-white hover:bg-white/15'
                : 'bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100'
            }`}
          >
            <option value="INR" className="text-slate-900 bg-white">
              INR (₹)
            </option>
            <option value="USD" className="text-slate-900 bg-white">
              USD ($)
            </option>
            <option value="EUR" className="text-slate-900 bg-white">
              EUR (€)
            </option>
          </select>

          {userProfile ? (
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onOpenAuth(userProfile.accountType)}
                className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isOverDarkHero
                    ? 'border-white/20 bg-white/10 text-white hover:bg-white/15'
                    : 'border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100'
                }`}
                title="Switch Traveller / Host account mode"
              >
                {userProfile.avatarUrl ? (
                  <img
                    src={userProfile.avatarUrl}
                    alt={userProfile.displayName}
                    referrerPolicy="no-referrer"
                    className="w-5 h-5 rounded-full object-cover"
                  />
                ) : (
                  <UserIcon className="w-4 h-4" />
                )}
                <span className="max-w-[110px] truncate">{userProfile.displayName}</span>
                <span className={isOverDarkHero ? 'text-teal-300' : 'text-teal-700'}>
                  · {userProfile.accountType === 'host' ? 'Host' : 'Traveller'}
                </span>
              </button>
              <button
                type="button"
                onClick={onSignOut}
                className={`p-2 rounded-lg border transition-colors ${
                  isOverDarkHero
                    ? 'border-white/20 text-slate-200 hover:bg-white/10 hover:text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onOpenAuth()}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg whitespace-nowrap shrink-0 transition-colors ${
                isOverDarkHero
                  ? 'bg-teal-500 text-slate-950 hover:bg-teal-400'
                  : 'bg-slate-900 text-white hover:bg-slate-800'
              }`}
            >
              Sign In
            </button>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden p-2 rounded-lg border border-current/20"
            aria-label="Toggle navigation menu"
          >
            {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Dropdown */}
      {mobileOpen && (
        <div
          className={`md:hidden border-t px-4 py-3 flex flex-col gap-2 ${
            isOverDarkHero
              ? 'bg-[#07141A] border-white/10 text-white'
              : 'bg-white border-slate-200 text-slate-900'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              onNavigate('discover');
              setMobileOpen(false);
            }}
            className="text-left py-2 text-sm font-medium"
          >
            Explore
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate('map');
              setMobileOpen(false);
            }}
            className="text-left py-2 text-sm font-medium"
          >
            World Map
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate('trips');
              setMobileOpen(false);
            }}
            className="text-left py-2 text-sm font-medium"
          >
            My Trips {tripCount > 0 ? `(${tripCount})` : ''}
          </button>
          <button
            type="button"
            onClick={() => {
              onNavigate('host');
              setMobileOpen(false);
            }}
            className="text-left py-2 text-sm font-medium"
          >
            Host Studio
          </button>
          {userProfile && (
            <button
              type="button"
              onClick={() => {
                onOpenAuth(userProfile.accountType);
                setMobileOpen(false);
              }}
              className="text-left py-2 text-sm font-semibold text-teal-600 border-t border-current/10 mt-1 pt-2.5"
            >
              Switch Portal ({userProfile.accountType === 'host' ? 'Host' : 'Traveller'})
            </button>
          )}
        </div>
      )}
    </header>
  );
};
