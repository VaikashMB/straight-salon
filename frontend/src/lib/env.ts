// Public (browser) configuration, 05-frontend §8. NEXT_PUBLIC_* values are inlined at build time,
// so each must be read with a literal `process.env.NAME`. Server-only settings (API_INTERNAL_URL)
// are read at request time in proxy.ts instead.

export interface PublicEnv {
  appName: string;
  defaultCountryCode: string; // digits only, e.g. "91"
}

export function readPublicEnv(source: {
  NEXT_PUBLIC_APP_NAME?: string | undefined;
  NEXT_PUBLIC_DEFAULT_COUNTRY_CODE?: string | undefined;
}): PublicEnv {
  const countryCode = (source.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE ?? '').replace(/^\+/, '').trim();
  if (countryCode && !/^[1-9]\d{0,2}$/.test(countryCode)) {
    throw new Error(
      `NEXT_PUBLIC_DEFAULT_COUNTRY_CODE must be a calling code like 91, got "${countryCode}"`,
    );
  }
  return {
    appName: source.NEXT_PUBLIC_APP_NAME?.trim() || 'Straight Salon',
    defaultCountryCode: countryCode || '91',
  };
}

export const publicEnv: PublicEnv = readPublicEnv({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: process.env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE,
});
