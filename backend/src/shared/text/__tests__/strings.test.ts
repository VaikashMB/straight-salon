import { describe, expect, it } from 'vitest';
import { compareStrings, trimChar, trimEndChar } from '../strings.js';

describe('compareStrings', () => {
  it('orders exactly like the default sort (code units, not locale)', () => {
    const values = ['b', 'B', 'a', '2026-01-10', '2026-01-02', 'é', 'e', 'a.b', 'a', 'Z'];
    expect([...values].sort(compareStrings)).toEqual([...values].sort());
    expect(compareStrings('a', 'a')).toBe(0);
  });
});

describe('trimEndChar', () => {
  it.each(['', '/', '///', 'http://x', 'http://x/', 'http://x///', '/a/b/', 'a//b', '//a'])(
    'matches value.replace(/\\/+$/, "") for %j',
    (value) => {
      expect(trimEndChar(value, '/')).toBe(value.replace(/\/+$/, ''));
    },
  );
});

describe('trimChar', () => {
  it.each(['', '-', '---', 'a', '-a', 'a-', '--a-b--', 'a--b', '-a-'])(
    'matches value.replace(/^-+|-+$/g, "") for %j',
    (value) => {
      expect(trimChar(value, '-')).toBe(value.replace(/^-+|-+$/g, ''));
    },
  );
});
