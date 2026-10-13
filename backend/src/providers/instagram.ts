import { env } from '../env';
import { ApiError, form, httpJson } from '../http';
import { fetchAll, wantsComments } from './paging';
import type { Provider, Ctx, MediaItem, RemotePost, RemoteComment } from './types';

const GRAPH = 'https://graph.instagram.com/v23.0';
const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_insights',
];
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitContainer(ctx: Ctx, id: string) {
  for (let i = 0; i < 40; i++) {
    const { data } = await httpJson<{ status_code?: string; status?: string }>(
      `${GRAPH}/${id}?fields=status_code,status&access_token=${ctx.accessToken}`,
    );
    if (data.status_code === 'FINISHED') return;
    if (data.status_code === 'ERROR' || data.status_code === 'EXPIRED')
      throw new ApiError(`Instagram a refusé le média: ${data.status ?? data.status_code}`, 422);
    await sleep(3000);
  }
  throw new ApiError('Instagram n’a pas fini de traiter le média (délai dépassé). Réessayez plus tard.', 504);
}

async function createContainer(ctx: Ctx, params: Record<string, string | undefined>) {
  const { data } = await httpJson<{ id: string }>(`${GRAPH}/${ctx.accountId}/media`, {
    method: 'POST',
    headers: FORM,
    body: form({ ...params, access_token: ctx.accessToken }),
  });
  return data.id;
}

export const instagram: Provider = {
  id: 'instagram',
  label: 'Instagram',
  capabilities: {
    publish: { status: 'available', note: 'Photos, Reels et carrousels d’images. Compte Instagram Professionnel (Business ou Creator) requis.' },
    schedule: { status: 'available', note: 'Programmation exécutée par notre serveur (l’API ne programme pas nativement).' },
    stats: { status: 'available', note: 'Portée, vues, enregistrements, partages par publication ; nombre d’abonnés.' },
    comments: { status: 'available', note: 'Commentaires des publications récentes.' },
    reply: { status: 'available', note: 'Réponse aux commentaires de premier niveau.' },
    reactions: { status: 'available', note: 'Nombre de J’aime uniquement (les personnes ne sont pas identifiables).' },
    messages: { status: 'requires_approval', note: 'Messages privés: permission distincte soumise à l’App Review Meta. Non activé ici.' },
  },
  rules: { maxText: 2200, mediaRequired: true, media: ['image', 'video'], maxMedia: 10 },
  setupHint:
    'Créez une app sur developers.facebook.com (type Business), ajoutez le produit « Instagram », renseignez INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET et l’URI de redirection <PUBLIC_API_URL>/api/oauth/instagram/callback. Tant que l’app est en mode Développement, seuls les comptes testeurs peuvent se connecter; l’App Review est requise pour le public.',
  configured: () => !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET),

  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: env.INSTAGRAM_APP_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(','),
      state,
    });
    return `https://www.instagram.com/oauth/authorize?${p}`;
  },

  async exchange(code, redirectUri) {
    const { data: short } = await httpJson<{ access_token: string; user_id: number | string }>(
      'https://api.instagram.com/oauth/access_token',
      {
        method: 'POST',
        headers: FORM,
        body: form({
          client_id: env.INSTAGRAM_APP_ID!,
          client_secret: env.INSTAGRAM_APP_SECRET!,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: code.replace(/#_$/, ''),
        }),
      },
    );
    const { data: long } = await httpJson<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/access_token?${new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: env.INSTAGRAM_APP_SECRET!,
        access_token: short.access_token,
      })}`,
    );
    return {
      accessToken: long.access_token,
      expiresAt: new Date(Date.now() + long.expires_in * 1000),
      accountId: String(short.user_id),
      scopes: SCOPES,
    };
  },

  async profile(accessToken) {
    const { data } = await httpJson<any>(
      `${GRAPH}/me?fields=user_id,username,account_type,profile_picture_url&access_token=${accessToken}`,
    );
    if (data.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(data.account_type))
      throw new ApiError('Ce compte Instagram est personnel. Passez-le en compte Professionnel (Réglages > Type de compte) puis reconnectez-le.', 422);
    return {
      accountId: String(data.user_id ?? data.id),
      name: `@${data.username}`,
      avatarUrl: data.profile_picture_url,
      meta: { accountType: data.account_type },
    };
  },

  /** Les jetons longue durée Instagram se prolongent avec leur propre valeur (≥24h d’ancienneté). */
  async refresh(token) {
    const { data } = await httpJson<{ access_token: string; expires_in: number }>(
      `https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: token,
      })}`,
    );
    return { accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000) };
  },

  async publish(ctx, text, media: MediaItem[]) {
    if (media.length === 0) throw new ApiError('Instagram exige au moins une image ou une vidéo.', 422);
    let creationId: string;
    if (media.length === 1) {
      const m = media[0];
      creationId = await createContainer(
        ctx,
        m.type === 'video'
          ? { media_type: 'REELS', video_url: m.url, caption: text }
          : { image_url: m.url, caption: text },
      );
      if (m.type === 'video') await waitContainer(ctx, creationId);
    } else {
      if (media.some((m) => m.type === 'video'))
        throw new ApiError('Les carrousels ne sont pris en charge ici qu’avec des images.', 422);
      const children: string[] = [];
      for (const m of media) children.push(await createContainer(ctx, { image_url: m.url, is_carousel_item: 'true' }));
      creationId = await createContainer(ctx, { media_type: 'CAROUSEL', children: children.join(','), caption: text });
      await waitContainer(ctx, creationId);
    }
    const { data } = await httpJson<{ id: string }>(`${GRAPH}/${ctx.accountId}/media_publish`, {
      method: 'POST',
      headers: FORM,
      body: form({ creation_id: creationId, access_token: ctx.accessToken }),
    });
    let url: string | undefined;
    try {
      const r = await httpJson<{ permalink?: string }>(`${GRAPH}/${data.id}?fields=permalink&access_token=${ctx.accessToken}`);
      url = r.data.permalink;
    } catch { /* le lien est facultatif */ }
    return { remoteId: data.id, url, state: 'published' };
  },

  async followers(ctx) {
    const { data } = await httpJson<any>(`${GRAPH}/me?fields=followers_count&access_token=${ctx.accessToken}`);
    return typeof data.followers_count === 'number' ? data.followers_count : null;
  },

  async listPosts(ctx) {
    const all = await fetchAll<any>(
      `${GRAPH}/${ctx.accountId}/media?fields=id,caption,media_type,permalink,timestamp,like_count,comments_count&limit=50&access_token=${ctx.accessToken}`,
      10, // jusqu'à 500 publications
    );
    const out: RemotePost[] = [];
    for (const [i, m] of all.entries()) {
      const metrics: Record<string, number> = {};
      if (typeof m.like_count === 'number') metrics.likes = m.like_count;
      if (typeof m.comments_count === 'number') metrics.comments = m.comments_count;
      if (i < 15) {
        // Les métriques disponibles varient selon le type de média: on tente large puis on réduit.
        for (const set of ['reach,views,saved,shares', 'reach,saved']) {
          try {
            const r = await httpJson<{ data: { name: string; values: { value: number }[] }[] }>(
              `${GRAPH}/${m.id}/insights?metric=${set}&access_token=${ctx.accessToken}`,
            );
            for (const row of r.data.data) if (typeof row.values?.[0]?.value === 'number') metrics[row.name] = row.values[0].value;
            break;
          } catch { /* essaie le jeu suivant; sinon métriques d’insight absentes */ }
        }
      }
      out.push({
        remoteId: m.id,
        caption: m.caption,
        permalink: m.permalink,
        mediaType: m.media_type,
        publishedAt: m.timestamp ? new Date(m.timestamp) : undefined,
        metrics,
      });
    }
    return out;
  },

  async listComments(ctx, posts, known) {
    const out: RemoteComment[] = [];
    for (const [i, p] of posts.entries()) {
      if (!wantsComments(p, i, known)) continue;
      try {
        const data = await fetchAll<any>(
          `${GRAPH}/${p.remoteId}/comments?fields=id,text,username,timestamp&limit=100&access_token=${ctx.accessToken}`,
          30,
        );
        for (const c of data)
          out.push({
            remoteId: c.id,
            mediaId: p.remoteId,
            mediaCaption: p.caption,
            mediaUrl: p.permalink,
            author: c.username ? `@${c.username}` : undefined,
            text: c.text ?? '',
            at: c.timestamp ? new Date(c.timestamp) : undefined,
          });
      } catch (e) {
        console.warn(`instagram comments ${p.remoteId}:`, (e as Error).message);
      }
    }
    return out;
  },

  async reply(ctx, commentId, text) {
    await httpJson(`${GRAPH}/${commentId}/replies`, {
      method: 'POST',
      headers: FORM,
      body: form({ message: text, access_token: ctx.accessToken }),
    });
  },
};
