// Money input (05 §7): people type major units ("450.50"); the API takes integer minor units
// (AGENTS: money as integers in the smallest unit). The currency decides the decimals.

export function currencyDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

// "450.5" -> 45050 (INR); null when it is not a non-negative amount with at most that many
// decimals.
export function toMinor(value: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const text = value.trim();
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{0,${digits}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || 0);
}

// 45050 -> "450.50" (for pre-filling inputs).
export function toMajor(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}
