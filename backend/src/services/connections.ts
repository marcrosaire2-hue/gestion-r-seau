import { C, NO_ID, logActivity, newId } from '../db';
import { decrypt, encrypt } from '../crypto';
import { ApiError } from '../http';
import { providers, type Ctx, type Platform, type Profile, type TokenResult } from '../providers';

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

/**
 * Enregistre (ou met à jour) le compte connecté d'un réseau. Un seul compte par réseau: si l'utilisateur en choisit un
 * autre (ex.: une autre Page Facebook), l'ancien est déconnecté et ses données propres sont supprimées.
 */
export async function saveConnection(userId: string, platform: Platform, token: TokenResult, profile: Profile) {
  await C.connections.updateOne(
    { user_id: userId, platform, account_id: profile.accountId },
    {
      $set: {
        account_name: profile.name,
        avatar_url: profile.avatarUrl ?? null,
        access_token_enc: encrypt(token.accessToken),
        refresh_token_enc: token.refreshToken ? encrypt(token.refreshToken) : null,
        expires_at: token.expiresAt ?? null,
        scopes: token.scopes ?? [],
        status: 'active',
        last_error: null,
        meta: profile.meta ?? {},
      },
      $setOnInsert: { id: newId(), created_at: new Date() },
    },
    { upsert: true },
  );
  const others = await C.connections.find({ user_id: userId, platform, account_id: { $ne: profile.accountId } }, { projection: { _id: 0, id: 1 } }).toArray();
  for (const o of others) {
    try { await disconnect(userId, o.id); } catch (e) { console.warn('remplacement du compte:', (e as Error).message); }
  }
  await logActivity(userId, 'connection.connected', platform, { account: profile.name });
}
