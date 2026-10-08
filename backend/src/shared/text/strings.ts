// Small string helpers shared across modules. Plain loops instead of regexes such as /\/+$/,
// which backtrack super-linearly on long runs of the trimmed character.

// Code-unit (UTF-16) order, exactly what `Array.prototype.sort()` uses without a comparator.
// For ids, keys, paths and ISO dates, where the order feeds hashes or stable output; human text
// sorts with `localeCompare` instead.
export function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// Drops every trailing `char` (a single character): ("http://x/a//", "/") -> "http://x/a".
export function trimEndChar(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return value.slice(0, end);
}

// Drops every leading and trailing `char` (a single character): ("--a-b--", "-") -> "a-b".
export function trimChar(value: string, char: string): string {
  let start = 0;
  while (start < value.length && value[start] === char) start += 1;
  return trimEndChar(value.slice(start), char);
}
