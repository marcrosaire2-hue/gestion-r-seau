import type { Platform } from './api'

export const PLATFORM_LIST: Platform[] = ['instagram', 'linkedin', 'tiktok', 'facebook', 'youtube']

export const PLATFORM_META: Record<Platform, { label: string; color: string; soft: string }> = {
  instagram: { label: 'Instagram', color: '#e1306c', soft: 'bg-pink-50 text-pink-700 ring-pink-200' },
  linkedin: { label: 'LinkedIn', color: '#0a66c2', soft: 'bg-sky-50 text-sky-700 ring-sky-200' },
  tiktok: { label: 'TikTok', color: '#111827', soft: 'bg-slate-100 text-slate-800 ring-slate-300' },
  facebook: { label: 'Facebook', color: '#1877f2', soft: 'bg-blue-50 text-blue-700 ring-blue-200' },
  youtube: { label: 'YouTube', color: '#ff0000', soft: 'bg-red-50 text-red-700 ring-red-200' },
}

export function Logo({ platform, size = 24 }: { platform: Platform; size?: number }) {
  const c = PLATFORM_META[platform].color
  const common = { width: size, height: size, viewBox: '0 0 24 24', role: 'img' as const, 'aria-label': PLATFORM_META[platform].label }
  switch (platform) {
    case 'instagram':
      return (
        <svg {...common} fill="none" stroke={c} strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.2" cy="6.8" r="1" fill={c} stroke="none" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="3" fill={c} />
          <path fill="#fff" d="M6.2 9.5h2.5V18H6.2zM7.45 5.8a1.45 1.45 0 1 1 0 2.9 1.45 1.45 0 0 1 0-2.9zM10.3 9.5h2.4v1.2c.4-.7 1.3-1.4 2.6-1.4 2.7 0 3.2 1.8 3.2 4V18h-2.5v-4c0-1 0-2.200-1.400-2.200s-1.600 1-1.600 2.100V18h-2.500z" />
        </svg>
      )
    case 'tiktok':
      return (
        <svg {...common} fill={c}>
          <path d="M16.6 3c.3 2.300 1.700 3.800 3.900 4v3.100a7.100 7.100 0 0 1-3.900-1.200v6.100a5.600 5.600 0 1 1-5.600-5.600c.3 0 .6 0 .9.100v3.200a2.500 2.500 0 1 0 1.600 2.300V3z" />
        </svg>
      )
    case 'youtube':
      return (
        <svg {...common}>
          <rect x="1.5" y="4.5" width="21" height="15" rx="4.5" fill={c} />
          <path fill="#fff" d="M10 8.8v6.4l5.500-3.200z" />
        </svg>
      )
    case 'facebook':
      return (
        <svg {...common}>
          <rect x="2" y="2" width="20" height="20" rx="4" fill={c} />
          <path fill="#fff" d="M15.2 21v-7.600h2.500l.4-3h-2.900V8.500c0-.9.300-1.400 1.500-1.400h1.500V4.400c-.3 0-1.200-.1-2.200-.1-2.200 0-3.700 1.300-3.700 3.800v2.300H9.800v3h2.500V21z" />
        </svg>
      )
  }
}
