import { C, NO_ID, logActivity, newId } from '../db';
import { ApiError } from '../http';
import { providers, type MediaItem, type Platform } from '../providers';
import { activeConnections, getConnection, getCtx, markStatus, type ConnectionRow } from './connections';
import { textFor, validateForPlatform } from './validation';

export interface PostRow {
  id: string;
  user_id: string;
  content: string;
  per_network: Record<string, string>;
  media: MediaItem[];
  platforms: Platform[];
  status: string;
  scheduled_at: Date | null;
}

/** Crée/actualise les cibles de publication. Valide le contenu; lève une ApiError listant les problèmes. */
export async function syncTargets(post: PostRow) {
  const conns = await activeConnections(post.user_id, post.platforms);
  const errors: string[] = [];
  for (const platform of post.platforms) {
    if (!conns.find((c) => c.platform === platform))
      errors.push(`${providers[platform].label}: aucun compte connecté.`);
    errors.push(...validateForPlatform(platform, textFor(post.content, post.per_network, platform), post.media));
  }
  if (errors.length) throw new ApiError(errors.join(' '), 422, { errors });

  const existing = await C.targets.find({ post_id: post.id }, NO_ID).toArray();
  const have = new Set<string>();
  for (const t of existing) {
    // Retire les cibles des réseaux désélectionnés (sauf déjà publiées).
    if (!post.platforms.includes(t.platform) && t.status !== 'published') await C.targets.deleteOne({ id: t.id });
    else have.add(t.platform);
  }
  for (const platform of post.platforms) {
    if (have.has(platform)) continue;
    const conn = conns.find((c) => c.platform === platform)!;
    await C.targets.insertOne({
      id: newId(), post_id: post.id, user_id: post.user_id, platform, connection_id: conn.id,
      status: 'pending', remote_id: null, remote_url: null, error: null, attempts: 0, published_at: null,
    });
  }
}

export async function recomputeStatus(postId: string) {
  const targets = await C.targets.find({ post_id: postId }, { projection: { status: 1, _id: 0 } }).toArray();
  const st = targets.map((t) => t.status as string);
  let status: string;
  if (st.length === 0) status = 'failed';
  else if (st.some((s) => ['pending', 'publishing', 'processing'].includes(s))) status = 'publishing';
  else if (st.every((s) => s === 'published')) status = 'published';
  else if (st.some((s) => s === 'published')) status = 'partial';
  else status = 'failed';
  // N'écrit que si le statut change: updated_at sert aussi de repère pour le délai de confirmation TikTok.
  await C.posts.updateOne({ id: postId, status: { $ne: status } }, { $set: { status, updated_at: new Date() } });
  return status;
}

/** Passage atomique vers « publishing » : empêche une double publication (scheduler + clic simultanés). */
export async function claimPost(postId: string, from: string[]): Promise<PostRow | null> {
  return (await C.posts.findOneAndUpdate(
    { id: postId, status: { $in: from } },
    { $set: { status: 'publishing', updated_at: new Date() } },
    { returnDocument: 'after', projection: { _id: 0 } },
  )) as PostRow | null;
}

async function publishTarget(post: PostRow, target: { id: string; platform: Platform; connection_id: string | null }) {
  const provider = providers[target.platform];
  await C.targets.updateOne({ id: target.id }, { $set: { status: 'publishing', error: null }, $inc: { attempts: 1 } });

  let conn: ConnectionRow | null = null;
  try {
    if (!provider.publish) throw new ApiError(`${provider.label}: publication non disponible.`, 422);
    if (!target.connection_id) throw new ApiError('Aucun compte connecté.', 422);
    conn = await getConnection(post.user_id, target.connection_id);
    if (conn.status !== 'active') throw new ApiError('Compte déconnecté ou expiré: reconnectez-le.', 401);
    const text = textFor(post.content, post.per_network, target.platform);
    const errs = validateForPlatform(target.platform, text, post.media);
    if (errs.length) throw new ApiError(errs.join(' '), 422);

    const ctx = await getCtx(conn);
    const res = await provider.publish(ctx, text, post.media);
    await C.targets.updateOne(
      { id: target.id },
      {
        $set:
          res.state === 'published'
            ? { status: 'published', remote_id: res.remoteId, remote_url: res.url ?? null, published_at: new Date() }
            : { status: 'processing', remote_id: res.remoteId },
      },
    );
    await logActivity(post.user_id, res.state === 'published' ? 'post.published' : 'post.processing', target.platform, {
      post_id: post.id,
      remote_id: res.remoteId,
    });
  } catch (e) {
    const err = e as ApiError;
    if (conn && err.status === 401) await markStatus(conn, 'expired', err.message);
    await C.targets.updateOne({ id: target.id }, { $set: { status: 'failed', error: err.message } });
    await logActivity(post.user_id, 'post.failed', target.platform, { post_id: post.id, error: err.message });
  }
}

/** Publie les cibles en attente ou en échec d'un post déjà « claimé ». N'annonce un succès que sur confirmation de l'API. */
export async function runPost(post: PostRow) {
  try {
    const targets = await C.targets.find({ post_id: post.id, status: { $in: ['pending', 'failed'] } }, NO_ID).toArray();
    for (const t of targets) await publishTarget(post, t as any);
  } finally {
    await recomputeStatus(post.id);
  }
}

/** Confirme les publications que la plateforme traite en différé (TikTok). */
export async function reconcileProcessing() {
  const targets = await C.targets.find({ status: 'processing' }, NO_ID).toArray();
  for (const t of targets) {
    const provider = providers[t.platform as Platform];
    try {
      if (!provider.checkPublish || !t.connection_id || !t.remote_id) throw new ApiError('Statut non vérifiable.', 500);
      const conn = await getConnection(t.user_id, t.connection_id);
      const r = await provider.checkPublish(await getCtx(conn), t.remote_id);
      if (r.state === 'published') {
        await C.targets.updateOne({ id: t.id }, { $set: { status: 'published', published_at: new Date() } });
        await logActivity(t.user_id, 'post.published', t.platform, { post_id: t.post_id, remote_id: t.remote_id });
      } else if (r.state === 'failed') {
        await C.targets.updateOne({ id: t.id }, { $set: { status: 'failed', error: r.error ?? 'Échec' } });
        await logActivity(t.user_id, 'post.failed', t.platform, { post_id: t.post_id, error: r.error });
      } else {
        const post = await C.posts.findOne({ id: t.post_id }, { projection: { updated_at: 1, _id: 0 } });
        if (Date.now() - new Date(post?.updated_at ?? 0).getTime() > 30 * 60_000)
          await C.targets.updateOne({ id: t.id }, { $set: { status: 'failed', error: 'Aucune confirmation de publication après 30 min.' } });
      }
    } catch (e) {
      console.warn('reconcile:', (e as Error).message);
    }
    await recomputeStatus(t.post_id);
  }
}
