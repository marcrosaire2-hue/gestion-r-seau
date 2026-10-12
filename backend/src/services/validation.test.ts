import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.PUBLIC_API_URL = 'https://x.example.com';
process.env.MONGODB_URI = 'mongodb://localhost:27017';
process.env.JWT_SECRET = 'j'.repeat(40);
process.env.TOKEN_ENCRYPTION_KEY = 'ab'.repeat(32);

test('règles par plateforme', async () => {
  const { validateForPlatform } = await import('./validation');
  assert.ok(validateForPlatform('instagram', 'texte', []).some((e) => e.includes('obligatoire')));
  assert.deepEqual(validateForPlatform('instagram', 'texte', [{ url: 'u', type: 'image' }]), []);
  assert.ok(validateForPlatform('linkedin', 'x'.repeat(3001), []).some((e) => e.includes('trop long')));
  assert.deepEqual(validateForPlatform('linkedin', 'ok', []), []);
  assert.ok(validateForPlatform('tiktok', 'ok', [{ url: 'u', type: 'image' }]).length > 0);
  assert.deepEqual(validateForPlatform('facebook', 'ok', []), []);
});
