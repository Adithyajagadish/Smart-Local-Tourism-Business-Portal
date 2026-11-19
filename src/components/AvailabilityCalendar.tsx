import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDaysIso, getMonthGrid, toIsoDate } from '../utils/dates';

interface AvailabilityCalendarProps {
  mode: 'book' | 'host-block';
  singleDateMode?: boolean;
  unavailableDates: Record<string, true>;
  blockedDates?: string[];
  selectedStart: string | null;
  selectedEnd: string | null;
  onSelectBookingRange?: (start: string | null, end: string | null) => void;
  onToggleBlockDate?: (isoDate: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const AvailabilityCalendar: React.FC<AvailabilityCalendarProps> = ({
  mode,
  singleDateMode = false,
  unavailableDates,
  blockedDates = [],
  selectedStart,
  selectedEnd,
  onSelectBookingRange,
  onToggleBlockDate,
}) => {
  const today = new Date();
  const todayIso = toIsoDate(today);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const cells = getMonthGrid(viewYear, viewMonth);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleDateClick = (iso: string) => {
    if (iso < todayIso) return;

    if (mode === 'host-block') {
      onToggleBlockDate?.(iso);
      return;
    }

    if (unavailableDates[iso]) return;

    if (!onSelectBookingRange) return;

    if (singleDateMode) {
      onSelectBookingRange(iso, addDaysIso(iso, 1));
      return;
    }

    if (!selectedStart || (selectedStart && selectedEnd)) {
      onSelectBookingRange(iso, null);
      return;
    }

    if (iso <= selectedStart) {
      onSelectBookingRange(iso, null);
      return;
    }

    // Verify no unavailable dates fall inside [selectedStart, iso)
    let cursor = selectedStart;
    while (cursor < iso) {
      if (unavailableDates[cursor]) {
        onSelectBookingRange(iso, null);
        return;
      }
      cursor = addDaysIso(cursor, 1);
    }

    onSelectBookingRange(selectedStart, iso);
  };

  const blockedLookup: Record<string, true> = {};
  for (const d of blockedDates) {
    blockedLookup[d] = true;
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={handlePrevMonth}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-sm font-semibold text-slate-900">{monthLabel}</span>
        <button
          type="button"
          onClick={handleNextMonth}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {WEEKDAYS.map((day) => (
          <div key={day} className="text-[11px] font-medium text-slate-500 py-1">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((iso, idx) => {
          if (!iso) {
            return <div key={`empty-${idx}`} className="h-9" />;
          }

          const dayNum = Number(iso.split('-')[2]);
          const isPast = iso < todayIso;
          const isBookedOrUnavailable = Boolean(unavailableDates[iso]);
          const isHostBlocked = Boolean(blockedLookup[iso]);

          const isSelectedStart = selectedStart === iso;
          const isSelectedEnd = !singleDateMode && selectedEnd === iso;
          const isInRange =
            !singleDateMode &&
            Boolean(selectedStart && selectedEnd && iso > selectedStart && iso < selectedEnd);

          let cellClass =
            'h-9 w-full rounded-lg text-xs font-mono-nums font-medium flex items-center justify-center transition-colors ';

          if (isPast) {
            cellClass += 'text-slate-300 cursor-not-allowed';
          } else if (mode === 'host-block') {
            if (isHostBlocked) {
              cellClass += 'bg-amber-100 text-amber-900 border border-amber-300 line-through hover:bg-amber-200';
            } else if (isBookedOrUnavailable) {
              cellClass += 'bg-slate-100 text-slate-500 cursor-not-allowed';
            } else {
              cellClass += 'text-slate-800 hover:bg-teal-50 hover:text-teal-800 border border-transparent';
            }
          } else {
            if (isBookedOrUnavailable) {
              cellClass += 'bg-slate-100 text-slate-400 line-through cursor-not-allowed';
            } else if (isSelectedStart || isSelectedEnd) {
              cellClass += 'bg-teal-600 text-white font-semibold';
            } else if (isInRange) {
              cellClass += 'bg-teal-50 text-teal-900';
            } else {
              cellClass += 'text-slate-800 hover:bg-slate-100';
            }
          }

          return (
            <button
              key={iso}
              type="button"
              disabled={isPast || (mode === 'book' && isBookedOrUnavailable)}
              onClick={() => handleDateClick(iso)}
              className={cellClass}
              title={
                mode === 'host-block'
                  ? isHostBlocked
                    ? 'Click to unblock date'
                    : 'Click to block date'
                  : isBookedOrUnavailable
                    ? 'Unavailable'
                    : iso
              }
            >
              {dayNum}
            </button>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        {mode === 'book' ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-teal-600 inline-block" /> Selected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-100 border border-slate-200 inline-block" /> Unavailable
            </span>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" /> Host Blocked
            </span>
            <span>Click any future date to toggle availability</span>
          </>
        )}
      </div>
    </div>
  );
};
