import React, { useEffect, useState } from 'react';
import { Building2, Compass, CheckCircle2, X } from 'lucide-react';
import { AccountType, UserProfile } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  initialFocus?: AccountType;
  userProfile: UserProfile | null;
  onClose: () => void;
  onSwitchRole: (role: AccountType) => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  initialFocus = 'traveller',
  userProfile,
  onClose,
  onSwitchRole,
}) => {
  const [loadingRole, setLoadingRole] = useState<AccountType | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!isOpen || !userProfile) return null;

  const handleSelect = async (role: AccountType) => {
    setErrorMsg(null);
    setLoadingRole(role);
    try {
      await onSwitchRole(role);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to switch portal mode. Please try again.',
      );
    } finally {
      setLoadingRole(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 sm:p-8 relative shadow-2xl max-h-[92vh] overflow-y-auto tourx-scroll">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          aria-label="Close portal switcher dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-5 pr-8">
          <h2 id="auth-modal-title" className="text-2xl font-bold text-slate-900 tracking-tight">
            Switch Portal Mode
          </h2>
          <p className="text-sm text-slate-600 mt-1.5">
            Signed in as <span className="font-semibold text-slate-900">{userProfile.displayName}</span>.
            Choose how you want to use Tourx right now.
          </p>
        </div>

        {errorMsg && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {errorMsg}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Option 1: Traveller Mode */}
          <div
            className={`rounded-xl border p-5 flex flex-col justify-between transition-colors ${
              initialFocus === 'traveller' || userProfile.accountType === 'traveller'
                ? 'border-teal-600 bg-teal-50/30'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-lg bg-sky-50 border border-sky-200 text-sky-700 flex items-center justify-center mb-4">
                <Compass className="w-5 h-5" />
              </div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <h3 className="text-lg font-bold text-slate-900">Traveller</h3>
                {userProfile.accountType === 'traveller' && (
                  <span className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Active
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Explore authentic homestays, local guides, and cultural workshops. Book dates and pay seamlessly with PhonePe or Google Pay.
              </p>
              <ul className="text-xs text-slate-600 space-y-1.5 mb-6">
                <li>· Filter stays &amp; explore anywhere on the map</li>
                <li>· Real-time date availability checking</li>
                <li>· Instant UPI receipts &amp; trip history</li>
              </ul>
            </div>

            <button
              type="button"
              disabled={loadingRole !== null}
              onClick={() => void handleSelect('traveller')}
              className="w-full py-2.5 px-4 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {loadingRole === 'traveller' ? 'Switching...' : 'Use Traveller Portal'}
            </button>
          </div>

          {/* Option 2: Host Mode */}
          <div
            className={`rounded-xl border p-5 flex flex-col justify-between transition-colors ${
              initialFocus === 'host' || userProfile.accountType === 'host'
                ? 'border-teal-600 bg-teal-50/30'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div>
              <div className="w-10 h-10 rounded-lg bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center mb-4">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <h3 className="text-lg font-bold text-slate-900">Host &amp; Owner</h3>
                {userProfile.accountType === 'host' && (
                  <span className="text-xs font-semibold text-teal-700 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Active
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed mb-4">
                Dedicated owner studio for property hosts, local guides, and cultural businesses to manage inventory and payouts.
              </p>
              <ul className="text-xs text-slate-600 space-y-1.5 mb-6">
                <li>· Upload listings with photos, pricing &amp; map pin</li>
                <li>· Block &amp; manage availability calendars</li>
                <li>· Manage bookings &amp; track rental earnings</li>
              </ul>
            </div>

            <button
              type="button"
              disabled={loadingRole !== null}
              onClick={() => void handleSelect('host')}
              className="w-full py-2.5 px-4 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {loadingRole === 'host' ? 'Switching...' : 'Open Host Studio'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
