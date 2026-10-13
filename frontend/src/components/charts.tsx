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
export function FollowersChart({ series, className = 'h-32' }: { series: { at: string; value: number }[]; className?: string }) {
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
      <svg viewBox="0 0 300 100" className={`${className} w-full`} role="img" aria-label="Évolution du nombre d’abonnés" preserveAspectRatio="none">
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
      <div className="-mt-2 mb-4 flex flex-col justify-between text-xs leading-4 text-slate-500" aria-hidden>
        {ticks.map((t, i) => <span key={i}>{fmtNum(t)}</span>)}
      </div>
      <div className="relative flex flex-1 items-end gap-2 sm:gap-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between" aria-hidden>
          {ticks.map((_, i) => <span key={i} className="block h-px w-full bg-slate-100" />)}
        </div>
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
                    className={`relative block w-full rounded-t-lg transition-colors ${active ? 'bg-gradient-to-b from-[#0b7a43] to-[#8fd0ae]' : 'bg-gradient-to-b from-[#3fb57b] to-[#d6efe2]'}`}
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

/** Mini-courbe (tendance), affichée seulement avec au moins deux points. */
export function Spark({ values, className = 'h-8 w-20', color = '#0b7a43' }: { values: number[]; className?: string; color?: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(26 - ((v - min) / range) * 22).toFixed(1)}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Anneau de progression (0–100). */
export function Ring({ pct, size = 44, color = '#0b7a43', stroke = 5, children }: { pct: number; size?: number; color?: string; stroke?: number; children?: React.ReactNode }) {
  const r = 18, circ = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct))
  return (
    <span className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 44 44" width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(p / 100) * circ} ${circ}`} />
      </svg>
      <span className="absolute text-[10px] font-semibold text-slate-700">{children}</span>
    </span>
  )
}

/** Évolution en texte (flèche + pourcentage); rien sans base de comparaison. */
export function DeltaText({ pct }: { pct: number | null }) {
  if (pct === null) return null
  const up = pct >= 0
  const I = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
      <I size={13} />{up ? '+' : '−'}{Math.abs(pct).toFixed(1).replace('.', ',')}%
    </span>
  )
}

/** Courbe d'abonnés avec axes, grille et point final; remplit la hauteur disponible. */
export function FollowersArea({ series, className = 'h-full' }: { series: { at: string; value: number }[]; className?: string }) {
  if (series.length < 2) {
    return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">Pas encore assez de relevés.</p>
  }
  const vals = series.map((s) => s.value)
  const min = Math.min(...vals), max = Math.max(...vals)
  const pad = (max - min) * 0.15 || Math.max(1, max * 0.02)
  const lo = min - pad, hi = max + pad
  const pos = (v: number) => (1 - (v - lo) / (hi - lo)) * 100
  const t0 = new Date(series[0].at).getTime(), t1 = new Date(series[series.length - 1].at).getTime()
  const x = (at: string) => (t1 === t0 ? 0 : ((new Date(at).getTime() - t0) / (t1 - t0)) * 100)
  const pts = series.map((s) => `${x(s.at).toFixed(2)},${pos(s.value).toFixed(2)}`)
  const line = `M${pts.join(' L')}`
  const yTicks = [0, 1, 2, 3].map((i) => Math.round(hi - ((hi - lo) * i) / 3))
  const xTicks = [0, 1, 2, 3].map((i) => new Date(t0 + ((t1 - t0) * i) / 3))
  const last = series[series.length - 1]
  return (
    <div className={`flex flex-col ${className}`} role="img" aria-label="Évolution du nombre d’abonnés">
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="-my-2 flex flex-col justify-between text-xs leading-4 text-slate-500" aria-hidden>
          {yTicks.map((t, i) => <span key={i}>{fmtNum(t)}</span>)}
        </div>
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between" aria-hidden>
            {yTicks.map((_, i) => <span key={i} className="block h-px w-full bg-slate-100" />)}
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="folArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#10b36a" stopOpacity="0.28" /><stop offset="100%" stopColor="#10b36a" stopOpacity="0.02" /></linearGradient>
            </defs>
            <path d={`${line} L100,100 L0,100 Z`} fill="url(#folArea)" />
            <path d={line} fill="none" stroke="#10b36a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          <span aria-hidden className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-600 ring-2 ring-white" style={{ left: `${x(last.at)}%`, top: `${pos(last.value)}%` }} />
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-10 text-[11px] text-slate-500" aria-hidden>
        {xTicks.map((d, i) => <span key={i}>{format(d, 'd MMM', { locale: fr })}</span>)}
      </div>
    </div>
  )
}
