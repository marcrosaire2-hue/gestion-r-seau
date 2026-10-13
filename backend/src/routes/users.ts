import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, requireAdmin, requireAuth, wrap } from '../auth';
import { C, logActivity, newId } from '../db';
import { ApiError } from '../http';
import { disconnect } from '../services/connections';

/** Gestion des utilisateurs: réservée aux administrateurs. Les comptes réseaux connectés sont communs à tous les utilisateurs. */
export const users = Router();
users.use(requireAuth, requireAdmin);

const username = z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,50}$/, 'Identifiant: 3 à 50 caractères (lettres, chiffres, . _ -).');
const password = z.string().min(10, 'Mot de passe: 10 caractères minimum.').max(200);

users.get(
  '/',
  wrap(async (_req, res) => {
    const rows = await C.users.find({}, { projection: { _id: 0, id: 1, username: 1, role: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray();
    res.json(rows.map((u) => ({ ...u, role: u.role ?? 'admin' })));
  }),
);

users.post(
  '/',
  wrap(async (req, res) => {
    const b = z.object({ username, password, role: z.enum(['admin', 'user']).default('user') }).parse(req.body);
    const doc = { id: newId(), username: b.username, role: b.role, password_hash: await hashPassword(b.password), created_at: new Date() };
    try {
      await C.users.insertOne({ ...doc });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ApiError('Cet identifiant existe déjà.', 409);
      throw e;
    }
    await logActivity(req.actorId, 'user.created', null, { username: doc.username, role: doc.role });
    res.status(201).json({ id: doc.id, username: doc.username, role: doc.role, created_at: doc.created_at });
  }),
);

/** Réinitialise le mot de passe d'un utilisateur. */
users.patch(
  '/:id/password',
  wrap(async (req, res) => {
    const b = z.object({ password }).parse(req.body);
    const r = await C.users.updateOne({ id: String(req.params.id) }, { $set: { password_hash: await hashPassword(b.password) } });
    if (!r.matchedCount) throw new ApiError('Utilisateur introuvable.', 404);
    await logActivity(req.actorId, 'user.password_reset', null, { user_id: String(req.params.id) });
    res.json({ ok: true });
  }),
);

/** Supprime un utilisateur et toutes ses données (comptes révoqués, statistiques, commentaires…). */
users.delete(
  '/:id',
  wrap(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.actorId) throw new ApiError('Vous ne pouvez pas supprimer votre propre compte.', 400);
    const target = await C.users.findOne({ id }, { projection: { _id: 0, username: 1 } });
    if (!target) throw new ApiError('Utilisateur introuvable.', 404);

    // Révocation des accès aux réseaux (quand l'API le permet) + données liées à chaque compte connecté
    for (const c of await C.connections.find({ user_id: id }, { projection: { _id: 0, id: 1 } }).toArray()) {
      try { await disconnect(id, c.id); } catch (e) { console.warn('suppression utilisateur, déconnexion:', (e as Error).message); }
    }
    await Promise.all([
      C.connections.deleteMany({ user_id: id }),
      C.posts.deleteMany({ user_id: id }),
      C.targets.deleteMany({ user_id: id }),
      C.comments.deleteMany({ user_id: id }),
      C.metrics.deleteMany({ user_id: id }),
      C.snapshots.deleteMany({ user_id: id }),
      C.oauthStates.deleteMany({ user_id: id }),
      C.activity.deleteMany({ user_id: id }),
    ]);
    await C.users.deleteOne({ id });
    await logActivity(req.actorId, 'user.deleted', null, { username: target.username });
    res.status(204).end();
  }),
);
