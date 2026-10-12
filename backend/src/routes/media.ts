import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { requireAuth, wrap } from '../auth';
import { logActivity } from '../db';
import { env } from '../env';
import { ApiError } from '../http';

export const UPLOAD_ROOT = path.resolve(env.UPLOAD_DIR);

const ALLOWED: Record<string, { ext: string; type: 'image' | 'video' }> = {
  'image/jpeg': { ext: 'jpg', type: 'image' },
  'image/png': { ext: 'png', type: 'image' },
  'video/mp4': { ext: 'mp4', type: 'video' },
  'video/quicktime': { ext: 'mov', type: 'video' },
};

/** Téléversement (API authentifiée). Corps binaire brut: le Content-Type donne le type. Limite 100 Mo. */
export const media = Router();
media.post(
  '/',
  requireAuth,
  express.raw({ type: Object.keys(ALLOWED), limit: '100mb' }),
  wrap(async (req, res) => {
    const mime = (req.headers['content-type'] ?? '').split(';')[0];
    const spec = ALLOWED[mime];
    if (!spec) throw new ApiError('Format non accepté (JPEG, PNG, MP4, MOV).', 415);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ApiError('Fichier vide.', 400);
    const name = `${crypto.randomUUID()}.${spec.ext}`; // nom serveur: jamais celui du client
    const dir = path.join(UPLOAD_ROOT, req.userId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), req.body);
    const url = `${env.PUBLIC_API_URL.replace(/\/$/, '')}/media/${req.userId}/${name}`;
    await logActivity(req.userId, 'media.uploaded', null, { name, bytes: req.body.length });
    res.status(201).json({ url, type: spec.type, path: `${req.userId}/${name}` });
  }),
);

/** Lecture publique des médias: Instagram et TikTok doivent pouvoir les télécharger sans authentification.
 *  Les noms sont des UUID non devinables; le dossier ne liste rien (index désactivé). */
export const mediaStatic = express.static(UPLOAD_ROOT, {
  index: false,
  dotfiles: 'deny',
  redirect: false,
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // sinon helmet bloque l'aperçu depuis le frontend
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
});
