import { httpJson } from '../http';

/** Suit `paging.next` de l'API Graph jusqu'au bout (plafonné par `maxPages` pour borner le coût). */
export async function fetchAll<T>(firstUrl: string, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = firstUrl;
  for (let i = 0; url && i < maxPages; i++) {
    const r: { data: { data: T[]; paging?: { next?: string } } } = await httpJson(url);
    out.push(...r.data.data);
    url = r.data.paging?.next;
  }
  return out;
}

/**
 * Faut-il (re)lire les commentaires de cette publication ? Toujours pour les 10 plus récentes (nouveaux commentaires),
 * et pour les plus anciennes dès que le nombre annoncé par le réseau diffère de ce qui est déjà enregistré.
 */
export const wantsComments = (p: { remoteId: string; metrics: Record<string, number> }, i: number, known: Record<string, number> = {}) =>
  (p.metrics.comments ?? 0) > 0 && (i < 10 || (known[p.remoteId] ?? 0) !== p.metrics.comments);
