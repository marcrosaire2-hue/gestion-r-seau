import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { env } from './env';

const client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
const database = client.db(env.MONGODB_DB);
const col = (name: string) => database.collection<any>(name);

/**
 * Collections. Chaque document porte un champ `id` (UUID) en plus du `_id` Mongo,
 * et toutes les requêtes filtrent par `user_id` côté serveur.
 */
export const C = {
  users: col('users'),
  connections: col('social_connections'),
  oauthStates: col('oauth_states'),
  posts: col('posts'),
  targets: col('post_targets'),
  comments: col('comments'),
  metrics: col('post_metrics'),
  snapshots: col('account_snapshots'),
  activity: col('activity_log'),
};

export const newId = () => randomUUID();
/** Projection standard: n'expose jamais le `_id` interne. */
export const NO_ID = { projection: { _id: 0 } } as const;

export async function initDb() {
  await client.connect();
  await Promise.all([
    C.users.dropIndex('email_1').catch(() => {}), // ancien index (connexion par e-mail)
    C.users.createIndex({ username: 1 }, { unique: true }),
    C.users.createIndex({ id: 1 }, { unique: true }),
    C.connections.createIndex({ id: 1 }, { unique: true }),
    C.connections.createIndex({ user_id: 1, platform: 1, account_id: 1 }, { unique: true }),
    // Les états OAuth expirent seuls après 10 minutes.
    C.oauthStates.createIndex({ created_at: 1 }, { expireAfterSeconds: 600 }),
    C.oauthStates.createIndex({ state: 1 }, { unique: true }),
    C.posts.createIndex({ id: 1 }, { unique: true }),
    C.posts.createIndex({ status: 1, scheduled_at: 1 }),
    C.posts.createIndex({ user_id: 1, created_at: -1 }),
    C.targets.createIndex({ id: 1 }, { unique: true }),
    C.targets.createIndex({ post_id: 1, platform: 1 }, { unique: true }),
    C.targets.createIndex({ status: 1 }),
    C.comments.createIndex({ id: 1 }, { unique: true }),
    C.comments.createIndex({ connection_id: 1, remote_id: 1 }, { unique: true }),
    C.comments.createIndex({ user_id: 1, status: 1 }),
    C.metrics.createIndex({ connection_id: 1, remote_id: 1 }, { unique: true }),
    C.metrics.createIndex({ user_id: 1, published_at: -1 }),
    C.snapshots.createIndex({ connection_id: 1, captured_at: 1 }),
    C.activity.createIndex({ user_id: 1, created_at: -1 }),
  ]);
  // Comptes antérieurs aux rôles (créés par le propriétaire en ligne de commande): administrateurs.
  await C.users.updateMany({ role: { $exists: false } }, { $set: { role: 'admin' } });
  console.log('MongoDB connecté.');
}

export async function logActivity(
  userId: string,
  action: string,
  platform?: string | null,
  detail: Record<string, unknown> = {},
) {
  try {
    await C.activity.insertOne({ id: newId(), user_id: userId, action, platform: platform ?? null, detail, created_at: new Date() });
  } catch (e) {
    console.error('activity_log:', (e as Error).message);
  }
}

export const closeDb = () => client.close();
