import { C, NO_ID, logActivity } from '../db';
import { decrypt, encrypt } from '../crypto';
import { ApiError } from '../http';
import { providers, type Ctx, type Platform } from '../providers';

export interface ConnectionRow {
  id: string;
  user_id: string;
  platform: Platform;
  account_id: string;
  account_name: string | null;
  avatar_url: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: Date | null;
  scopes: string[];
  status: 'active' | 'expired' | 'error';
  last_error: string | null;
  meta: Record<string, any>;
}

export async function getConnection(userId: string, id: string): Promise<ConnectionRow> {
  const conn = await C.connections.findOne({ id, user_id: userId }, NO_ID);
  if (!conn) throw new ApiError('Connexion introuvable.', 404);
  return conn as ConnectionRow;
}

export async function activeConnections(userId: string, platforms?: Platform[]): Promise<ConnectionRow[]> {
  const q: Record<string, unknown> = { user_id: userId, status: 'active' };
  if (platforms?.length) q.platform = { $in: platforms };
  return (await C.connections.find(q, NO_ID).toArray()) as ConnectionRow[];
}

export async function markStatus(conn: ConnectionRow, status: 'active' | 'expired' | 'error', msg?: string) {
  await C.connections.updateOne({ id: conn.id }, { $set: { status, last_error: msg ?? null } });
}

/** Renvoie un contexte avec un jeton valide, en le renouvelant si nécessaire. */
export async function getCtx(conn: ConnectionRow): Promise<Ctx> {
  const provider = providers[conn.platform];
  let accessToken = decrypt(conn.access_token_enc);
  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : null;

  const marginMs = conn.platform === 'instagram' ? 7 * 86_400_000 : 5 * 60_000;
  const expiring = expiresAt !== null && expiresAt - Date.now() < marginMs;
  if (expiring && provider.refresh) {
    const refreshSource = conn.refresh_token_enc ? decrypt(conn.refresh_token_enc) : accessToken;
    const canRefresh = conn.platform === 'instagram' || !!conn.refresh_token_enc;
    if (canRefresh) {
      try {
        const t = await provider.refresh(refreshSource);
        accessToken = t.accessToken;
        await C.connections.updateOne(
          { id: conn.id },
          {
            $set: {
              access_token_enc: encrypt(t.accessToken),
              refresh_token_enc: t.refreshToken ? encrypt(t.refreshToken) : conn.refresh_token_enc,
              expires_at: t.expiresAt ?? conn.expires_at,
              status: 'active',
              last_error: null,
            },
          },
        );
      } catch (e) {
        if (expiresAt! < Date.now()) {
          await markStatus(conn, 'expired', 'Jeton expiré: reconnectez le compte.');
          throw new ApiError('Le jeton d’accès a expiré. Reconnectez le compte.', 401);
        }
        console.warn(`refresh ${conn.platform}:`, (e as Error).message);
      }
    } else if (expiresAt! < Date.now()) {
      await markStatus(conn, 'expired', 'Jeton expiré: reconnectez le compte.');
      throw new ApiError('Le jeton d’accès a expiré. Reconnectez le compte.', 401);
    }
  }
  return { accessToken, accountId: conn.account_id, meta: conn.meta };
}

export async function disconnect(userId: string, id: string) {
  const conn = await getConnection(userId, id);
  const provider = providers[conn.platform];
  let revoked = false;
  if (provider.revoke) {
    try {
      await provider.revoke(decrypt(conn.access_token_enc));
      revoked = true;
    } catch (e) {
      console.warn(`revoke ${conn.platform}:`, (e as Error).message);
    }
  }
  await C.connections.deleteOne({ id, user_id: userId });
  // Données dépendantes de ce compte
  await Promise.all([
    C.comments.deleteMany({ connection_id: id }),
    C.metrics.deleteMany({ connection_id: id }),
    C.snapshots.deleteMany({ connection_id: id }),
    C.targets.updateMany({ connection_id: id }, { $set: { connection_id: null } }),
  ]);
  await logActivity(userId, 'connection.disconnected', conn.platform, { account: conn.account_name, revoked });
  return { revoked };
}
