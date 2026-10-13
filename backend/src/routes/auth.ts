import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, signToken, verifyPassword, wrap } from '../auth';
import { C } from '../db';
import { ApiError } from '../http';

export const auth = Router();

// Freine le devinage de mots de passe.
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });

const creds = z.object({
  username: z.string().trim().toLowerCase().min(1).max(100),
  password: z.string().min(1).max(200),
});

/** Pas d'inscription publique: les comptes se créent par `npm run create-user`. */
auth.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const { username, password } = creds.parse(req.body);
    const user = await C.users.findOne({ username });
    // Même message que l'identifiant existe ou non, pour ne pas révéler les comptes.
    if (!user || !(await verifyPassword(password, user.password_hash))) throw new ApiError('Identifiant ou mot de passe incorrect.', 401);
    res.json({ token: signToken(user.id), username: user.username, role: user.role ?? 'admin' });
  }),
);

/** Qui suis-je ? (le rôle sert à afficher le menu; chaque route sensible revérifie le rôle côté serveur) */
auth.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const u = await C.users.findOne({ id: req.actorId }, { projection: { _id: 0, username: 1, role: 1 } });
    res.json({ username: u?.username, role: u?.role ?? 'admin' });
  }),
);
