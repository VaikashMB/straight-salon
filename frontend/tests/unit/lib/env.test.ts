import { describe, expect, it } from 'vitest';
import { readPublicEnv } from '@/lib/env';

describe('public env (05 §8)', () => {
  it('defaults the app name and the +91 calling code', () => {
    expect(readPublicEnv({})).toEqual({
      appName: 'Straight Salon',
      defaultCountryCode: '91',
      siteUrl: 'http://localhost:3000',
    });
    expect(
      readPublicEnv({ NEXT_PUBLIC_APP_NAME: '  ', NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: '' }),
    ).toEqual({
      appName: 'Straight Salon',
      defaultCountryCode: '91',
      siteUrl: 'http://localhost:3000',
    });
  });

  it('accepts a calling code with or without "+", rejects anything else', () => {
    expect(
      readPublicEnv({ NEXT_PUBLIC_APP_NAME: 'Fade Co', NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: '+44' }),
    ).toEqual({ appName: 'Fade Co', defaultCountryCode: '44', siteUrl: 'http://localhost:3000' });
    expect(() => readPublicEnv({ NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: 'IN' })).toThrow(/calling code/);
    expect(() => readPublicEnv({ NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: '0091' })).toThrow();
  });

  it('takes the public origin for share previews, trimming a trailing slash', () => {
    expect(readPublicEnv({ NEXT_PUBLIC_SITE_URL: ' https://straightsalon.in/ ' }).siteUrl).toBe(
      'https://straightsalon.in',
    );
    expect(() => readPublicEnv({ NEXT_PUBLIC_SITE_URL: 'straightsalon.in' })).toThrow(/origin/);
    expect(() => readPublicEnv({ NEXT_PUBLIC_SITE_URL: 'https://a.in/path' })).toThrow(/origin/);
  });
});
