import { providers, type MediaItem, type Platform } from '../providers';

export function textFor(content: string, perNetwork: Record<string, string> | undefined, platform: Platform) {
  const t = perNetwork?.[platform];
  return t && t.trim() ? t : content;
}

/** Vérifie le contenu contre les règles de la plateforme. Renvoie une liste d'erreurs lisibles. */
export function validateForPlatform(platform: Platform, text: string, media: MediaItem[]): string[] {
  const p = providers[platform];
  const errors: string[] = [];
  if (p.capabilities.publish.status === 'unavailable') {
    return [`${p.label}: publication impossible via l’API (${p.capabilities.publish.note})`];
  }
  if (text.length > p.rules.maxText) errors.push(`${p.label}: texte trop long (${text.length}/${p.rules.maxText}).`);
  if (p.rules.mediaRequired && media.length === 0) errors.push(`${p.label}: un média est obligatoire.`);
  if (media.length > p.rules.maxMedia) errors.push(`${p.label}: ${p.rules.maxMedia} média(s) maximum.`);
  for (const m of media) {
    if (!p.rules.media.includes(m.type)) errors.push(`${p.label}: les médias de type « ${m.type} » ne sont pas acceptés.`);
  }
  if (!text.trim() && media.length === 0) errors.push(`${p.label}: contenu vide.`);
  return errors;
}
