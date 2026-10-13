import { httpJson } from '../http';

/** Suit `paging.next` de l'API Graph jusqu'à la dernière page (sans plafond; s'arrête si une page se répète). */
export async function fetchAll<T>(firstUrl: string): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  let url: string | undefined = firstUrl;
  while (url && !seen.has(url)) {
    seen.add(url);
    const r: { data: { data: T[]; paging?: { next?: string } } } = await httpJson(url);
    out.push(...r.data.data);
    url = r.data.paging?.next;
  }
  return out;
}

const lastDeep = new Map<string, number>();
/**
 * Les statistiques détaillées (portée, vues…) de TOUTES les publications sont relues une fois par heure;
 * entre-temps seules les plus récentes sont actualisées, pour ne pas dépasser les limites d'appels du réseau.
 */
export function deepInsights(accountId: string): boolean {
  const now = Date.now();
  if (now - (lastDeep.get(accountId) ?? 0) < 3_600_000) return false;
  lastDeep.set(accountId, now);
  return true;
}

/**
 * Faut-il (re)lire les commentaires de cette publication ? Toujours pour les 10 plus récentes (nouveaux commentaires),
 * et pour les plus anciennes dès que le nombre annoncé par le réseau diffère de ce qui est déjà enregistré.
 */
export const wantsComments = (p: { remoteId: string; metrics: Record<string, number> }, i: number, known: Record<string, number> = {}) =>
  (p.metrics.comments ?? 0) > 0 && (i < 10 || (known[p.remoteId] ?? 0) !== p.metrics.comments);
