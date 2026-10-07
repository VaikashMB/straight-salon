import { describe, expect, it } from 'vitest';
import { readPublicEnv } from '@/lib/env';

describe('public env (05 §8)', () => {
  it('defaults the app name and the +91 calling code', () => {
    expect(readPublicEnv({})).toEqual({ appName: 'Straight Salon', defaultCountryCode: '91' });
    expect(
      readPublicEnv({ NEXT_PUBLIC_APP_NAME: '  ', NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: '' }),
    ).toEqual({ appName: 'Straight Salon', defaultCountryCode: '91' });
  });

  it('accepts a calling code with or without "+", rejects anything else', () => {
    expect(
      readPublicEnv({ NEXT_PUBLIC_APP_NAME: 'Fade Co', NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: '+44' }),
    ).toEqual({ appName: 'Fade Co', defaultCountryCode: '44' });
    expect(() => readPublicEnv({ NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: 'IN' })).toThrow(/calling code/);
    expect(() => readPublicEnv({ NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: '0091' })).toThrow();
  });
});
