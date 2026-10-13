import { Router } from 'express';
import { requireAuth, wrap } from '../auth';
import { C, NO_ID } from '../db';
import { PLATFORMS, providers, type Platform } from '../providers';

export const insights = Router();
insights.use(requireAuth);

const sum = (rows: { metrics: Record<string, number> }[], k: string) => {
  const vals = rows.map((r) => r.metrics[k]).filter((v): v is number => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null; // null = non fourni par l'API (≠ 0)
};

/** L'engagement n'est calculé qu'avec la base propre à chaque réseau; jamais comparé entre réseaux. */
function engagement(platform: Platform, rows: { metrics: Record<string, number> }[]) {
  const basisKey = (platform === 'instagram' || platform === 'facebook') ? 'reach' : (platform === 'tiktok' || platform === 'youtube') ? 'views' : null;
  if (!basisKey) return { rate: null, basis: null };
  const withBasis = rows.filter((r) => (r.metrics[basisKey] ?? 0) > 0);
  const base = sum(withBasis, basisKey);
  if (!base) return { rate: null, basis: basisKey };
  const inter = withBasis.reduce(
    (a, r) => a + (r.metrics.likes ?? 0) + (r.metrics.comments ?? 0) + (r.metrics.shares ?? 0) + (r.metrics.saved ?? 0),
    0,
  );
  return { rate: inter / base, basis: basisKey };
}

export const METRIC_HELP = {
  reach: 'Portée (Instagram): nombre de comptes uniques ayant vu la publication.',
  views: 'Vues: nombre de lectures/affichages. Définition différente selon le réseau (TikTok: lectures de la vidéo; Instagram: vues du média).',
  likes: 'J’aime / réactions: compteur total. Les personnes ne sont pas identifiables via l’API.',
  comments: 'Commentaires reçus.',
  shares: 'Partages.',
  saved: 'Enregistrements (Instagram).',
  engagement:
    'Taux d’engagement = (J’aime + commentaires + partages + enregistrements) / base du réseau. Base Instagram: portée. Base TikTok: vues. Ces taux ne sont pas comparables entre réseaux.',
};

const interactions = (m: Record<string, number>) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saved ?? 0);

insights.get(
  '/',
  wrap(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
    const now = Date.now();
    const curFrom = new Date(now - days * 86_400_000);
    const prevFrom = new Date(now - 2 * days * 86_400_000);

    const [metrics, snaps, conns] = await Promise.all([
      C.metrics.find({ user_id: req.userId, published_at: { $gte: prevFrom } }, NO_ID).toArray(),
      C.snapshots.find({ user_id: req.userId, captured_at: { $gte: curFrom } }, NO_ID).sort({ captured_at: 1 }).toArray(),
      C.connections.find({ user_id: req.userId }, { projection: { _id: 0, platform: 1, status: 1 } }).toArray(),
    ]);

    const perPlatform = PLATFORMS.map((p) => {
      const rows = metrics.filter((m) => m.platform === p) as any[];
      const cur = rows.filter((r) => new Date(r.published_at) >= curFrom);
      const prev = rows.filter((r) => new Date(r.published_at) < curFrom);
      const connected = conns.some((c) => c.platform === p && c.status === 'active');
      const series = snaps.filter((s) => s.platform === p && s.followers !== null);
      const period = (r: any[]) => ({
        posts: r.length,
        views: sum(r, 'views'),
        reach: sum(r, 'reach'),
        likes: sum(r, 'likes'),
        comments: sum(r, 'comments'),
        shares: sum(r, 'shares'),
        saved: sum(r, 'saved'),
        engagement: engagement(p, r),
      });
      return {
        platform: p,
        label: providers[p].label,
        connected,
        statsAvailable: providers[p].capabilities.stats.status === 'available',
        statsNote: providers[p].capabilities.stats.note,
        current: period(cur),
        previous: period(prev),
        followers: {
          latest: series.at(-1)?.followers ?? null,
          first: series[0]?.followers ?? null,
          series: series.map((s) => ({ at: s.captured_at, value: s.followers })),
        },
        top: [...cur]
          .map((r) => ({
            remote_id: r.remote_id,
            caption: r.caption,
            permalink: r.permalink,
            published_at: r.published_at,
            metrics: r.metrics,
            interactions: interactions(r.metrics),
          }))
          .sort((a, b) => b.interactions - a.interactions)
          .slice(0, 5),
      };
    });
    res.json({ days, help: METRIC_HELP, platforms: perPlatform });
  }),
);

insights.get(
  '/dashboard',
  wrap(async (req, res) => {
    const uid = req.userId;
    const [conns, posts, comments, activity, metrics] = await Promise.all([
      C.connections.find({ user_id: uid }, { projection: { _id: 0, platform: 1, account_name: 1, status: 1, last_error: 1 } }).toArray(),
      C.posts.find({ user_id: uid }, { projection: { _id: 0, status: 1, platforms: 1 } }).toArray(),
      C.comments.find({ user_id: uid }, { projection: { _id: 0, platform: 1, status: 1 } }).toArray(),
      C.activity.find({ user_id: uid }, NO_ID).sort({ created_at: -1 }).limit(30).toArray(),
      C.metrics.find({ user_id: uid }, { projection: { _id: 0, platform: 1, caption: 1, permalink: 1, published_at: 1, metrics: 1 } }).toArray(),
    ]);

    const byStatus = (s: string) => posts.filter((p) => p.status === s).length;
    const networks = PLATFORMS.map((p) => {
      const c = conns.filter((x) => x.platform === p);
      const active = c.find((x) => x.status === 'active');
      const m = metrics.filter((x) => x.platform === p) as any[];
      const cm = comments.filter((x) => x.platform === p);
      const caps = providers[p].capabilities;
      return {
        platform: p,
        label: providers[p].label,
        configured: providers[p].configured(),
        status: active ? 'connected' : c.some((x) => x.status === 'expired') ? 'expired' : 'disconnected',
        account: active?.account_name ?? null,
        lastError: c.find((x) => x.last_error)?.last_error ?? null,
        // null = métrique non fournie par l'API (afficher « indisponible », pas 0)
        remotePosts: caps.stats.status === 'available' || m.length ? m.length : null,
        likes: sum(m, 'likes'),
        pendingComments: caps.comments.status === 'available' ? cm.filter((x) => x.status === 'pending').length : null,
        commentsNote: caps.comments.status === 'available' ? null : caps.comments.note,
        messagesNote: caps.messages.note,
        publishedByUs: posts.filter((x) => x.status === 'published' && x.platforms.includes(p)).length,
        scheduledByUs: posts.filter((x) => x.status === 'scheduled' && x.platforms.includes(p)).length,
      };
    });

    const top = (metrics as any[])
      .map((r) => ({ platform: r.platform, caption: r.caption, permalink: r.permalink, published_at: r.published_at, interactions: interactions(r.metrics) }))
      .sort((a, b) => b.interactions - a.interactions)
      .slice(0, 5);

    res.json({
      networks,
      totals: {
        published: byStatus('published') + byStatus('partial'),
        scheduled: byStatus('scheduled'),
        drafts: byStatus('draft'),
        failed: byStatus('failed'),
        pendingComments: comments.filter((c) => c.status === 'pending').length,
      },
      activity,
      top,
    });
  }),
);

/** Interactions par période (semaines ou mois), d'après les publications synchronisées.
 *  Les périodes sans publication synchronisée valent 0 publication — pas de valeur estimée. */
insights.get(
  '/timeline',
  wrap(async (req, res) => {
    const bucket = req.query.bucket === 'month' ? 'month' : 'week';
    const now = new Date();
    const starts: Date[] = [];
    if (bucket === 'month') {
      for (let i = 5; i >= 0; i--) starts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    } else {
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      for (let i = 7; i >= 0; i--) starts.push(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - i * 7));
    }
    const q: Record<string, unknown> = { user_id: req.userId, published_at: { $gte: starts[0] } };
    const only = String(req.query.platform ?? '');
    if ((PLATFORMS as string[]).includes(only)) q.platform = only; // page d'un réseau: ne compter que ce réseau
    const rows = (await C.metrics.find(q, NO_ID).toArray()) as any[];
    const buckets = starts.map((start, i) => {
      const end = starts[i + 1] ?? new Date(now.getTime() + 86_400_000);
      const inRange = rows.filter((r) => r.published_at && new Date(r.published_at) >= start && new Date(r.published_at) < end);
      const byPlatform: Record<string, number> = {};
      for (const r of inRange) byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + interactions(r.metrics);
      return {
        start: start.toISOString(),
        end: end.toISOString(),
        label: bucket === 'month' ? start.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '') : `${start.getDate()}/${start.getMonth() + 1}`,
        interactions: inRange.reduce((a, r) => a + interactions(r.metrics), 0),
        posts: inRange.length,
        byPlatform,
      };
    });
    res.json({ bucket, total: buckets.reduce((a, b) => a + b.interactions, 0), buckets });
  }),
);

/** Publications suivies (comptes connectés) avec leurs résultats, sur une période: alimente le calendrier de suivi. */
insights.get(
  '/calendar',
  wrap(async (req, res) => {
    const from = new Date(String(req.query.from));
    const to = new Date(String(req.query.to));
    if (Number.isNaN(+from) || Number.isNaN(+to) || to < from) return res.status(400).json({ error: 'Période invalide.' });
    if (+to - +from > 100 * 86_400_000) return res.status(400).json({ error: 'Période trop longue (100 jours maximum).' });
    const q: Record<string, unknown> = { user_id: req.userId, published_at: { $gte: from, $lte: to } };
    const platform = String(req.query.platform ?? '');
    if ((PLATFORMS as string[]).includes(platform)) q.platform = platform;
    const rows = (await C.metrics.find(q, NO_ID).sort({ published_at: 1 }).limit(500).toArray()) as any[];
    res.json(
      rows.map((r) => ({
        platform: r.platform,
        remote_id: r.remote_id,
        caption: r.caption,
        permalink: r.permalink,
        media_type: r.media_type,
        published_at: r.published_at,
        metrics: r.metrics,
        interactions: interactions(r.metrics),
      })),
    );
  }),
);
