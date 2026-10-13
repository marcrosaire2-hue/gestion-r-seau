import { env } from '../env';
import { ApiError, form, httpJson } from '../http';
import type { AccountOption, Provider, Ctx, MediaItem, RemotePost, RemoteComment } from './types';

const V = 'v23.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
];
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

const post = (url: string, params: Record<string, string | undefined>, token: string) =>
  httpJson<any>(url, { method: 'POST', headers: FORM, body: form({ ...params, access_token: token }) });

/**
 * Facebook = Pages uniquement. L'API Graph ne permet pas de publier sur un profil personnel.
 * La connexion enregistre le jeton de la PAGE (qui n'expire pas s'il vient d'un jeton utilisateur longue durée).
 * Plusieurs Pages: la première est retenue, ou celle de FACEBOOK_PAGE_ID.
 */
export const facebook: Provider = {
  id: 'facebook',
  label: 'Facebook',
  capabilities: {
    publish: { status: 'available', note: 'Texte, photos (jusqu’à 10) ou une vidéo sur une Page Facebook que vous administrez. Les profils personnels ne sont pas accessibles par l’API.' },
    schedule: { status: 'available', note: 'Programmation exécutée par notre serveur.' },
    stats: { status: 'available', note: 'Abonnés, réactions, commentaires, partages par publication ; portée quand Meta la fournit.' },
    comments: { status: 'available', note: 'Commentaires des publications récentes de la Page (permission pages_read_user_content).' },
    reply: { status: 'available', note: 'Réponse aux commentaires au nom de la Page (permission pages_manage_engagement).' },
    reactions: { status: 'available', note: 'Total des réactions par publication (les personnes ne sont pas toutes identifiables).' },
    messages: { status: 'requires_approval', note: 'Messenger: permission pages_messaging soumise à l’App Review Meta. Non activé ici.' },
  },
  rules: { maxText: 63206, mediaRequired: false, media: ['image', 'video'], maxMedia: 10 },
  setupHint:
    'Dans votre app Meta (developers.facebook.com, type Business), ajoutez « Facebook Login », renseignez FACEBOOK_APP_ID / FACEBOOK_APP_SECRET (ceux de l’app principale, pas ceux du produit Instagram) et l’URI de redirection <PUBLIC_API_URL>/api/oauth/facebook/callback. Vous devez administrer une Page Facebook. En mode Développement, seuls les rôles de l’app (vous) peuvent se connecter; l’App Review est requise pour les autres comptes.',
  configured: () => !!(env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET),

  authUrl(state, redirectUri) {
    // « Facebook Login for Business »: les permissions viennent d'une configuration (config_id), pas du paramètre scope.
    const p = env.FACEBOOK_CONFIG_ID
      ? new URLSearchParams({
          client_id: env.FACEBOOK_APP_ID!,
          redirect_uri: redirectUri,
          state,
          config_id: env.FACEBOOK_CONFIG_ID,
          response_type: 'code',
          override_default_response_type: 'true',
        })
      : new URLSearchParams({
          client_id: env.FACEBOOK_APP_ID!,
          redirect_uri: redirectUri,
          state,
          scope: SCOPES.join(','),
          response_type: 'code',
        });
    return `https://www.facebook.com/${V}/dialog/oauth?${p}`;
  },

  /** Pages que l'utilisateur a autorisées (jeton de Page sans date d'expiration s'il vient d'un jeton utilisateur longue durée). */
  async listAccounts(code, redirectUri): Promise<AccountOption[]> {
    const { data: short } = await httpJson<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: env.FACEBOOK_APP_ID!,
        client_secret: env.FACEBOOK_APP_SECRET!,
        redirect_uri: redirectUri,
        code,
      })}`,
    );
    const { data: long } = await httpJson<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: env.FACEBOOK_APP_ID!,
        client_secret: env.FACEBOOK_APP_SECRET!,
        fb_exchange_token: short.access_token,
      })}`,
    );
    // Graph pagine /me/accounts et peut renvoyer moins de Pages que `limit`: on suit `paging.next` jusqu'au bout.
    type Pg = { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } };
    const pages: { data: Pg[] } = { data: [] };
    let next: string | undefined = `${GRAPH}/me/accounts?fields=id,name,access_token,picture.type(large){url}&limit=25&access_token=${long.access_token}`;
    for (let i = 0; next && i < 20; i++) {
      const r: { data: { data: Pg[]; paging?: { next?: string } } } = await httpJson(next);
      pages.data.push(...r.data.data);
      next = r.data.paging?.next;
    }
    if (!pages.data.length)
      throw new ApiError('Aucune Page Facebook trouvée. Vous devez administrer une Page, et l’avoir cochée lors de l’autorisation.', 422);
    return pages.data.map((p) => ({ id: p.id, name: p.name, avatarUrl: p.picture?.data?.url, accessToken: p.access_token, scopes: SCOPES }));
  },

  async exchange(code, redirectUri) {
    const pages = await this.listAccounts!(code, redirectUri);
    const page = (env.FACEBOOK_PAGE_ID && pages.find((p) => p.id === env.FACEBOOK_PAGE_ID)) || pages[0];
    return { accessToken: page.accessToken, accountId: page.id, scopes: SCOPES };
  },

  async profile(accessToken) {
    const { data } = await httpJson<any>(`${GRAPH}/me?fields=id,name,picture.type(large){url}&access_token=${accessToken}`);
    return { accountId: String(data.id), name: data.name, avatarUrl: data.picture?.data?.url, meta: { kind: 'page' } };
  },

  async publish(ctx: Ctx, text: string, media: MediaItem[]) {
    const page = ctx.accountId;
    const t = ctx.accessToken;
    const videos = media.filter((m) => m.type === 'video');
    if (videos.length > 0 && media.length > 1)
      throw new ApiError('Facebook: une vidéo ne peut pas être combinée avec d’autres médias.', 422);

    if (videos.length === 1) {
      const { data } = await post(`${GRAPH}/${page}/videos`, { file_url: videos[0].url, description: text }, t);
      // La vidéo est acceptée mais traitée en différé: confirmation via checkPublish().
      return { remoteId: String(data.id), state: 'processing' as const };
    }

    let postId: string;
    if (media.length === 0) {
      if (!text.trim()) throw new ApiError('Facebook: contenu vide.', 422);
      postId = (await post(`${GRAPH}/${page}/feed`, { message: text }, t)).data.id;
    } else if (media.length === 1) {
      const r = (await post(`${GRAPH}/${page}/photos`, { url: media[0].url, caption: text, published: 'true' }, t)).data;
      postId = r.post_id ?? r.id;
    } else {
      const ids: string[] = [];
      for (const m of media) ids.push((await post(`${GRAPH}/${page}/photos`, { url: m.url, published: 'false' }, t)).data.id);
      const attached = Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]));
      postId = (await post(`${GRAPH}/${page}/feed`, { message: text, ...attached }, t)).data.id;
    }
    if (!postId) throw new ApiError('Facebook n’a pas renvoyé d’identifiant de publication: succès non confirmé.', 502);
    return { remoteId: postId, url: `https://www.facebook.com/${postId}`, state: 'published' as const };
  },

  async checkPublish(ctx, videoId) {
    const { data } = await httpJson<any>(`${GRAPH}/${videoId}?fields=status,permalink_url&access_token=${ctx.accessToken}`);
    const s = data.status?.video_status as string | undefined;
    if (s === 'ready') return { state: 'published' };
    if (s === 'error') return { state: 'failed', error: data.status?.processing_progress ? 'Traitement vidéo refusé par Facebook.' : 'Échec du traitement vidéo.' };
    return { state: 'processing' };
  },

  async followers(ctx) {
    const { data } = await httpJson<any>(`${GRAPH}/${ctx.accountId}?fields=followers_count,fan_count&access_token=${ctx.accessToken}`);
    const n = data.followers_count ?? data.fan_count;
    return typeof n === 'number' ? n : null;
  },

  async listPosts(ctx) {
    const { data } = await httpJson<{ data: any[] }>(
      `${GRAPH}/${ctx.accountId}/posts?fields=id,message,permalink_url,created_time,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)&limit=25&access_token=${ctx.accessToken}`,
    );
    const out: RemotePost[] = [];
    for (const [i, p] of data.data.entries()) {
      const metrics: Record<string, number> = {};
      if (typeof p.reactions?.summary?.total_count === 'number') metrics.likes = p.reactions.summary.total_count;
      if (typeof p.comments?.summary?.total_count === 'number') metrics.comments = p.comments.summary.total_count;
      metrics.shares = p.shares?.count ?? 0;
      if (i < 15) {
        // Meta renomme régulièrement ses métriques de portée: on tente, et on ignore si indisponible.
        try {
          const r = await httpJson<{ data: { name: string; values: { value: number }[] }[] }>(
            `${GRAPH}/${p.id}/insights?metric=post_impressions_unique&access_token=${ctx.accessToken}`,
          );
          const v = r.data.data[0]?.values?.[0]?.value;
          if (typeof v === 'number') metrics.reach = v;
        } catch { /* portée indisponible pour cette publication */ }
      }
      out.push({
        remoteId: p.id,
        caption: p.message,
        permalink: p.permalink_url,
        mediaType: 'POST',
        publishedAt: p.created_time ? new Date(p.created_time) : undefined,
        metrics,
      });
    }
    return out;
  },

  async listComments(ctx, posts) {
    const out: RemoteComment[] = [];
    for (const p of posts.filter((p) => (p.metrics.comments ?? 0) > 0).slice(0, 15)) {
      try {
        const { data } = await httpJson<{ data: any[] }>(
          `${GRAPH}/${p.remoteId}/comments?fields=id,message,from{name},created_time&limit=50&access_token=${ctx.accessToken}`,
        );
        for (const c of data.data)
          out.push({
            remoteId: c.id,
            mediaId: p.remoteId,
            mediaCaption: p.caption,
            mediaUrl: p.permalink,
            author: c.from?.name,
            text: c.message ?? '',
            at: c.created_time ? new Date(c.created_time) : undefined,
          });
      } catch (e) {
        console.warn(`facebook comments ${p.remoteId}:`, (e as Error).message);
      }
    }
    return out;
  },

  async reply(ctx, commentId, text) {
    await post(`${GRAPH}/${commentId}/comments`, { message: text }, ctx.accessToken);
  },
};
