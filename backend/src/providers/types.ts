export type Platform = 'instagram' | 'linkedin' | 'tiktok' | 'facebook';
export const PLATFORMS: Platform[] = ['instagram', 'linkedin', 'tiktok', 'facebook'];

export type CapKey = 'publish' | 'schedule' | 'stats' | 'comments' | 'reply' | 'reactions' | 'messages';
export type CapStatus = 'available' | 'requires_approval' | 'unavailable';
export interface Capability { status: CapStatus; note: string }

export interface MediaItem { url: string; type: 'image' | 'video'; path?: string }

export interface Ctx {
  accessToken: string;
  accountId: string;
  meta: Record<string, any>;
}

export interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
  /** Identifiant renvoyé par l'échange de jeton (open_id TikTok, user_id Instagram…) */
  accountId?: string;
}

export interface Profile {
  accountId: string;
  name: string;
  avatarUrl?: string;
  meta?: Record<string, any>;
}

export interface RemotePost {
  remoteId: string;
  caption?: string;
  permalink?: string;
  mediaType?: string;
  publishedAt?: Date;
  metrics: Record<string, number>;
}

export interface RemoteComment {
  remoteId: string;
  mediaId: string;
  mediaCaption?: string;
  mediaUrl?: string;
  author?: string;
  text: string;
  at?: Date;
}

export interface PublishResult {
  remoteId: string;
  url?: string;
  /** 'processing' : accepté par la plateforme mais pas encore confirmé publié */
  state: 'published' | 'processing';
}

/** Un compte que l'utilisateur peut choisir (ex.: une Page Facebook parmi celles qu'il administre). */
export interface AccountOption {
  id: string;
  name: string;
  avatarUrl?: string;
  accessToken: string;
  scopes?: string[];
}

export interface Provider {
  id: Platform;
  label: string;
  capabilities: Record<CapKey, Capability>;
  /** Limites de contenu utilisées pour la validation */
  rules: { maxText: number; mediaRequired: boolean; media: ('image' | 'video')[]; maxMedia: number };
  configured(): boolean;
  /** Explique quoi faire quand l'app n'est pas configurée */
  setupHint: string;
  authUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<TokenResult>;
  /** Si présent: la connexion donne accès à PLUSIEURS comptes et l'utilisateur doit en choisir un. */
  listAccounts?(code: string, redirectUri: string): Promise<AccountOption[]>;
  profile(accessToken: string, token: TokenResult): Promise<Profile>;
  refresh?(refreshOrAccessToken: string): Promise<TokenResult>;
  revoke?(accessToken: string): Promise<void>;
  publish?(ctx: Ctx, text: string, media: MediaItem[]): Promise<PublishResult>;
  checkPublish?(ctx: Ctx, remoteId: string): Promise<{ state: 'published' | 'processing' | 'failed'; error?: string }>;
  followers?(ctx: Ctx): Promise<number | null>;
  listPosts?(ctx: Ctx): Promise<RemotePost[]>;
  listComments?(ctx: Ctx, posts: RemotePost[]): Promise<RemoteComment[]>;
  reply?(ctx: Ctx, commentRemoteId: string, text: string): Promise<void>;
}
