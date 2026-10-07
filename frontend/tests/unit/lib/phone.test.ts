import { describe, expect, it } from 'vitest';
import { E164, normalisePhone } from '@/lib/phone';

describe('phone normalisation (E.164, decision 2026-10-07)', () => {
  it.each([
    ['98765 43212', '+919876543212'],
    ['098765-43212', '+919876543212'],
    ['(987) 654.3212', '+919876543212'],
    ['+91 98765 43212', '+919876543212'],
    ['0044 20 7946 0958', '+442079460958'],
    ['+44 (0)20', '+44020'],
    ['  ', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalisePhone(input, '91')).toBe(expected);
  });

  it('the result must still be a valid E.164 number', () => {
    expect(E164.test(normalisePhone('98765 43212', '91'))).toBe(true);
    expect(E164.test(normalisePhone('123', '91'))).toBe(false);
    expect(E164.test('+0123456789')).toBe(false);
  });
});
