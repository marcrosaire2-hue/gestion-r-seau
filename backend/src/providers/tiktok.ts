import { env } from '../env';
import { ApiError, form, httpJson } from '../http';
import type { Provider, Ctx } from './types';

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.publish'];
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };
const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' });

const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;

export const tiktok: Provider = {
  id: 'tiktok',
  label: 'TikTok',
  capabilities: {
    publish: {
      status: 'requires_approval',
      note: 'Content Posting API (vidéo). Tant que votre app n’a pas passé l’audit TikTok, les vidéos ne peuvent être publiées qu’en mode privé (« Moi uniquement »).',
    },
    schedule: { status: 'requires_approval', note: 'Programmation exécutée par notre serveur; mêmes restrictions d’audit que la publication.' },
    stats: { status: 'available', note: 'Vues, J’aime, commentaires, partages par vidéo; nombre d’abonnés (scope user.info.stats).' },
    comments: { status: 'unavailable', note: 'TikTok ne propose pas d’API publique pour lire les commentaires de votre compte (seule l’API Research, réservée à la recherche académique, y accède).' },
    reply: { status: 'unavailable', note: 'Répondre aux commentaires n’est pas possible via l’API publique. À faire dans l’application TikTok.' },
    reactions: { status: 'available', note: 'Compteurs de J’aime par vidéo uniquement.' },
    messages: { status: 'unavailable', note: 'Aucune API de messagerie publique.' },
  },
  rules: { maxText: 2200, mediaRequired: true, media: ['video'], maxMedia: 1 },
  setupHint:
    'Créez une app sur developers.tiktok.com, ajoutez les produits « Login Kit » et « Content Posting API », scopes user.info.basic, user.info.profile, user.info.stats, video.list, video.publish; renseignez TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET et l’URI de redirection <PUBLIC_API_URL>/api/oauth/tiktok/callback (HTTPS). Pour publier publiquement, soumettez l’app à l’audit TikTok.',
  configured: () => !!(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),

  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      response_type: 'code',
      scope: SCOPES.join(','),
      redirect_uri: redirectUri,
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${p}`;
  },

  async exchange(code, redirectUri) {
    const { data } = await httpJson<any>(`${API}/oauth/token/`, {
      method: 'POST',
      headers: FORM,
      body: form({
        client_key: env.TIKTOK_CLIENT_KEY!,
        client_secret: env.TIKTOK_CLIENT_SECRET!,
        code: decodeURIComponent(code),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    if (!data.access_token) throw new ApiError(data.error_description ?? 'Échange de jeton TikTok refusé.', 502);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
      accountId: data.open_id,
      scopes: typeof data.scope === 'string' ? data.scope.split(',') : SCOPES,
    };
  },

  async profile(accessToken, token) {
    const { data } = await httpJson<any>(`${API}/user/info/?fields=open_id,display_name,avatar_url`, {
      headers: auth(accessToken),
    });
    const u = data.data?.user ?? {};
    return { accountId: u.open_id ?? token.accountId!, name: u.display_name ?? 'Compte TikTok', avatarUrl: u.avatar_url };
  },

  async refresh(refreshToken) {
    const { data } = await httpJson<any>(`${API}/oauth/token/`, {
      method: 'POST',
      headers: FORM,
      body: form({
        client_key: env.TIKTOK_CLIENT_KEY!,
        client_secret: env.TIKTOK_CLIENT_SECRET!,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(Date.now() + data.expires_in * 1000),
    };
  },

  async revoke(token) {
    await httpJson(`${API}/oauth/revoke/`, {
      method: 'POST',
      headers: FORM,
      body: form({ client_key: env.TIKTOK_CLIENT_KEY!, client_secret: env.TIKTOK_CLIENT_SECRET!, token }),
    });
  },

  async publish(ctx, text, media) {
    const video = media[0];
    if (!video || video.type !== 'video') throw new ApiError('TikTok exige une vidéo.', 422);

    const { data: creator } = await httpJson<any>(`${API}/post/publish/creator_info/query/`, {
      method: 'POST',
      headers: auth(ctx.accessToken),
      body: '{}',
    });
    const options: string[] = creator.data?.privacy_level_options ?? [];
    // Une app non auditée n'offre que SELF_ONLY: on prend la première option réellement autorisée.
    const privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0];
    if (!privacy) throw new ApiError('TikTok n’autorise aucune visibilité pour ce compte pour le moment.', 422);

    const file = await fetch(video.url);
    if (!file.ok) throw new ApiError(`Impossible de lire la vidéo (${file.status}).`, 422);
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_SINGLE_CHUNK)
      throw new ApiError('Vidéo trop lourde pour l’envoi en un bloc (64 Mo max dans cette version).', 422);

    const { data: init } = await httpJson<any>(`${API}/post/publish/video/init/`, {
      method: 'POST',
      headers: auth(ctx.accessToken),
      body: JSON.stringify({
        post_info: { title: text.slice(0, 2200), privacy_level: privacy },
        source_info: { source: 'FILE_UPLOAD', video_size: buf.length, chunk_size: buf.length, total_chunk_count: 1 },
      }),
    });
    const { publish_id, upload_url } = init.data ?? {};
    if (!publish_id || !upload_url) throw new ApiError('TikTok n’a pas renvoyé d’identifiant d’envoi.', 502);

    const up = await fetch(upload_url, {
      method: 'PUT',
      headers: {
        'Content-Type': file.headers.get('content-type') ?? 'video/mp4',
        'Content-Length': String(buf.length),
        'Content-Range': `bytes 0-${buf.length - 1}/${buf.length}`,
      },
      body: buf,
    });
    if (!up.ok) throw new ApiError(`Échec de l’envoi de la vidéo à TikTok (HTTP ${up.status}).`, 502);
    // TikTok traite la vidéo ensuite: la confirmation passe par checkPublish().
    return { remoteId: publish_id, state: 'processing' };
  },

  async checkPublish(ctx, publishId) {
    const { data } = await httpJson<any>(`${API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: auth(ctx.accessToken),
      body: JSON.stringify({ publish_id: publishId }),
    });
    const s = data.data?.status as string | undefined;
    if (s === 'PUBLISH_COMPLETE') return { state: 'published' };
    if (s === 'FAILED') return { state: 'failed', error: data.data?.fail_reason ?? 'Échec signalé par TikTok.' };
    return { state: 'processing' };
  },

  async followers(ctx: Ctx) {
    const { data } = await httpJson<any>(`${API}/user/info/?fields=follower_count`, { headers: auth(ctx.accessToken) });
    const n = data.data?.user?.follower_count;
    return typeof n === 'number' ? n : null;
  },

  async listPosts(ctx) {
    const { data } = await httpJson<any>(
      `${API}/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count`,
      { method: 'POST', headers: auth(ctx.accessToken), body: JSON.stringify({ max_count: 20 }) },
    );
    return (data.data?.videos ?? []).map((v: any) => ({
      remoteId: String(v.id),
      caption: v.title || v.video_description,
      permalink: v.share_url,
      mediaType: 'VIDEO',
      publishedAt: v.create_time ? new Date(v.create_time * 1000) : undefined,
      metrics: {
        views: v.view_count ?? 0,
        likes: v.like_count ?? 0,
        comments: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
      },
    }));
  },
};
