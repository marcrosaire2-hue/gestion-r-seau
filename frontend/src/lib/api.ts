import { getToken, setToken } from './session'

const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '')

const token = async () => getToken() ?? undefined

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = await token()
  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const json = await res.json().catch(() => ({}))
  // Session expirée: retour à l'écran de connexion (sauf pendant la connexion elle-même).
  if (res.status === 401 && t && !path.startsWith('/auth/')) setToken(null)
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Erreur ${res.status}`)
  return json as T
}

export async function uploadMedia(file: File) {
  const t = await token()
  const res = await fetch(`${BASE}/api/media`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: file,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Erreur ${res.status}`)
  return json as { url: string; type: 'image' | 'video'; path: string }
}

// ---- Types partagés avec le backend ----
export type Platform = 'instagram' | 'linkedin' | 'tiktok' | 'facebook'
export type CapStatus = 'available' | 'requires_approval' | 'unavailable'
export interface Capability { status: CapStatus; note: string }
export type CapKey = 'publish' | 'schedule' | 'stats' | 'comments' | 'reply' | 'reactions' | 'messages'

export interface Account {
  id: string
  platform: Platform
  account_name: string | null
  avatar_url: string | null
  status: 'active' | 'expired' | 'error'
  last_error: string | null
  expires_at: string | null
}
export interface NetworkInfo {
  platform: Platform
  label: string
  configured: boolean
  setupHint: string
  capabilities: Record<CapKey, Capability>
  rules: { maxText: number; mediaRequired: boolean; media: ('image' | 'video')[]; maxMedia: number }
  accounts: Account[]
}
export interface Media { url: string; type: 'image' | 'video'; path?: string }
export interface Target {
  id: string
  platform: Platform
  status: 'pending' | 'publishing' | 'processing' | 'published' | 'failed'
  error: string | null
  remote_url: string | null
  attempts: number
}
export interface Post {
  id: string
  content: string
  per_network: Partial<Record<Platform, string>>
  media: Media[]
  platforms: Platform[]
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'partial' | 'failed'
  scheduled_at: string | null
  created_at: string
  post_targets: Target[]
}
export interface CommentRow {
  id: string
  platform: Platform
  author: string | null
  text: string
  remote_media_id?: string | null
  media_caption: string | null
  media_url: string | null
  commented_at: string | null
  status: 'pending' | 'replied' | 'done'
  reply_text: string | null
}
