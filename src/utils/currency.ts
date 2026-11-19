import { CurrencyCode } from '../types';

const RATES_FROM_INR: Record<CurrencyCode, number> = {
  INR: 1,
  USD: 0.0118,
  EUR: 0.0109,
};

const SYMBOLS: Record<CurrencyCode, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
};

export function convertFromInr(amountInr: number, currency: CurrencyCode): number {
  const converted = amountInr * RATES_FROM_INR[currency];
  if (currency === 'INR') {
    return Math.round(converted);
  }
  return Math.round(converted);
}

export function formatCurrency(amountInr: number, currency: CurrencyCode): string {
  const value = convertFromInr(amountInr, currency);
  const symbol = SYMBOLS[currency];
  if (currency === 'INR') {
    return `${symbol}${value.toLocaleString('en-IN')}`;
  }
  return `${symbol}${value.toLocaleString('en-US')}`;
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  return SYMBOLS[currency];
}
