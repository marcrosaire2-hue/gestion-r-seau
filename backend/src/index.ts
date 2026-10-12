import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { initDb } from './db';
import { env } from './env';
import { ApiError } from './http';
import { ai } from './routes/ai';
import { auth } from './routes/auth';
import { comments } from './routes/comments';
import { connections, oauthCallback } from './routes/connections';
import { insights } from './routes/insights';
import { media, mediaStatic } from './routes/media';
import { posts } from './routes/posts';
import { users } from './routes/users';
import { startScheduler } from './services/scheduler';

const app = express();
app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        // Les photos de profil des réseaux (Facebook, Instagram…) viennent de leurs propres serveurs HTTPS.
        'img-src': ["'self'", 'data:', 'https:'],
        'media-src': ["'self'", 'https:'],
      },
    },
  }),
);
app.use(cors({ origin: env.FRONTEND_URL }));
app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/media', mediaStatic); // lecture publique des médias (requis par Instagram / TikTok)
app.use('/api/oauth', oauthCallback);

// Le téléversement lit un corps binaire brut: il doit passer avant express.json().
app.use('/api/media', media);
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth', auth);
app.use('/api/connections', connections);
app.use('/api/posts', posts);
app.use('/api/users', users);
app.use('/api/comments', comments);
app.use('/api/insights', insights);
app.use('/api/ai', rateLimit({ windowMs: 60_000, limit: 20 }), ai);

// En production, le même service sert le site (frontend/dist): une seule adresse, pas de CORS.
const dist = fileURLToPath(new URL('../../frontend/dist', import.meta.url));
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }));
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.setHeader('Cache-Control', 'no-cache'); // index.html doit toujours être revalidé après un déploiement
    res.sendFile(path.join(dist, 'index.html'));
  });
  console.log('Site servi depuis', dist);
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError)
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (err instanceof ApiError) return res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
  if ((err as { status?: number }).status === 404) return res.status(404).json({ error: 'Introuvable.' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

initDb()
  .then(() =>
    app.listen(env.PORT, () => {
      console.log(`API sur http://localhost:${env.PORT}`);
      startScheduler();
    }),
  )
  .catch((e) => {
    console.error('Impossible de se connecter à MongoDB:', (e as Error).message);
    console.error('Vérifiez MONGODB_URI et, dans Atlas, Network Access (autoriser votre IP).');
    process.exit(1);
  });
