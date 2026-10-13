import { instagram } from './instagram';
import { linkedin } from './linkedin';
import { tiktok } from './tiktok';
import { facebook } from './facebook';
import { youtube } from './youtube';
import type { Platform, Provider } from './types';

export const providers: Record<Platform, Provider> = { instagram, linkedin, tiktok, facebook, youtube };
export const isPlatform = (s: string): s is Platform => s in providers;
export * from './types';
