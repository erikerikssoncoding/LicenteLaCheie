import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey() {
  const secret = process.env.SESSION_SECRET || 'schimbati-aceasta-cheie';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptObject(data) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    payload: encrypted.toString('hex')
  };
}

export function decryptObject({ payload, iv, authTag }) {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload, 'hex')),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString('utf8'));
}
