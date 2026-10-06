import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM for secrets carried through the outbox (09 §7), e.g. the raw password-reset
// token that only the email consumer may read. Key: OUTBOX_ENCRYPTION_KEY (32 bytes, base64).

export interface EncryptedSecret {
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16-byte auth tag
  data: string; // base64 ciphertext
}

const ALGORITHM = 'aes-256-gcm';

function keyBuffer(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');
  return key;
}

export function encryptSecret(plaintext: string, keyBase64: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyBuffer(keyBase64), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

// Throws if the ciphertext was tampered with or the key is wrong (GCM authentication).
export function decryptSecret(secret: EncryptedSecret, keyBase64: string): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    keyBuffer(keyBase64),
    Buffer.from(secret.iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
