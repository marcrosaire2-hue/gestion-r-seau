import { env } from '../env';
import { ApiError, form, httpJson } from '../http';
import type { Provider, Ctx, MediaItem } from './types';

const SCOPES = ['openid', 'profile', 'w_member_social'];
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

const restHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Linkedin-Version': env.LINKEDIN_API_VERSION,
  'X-Restli-Protocol-Version': '2.0.0',
  'Content-Type': 'application/json',
});

async function uploadImage(ctx: Ctx, m: MediaItem): Promise<string> {
  const owner = `urn:li:person:${ctx.accountId}`;
  const { data } = await httpJson<{ value: { uploadUrl: string; image: string } }>(
    'https://api.linkedin.com/rest/images?action=initializeUpload',
    { method: 'POST', headers: restHeaders(ctx.accessToken), body: JSON.stringify({ initializeUploadRequest: { owner } }) },
  );
  const file = await fetch(m.url);
  if (!file.ok) throw new ApiError(`Impossible de lire le média (${file.status}).`, 422);
  const up = await fetch(data.value.uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
    body: Buffer.from(await file.arrayBuffer()),
  });
  if (!up.ok) throw new ApiError(`Échec de l’envoi de l’image à LinkedIn (HTTP ${up.status}).`, 502);
  return data.value.image;
}

export const linkedin: Provider = {
  id: 'linkedin',
  label: 'LinkedIn',
  capabilities: {
    publish: { status: 'available', note: 'Texte et une image sur votre profil personnel (produit « Share on LinkedIn »). Vidéo non prise en charge ici.' },
    schedule: { status: 'available', note: 'Programmation exécutée par notre serveur.' },
    stats: { status: 'unavailable', note: 'Les statistiques d’un profil personnel ne sont pas exposées par l’API publique. Disponibles pour les Pages d’organisation (Community Management API, sur validation).' },
    comments: { status: 'unavailable', note: 'Lecture des commentaires d’un profil personnel: permission r_member_social réservée aux partenaires approuvés. Pages: Community Management API.' },
    reply: { status: 'unavailable', note: 'Même restriction que la lecture des commentaires.' },
    reactions: { status: 'unavailable', note: 'Non exposées pour un profil personnel.' },
    messages: { status: 'unavailable', note: 'Aucune API de messagerie publique.' },
  },
  rules: { maxText: 3000, mediaRequired: false, media: ['image'], maxMedia: 1 },
  setupHint:
    'Créez une app sur linkedin.com/developers, associez-la à une Page LinkedIn, ajoutez les produits « Share on LinkedIn » et « Sign In with LinkedIn using OpenID Connect », puis renseignez LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET et l’URL de redirection <PUBLIC_API_URL>/api/oauth/linkedin/callback. Pour publier au nom d’une Page: demandez la Community Management API (validation LinkedIn).',
  configured: () => !!(env.LINKEDIN_CLIENT_ID && env.LINKEDIN_CLIENT_SECRET),

  authUrl(state, redirectUri) {
    const p = new URLSearchParams({
      response_type: 'code',
      client_id: env.LINKEDIN_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' '),
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
  },

  async exchange(code, redirectUri) {
    const { data } = await httpJson<any>('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: FORM,
      body: form({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: env.LINKEDIN_CLIENT_ID!,
        client_secret: env.LINKEDIN_CLIENT_SECRET!,
      }),
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scopes: typeof data.scope === 'string' ? data.scope.split(/[ ,]/) : SCOPES,
    };
  },

  async profile(accessToken) {
    const { data } = await httpJson<any>('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { accountId: data.sub, name: data.name ?? 'Profil LinkedIn', avatarUrl: data.picture, meta: { kind: 'person' } };
  },

  /** Le renouvellement programmatique n’existe que pour les partenaires LinkedIn; sinon reconnexion. */
  async refresh(refreshToken) {
    const { data } = await httpJson<any>('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: FORM,
      body: form({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.LINKEDIN_CLIENT_ID!,
        client_secret: env.LINKEDIN_CLIENT_SECRET!,
      }),
    });
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
    };
  },

  async revoke(token) {
    await httpJson('https://www.linkedin.com/oauth/v2/revoke', {
      method: 'POST',
      headers: FORM,
      body: form({ token, client_id: env.LINKEDIN_CLIENT_ID!, client_secret: env.LINKEDIN_CLIENT_SECRET! }),
    });
  },

  async publish(ctx, text, media) {
    if (media.some((m) => m.type !== 'image')) throw new ApiError('LinkedIn: seules les images sont prises en charge ici.', 422);
    const body: Record<string, unknown> = {
      author: `urn:li:person:${ctx.accountId}`,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: { feedDistributionType: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };
    if (media[0]) body.content = { media: { id: await uploadImage(ctx, media[0]) } };
    const { headers } = await httpJson('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: restHeaders(ctx.accessToken),
      body: JSON.stringify(body),
    });
    const urn = headers.get('x-restli-id') ?? headers.get('x-linkedin-id');
    if (!urn) throw new ApiError('LinkedIn n’a pas renvoyé d’identifiant de publication: succès non confirmé.', 502);
    return { remoteId: urn, url: `https://www.linkedin.com/feed/update/${urn}/`, state: 'published' };
  },
};
