import { C, newId } from '../db';
import { providers } from '../providers';
import { activeConnections, getCtx, markStatus, type ConnectionRow } from './connections';

/** Récupère abonnés, publications+métriques et commentaires d'une connexion. Retourne un rapport par fonction. */
export async function syncConnection(conn: ConnectionRow) {
  const provider = providers[conn.platform];
  const report: Record<string, string> = {};
  let ctx;
  try {
    ctx = await getCtx(conn);
  } catch (e) {
    return { error: (e as Error).message };
  }

  try {
    if (provider.followers) {
      const n = await provider.followers(ctx);
      if (n !== null)
        await C.snapshots.insertOne({ id: newId(), user_id: conn.user_id, connection_id: conn.id, platform: conn.platform, followers: n, captured_at: new Date() });
      report.followers = n === null ? 'indisponible' : 'ok';
    }
  } catch (e) {
    report.followers = (e as Error).message;
  }

  let posts: Awaited<ReturnType<NonNullable<typeof provider.listPosts>>> = [];
  try {
    if (provider.listPosts) {
      posts = await provider.listPosts(ctx);
      if (posts.length)
        await C.metrics.bulkWrite(
          posts.map((p) => ({
            updateOne: {
              filter: { connection_id: conn.id, remote_id: p.remoteId },
              update: {
                $set: {
                  user_id: conn.user_id,
                  platform: conn.platform,
                  caption: p.caption ?? null,
                  permalink: p.permalink ?? null,
                  media_type: p.mediaType ?? null,
                  published_at: p.publishedAt ?? null,
                  metrics: p.metrics,
                  fetched_at: new Date(),
                },
                $setOnInsert: { id: newId() },
              },
              upsert: true,
            },
          })),
        );
      report.posts = `${posts.length}`;
    }
  } catch (e) {
    report.posts = (e as Error).message;
    if ((e as any).status === 401) await markStatus(conn, 'expired', (e as Error).message);
  }

  try {
    if (provider.listComments) {
      const counts = await C.comments.aggregate([{ $match: { connection_id: conn.id } }, { $group: { _id: '$remote_media_id', n: { $sum: 1 } } }]).toArray();
      const comments = await provider.listComments(ctx, posts, Object.fromEntries(counts.map((x: any) => [x._id, x.n])));
      if (comments.length)
        // $setOnInsert uniquement: ne jamais écraser le statut de traitement d'un commentaire déjà connu.
        await C.comments.bulkWrite(
          comments.map((c) => ({
            updateOne: {
              filter: { connection_id: conn.id, remote_id: c.remoteId },
              update: {
                $setOnInsert: {
                  id: newId(),
                  user_id: conn.user_id,
                  platform: conn.platform,
                  remote_media_id: c.mediaId,
                  media_caption: c.mediaCaption ?? null,
                  media_url: c.mediaUrl ?? null,
                  author: c.author ?? null,
                  text: c.text,
                  commented_at: c.at ?? null,
                  status: 'pending',
                  reply_text: null,
                  replied_at: null,
                },
              },
              upsert: true,
            },
          })),
        );
      report.comments = `${comments.length}`;
    }
  } catch (e) {
    report.comments = (e as Error).message;
  }
  return report;
}

export async function syncUser(userId: string) {
  const out: Record<string, unknown> = {};
  for (const conn of await activeConnections(userId)) out[conn.platform] = await syncConnection(conn);
  return out;
}

export async function syncAll() {
  const ids = await C.connections.distinct('user_id', { status: 'active' });
  for (const userId of ids as string[]) {
    try { await syncUser(userId); } catch (e) { console.warn('syncAll:', (e as Error).message); }
  }
}
