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
  const basis = platform === 'instagram' || platform === 'facebook' ? 'reach' : (platform === 'tiktok' || platform === 'youtube') ? 'views' : null;
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

      const curP = period(p, cur);
      const prevP = period(p, prev);
      const first = fol[0]?.followers ?? null;
      const last = fol.at(-1)?.followers ?? null;
      // Variations calculées ici (jamais par le modèle): null quand il n'y a pas de base de comparaison.
      const pct = (c: number | null, b: number | null) => (c !== null && b !== null && b > 0 ? Math.round(((c - b) / b) * 1000) / 10 : null);

      return {
        reseau: providers[p].label,
        connecte: connected.has(p),
        statistiques_disponibles_via_api: providers[p].capabilities.stats.status === 'available',
        periode_actuelle: curP,
        periode_precedente: prevP,
        variation_pct: {
          publications: pct(curP.publications, prevP.publications),
          interactions: pct(curP.interactions_total, prevP.interactions_total),
          vues: pct(curP.vues, prevP.vues),
          portee: pct(curP.portee, prevP.portee),
          abonnes: pct(last, first),
        },
        abonnes: { premier_releve: first, dernier_releve: last, nombre_releves: fol.length },
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

/** Tous les nombres présents dans les données envoyées au modèle. */
function collectNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collectNumbers(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectNumbers(x, out));
  return out;
}

/**
 * Garde-fou contre les chiffres inventés: renvoie les nombres cités dans la réponse qui n'existent pas dans les données
 * (à tolérance d'arrondi près). Les petits entiers (comptages, rangs) et les années sont ignorés.
 * Un chiffre listé ici est « à vérifier », pas forcément faux (le modèle a pu calculer une somme).
 */
export function unverifiedNumbers(text: string, context: unknown): string[] {
  const known = collectNumbers(context);
  const found = text.match(/\d+(?:[   ]\d{3})*(?:[.,]\d+)?/g) ?? [];
  const bad = new Set<string>();
  for (const raw of found) {
    const v = parseFloat(raw.replace(/[   ]/g, '').replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    if (Number.isInteger(v) && (v < 100 || (v >= 1990 && v <= 2100))) continue;
    const ok = known.some((k) => Math.abs(k - v) <= Math.max(0.1, Math.abs(k) * 0.02) || Math.abs(Math.abs(k) - v) <= Math.max(0.1, Math.abs(k) * 0.02));
    if (!ok) bad.add(raw.trim());
  }
  return [...bad].slice(0, 8);
}
