// Deep comparison of plain objects producing a list of changed paths (07 §2.2), e.g.
// ["status", "cancellation", "preferences.smsOptIn"]. Arrays are compared as a whole.

type Plain = Record<string, unknown>;

function isPlainObject(value: unknown): value is Plain {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

// ObjectId (has toHexString) and Date compare by value; everything else structurally.
function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === 'object' &&
    'toHexString' in value &&
    typeof value.toHexString === 'function'
  ) {
    return (value.toHexString as () => string)();
  }
  return value;
}

export function isEqual(a: unknown, b: unknown): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => isEqual(item, right[i]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => isEqual(left[key], right[key]));
  }
  return Object.is(left, right);
}

export function diffPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    return keys.flatMap((key) =>
      diffPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key),
    );
  }
  return isEqual(before, after) ? [] : [prefix];
}

// Keeps only the top-level fields touched by `paths`, so audit rows store what changed.
export function pickTopLevel(value: Plain | null, paths: string[]): Plain | null {
  if (value === null) return null;
  const keys = new Set(paths.map((path) => path.split('.')[0] ?? path));
  return Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)));
}
