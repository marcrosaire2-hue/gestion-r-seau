import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, wrap } from '../auth';
import { C, NO_ID, logActivity } from '../db';
import { ApiError } from '../http';
import { providers } from '../providers';
import { getConnection, getCtx } from '../services/connections';
import { syncUser } from '../services/sync';

export const comments = Router();
comments.use(requireAuth);

comments.get(
  '/',
  wrap(async (req, res) => {
    const { platform, status, from, to } = req.query as Record<string, string | undefined>;
    const q: Record<string, unknown> = { user_id: req.userId };
    if (platform) q.platform = String(platform);
    if (status) q.status = String(status);
    if (from || to) q.commented_at = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
    res.json(await C.comments.find(q, NO_ID).sort({ commented_at: -1 }).toArray());
  }),
);

comments.post(
  '/sync',
  wrap(async (req, res) => {
    res.json(await syncUser(req.userId));
  }),
);

async function ownComment(userId: string, id: string) {
  const c = await C.comments.findOne({ id, user_id: userId }, NO_ID);
  if (!c) throw new ApiError('Commentaire introuvable.', 404);
  return c;
}

/** Envoie la réponse sur le réseau. Le statut « replied » n'est posé qu'après succès de l'API. */
comments.post(
  '/:id/reply',
  wrap(async (req, res) => {
    const { text } = z.object({ text: z.string().trim().min(1).max(2200) }).parse(req.body);
    const c = await ownComment(req.userId, String(req.params.id));
    const provider = providers[c.platform as keyof typeof providers];
    if (!provider.reply) throw new ApiError(`${provider.label}: ${provider.capabilities.reply.note}`, 422);
    const conn = await getConnection(req.userId, c.connection_id);
    await provider.reply(await getCtx(conn), c.remote_id, text);
    await C.comments.updateOne({ id: c.id, user_id: req.userId }, { $set: { status: 'replied', reply_text: text, replied_at: new Date() } });
    await logActivity(req.userId, 'comment.replied', c.platform, { comment_id: c.id });
    res.json({ ok: true });
  }),
);

comments.post(
  '/:id/done',
  wrap(async (req, res) => {
    const c = await ownComment(req.userId, String(req.params.id));
    await C.comments.updateOne({ id: c.id, user_id: req.userId }, { $set: { status: 'done' } });
    await logActivity(req.userId, 'comment.done', c.platform, { comment_id: c.id });
    res.json({ ok: true });
  }),
);

comments.post(
  '/:id/reopen',
  wrap(async (req, res) => {
    const c = await ownComment(req.userId, String(req.params.id));
    await C.comments.updateOne({ id: c.id, user_id: req.userId }, { $set: { status: c.reply_text ? 'replied' : 'pending' } });
    res.json({ ok: true });
  }),
);
