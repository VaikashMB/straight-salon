import { describe, expect, it } from 'vitest';
import { currencyDigits, toMajor, toMinor } from '@/lib/money';

describe('money input in minor units (AGENTS: integers in the smallest unit)', () => {
  it('parses major-unit input by the currency’s decimals', () => {
    expect(toMinor('450', 'INR')).toBe(45_000);
    expect(toMinor('450.5', 'INR')).toBe(45_050);
    expect(toMinor(' 0.05 ', 'USD')).toBe(5);
    expect(toMinor('1200', 'JPY')).toBe(1200);
    expect(currencyDigits('JPY')).toBe(0);
  });

  it('rejects negatives, too many decimals and junk', () => {
    for (const bad of ['-1', '1.234', 'abc', '', '1,000']) expect(toMinor(bad, 'INR')).toBeNull();
    expect(toMinor('12.5', 'JPY')).toBeNull();
  });

  it('formats minor units back for inputs', () => {
    expect(toMajor(45_050, 'INR')).toBe('450.50');
    expect(toMajor(1200, 'JPY')).toBe('1200');
  });
});
