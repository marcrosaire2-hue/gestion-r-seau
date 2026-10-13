import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { C, WORKSPACE_ID } from './db';
import { env } from './env';
import { ApiError } from './http';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

declare module 'express-serve-static-core' {
  // userId: espace commun (propriétaire des données, identique pour tous); actorId: l'utilisateur réellement connecté.
  interface Request { userId: string; actorId: string }
}

/** Format: scrypt$<sel hex>$<hash hex>. Aucun mot de passe en clair n'est conservé. */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

export const signToken = (userId: string) => jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn: '7d', algorithm: 'HS256' });

/** Vérifie le JWT, puis que l'utilisateur existe encore (un compte supprimé perd son accès immédiatement). Pose req.userId. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new ApiError('Authentification requise.', 401);
    let sub: string | undefined;
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof payload !== 'string') sub = payload.sub;
    } catch {
      /* jeton invalide ou expiré: traité ci-dessous */
    }
    if (!sub) throw new ApiError('Session invalide ou expirée.', 401);
    const user = await C.users.findOne({ id: sub }, { projection: { _id: 0, id: 1 } });
    if (!user) throw new ApiError('Session invalide ou expirée.', 401);
    req.actorId = sub;
    req.userId = WORKSPACE_ID;
    next();
  } catch (e) {
    next(e);
  }
}

/** Réserve une route aux administrateurs (le rôle est relu en base: jamais lu dans le jeton). À placer après requireAuth. */
export async function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await C.users.findOne({ id: req.actorId }, { projection: { _id: 0, role: 1 } });
    if ((user?.role ?? 'admin') !== 'admin') throw new ApiError('Réservé aux administrateurs.', 403);
    next();
  } catch (e) {
    next(e);
  }
}

/** Enveloppe les handlers async pour que les erreurs atteignent le gestionnaire central. */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
