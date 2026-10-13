import { env } from '../env';
import { ApiError, form, httpJson } from '../http';
import type { Provider, Ctx, RemotePost, RemoteComment } from './types';

const API = 'https://www.googleapis.com/youtube/v3';
// Un seul scope: lire la chaîne, les vidéos et les commentaires, et répondre aux commentaires.
const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl'];
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Lit toutes les pages d'une liste de l'API YouTube (nextPageToken). */
async function listAll<T>(url: string, token: string, pageSize: number): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;
  do {
    const { data } = await httpJson<{ items?: T[]; nextPageToken?: string }>(
      `${url}&maxResults=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
      { headers: bearer(token) },
    );
    out.push(...(data.items ?? []));
    pageToken = data.nextPageToken && !seen.has(data.nextPageToken) ? data.nextPageToken : undefined;
    if (pageToken) seen.add(pageToken);
  } while (pageToken);
  return out;
}

const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));

export const youtube: Provider = {
  id: 'youtube',
  label: 'YouTube',
  capabilities: {
    publish: { status: 'unavailable', note: 'Publication de vidéos non prise en charge ici.' },
    schedule: { status: 'unavailable', note: 'Non applicable.' },
    stats: { status: 'available', note: 'Vues, J’aime et commentaires par vidéo ; nombre d’abonnés (masqué si la chaîne le cache).' },
    comments: { status: 'available', note: 'Commentaires et réponses des vidéos de la chaîne.' },
    reply: { status: 'available', note: 'Réponse aux commentaires au nom de la chaîne.' },
    reactions: { status: 'available', note: 'Nombre de J’aime par vidéo (masqué si la chaîne le cache).' },
    messages: { status: 'unavailable', note: 'YouTube n’a pas de messagerie dans son API.' },
  },
  rules: { maxText: 5000, mediaRequired: true, media: ['video'], maxMedia: 1 },
  setupHint:
    'Dans Google Cloud Console (console.cloud.google.com), créez un projet, activez « YouTube Data API v3 », configurez l’écran de consentement OAuth, créez un « ID client OAuth » de type Application Web avec l’URI de redirection <PUBLIC_API_URL>/api/oauth/youtube/callback, puis renseignez YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET.',
  configured: () => !!(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET),

  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline', // pour obtenir un jeton de renouvellement
      prompt: 'consent select_account', // redemande le consentement (jeton de renouvellement) et laisse choisir le compte/la chaîne
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },

  async exchange(code, redirectUri) {
    const { data } = await httpJson<any>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: FORM,
      body: form({
        code,
        client_id: env.YOUTUBE_CLIENT_ID!,
        client_secret: env.YOUTUBE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!data.access_token) throw new ApiError('Échange de jeton Google refusé.', 502);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      scopes: typeof data.scope === 'string' ? data.scope.split(' ') : SCOPES,
    };
  },

  async profile(accessToken) {
    const { data } = await httpJson<any>(`${API}/channels?part=snippet&mine=true`, { headers: bearer(accessToken) });
    const ch = data.items?.[0];
    if (!ch) throw new ApiError('Aucune chaîne YouTube n’est liée à ce compte Google. Choisissez un compte (ou une chaîne) qui en possède une.', 422);
    const t = ch.snippet?.thumbnails;
    return { accountId: String(ch.id), name: ch.snippet?.title ?? 'Chaîne YouTube', avatarUrl: t?.high?.url ?? t?.default?.url };
  },

  async refresh(refreshToken) {
    const { data } = await httpJson<any>('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: FORM,
      body: form({
        client_id: env.YOUTUBE_CLIENT_ID!,
        client_secret: env.YOUTUBE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    // Google ne renvoie pas de nouveau jeton de renouvellement: l'ancien reste valable.
    return { accessToken: data.access_token, expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000) };
  },

  async revoke(token) {
    await httpJson('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: FORM, body: form({ token }) });
  },

  async followers(ctx: Ctx) {
    const { data } = await httpJson<any>(`${API}/channels?part=statistics&mine=true`, { headers: bearer(ctx.accessToken) });
    const s = data.items?.[0]?.statistics;
    if (!s || s.hiddenSubscriberCount) return null;
    return num(s.subscriberCount) ?? null;
  },

  async listPosts(ctx) {
    const { data: ch } = await httpJson<any>(`${API}/channels?part=contentDetails&mine=true`, { headers: bearer(ctx.accessToken) });
    const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return [];
    const items = await listAll<any>(`${API}/playlistItems?part=contentDetails&playlistId=${uploads}`, ctx.accessToken, 50);
    const ids = items.map((i) => i.contentDetails?.videoId).filter(Boolean) as string[];
    const out: RemotePost[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const { data } = await httpJson<any>(`${API}/videos?part=snippet,statistics&id=${ids.slice(i, i + 50).join(',')}`, { headers: bearer(ctx.accessToken) });
      for (const v of data.items ?? []) {
        const s = v.statistics ?? {};
        const metrics: Record<string, number> = { views: num(s.viewCount) ?? 0 };
        if (num(s.likeCount) !== undefined) metrics.likes = num(s.likeCount)!;
        if (num(s.commentCount) !== undefined) metrics.comments = num(s.commentCount)!;
        out.push({
          remoteId: v.id,
          caption: v.snippet?.title,
          permalink: `https://www.youtube.com/watch?v=${v.id}`,
          mediaType: 'VIDEO',
          publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : undefined,
          metrics,
        });
      }
    }
    return out;
  },

  async listComments(ctx, posts, known = {}) {
    const out: RemoteComment[] = [];
    for (const [i, p] of posts.entries()) {
      // Les 3 vidéos les plus récentes sont relues à chaque fois; les autres seulement si leur nombre de commentaires a changé.
      if (!((p.metrics.comments ?? 0) > 0 && (i < 3 || (known[p.remoteId] ?? 0) !== p.metrics.comments))) continue;
      try {
        const threads = await listAll<any>(`${API}/commentThreads?part=snippet,replies&videoId=${p.remoteId}&order=time&textFormat=plainText`, ctx.accessToken, 100);
        const push = (c: any) => {
          // Les réponses de la chaîne elle-même ne sont pas des commentaires à traiter.
          if (c.snippet?.authorChannelId?.value === ctx.accountId) return;
          out.push({
            remoteId: c.id,
            mediaId: p.remoteId,
            mediaCaption: p.caption,
            mediaUrl: p.permalink,
            author: c.snippet?.authorDisplayName,
            text: c.snippet?.textDisplay ?? c.snippet?.textOriginal ?? '',
            at: c.snippet?.publishedAt ? new Date(c.snippet.publishedAt) : undefined,
          });
        };
        for (const t of threads) {
          const top = t.snippet?.topLevelComment;
          if (top) push(top);
          const total = t.snippet?.totalReplyCount ?? 0;
          if (!total || !top) continue;
          const embedded: any[] = t.replies?.comments ?? [];
          const replies = embedded.length >= total
            ? embedded
            : await listAll<any>(`${API}/comments?part=snippet&parentId=${top.id}&textFormat=plainText`, ctx.accessToken, 100);
          replies.forEach(push);
        }
      } catch (e) {
        console.warn(`youtube comments ${p.remoteId}:`, (e as Error).message); // ex.: commentaires désactivés sur la vidéo
      }
    }
    return out;
  },

  async reply(ctx, commentId, text) {
    // Une réponse se rattache toujours au commentaire principal: l'identifiant d'une réponse est « <principal>.<réponse> ».
    const parentId = commentId.split('.')[0];
    await httpJson(`${API}/comments?part=snippet`, {
      method: 'POST',
      headers: { ...bearer(ctx.accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ snippet: { parentId, textOriginal: text } }),
    });
  },
};
