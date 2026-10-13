import crypto from 'node:crypto';
import { Router } from 'express';
import { requireAdmin, requireAuth, wrap } from '../auth';
import { encrypt } from '../crypto';
import { C, logActivity, newId } from '../db';
import { env } from '../env';
import { ApiError } from '../http';
import { isPlatform, providers, PLATFORMS } from '../providers';
import { decrypt } from '../crypto';
import { disconnect, saveConnection } from '../services/connections';
import { syncUser } from '../services/sync';

const redirectUri = (platform: string) => `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/oauth/${platform}/callback`;

/** Routes publiques: le callback OAuth arrive du navigateur, sans JWT. L'identité vient du `state`. */
export const oauthCallback = Router();
oauthCallback.get(
  '/:platform/callback',
  wrap(async (req, res) => {
    const platform = String(req.params.platform);
    // Retour sur la page du réseau concerné (chaque réseau gère sa propre connexion).
    const back = (q: string) => res.redirect(`${env.FRONTEND_URL.replace(/\/$/, '')}/${isPlatform(platform) ? platform : ''}?${q}`);
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
      // Réseau donnant accès à plusieurs comptes (ex.: plusieurs Pages Facebook): l'utilisateur choisit dans Boussole.
      if (provider.listAccounts) {
        const options = await provider.listAccounts(code, redirectUri(platform));
        const preset = platform === 'facebook' && env.FACEBOOK_PAGE_ID ? options.find((o) => o.id === env.FACEBOOK_PAGE_ID) : undefined;
        const chosen = preset ?? (options.length === 1 ? options[0] : undefined);
        if (!chosen) {
          const pendingId = newId();
          await C.oauthPending.insertOne({
            id: pendingId,
            user_id: st.user_id,
            platform,
            options: options.map((o) => ({ id: o.id, name: o.name, avatar_url: o.avatarUrl ?? null, token_enc: encrypt(o.accessToken), scopes: o.scopes ?? [] })),
            created_at: new Date(),
          });
          return back(`choose=${pendingId}`);
        }
        await saveConnection(st.user_id, platform, { accessToken: chosen.accessToken, accountId: chosen.id, scopes: chosen.scopes }, { accountId: chosen.id, name: chosen.name, avatarUrl: chosen.avatarUrl, meta: { kind: 'page' } });
      } else {
        const token = await provider.exchange(code, redirectUri(platform));
        const profile = await provider.profile(token.accessToken, token);
        if (!profile.accountId) throw new ApiError('Identifiant de compte introuvable.', 502);
        await saveConnection(st.user_id, platform, token, profile);
      }
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
  requireAdmin,
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
  requireAdmin,
  wrap(async (req, res) => {
    res.json(await disconnect(req.userId, String(req.params.id)));
  }),
);


/* ---- Choix du compte après autorisation (ex.: quelle Page Facebook connecter) ---- */

async function ownPending(userId: string, id: string) {
  const p = await C.oauthPending.findOne({ id, user_id: userId }, { projection: { _id: 0 } });
  if (!p) throw new ApiError('Cette sélection a expiré. Cliquez de nouveau sur « Connecter mon compte ».', 404);
  return p;
}

// Liste des comptes proposés (jamais les jetons)
connections.get(
  '/pending/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const p = await ownPending(req.userId, String(req.params.id));
    res.json({ platform: p.platform, options: p.options.map((o: any) => ({ id: o.id, name: o.name, avatar_url: o.avatar_url })) });
  }),
);

connections.post(
  '/pending/:id/select',
  requireAdmin,
  wrap(async (req, res) => {
    const p = await ownPending(req.userId, String(req.params.id));
    const accountId = String((req.body ?? {}).account_id ?? '');
    const o = p.options.find((x: any) => x.id === accountId);
    if (!o) throw new ApiError('Compte introuvable dans la sélection.', 404);
    // Suppression d'abord (usage unique): un double clic ne crée rien de plus.
    const taken = await C.oauthPending.deleteOne({ id: p.id });
    if (!taken.deletedCount) throw new ApiError('Cette sélection a déjà été utilisée.', 409);
    await saveConnection(
      req.userId,
      p.platform,
      { accessToken: decrypt(o.token_enc), accountId: o.id, scopes: o.scopes },
      { accountId: o.id, name: o.name, avatarUrl: o.avatar_url ?? undefined, meta: { kind: 'page' } },
    );
    syncUser(req.userId).catch((e) => console.warn('sync après choix:', e.message));
    res.json({ ok: true, account: o.name });
  }),
);

connections.delete(
  '/pending/:id',
  requireAdmin,
  wrap(async (req, res) => {
    await C.oauthPending.deleteOne({ id: String(req.params.id), user_id: req.userId });
    res.status(204).end();
  }),
);
