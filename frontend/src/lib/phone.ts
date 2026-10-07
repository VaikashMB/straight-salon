// The API takes E.164 numbers (+919876543212, 02 §2.1). People type local numbers, so input is
// normalised first (decision 2026-10-07): spaces, dashes, dots and brackets are dropped; "+" or
// "00" means the number already has a country code; otherwise one leading 0 (trunk prefix) is
// removed and the salon's default calling code (NEXT_PUBLIC_DEFAULT_COUNTRY_CODE) is added.

export const E164 = /^\+[1-9]\d{7,14}$/;

export function normalisePhone(input: string, defaultCountryCode: string): string {
  const compact = input.trim().replace(/[\s\-.()]/g, '');
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (compact === '') return '';
  return `+${defaultCountryCode}${compact.replace(/^0/, '')}`;
}
