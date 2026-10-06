import bcrypt from 'bcrypt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasswordHasher, passwordSchema } from '../password.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('password policy (06 §4)', () => {
  it.each([
    ['Fade-and-Trim7', true],
    ['abcdefg1', true],
    ['short1', false], // < 8
    ['onlyletters', false], // no number
    ['1234567890', false], // no letter
    ['Password123', false], // common (case-insensitive)
    ['Welcome2026', false], // common
    [`a1${'x'.repeat(71)}`, false], // > 72 bytes (bcrypt limit)
    [`a1${'é'.repeat(35)}`, true], // 72 bytes exactly
  ])('%s -> %s', (password, valid) => {
    expect(passwordSchema.safeParse(password).success).toBe(valid);
  });
});

describe('createPasswordHasher', () => {
  const hasher = createPasswordHasher(4);

  it('hashes with bcrypt and verifies', async () => {
    const hash = await hasher.hash('Fade-and-Trim7');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(await hasher.verify('Fade-and-Trim7', hash)).toBe(true);
    expect(await hasher.verify('wrong-Pass9', hash)).toBe(false);
  });

  it('still runs a bcrypt comparison when there is no stored hash (06 §5 timing)', async () => {
    const compare = vi.spyOn(bcrypt, 'compare');
    expect(await hasher.verify('anything1', undefined)).toBe(false);
    expect(await hasher.verify('anything1', null)).toBe(false);
    expect(compare).toHaveBeenCalledTimes(2);
  });
});
