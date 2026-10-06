// PII masking for audit rows about users (07 §2.2): "a***@x.com", "+9198******12".

export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '*'.repeat(phone.length);
  return `${phone.slice(0, 5)}${'*'.repeat(phone.length - 7)}${phone.slice(-2)}`;
}

// Masks every `email` / `phone` string at any depth; returns a copy.
export function maskPii<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item: unknown) => maskPii(item)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('toHexString' in value) return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => {
        if (key === 'email' && typeof inner === 'string') return [key, maskEmail(inner)];
        if (key === 'phone' && typeof inner === 'string') return [key, maskPhone(inner)];
        return [key, maskPii(inner)];
      }),
    ) as T;
  }
  return value;
}
