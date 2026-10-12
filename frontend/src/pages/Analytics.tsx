import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ArrowDownRight, ArrowUpRight, BarChart3, ChevronDown, Info, RefreshCw, Trophy, Users } from 'lucide-react'
import { api, type Platform } from '../lib/api'
import { Logo, PLATFORM_META } from '../lib/platforms'
import { Empty, ErrorBox, Spinner, fmtNum, useFetch, useToast } from '../components/ui'

interface Period {
  posts: number; views: number | null; reach: number | null; likes: number | null; comments: number | null
  shares: number | null; saved: number | null; engagement: { rate: number | null; basis: string | null }
}
interface Net {
  platform: Platform; label: string; connected: boolean; statsAvailable: boolean; statsNote: string
  current: Period; previous: Period
  followers: { latest: number | null; first: number | null; series: { at: string; value: number }[] }
  top: { remote_id: string; caption: string | null; permalink: string | null; published_at: string; interactions: number }[]
}
interface Data { days: number; help: Record<string, string>; platforms: Net[] }

// Interactions = J'aime + commentaires + partages + enregistrements (compteurs de même nature, sommables)
const inter = (p: Period) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0)
const pctChange = (cur: number, prev: number) => (prev > 0 ? ((cur - prev) / prev) * 100 : null)

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-slate-300">—</span>
  const up = pct >= 0
  const I = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {up ? '+' : '−'}{Math.abs(pct).toFixed(1)}% <I size={12} />
    </span>
  )
}

function Kpi({ icon, label, value, delta, hint }: { icon: React.ReactNode; label: string; value: string; delta?: number | null; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-sm text-slate-500"><span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-700">{icon}</span>{label}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <span className="text-3xl font-semibold tracking-tight text-slate-900">{value}</span>
        {delta !== undefined && <Delta pct={delta} />}
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

/** Courbe d'abonnés (un relevé par synchronisation) */
function FollowersChart({ series }: { series: { at: string; value: number }[] }) {
  if (series.length < 2) {
    return <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">Pas encore assez de relevés pour tracer une courbe. Un relevé est ajouté à chaque synchronisation.</p>
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

function TopPosts({ top }: { top: Net['top'] }) {
  if (!top.length) return <Empty icon={<Trophy size={30} />} title="Aucune publication sur la période" />
  const max = Math.max(...top.map((t) => t.interactions), 1)
  return (
    <ol className="space-y-3">
      {top.map((t, i) => (
        <li key={t.remote_id} className="text-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">{i + 1}</span>
            <p className="min-w-0 flex-1 truncate">{t.permalink ? <a className="hover:underline" href={t.permalink} target="_blank" rel="noreferrer">{t.caption || '(sans légende)'}</a> : t.caption || '(sans légende)'}</p>
            <span className="shrink-0 font-semibold">{fmtNum(t.interactions)}</span>
          </div>
          <div className="mt-1.5 ml-9 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-[#0b7a43] to-[#4fb883]" style={{ width: `${(t.interactions / max) * 100}%` }} /></div>
        </li>
      ))}
    </ol>
  )
}

const ROWS: [string, keyof Period][] = [['Publications', 'posts'], ['Vues', 'views'], ['Portée', 'reach'], ['J’aime', 'likes'], ['Commentaires', 'comments'], ['Partages', 'shares'], ['Enregistrements', 'saved']]

function Detail({ n, days }: { n: Net; days: number }) {
  const rate = n.current.engagement, prevRate = n.previous.engagement
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
        <h2 className="mb-3 text-lg font-semibold">Indicateurs · {days} jours</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th className="pb-2 font-normal">Indicateur</th><th className="pb-2 text-right font-normal">Période</th><th className="pb-2 text-right font-normal">Précédente</th><th className="pb-2 text-right font-normal">Évolution</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {ROWS.map(([label, k]) => {
                const cur = n.current[k] as number | null, prev = n.previous[k] as number | null
                if (k !== 'posts' && cur === null && prev === null) return null
                return (
                  <tr key={k}>
                    <td className="py-2.5">{label}</td>
                    <td className="py-2.5 text-right font-semibold">{fmtNum(cur)}</td>
                    <td className="py-2.5 text-right text-slate-500">{fmtNum(prev)}</td>
                    <td className="py-2.5 text-right">{cur !== null && prev !== null ? <Delta pct={pctChange(cur, prev)} /> : <span className="text-xs text-slate-300">—</span>}</td>
                  </tr>
                )
              })}
              <tr>
                <td className="py-2.5">Taux d’engagement{rate.basis && <span className="block text-[11px] text-slate-400">base : {rate.basis === 'reach' ? 'portée' : 'vues'}</span>}</td>
                <td className="py-2.5 text-right font-semibold">{rate.rate === null ? '—' : `${(rate.rate * 100).toFixed(1)} %`}</td>
                <td className="py-2.5 text-right text-slate-500">{prevRate.rate === null ? '—' : `${(prevRate.rate * 100).toFixed(1)} %`}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        {n.current.posts === 0 && n.previous.posts === 0 && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><BarChart3 size={16} /> Aucune publication synchronisée sur ces deux périodes.</p>}
      </section>

      <div className="space-y-4 lg:col-span-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Abonnés</h2>
            <span className="text-2xl font-semibold tracking-tight">{fmtNum(n.followers.latest)}</span>
          </div>
          <FollowersChart series={n.followers.series} />
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Trophy size={17} className="text-amber-500" /> Meilleures publications</h2>
          <TopPosts top={n.top} />
        </section>
      </div>
    </div>
  )
}

export default function Analytics() {
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [sel, setSel] = useState<Platform | 'all'>('all')
  const [helpOpen, setHelpOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const { data, error, loading, reload } = useFetch(() => api<Data>(`/insights?days=${days}`), [days])

  const stats = useMemo(() => (data?.platforms ?? []).filter((p) => p.connected && p.statsAvailable), [data])
  const tot = useMemo(() => {
    const cur = stats.reduce((a, p) => a + inter(p.current), 0), prev = stats.reduce((a, p) => a + inter(p.previous), 0)
    const posts = stats.reduce((a, p) => a + p.current.posts, 0), prevPosts = stats.reduce((a, p) => a + p.previous.posts, 0)
    const fol = stats.some((p) => p.followers.latest !== null) ? stats.reduce((a, p) => a + (p.followers.latest ?? 0), 0) : null
    const folFirst = stats.reduce((a, p) => a + (p.followers.first ?? p.followers.latest ?? 0), 0)
    return { cur, prev, posts, prevPosts, fol, folDelta: fol !== null && folFirst > 0 ? pctChange(fol, folFirst) : null }
  }, [stats])

  async function refresh() {
    setRefreshing(true)
    try {
      await api('/connections/sync', { method: 'POST' })
      toast('success', 'Statistiques actualisées.')
    } catch (e) {
      toast('error', (e as Error).message)
    }
    reload()
    setRefreshing(false)
  }

  const selected = data?.platforms.find((p) => p.platform === sel)

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Statistiques</h1>
          <p className="max-w-2xl text-sm text-slate-500">Données de la dernière synchronisation. « — » : non fourni par le réseau (≠ zéro). Chaque réseau est analysé avec ses propres définitions.</p>
        </div>
        <div className="flex gap-2">
          <label className="relative">
            <span className="sr-only">Période</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pr-8 pl-3.5 text-sm font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option>
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500" />
          </label>
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Actualiser
          </button>
        </div>
      </div>

      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && (
        <>
          {stats.length === 0 && (
            <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-700">
              Aucun réseau connecté avec statistiques disponibles. <Link to="/networks" className="font-semibold underline">Connectez un compte</Link>, puis cliquez sur « Actualiser ».
            </div>
          )}

          {/* Indicateurs clés (sommes de compteurs de même nature uniquement) */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi icon={<BarChart3 size={16} />} label="Publications" value={stats.length ? fmtNum(tot.posts) : '—'} delta={stats.length ? pctChange(tot.posts, tot.prevPosts) : undefined} hint={`sur ${days} jours`} />
            <Kpi icon={<Trophy size={16} />} label="Interactions" value={stats.length ? fmtNum(tot.cur) : '—'} delta={stats.length ? pctChange(tot.cur, tot.prev) : undefined} hint="J’aime + commentaires + partages + enreg." />
            <Kpi icon={<Users size={16} />} label="Abonnés" value={fmtNum(tot.fol)} delta={tot.fol !== null ? tot.folDelta : undefined} hint="tous réseaux connectés" />
            <Kpi icon={<Info size={16} />} label="Réseaux suivis" value={`${stats.length}/${data.platforms.length}`} hint="connectés avec statistiques" />
          </div>

          {/* Sélecteur de réseau */}
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Réseau">
            {([['all', 'Tous les réseaux'], ...data.platforms.map((p) => [p.platform, p.label])] as [string, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setSel(k as Platform | 'all')} aria-pressed={sel === k}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium ${sel === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {k !== 'all' && <span className={`grid h-5 w-5 place-items-center rounded-full ${sel === k ? 'bg-white' : ''}`}><Logo platform={k as Platform} size={14} /></span>}
                {l}
              </button>
            ))}
          </div>

          {sel === 'all' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.platforms.map((n) => {
                const ok = n.connected && n.statsAvailable
                const c = inter(n.current), p = inter(n.previous)
                return (
                  <button key={n.platform} onClick={() => setSel(n.platform)} className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-brand-500">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="flex items-center gap-2.5 font-semibold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-50 ring-1 ring-slate-200"><Logo platform={n.platform} size={22} /></span>{n.label}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : !n.connected ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'}`}>{ok ? 'Données réelles' : !n.connected ? 'Non connecté' : 'Stats indisponibles'}</span>
                    </div>
                    {!n.statsAvailable ? <p className="text-sm text-slate-500">{n.statsNote}</p>
                      : !n.connected ? <p className="text-sm text-slate-500">Connectez ce compte pour afficher ses statistiques.</p>
                      : (
                        <>
                          <dl className="grid grid-cols-3 gap-3">
                            <div><dt className="text-xs text-slate-400">Publications</dt><dd className="text-xl font-semibold">{fmtNum(n.current.posts)}</dd></div>
                            <div><dt className="text-xs text-slate-400">Interactions</dt><dd className="flex flex-wrap items-center gap-1.5 text-xl font-semibold">{fmtNum(c)} <Delta pct={pctChange(c, p)} /></dd></div>
                            <div><dt className="text-xs text-slate-400">Abonnés</dt><dd className="text-xl font-semibold">{fmtNum(n.followers.latest)}</dd></div>
                          </dl>
                          <p className="mt-3 text-xs text-slate-400">
                            Engagement{n.current.engagement.basis ? ` (base : ${n.current.engagement.basis === 'reach' ? 'portée' : 'vues'})` : ''} :{' '}
                            <strong className="text-slate-600">{n.current.engagement.rate === null ? '—' : `${(n.current.engagement.rate * 100).toFixed(1)} %`}</strong>
                          </p>
                        </>
                      )}
                  </button>
                )
              })}
            </div>
          ) : selected && selected.connected && selected.statsAvailable ? (
            <Detail n={selected} days={data.days} />
          ) : selected ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold"><Logo platform={selected.platform} size={22} /> {PLATFORM_META[selected.platform].label}</h2>
              <p className="text-sm text-slate-600">{!selected.statsAvailable ? selected.statsNote : 'Connectez ce compte pour afficher ses statistiques.'}</p>
              {selected.statsAvailable && !selected.connected && <Link to="/networks" className="mt-3 inline-flex rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Connecter ce compte</Link>}
            </section>
          ) : null}

          {/* Aide */}
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button onClick={() => setHelpOpen((o) => !o)} aria-expanded={helpOpen} className="flex w-full items-center justify-between p-5 text-left">
              <span className="flex items-center gap-2 font-semibold"><Info size={16} className="text-brand-600" /> Comprendre les indicateurs</span>
              <ChevronDown size={16} className={`text-slate-400 transition ${helpOpen ? 'rotate-180' : ''}`} />
            </button>
            {helpOpen && (
              <dl className="grid gap-3 px-5 pb-5 text-sm sm:grid-cols-2">
                {Object.entries(data.help).map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-slate-50 p-3"><dt className="font-medium capitalize">{k === 'engagement' ? 'Taux d’engagement' : k}</dt><dd className="mt-0.5 text-slate-600">{v}</dd></div>
                ))}
              </dl>
            )}
          </section>
        </>
      )}
    </>
  )
}
