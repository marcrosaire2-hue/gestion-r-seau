import { createHash } from 'node:crypto';
import { C } from '../db';

/**
 * Mémorise un résultat d'IA pour éviter de rappeler le fournisseur (quota gratuit, délai).
 * La clé inclut l'empreinte des données: dès qu'elles changent (synchronisation), l'ancienne analyse n'est plus utilisée.
 */
export async function cached<T extends Record<string, unknown>>(
  userId: string,
  kind: string,
  material: string,
  compute: () => Promise<T>,
): Promise<T & { cached: boolean }> {
  const key = createHash('sha256').update(`${kind}\n${material}`).digest('hex');
  const hit = await C.aiCache.findOne({ user_id: userId, key }, { projection: { _id: 0, value: 1 } });
  if (hit) return { ...(hit.value as T), cached: true };
  const value = await compute();
  await C.aiCache.updateOne({ user_id: userId, key }, { $set: { value, created_at: new Date() } }, { upsert: true });
  return { ...value, cached: false };
}
