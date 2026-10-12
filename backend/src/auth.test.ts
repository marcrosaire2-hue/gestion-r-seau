import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PUBLIC_API_URL = 'https://x.example.com';
process.env.MONGODB_URI = 'mongodb://localhost:27017';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

test('mot de passe: haché, vérifiable, jamais en clair', async () => {
  const { hashPassword, verifyPassword } = await import('./auth');
  const h = await hashPassword('un-mot-de-passe-long');
  assert.ok(!h.includes('un-mot-de-passe-long'));
  assert.equal(await verifyPassword('un-mot-de-passe-long', h), true);
  assert.equal(await verifyPassword('autre-mot-de-passe', h), false);
});

test('jeton de session: signé et vérifié', async () => {
  const { signToken } = await import('./auth');
  const jwt = (await import('jsonwebtoken')).default;
  const t = signToken('user-1');
  assert.equal((jwt.verify(t, 'j'.repeat(40)) as { sub: string }).sub, 'user-1');
  assert.throws(() => jwt.verify(t, 'x'.repeat(40)));
});
