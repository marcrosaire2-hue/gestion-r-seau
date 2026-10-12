import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PUBLIC_API_URL = 'https://x.example.com';
process.env.MONGODB_URI = 'mongodb://localhost:27017';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

test('chiffrement aller-retour et intégrité', async () => {
  const { encrypt, decrypt } = await import('./crypto');
  const c = encrypt('jeton-secret');
  assert.notEqual(c, 'jeton-secret');
  assert.equal(decrypt(c), 'jeton-secret');
  const tampered = Buffer.from(c, 'base64');
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered.toString('base64')));
});
