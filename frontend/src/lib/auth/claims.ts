// Reads the non-secret claims the UI needs from the access token (06 §1). The token is not
// verified here: the API verifies it on every request and enforces ownership, so a forged claim
// only changes what the browser asks for, never what it gets.

export interface TokenClaims {
  staffId: string | null; // STAFF tokens: the stylist profile (for time-off, API-035..037)
}

function decodeSegment(segment: string): unknown {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function readClaims(token: string | null): TokenClaims {
  const payload = token?.split('.')[1];
  if (!payload) return { staffId: null };
  try {
    const claims = decodeSegment(payload) as { staffId?: unknown };
    return { staffId: typeof claims.staffId === 'string' ? claims.staffId : null };
  } catch {
    return { staffId: null };
  }
}
