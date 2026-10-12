import { C, NO_ID } from '../db';
import { providers, type Platform } from '../providers';

type Metrics = Record<string, number>;
interface Row { platform: Platform; caption: string | null; published_at: Date | null; media_type: string | null; metrics: Metrics }

const inter = (m: Metrics) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saved ?? 0);
const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Somme d'une métrique; null si aucune publication ne la fournit (≠ 0). */
const sumK = (rows: Row[], k: string) => {
  const v = rows.map((r) => r.metrics[k]).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
};

function period(platform: Platform, rows: Row[]) {
  // Base du taux d'engagement propre à chaque réseau (jamais comparée entre réseaux)
  const basis = platform === 'instagram' || platform === 'facebook' ? 'reach' : platform === 'tiktok' ? 'views' : null;
  const withBasis = basis ? rows.filter((r) => (r.metrics[basis] ?? 0) > 0) : [];
  const base = basis ? sumK(withBasis, basis) : null;
  const rate = base ? (withBasis.reduce((a, r) => a + inter(r.metrics), 0) / base) * 100 : null;
  return {
    publications: rows.length,
    vues: sumK(rows, 'views'),
    portee: sumK(rows, 'reach'),
    jaime_reactions: sumK(rows, 'likes'),
    commentaires: sumK(rows, 'comments'),
    partages: sumK(rows, 'shares'),
    enregistrements: sumK(rows, 'saved'),
    interactions_total: rows.length ? rows.reduce((a, r) => a + inter(r.metrics), 0) : null,
    taux_engagement_pct: rate === null ? null : Math.round(rate * 100) / 100,
    base_taux_engagement: rate === null ? null : basis === 'reach' ? 'portée' : 'vues',
  };
}

const brief = (r: Row) => ({
  date: r.published_at ? new Date(r.published_at).toISOString().slice(0, 10) : null,
  type: r.media_type,
  legende: (r.caption ?? '').replace(/\s+/g, ' ').slice(0, 110),
  interactions: inter(r.metrics),
  metriques: r.metrics,
});

/** Données réelles synchronisées, mises en forme pour l'analyse. Rien n'est estimé ni inventé. */
export async function buildContext(userId: string, days: number, focus?: Platform) {
  const now = Date.now();
  const curFrom = new Date(now - days * 86_400_000);
  const prevFrom = new Date(now - 2 * days * 86_400_000);

  const q: Record<string, unknown> = { user_id: userId, published_at: { $gte: prevFrom } };
  if (focus) q.platform = focus;
  const rows = (await C.metrics.find(q, NO_ID).toArray()) as unknown as Row[];

  const sq: Record<string, unknown> = { user_id: userId, captured_at: { $gte: curFrom } };
  if (focus) sq.platform = focus;
  const snaps = await C.snapshots.find(sq, NO_ID).sort({ captured_at: 1 }).toArray();

  const active = await C.connections.find({ user_id: userId, status: 'active' }, { projection: { _id: 0, platform: 1 } }).toArray();
  const connected = new Set(active.map((c) => c.platform as string));

  const platforms = (Object.keys(providers) as Platform[])
    .filter((p) => !focus || p === focus)
    .map((p) => {
      const mine = rows.filter((r) => r.platform === p);
      const cur = mine.filter((r) => r.published_at && new Date(r.published_at) >= curFrom);
      const prev = mine.filter((r) => r.published_at && new Date(r.published_at) < curFrom);
      const fol = snaps.filter((s) => s.platform === p && typeof s.followers === 'number');

      const ranked = [...cur].sort((a, b) => inter(b.metrics) - inter(a.metrics));
      const byDay: Record<string, { publications: number; interactions_moyennes: number }> = {};
      for (const r of mine) {
        if (!r.published_at) continue;
        const d = DAYS_FR[new Date(r.published_at).getDay()];
        const e = (byDay[d] ??= { publications: 0, interactions_moyennes: 0 });
        e.interactions_moyennes = (e.interactions_moyennes * e.publications + inter(r.metrics)) / (e.publications + 1);
        e.publications += 1;
      }
      for (const e of Object.values(byDay)) e.interactions_moyennes = Math.round(e.interactions_moyennes);
      const byType: Record<string, { publications: number; interactions_moyennes: number }> = {};
      for (const r of mine) {
        const t = r.media_type ?? 'inconnu';
        const e = (byType[t] ??= { publications: 0, interactions_moyennes: 0 });
        e.interactions_moyennes = (e.interactions_moyennes * e.publications + inter(r.metrics)) / (e.publications + 1);
        e.publications += 1;
      }
      for (const e of Object.values(byType)) e.interactions_moyennes = Math.round(e.interactions_moyennes);

      return {
        reseau: providers[p].label,
        connecte: connected.has(p),
        statistiques_disponibles_via_api: providers[p].capabilities.stats.status === 'available',
        periode_actuelle: period(p, cur),
        periode_precedente: period(p, prev),
        abonnes: { premier_releve: fol[0]?.followers ?? null, dernier_releve: fol.at(-1)?.followers ?? null, nombre_releves: fol.length },
        meilleures_publications: ranked.slice(0, 3).map(brief),
        moins_bonnes_publications: ranked.length > 3 ? ranked.slice(-3).reverse().map(brief) : [],
        par_jour_de_semaine: byDay,
        par_type_de_contenu: byType,
      };
    })
    .filter((p) => p.connecte || p.periode_actuelle.publications > 0 || p.periode_precedente.publications > 0);

  const totalPosts = platforms.reduce((a, p) => a + p.periode_actuelle.publications + p.periode_precedente.publications, 0);
  return { totalPosts, platforms, context: { periode_jours: days, fuseau: 'heure du serveur', reseaux: platforms } };
}
