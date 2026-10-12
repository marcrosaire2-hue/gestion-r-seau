import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAuth, wrap } from '../auth';
import { encrypt } from '../crypto';
import { C, logActivity, newId } from '../db';
import { env } from '../env';
import { ApiError } from '../http';
import { isPlatform, providers, PLATFORMS } from '../providers';
import { disconnect } from '../services/connections';
import { syncUser } from '../services/sync';

const redirectUri = (platform: string) => `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/oauth/${platform}/callback`;

/** Routes publiques: le callback OAuth arrive du navigateur, sans JWT. L'identité vient du `state`. */
export const oauthCallback = Router();
oauthCallback.get(
  '/:platform/callback',
  wrap(async (req, res) => {
    const platform = String(req.params.platform);
    const back = (q: string) => res.redirect(`${env.FRONTEND_URL}/networks?${q}`);
    if (!isPlatform(platform)) return back('error=plateforme%20inconnue');
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
    if (error) return back(`error=${encodeURIComponent(error_description ?? error)}&platform=${platform}`);
    if (!code || !state) return back(`error=${encodeURIComponent('Paramètres OAuth manquants.')}&platform=${platform}`);

    // `state` à usage unique (supprimé à la lecture), lié à l'utilisateur et à la plateforme, valable 10 min.
    const st = await C.oauthStates.findOneAndDelete({ state: String(state) });
    if (!st || st.platform !== platform || Date.now() - new Date(st.created_at).getTime() > 10 * 60_000)
      return back(`error=${encodeURIComponent('Session d’autorisation invalide ou expirée. Recommencez.')}&platform=${platform}`);

    const provider = providers[platform];
    try {
      const token = await provider.exchange(code, redirectUri(platform));
      const profile = await provider.profile(token.accessToken, token);
      if (!profile.accountId) throw new ApiError('Identifiant de compte introuvable.', 502);
      await C.connections.updateOne(
        { user_id: st.user_id, platform, account_id: profile.accountId },
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
      await logActivity(st.user_id, 'connection.connected', platform, { account: profile.name });
      syncUser(st.user_id).catch((e) => console.warn('sync après connexion:', e.message));
      return back(`connected=${platform}`);
    } catch (e) {
      console.error(`oauth ${platform}:`, (e as Error).message);
      await logActivity(st.user_id, 'connection.failed', platform, { error: (e as Error).message });
      return back(`error=${encodeURIComponent((e as Error).message)}&platform=${platform}`);
    }
  }),
);

export const connections = Router();
connections.use(requireAuth);

connections.get(
  '/',
  wrap(async (req, res) => {
    // Projection explicite: jamais de jetons (même chiffrés) vers le navigateur.
    const rows = await C.connections
      .find({ user_id: req.userId }, { projection: { _id: 0, id: 1, platform: 1, account_id: 1, account_name: 1, avatar_url: 1, expires_at: 1, scopes: 1, status: 1, last_error: 1, created_at: 1 } })
      .toArray();
    res.json(
      PLATFORMS.map((p) => ({
        platform: p,
        label: providers[p].label,
        configured: providers[p].configured(),
        setupHint: providers[p].setupHint,
        capabilities: providers[p].capabilities,
        rules: providers[p].rules,
        accounts: rows.filter((c) => c.platform === p),
      })),
    );
  }),
);

connections.post(
  '/:platform/start',
  wrap(async (req, res) => {
    const platform = String(req.params.platform);
    if (!isPlatform(platform)) throw new ApiError('Plateforme inconnue.', 404);
    const provider = providers[platform];
    if (!provider.configured()) throw new ApiError(`${provider.label} n’est pas configuré côté serveur. ${provider.setupHint}`, 412);
    const state = crypto.randomBytes(24).toString('hex');
    await C.oauthStates.insertOne({ state, user_id: req.userId, platform, created_at: new Date() });
    res.json({ url: provider.authUrl(state, redirectUri(platform)) });
  }),
);

connections.post(
  '/sync',
  wrap(async (req, res) => {
    res.json(await syncUser(req.userId));
  }),
);

connections.delete(
  '/:id',
  wrap(async (req, res) => {
    res.json(await disconnect(req.userId, String(req.params.id)));
  }),
);

