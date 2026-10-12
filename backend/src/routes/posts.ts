import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, wrap } from '../auth';
import { C, NO_ID, logActivity, newId } from '../db';
import { env } from '../env';
import { ApiError } from '../http';
import { PLATFORMS } from '../providers';
import { claimPost, runPost, syncTargets, type PostRow } from '../services/publisher';

export const posts = Router();
posts.use(requireAuth);

const mediaSchema = z.object({
  url: z.string().url(),
  type: z.enum(['image', 'video']),
  path: z.string().optional(),
});
const bodySchema = z.object({
  content: z.string().max(5000).default(''),
  per_network: z.record(z.enum(PLATFORMS as [string, ...string[]]), z.string().max(5000)).default({}),
  media: z.array(mediaSchema).max(10).default([]),
  platforms: z.array(z.enum(PLATFORMS as [string, ...string[]])).default([]),
  scheduled_at: z.string().datetime().nullable().optional(),
  action: z.enum(['draft', 'schedule', 'publish']).default('draft'),
});

/** Les médias doivent venir du dossier de l'utilisateur sur CE serveur: évite qu'un client fasse
 *  récupérer une URL arbitraire par le serveur (SSRF) ou publier le fichier d'un autre utilisateur. */
function assertOwnMedia(userId: string, media: z.infer<typeof mediaSchema>[]) {
  const prefix = `${env.PUBLIC_API_URL.replace(/\/$/, '')}/media/${userId}/`;
  for (const m of media) if (!m.url.startsWith(prefix)) throw new ApiError('Média non autorisé: téléversez-le via l’éditeur.', 422);
}

posts.get(
  '/',
  wrap(async (req, res) => {
    const { status, from, to } = req.query as Record<string, string | undefined>;
    const q: Record<string, unknown> = { user_id: req.userId };
    if (status) q.status = String(status);
    if (from || to) {
      q.scheduled_at = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lte: new Date(to) } : {}),
      };
    }
    const list = await C.posts.find(q, NO_ID).sort({ created_at: -1 }).limit(300).toArray();
    const targets = await C.targets
      .find({ post_id: { $in: list.map((p) => p.id) } }, { projection: { _id: 0, id: 1, post_id: 1, platform: 1, status: 1, error: 1, remote_url: 1, attempts: 1, published_at: 1 } })
      .toArray();
    res.json(list.map((p) => ({ ...p, post_targets: targets.filter((t) => t.post_id === p.id) })));
  }),
);

async function ownPost(userId: string, id: string): Promise<PostRow> {
  const p = await C.posts.findOne({ id, user_id: userId }, NO_ID);
  if (!p) throw new ApiError('Publication introuvable.', 404);
  return p as PostRow;
}

async function save(userId: string, id: string | null, input: z.infer<typeof bodySchema>) {
  assertOwnMedia(userId, input.media);
  const when = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (input.action === 'schedule') {
    if (!when) throw new ApiError('Choisissez une date de programmation.', 422);
    if (when.getTime() < Date.now() + 60_000) throw new ApiError('La date doit être dans le futur (au moins 1 minute).', 422);
  }
  if (input.action !== 'draft' && input.platforms.length === 0) throw new ApiError('Sélectionnez au moins un réseau.', 422);

  const fields = {
    content: input.content,
    per_network: input.per_network,
    media: input.media,
    platforms: input.platforms,
    scheduled_at: when,
    status: input.action === 'draft' ? 'draft' : input.action === 'schedule' ? 'scheduled' : 'publishing',
    updated_at: new Date(),
  };
  let post: PostRow;
  if (id) {
    const existing = await ownPost(userId, id);
    if (!['draft', 'scheduled', 'failed'].includes(existing.status))
      throw new ApiError('Cette publication ne peut plus être modifiée.', 409);
    await C.posts.updateOne({ id, user_id: userId }, { $set: fields });
    post = await ownPost(userId, id);
  } else {
    post = { id: newId(), user_id: userId, ...fields } as PostRow;
    await C.posts.insertOne({ ...post, created_at: new Date() });
  }

  if (input.action !== 'draft') {
    try {
      await syncTargets(post);
    } catch (e) {
      // Validation échouée: on conserve le contenu en brouillon plutôt que de le perdre.
      await C.posts.updateOne({ id: post.id }, { $set: { status: 'draft' } });
      throw e;
    }
    // Un post à nouveau programmé repart sur des cibles propres.
    await C.targets.updateMany({ post_id: post.id, status: { $ne: 'published' } }, { $set: { status: 'pending', error: null } });
  }
  return post;
}

posts.post(
  '/',
  wrap(async (req, res) => {
    const input = bodySchema.parse(req.body);
    const post = await save(req.userId, null, input);
    await logActivity(req.userId, `post.${input.action === 'draft' ? 'draft_saved' : input.action === 'schedule' ? 'scheduled' : 'publish_requested'}`, null, { post_id: post.id });
    if (input.action === 'publish') runPost(post).catch((e) => console.error('runPost:', e.message));
    res.status(input.action === 'publish' ? 202 : 201).json(post);
  }),
);

posts.put(
  '/:id',
  wrap(async (req, res) => {
    const input = bodySchema.parse(req.body);
    const post = await save(req.userId, String(req.params.id), input);
    await logActivity(req.userId, 'post.updated', null, { post_id: post.id, action: input.action });
    if (input.action === 'publish') runPost(post).catch((e) => console.error('runPost:', e.message));
    res.status(input.action === 'publish' ? 202 : 200).json(post);
  }),
);

posts.delete(
  '/:id',
  wrap(async (req, res) => {
    const post = await ownPost(req.userId, String(req.params.id));
    if (post.status === 'publishing') throw new ApiError('Publication en cours: impossible de la supprimer maintenant.', 409);
    if (post.status === 'published' || post.status === 'partial')
      throw new ApiError('Une publication déjà en ligne ne se supprime pas d’ici (retirez-la sur le réseau).', 409);
    await C.posts.deleteOne({ id: post.id, user_id: req.userId });
    await C.targets.deleteMany({ post_id: post.id });
    await logActivity(req.userId, 'post.deleted', null, { post_id: post.id });
    res.status(204).end();
  }),
);

/** Relance les cibles en échec (après correction du compte ou du contenu). */
posts.post(
  '/:id/retry',
  wrap(async (req, res) => {
    const post = await ownPost(req.userId, String(req.params.id));
    if (!['failed', 'partial'].includes(post.status)) throw new ApiError('Rien à relancer pour cette publication.', 409);
    await syncTargets(post);
    const claimed = await claimPost(post.id, ['failed', 'partial']);
    if (!claimed) throw new ApiError('Cette publication est déjà en cours de traitement.', 409);
    await logActivity(req.userId, 'post.retry', null, { post_id: post.id });
    runPost(claimed).catch((e) => console.error('runPost:', e.message));
    res.status(202).json({ ok: true });
  }),
);

/** Publier maintenant un brouillon ou une publication programmée. */
posts.post(
  '/:id/publish',
  wrap(async (req, res) => {
    const post = await ownPost(req.userId, String(req.params.id));
    await syncTargets(post);
    const claimed = await claimPost(post.id, ['draft', 'scheduled']);
    if (!claimed) throw new ApiError('Cette publication ne peut pas être publiée maintenant.', 409);
    runPost(claimed).catch((e) => console.error('runPost:', e.message));
    res.status(202).json({ ok: true });
  }),
);

/** Replanifie (déplacement dans le calendrier). */
posts.patch(
  '/:id/schedule',
  wrap(async (req, res) => {
    const { scheduled_at } = z.object({ scheduled_at: z.string().datetime() }).parse(req.body);
    const post = await ownPost(req.userId, String(req.params.id));
    if (post.status !== 'scheduled') throw new ApiError('Seules les publications programmées peuvent être déplacées.', 409);
    if (new Date(scheduled_at).getTime() < Date.now() + 60_000) throw new ApiError('La date doit être dans le futur.', 422);
    await C.posts.updateOne({ id: post.id, user_id: req.userId }, { $set: { scheduled_at: new Date(scheduled_at), updated_at: new Date() } });
    await logActivity(req.userId, 'post.rescheduled', null, { post_id: post.id, scheduled_at });
    res.json({ ok: true });
  }),
);
