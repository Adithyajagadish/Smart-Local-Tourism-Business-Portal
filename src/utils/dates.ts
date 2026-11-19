import { AvailabilitySlot } from '../types';

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDaysIso(iso: string, days: number): string {
  const dt = parseIsoDate(iso);
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

export function diffDaysIso(startIso: string, endIso: string): number {
  const a = parseIsoDate(startIso).getTime();
  const b = parseIsoDate(endIso).getTime();
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

export function expandDateRange(startIso: string, endIso: string): string[] {
  const nights = diffDaysIso(startIso, endIso);
  if (nights <= 0) return [startIso];
  const dates: string[] = [];
  for (let i = 0; i < nights; i += 1) {
    dates.push(addDaysIso(startIso, i));
  }
  return dates;
}

export function buildUnavailableDateSet(
  blockedDates: string[],
  slots: AvailabilitySlot[],
): Record<string, true> {
  const unavailable: Record<string, true> = {};
  for (const d of blockedDates) {
    unavailable[d] = true;
  }
  for (const slot of slots) {
    if (slot.status !== 'active') continue;
    const range = expandDateRange(slot.checkInDate, slot.checkOutDate);
    for (const d of range) {
      unavailable[d] = true;
    }
  }
  return unavailable;
}

export function hasConflictInRange(
  startIso: string,
  endIso: string,
  unavailable: Record<string, true>,
): boolean {
  const range = expandDateRange(startIso, endIso);
  return range.some((d) => Boolean(unavailable[d]));
}

export function formatReadableDate(iso: string): string {
  const dt = parseIsoDate(iso);
  return dt.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function getMonthGrid(year: number, month: number): (string | null)[] {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIsoDate(new Date(year, month, day)));
  }
  return cells;
}
