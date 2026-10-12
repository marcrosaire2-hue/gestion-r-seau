import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addDays, addMonths, addWeeks, eachDayOfInterval, endOfDay, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek,
} from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, Heart, Trophy, X } from 'lucide-react'
import { api, type NetworkInfo, type Platform } from '../lib/api'
import { Logo, PLATFORM_LIST, PLATFORM_META } from '../lib/platforms'
import { ErrorBox, PlatformTag, Spinner, fmtNum, useFetch } from '../components/ui'

interface Item {
  platform: Platform; remote_id: string; caption: string | null; permalink: string | null; media_type: string | null
  published_at: string; metrics: Record<string, number>; interactions: number
}
type View = 'month' | 'week' | 'day'

const METRICS: [string, string][] = [['views', 'Vues'], ['reach', 'Portée'], ['likes', 'J’aime / réactions'], ['comments', 'Commentaires'], ['shares', 'Partages'], ['saved', 'Enregistrements']]
const TYPE: Record<string, string> = { IMAGE: 'Photo', VIDEO: 'Vidéo', CAROUSEL_ALBUM: 'Carrousel', REELS: 'Reel', POST: 'Publication' }
const key = (d: Date) => format(d, 'yyyy-MM-dd')

export default function Calendar() {
  const [view, setView] = useState<View>('month')
  const [cursor, setCursor] = useState(new Date())
  const [net, setNet] = useState<Platform | ''>('')
  const [openDay, setOpenDay] = useState<Date | null>(null)

  // Période affichée (la grille du mois déborde sur les semaines voisines)
  const range = useMemo(() => {
    if (view === 'month') return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) }
    if (view === 'week') return { from: startOfWeek(cursor, { weekStartsOn: 1 }), to: endOfWeek(cursor, { weekStartsOn: 1 }) }
    return { from: cursor, to: cursor }
  }, [view, cursor])
  const period = useMemo(() => {
    if (view === 'month') return { from: startOfMonth(cursor), to: endOfMonth(cursor) }
    return range
  }, [view, cursor, range])
  const days = eachDayOfInterval({ start: range.from, end: range.to })

  const from = new Date(range.from); from.setHours(0, 0, 0, 0)
  const to = endOfDay(range.to)
  const { data, error, loading, reload } = useFetch(
    () => api<Item[]>(`/insights/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${net ? `&platform=${net}` : ''}`),
    [from.getTime(), to.getTime(), net],
  )
  const { data: nets } = useFetch(() => api<NetworkInfo[]>('/connections'))

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>()
    for (const it of data ?? []) {
      const k = key(new Date(it.published_at))
      m.set(k, [...(m.get(k) ?? []), it])
    }
    return m
  }, [data])

  const inPeriod = useMemo(() => (data ?? []).filter((i) => { const d = new Date(i.published_at); return d >= startOfDayLocal(period.from) && d <= endOfDay(period.to) }), [data, period])
  const total = inPeriod.reduce((a, i) => a + i.interactions, 0)
  const best = useMemo(() => {
    const sums = new Map<string, number>()
    for (const i of inPeriod) { const k = key(new Date(i.published_at)); sums.set(k, (sums.get(k) ?? 0) + i.interactions) }
    return [...sums.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  }, [inPeriod])
  const maxDay = useMemo(() => Math.max(1, ...days.map((d) => (byDay.get(key(d)) ?? []).reduce((a, i) => a + i.interactions, 0))), [days, byDay])

  const step = (n: number) => setCursor((c) => (view === 'month' ? addMonths(c, n) : view === 'week' ? addWeeks(c, n) : addDays(c, n)))
  const title = view === 'day' ? format(cursor, 'EEEE d MMMM yyyy', { locale: fr }) : view === 'week' ? `Semaine du ${format(range.from, 'd MMM', { locale: fr })} au ${format(range.to, 'd MMM yyyy', { locale: fr })}` : format(cursor, 'MMMM yyyy', { locale: fr })
  const noStats = (nets ?? []).filter((n) => !n.accounts.some((a) => a.status === 'active') || n.capabilities.stats.status !== 'available')

  const Chip = ({ it }: { it: Item }) => (
    <span className="flex w-full items-center gap-1 truncate rounded-md bg-white/90 px-1.5 py-0.5 text-left text-[11px] ring-1 ring-slate-200">
      <Logo platform={it.platform} size={11} />
      <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-slate-800"><Heart size={9} className="text-rose-500" />{fmtNum(it.interactions)}</span>
      <span className="truncate text-slate-500">{it.caption || TYPE[it.media_type ?? ''] || 'Publication'}</span>
    </span>
  )

  const openItems = openDay ? byDay.get(key(openDay)) ?? [] : []

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Calendrier de suivi</h1>
        <p className="max-w-3xl text-sm text-slate-500">Vos publications réelles, jour par jour, avec leurs résultats. La teinte d’une journée est proportionnelle à ses interactions.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button aria-label="Précédent" onClick={() => step(-1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50"><ChevronLeft size={16} /></button>
        <button onClick={() => setCursor(new Date())} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50">Aujourd’hui</button>
        <button aria-label="Suivant" onClick={() => step(1)} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50"><ChevronRight size={16} /></button>
        <h2 className="mx-2 text-lg font-semibold capitalize">{title}</h2>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="flex rounded-xl bg-slate-200/70 p-0.5" role="group" aria-label="Vue">
            {(['month', 'week', 'day'] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-[0.6rem] px-3 py-1.5 text-sm font-medium ${view === v ? 'bg-white shadow-sm' : 'text-slate-600'}`}>{{ month: 'Mois', week: 'Semaine', day: 'Jour' }[v]}</button>
            ))}
          </div>
          <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Filtrer par réseau" value={net} onChange={(e) => setNet(e.target.value as Platform | '')}>
            <option value="">Tous les réseaux</option>
            {PLATFORM_LIST.map((p) => <option key={p} value={p}>{PLATFORM_META[p].label}</option>)}
          </select>
        </div>
      </div>

      {/* Bilan de la période affichée */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-2xl font-semibold tracking-tight">{fmtNum(inPeriod.length)}</p><p className="text-xs text-slate-500">Publications</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><p className="text-2xl font-semibold tracking-tight">{inPeriod.length ? fmtNum(total) : '—'}</p><p className="text-xs text-slate-500">Interactions</p></div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <p className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight">{best ? <><Trophy size={18} className="text-amber-500" />{format(new Date(best[0] + 'T12:00'), 'd MMM', { locale: fr })}</> : '—'}</p>
          <p className="text-xs text-slate-500">{best ? `Meilleur jour · ${fmtNum(best[1])} interactions` : 'Meilleur jour'}</p>
        </div>
      </div>

      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {view === 'month' ? (
            <div className="overflow-x-auto">
              <div className="grid min-w-[44rem] grid-cols-7 text-sm">
                {['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => <div key={d} className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-500">{d}</div>)}
                {days.map((d) => {
                  const items = byDay.get(key(d)) ?? []
                  const sum = items.reduce((a, i) => a + i.interactions, 0)
                  const inMonth = isSameMonth(d, cursor)
                  return (
                    <button
                      key={d.toISOString()}
                      onClick={() => items.length && setOpenDay(d)}
                      disabled={!items.length}
                      aria-label={`${format(d, 'd MMMM', { locale: fr })}: ${items.length} publication(s), ${sum} interactions`}
                      style={items.length ? { backgroundColor: `rgba(11,122,67,${0.06 + 0.24 * (sum / maxDay)})` } : undefined}
                      className={`flex min-h-28 flex-col items-stretch gap-1 border-r border-b border-slate-100 p-1.5 text-left transition ${items.length ? 'cursor-pointer hover:ring-2 hover:ring-brand-600 hover:ring-inset' : 'cursor-default'} ${inMonth ? '' : 'opacity-45'}`}
                    >
                      <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${isSameDay(d, new Date()) ? 'bg-brand-600 font-semibold text-white' : 'text-slate-600'}`}>{format(d, 'd')}</span>
                      {items.slice(0, 3).map((it) => <Chip key={it.platform + it.remote_id} it={it} />)}
                      {items.length > 3 && <span className="px-1 text-[11px] font-medium text-brand-700">+ {items.length - 3} autre(s)</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className={`grid ${view === 'week' ? 'min-w-[44rem] grid-cols-7' : 'grid-cols-1'} overflow-x-auto`}>
              {days.map((d) => {
                const items = byDay.get(key(d)) ?? []
                return (
                  <div key={d.toISOString()} className="min-h-72 border-r border-slate-100 p-2">
                    <p className={`mb-2 text-xs font-medium capitalize ${isSameDay(d, new Date()) ? 'text-brand-700' : 'text-slate-500'}`}>{format(d, 'EEE d MMM', { locale: fr })}</p>
                    <div className="space-y-2">
                      {items.map((it) => (
                        <button key={it.platform + it.remote_id} onClick={() => setOpenDay(d)} className="block w-full rounded-xl border border-slate-200 bg-slate-50/60 p-2 text-left hover:border-brand-600">
                          <span className="mb-1 flex items-center justify-between text-[11px] text-slate-500"><Logo platform={it.platform} size={13} />{format(new Date(it.published_at), 'HH:mm')}</span>
                          <span className="line-clamp-2 text-xs text-slate-700">{it.caption || TYPE[it.media_type ?? ''] || 'Publication'}</span>
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold"><Heart size={11} className="text-rose-500" />{fmtNum(it.interactions)}</span>
                        </button>
                      ))}
                      {items.length === 0 && <p className="text-xs text-slate-300">Aucune publication</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {data && inPeriod.length === 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
          <CalendarDays size={20} className="mt-0.5 shrink-0 text-slate-400" />
          <p>Aucune publication suivie sur cette période. Connectez vos comptes dans <Link to="/networks" className="font-medium text-brand-700 hover:underline">Mes réseaux</Link> puis cliquez sur « Actualiser » dans le tableau de bord. Seules les publications récentes de chaque compte sont synchronisées.</p>
        </div>
      )}

      {noStats.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">
          Non suivis : {noStats.map((n) => `${n.label} (${n.accounts.some((a) => a.status === 'active') ? 'statistiques non fournies par l’API' : 'non connecté'})`).join(' · ')}.
        </p>
      )}

      {/* Détail d'une journée */}
      {openDay && (
        <div role="dialog" aria-modal="true" aria-label={`Publications du ${format(openDay, 'd MMMM', { locale: fr })}`} className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4" onClick={() => setOpenDay(null)}>
          <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <div>
                <h3 className="text-lg font-semibold capitalize">{format(openDay, 'EEEE d MMMM yyyy', { locale: fr })}</h3>
                <p className="text-sm text-slate-500">{openItems.length} publication(s) · {fmtNum(openItems.reduce((a, i) => a + i.interactions, 0))} interactions</p>
              </div>
              <button onClick={() => setOpenDay(null)} aria-label="Fermer" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-slate-100"><X size={18} /></button>
            </div>
            <ul className="space-y-4 overflow-y-auto p-5">
              {openItems.length === 0 && <li className="text-sm text-slate-500">Aucune publication ce jour-là.</li>}
              {openItems.map((it) => (
                <li key={it.platform + it.remote_id} className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <PlatformTag platform={it.platform} />
                    <span>{format(new Date(it.published_at), 'HH:mm')}</span>
                    {it.media_type && <span className="rounded-full bg-slate-100 px-2 py-0.5">{TYPE[it.media_type] ?? it.media_type}</span>}
                    {it.permalink && <a href={it.permalink} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">Voir <ExternalLink size={12} /></a>}
                  </div>
                  <p className="mb-3 line-clamp-4 text-sm whitespace-pre-wrap text-slate-800">{it.caption || '(sans légende)'}</p>
                  <dl className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-brand-50 p-2"><dt className="text-[10px] text-brand-700">Interactions</dt><dd className="text-base font-semibold">{fmtNum(it.interactions)}</dd></div>
                    {METRICS.filter(([k]) => typeof it.metrics[k] === 'number').map(([k, l]) => (
                      <div key={k} className="rounded-lg bg-slate-50 p-2"><dt className="text-[10px] text-slate-500">{l}</dt><dd className="text-base font-semibold">{fmtNum(it.metrics[k])}</dd></div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}

function startOfDayLocal(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
