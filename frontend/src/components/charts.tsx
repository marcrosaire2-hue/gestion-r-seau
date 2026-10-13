import { useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { Platform } from '../lib/api'
import { PLATFORM_META } from '../lib/platforms'
import { fmtNum } from './ui'

export const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)

/** Pastille d'évolution; rien n'est affiché sans base de comparaison. */
export function Delta({ pct, onDark }: { pct: number | null; onDark?: boolean }) {
  if (pct === null) return null
  const up = pct >= 0
  const I = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${onDark ? 'bg-white text-emerald-700' : up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {up ? '+' : '−'}{Math.abs(pct).toFixed(1)}% <I size={12} />
    </span>
  )
}

/** Courbe d'abonnés (un relevé par synchronisation) */
export function FollowersChart({ series }: { series: { at: string; value: number }[] }) {
  if (series.length < 2) {
    return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">Pas encore assez de relevés.</p>
  }
  const vals = series.map((s) => s.value)
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const x = (i: number) => (i / (series.length - 1)) * 300
  const y = (v: number) => 12 + (1 - (v - min) / range) * 76
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ')
  return (
    <div>
      <svg viewBox="0 0 300 100" className="h-32 w-full" role="img" aria-label="Évolution du nombre d’abonnés" preserveAspectRatio="none">
        <defs>
          <linearGradient id="fol" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#0b7a43" stopOpacity="0.25" /><stop offset="100%" stopColor="#0b7a43" stopOpacity="0" /></linearGradient>
        </defs>
        <path d={`${line} L300,100 L0,100 Z`} fill="url(#fol)" />
        <path d={line} fill="none" stroke="#0b7a43" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-slate-400">
        <span>{format(new Date(series[0].at), 'd MMM', { locale: fr })} · {fmtNum(series[0].value)}</span>
        <span>{format(new Date(series[series.length - 1].at), 'd MMM', { locale: fr })} · {fmtNum(series[series.length - 1].value)}</span>
      </div>
    </div>
  )
}

export interface Timeline {
  bucket: 'week' | 'month'; total: number
  buckets: { start: string; end: string; label: string; interactions: number; posts: number; byPlatform: Record<string, number> }[]
}

/** Axe vertical « propre » (0, 10, 20…) */
function niceMax(v: number) {
  if (v <= 5) return 5
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / p) * p
}

/** Histogramme des interactions par période, avec infobulle au survol ou au focus. */
export function EngagementChart({ data, className = 'h-64' }: { data: Timeline; className?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.buckets.map((b) => b.interactions)))
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((t) => Math.round(max * t))
  const empty = data.buckets.every((b) => b.posts === 0)
  return (
    <div className={`relative mt-3 flex gap-3 ${className}`}>
      <div className="flex flex-col justify-between pb-6 text-xs text-slate-500" aria-hidden>
        {ticks.map((t) => <span key={t}>{fmtNum(t)}</span>)}
      </div>
      <div className="relative flex flex-1 items-end gap-2 sm:gap-4">
        {empty && (
          <p className="absolute inset-x-0 top-1/3 z-10 text-center text-sm text-slate-400">
            Aucune publication sur cette période.
          </p>
        )}
        {data.buckets.map((b, i) => {
          const h = max ? (b.interactions / max) * 100 : 0
          const active = hover === i
          const detail = Object.entries(b.byPlatform).filter(([, v]) => v > 0)
          return (
            <div key={b.start} className="flex h-full min-w-0 flex-1 flex-col items-center">
              <div className="relative w-full flex-1">
                <button
                  type="button"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${b.label}: ${b.interactions} interactions, ${b.posts} publication(s)`}
                  className="absolute inset-0 flex items-end rounded-t-lg focus-visible:outline-2"
                >
                  <span
                    style={{ height: `${Math.max(h, b.posts ? 3 : 1)}%` }}
                    className={`relative block w-full rounded-t-lg transition-colors ${active ? 'bg-gradient-to-b from-[#0b7a43] to-[#cfe6d8]' : 'bg-gradient-to-b from-[#cfe3d8] to-[#eef5f1]'}`}
                  >
                    {active && <span aria-hidden className="absolute bottom-0 left-1/2 h-full w-px bg-white/70" />}
                  </span>
                </button>
                {active && (
                  <div
                    role="tooltip"
                    style={{ bottom: `min(calc(${Math.max(h, 3)}% + 0.5rem), calc(100% - 9.5rem))` }}
                    className={`pointer-events-none absolute z-20 w-48 rounded-xl bg-neutral-900 p-3 text-xs text-white shadow-xl ${i < 2 ? 'left-0' : i > data.buckets.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}
                  >
                    <p className="mb-1.5 text-white/60">{format(new Date(b.start), 'd MMM', { locale: fr })} – {format(new Date(new Date(b.end).getTime() - 1), 'd MMM yyyy', { locale: fr })}</p>
                    <p className="flex justify-between"><span className="text-white/70">Interactions</span><span className="font-medium">{fmtNum(b.interactions)}</span></p>
                    <p className="flex justify-between"><span className="text-white/70">Publications</span><span className="font-medium">{b.posts}</span></p>
                    {detail.map(([p, v]) => <p key={p} className="flex justify-between"><span className="text-white/70">{PLATFORM_META[p as Platform].label}</span><span className="font-medium">{fmtNum(v)}</span></p>)}
                  </div>
                )}
              </div>
              <span className="mt-2 h-4 text-xs text-slate-500">{b.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
