import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  Activity, ArrowRight, ArrowUpRight, ArrowDownRight, CalendarClock, ChevronDown, Filter, Heart, MessageSquare, Plus, RefreshCw, Search, Trophy,
} from 'lucide-react'
import { api, type Platform } from '../lib/api'
import { Logo, PLATFORM_LIST, PLATFORM_META } from '../lib/platforms'
import { Empty, ErrorBox, PlatformTag, Spinner, fmtNum, useFetch, useToast } from '../components/ui'

interface Net {
  platform: Platform; label: string; configured: boolean; status: 'connected' | 'expired' | 'disconnected'
  account: string | null; lastError: string | null; remotePosts: number | null; likes: number | null
  pendingComments: number | null; commentsNote: string | null; messagesNote: string
  publishedByUs: number; scheduledByUs: number
}
interface Dash {
  networks: Net[]
  totals: { published: number; scheduled: number; drafts: number; failed: number; pendingComments: number }
  activity: { id: string; action: string; platform: Platform | null; detail: Record<string, unknown>; created_at: string }[]
  top: { platform: Platform; caption: string | null; permalink: string | null; published_at: string | null; interactions: number }[]
}
interface Period { posts: number; likes: number | null; comments: number | null; shares: number | null; saved: number | null }
interface Analytics {
  platforms: { platform: Platform; connected: boolean; followers: { latest: number | null }; current: Period; previous: Period }[]
}
interface Timeline {
  bucket: 'week' | 'month'; total: number
  buckets: { start: string; end: string; label: string; interactions: number; posts: number; byPlatform: Record<string, number> }[]
}

const ACTION: Record<string, string> = {
  'post.published': 'Publication en ligne', 'post.failed': 'Échec de publication', 'post.processing': 'Traitement par le réseau',
  'post.scheduled': 'Publication programmée', 'post.draft_saved': 'Brouillon enregistré', 'post.publish_requested': 'Publication lancée',
  'post.rescheduled': 'Publication replanifiée', 'post.retry': 'Nouvelle tentative', 'post.deleted': 'Publication supprimée', 'post.updated': 'Publication modifiée',
  'comment.replied': 'Réponse envoyée', 'comment.done': 'Commentaire traité',
  'connection.connected': 'Compte connecté', 'connection.disconnected': 'Compte déconnecté', 'connection.failed': 'Connexion échouée',
  'media.uploaded': 'Média téléversé', 'auth.registered': 'Compte créé',
}
function tone(action: string): { label: string; dot: string; text: string } {
  if (action.endsWith('failed')) return { label: 'Échec', dot: 'bg-red-500', text: 'text-red-600' }
  if (action === 'post.processing' || action === 'post.publish_requested' || action === 'post.retry') return { label: 'En cours', dot: 'bg-amber-500', text: 'text-amber-600' }
  if (/published|replied|done|connected$/.test(action)) return { label: 'Terminé', dot: 'bg-emerald-500', text: 'text-emerald-700' }
  return { label: 'Enregistré', dot: 'bg-slate-400', text: 'text-slate-500' }
}

const inter = (p: Period) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0)

function Pill({ pct, onDark }: { pct: number | null; onDark?: boolean }) {
  if (pct === null) return null
  const up = pct >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${onDark ? 'bg-white text-emerald-700' : up ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {up ? '+' : '−'}{Math.abs(pct).toFixed(1)}% <Icon size={12} />
    </span>
  )
}

function SummaryCard({ icon, title, subtitle, value, pill, footer, to, hero }: {
  icon: React.ReactNode; title: string; subtitle: string; value: string; pill?: React.ReactNode; footer: string; to: string; hero?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className={`relative p-5 ${hero ? 'bg-gradient-to-br from-[#0a6b3d] via-[#0d8049] to-[#14a05a] text-white' : ''}`}>
        {hero && <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,255,255,.14),transparent_45%)]" />}
        <div className="relative flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${hero ? 'bg-white text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>{icon}</span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{title}</p>
            <p className={`truncate text-sm ${hero ? 'text-white/75' : 'text-slate-500'}`}>{subtitle}</p>
          </div>
        </div>
        <div className="relative mt-5 flex items-center gap-3">
          <span className="text-3xl font-semibold tracking-tight">{value}</span>
          {pill}
        </div>
      </div>
      <Link to={to} className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-3 text-sm text-slate-700 hover:bg-slate-50">
        {footer} <ArrowRight size={16} />
      </Link>
    </div>
  )
}

/** Axe vertical « propre » (0, 10, 20…) */
function niceMax(v: number) {
  if (v <= 5) return 5
  const p = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / p) * p
}

function Chart({ data }: { data: Timeline }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...data.buckets.map((b) => b.interactions)))
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((t) => Math.round(max * t))
  const empty = data.buckets.every((b) => b.posts === 0)
  return (
    <div className="relative mt-4 flex h-64 gap-3">
      <div className="flex flex-col justify-between pb-6 text-xs text-slate-500" aria-hidden>
        {ticks.map((t) => <span key={t}>{fmtNum(t)}</span>)}
      </div>
      <div className="relative flex flex-1 items-end gap-2 sm:gap-4">
        {empty && (
          <p className="absolute inset-x-0 top-1/3 z-10 text-center text-sm text-slate-400">
            Aucune publication synchronisée sur cette période.<br />Connectez un compte puis cliquez sur « Actualiser ».
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

export default function Dashboard() {
  const toast = useToast()
  const [days, setDays] = useState(30)
  const [bucket, setBucket] = useState<'week' | 'month'>('week')
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [net, setNet] = useState<Platform | ''>('')

  const dash = useFetch(() => api<Dash>('/insights/dashboard'))
  const ana = useFetch(() => api<Analytics>(`/insights?days=${days}`), [days])
  const tl = useFetch(() => api<Timeline>(`/insights/timeline?bucket=${bucket}`), [bucket])

  async function refresh() {
    setRefreshing(true)
    try {
      await api('/connections/sync', { method: 'POST' })
      toast('success', 'Données actualisées.')
    } catch (e) {
      toast('error', (e as Error).message)
    }
    dash.reload(); ana.reload(); tl.reload()
    setRefreshing(false)
  }

  const cur = useMemo(() => (ana.data?.platforms ?? []).reduce((a, p) => a + inter(p.current), 0), [ana.data])
  const prev = useMemo(() => (ana.data?.platforms ?? []).reduce((a, p) => a + inter(p.previous), 0), [ana.data])
  const delta = prev > 0 ? ((cur - prev) / prev) * 100 : null // pas de pourcentage sans base de comparaison
  const anyStats = (ana.data?.platforms ?? []).some((p) => p.connected)

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (dash.data?.activity ?? []).filter((a) =>
      (!net || a.platform === net) &&
      (!s || (ACTION[a.action] ?? a.action).toLowerCase().includes(s) || String(a.detail?.error ?? '').toLowerCase().includes(s)),
    )
  }, [dash.data, search, net])

  if (dash.loading && !dash.data) return <Spinner />
  if (dash.error || !dash.data) return <ErrorBox error={dash.error ?? 'Données indisponibles'} onRetry={dash.reload} />
  const d = dash.data
  const connected = d.networks.filter((n) => n.status === 'connected').length
  const followers = (p: Platform) => ana.data?.platforms.find((x) => x.platform === p)?.followers.latest ?? null

  return (
    <>
      {/* En-tête */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vue d’ensemble</h1>
          <p className="text-sm text-slate-500">Résumé de vos réseaux sociaux. « — » : donnée non fournie par le réseau.</p>
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

      {connected === 0 && (
        <div className="mb-5 rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-700">
          Aucun réseau connecté pour le moment. <Link to="/networks" className="font-semibold underline">Connectez vos comptes</Link> pour alimenter ce tableau de bord.
        </div>
      )}

      {/* Cartes de synthèse */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          hero
          icon={<Heart size={20} />}
          title="Interactions"
          subtitle={`J’aime, commentaires, partages · ${days} jours`}
          value={anyStats ? fmtNum(cur) : '—'}
          pill={anyStats ? <Pill pct={delta} onDark /> : null}
          footer="Voir les statistiques"
          to="/analytics"
        />
        <SummaryCard icon={<CalendarClock size={20} />} title="Publications programmées" subtitle="Envoyées par le serveur à l’heure dite" value={fmtNum(d.totals.scheduled)} footer="Ouvrir le calendrier" to="/calendar" />
        <SummaryCard icon={<MessageSquare size={20} />} title="Commentaires à traiter" subtitle={d.totals.failed ? `${d.totals.failed} échec(s) de publication à relancer` : 'Aucun échec de publication'} value={fmtNum(d.totals.pendingComments)} footer="Ouvrir la boîte de réception" to="/inbox" />
      </div>

      {/* Réseaux + graphique */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Mes réseaux</h2>
              <p className="text-sm text-slate-500">{connected} connecté{connected > 1 ? 's' : ''} sur {d.networks.length}</p>
            </div>
            <Link to="/networks" className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"><Plus size={15} /> Gérer</Link>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {d.networks.map((n) => {
              const st = n.status === 'connected' ? { t: 'Connecté', c: 'text-emerald-600' } : n.status === 'expired' ? { t: 'Expiré', c: 'text-amber-600' } : { t: n.configured ? 'Non connecté' : 'Non configuré', c: 'text-red-500' }
              return (
                <Link key={n.platform} to="/networks" className="rounded-xl bg-slate-50 p-3.5 transition hover:bg-slate-100" title={n.lastError ?? n.account ?? undefined}>
                  <div className="flex items-center gap-2 text-sm font-medium"><Logo platform={n.platform} size={20} /> {n.label}</div>
                  <p className="mt-3 text-xl font-semibold tracking-tight">{n.status === 'connected' ? fmtNum(followers(n.platform)) : '—'}</p>
                  <p className="text-[11px] text-slate-500">abonnés</p>
                  <p className="mt-1.5 truncate text-[11px] text-slate-500">
                    {n.scheduledByUs} programmée(s) · {n.pendingComments === null ? 'commentaires N/D' : `${n.pendingComments} commentaire(s)`}
                  </p>
                  <p className={`mt-1 text-[11px] font-medium ${st.c}`}>{st.t}</p>
                </Link>
              )
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm text-slate-500">Engagement</p>
              <p className="text-3xl font-semibold tracking-tight">{tl.data ? fmtNum(tl.data.total) : '—'}</p>
              <p className="text-xs text-slate-400">interactions sur les {bucket === 'week' ? '8 dernières semaines' : '6 derniers mois'}</p>
            </div>
            <div className="flex rounded-full border border-slate-200 p-0.5 text-sm" role="group" aria-label="Regroupement">
              {([['week', 'Hebdo'], ['month', 'Mensuel']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setBucket(k)} aria-pressed={bucket === k} className={`rounded-full px-3.5 py-1 font-medium ${bucket === k ? 'bg-brand-600 text-white' : 'text-slate-600'}`}>{l}</button>
              ))}
            </div>
          </div>
          {tl.error ? <div className="mt-4"><ErrorBox error={tl.error} onRetry={tl.reload} /></div> : tl.data ? <Chart data={tl.data} /> : <Spinner />}
          <p className="mt-3 text-[11px] text-slate-400">Basé sur les publications synchronisées (les plus récentes de chaque réseau). Interactions = J’aime + commentaires + partages + enregistrements.</p>
        </section>
      </div>

      {/* Activités + meilleures publications */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Activités récentes</h2>
            <div className="flex gap-2">
              <label className="relative">
                <span className="sr-only">Rechercher une activité</span>
                <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher" className="w-40 rounded-xl border border-slate-200 py-2 pr-3 pl-9 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:w-52" />
              </label>
              <label className="relative">
                <span className="sr-only">Filtrer par réseau</span>
                <Filter size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" />
                <select value={net} onChange={(e) => setNet(e.target.value as Platform | '')} className="appearance-none rounded-xl border border-slate-200 py-2 pr-3 pl-8 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <option value="">Filtrer</option>
                  {PLATFORM_LIST.map((p) => <option key={p} value={p}>{PLATFORM_META[p].label}</option>)}
                </select>
              </label>
            </div>
          </div>
          {rows.length === 0 ? (
            <Empty icon={<Activity size={32} />} title={d.activity.length ? 'Aucun résultat' : 'Aucune activité'} text={d.activity.length ? 'Modifiez la recherche ou le filtre.' : 'Les publications, réponses et connexions apparaîtront ici.'} />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr><th className="px-4 py-2.5 font-medium">Activité</th><th className="px-4 py-2.5 font-medium">Réseau</th><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Heure</th><th className="px-4 py-2.5 font-medium">Statut</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((a) => {
                    const t = tone(a.action)
                    const when = new Date(a.created_at)
                    return (
                      <tr key={a.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{ACTION[a.action] ?? a.action}</p>
                          {typeof a.detail?.error === 'string' && <p className="max-w-xs truncate text-xs text-red-600" title={a.detail.error}>{a.detail.error}</p>}
                        </td>
                        <td className="px-4 py-3">{a.platform ? <PlatformTag platform={a.platform} /> : <span className="text-slate-300">—</span>}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{format(when, 'd MMM yyyy', { locale: fr })}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{format(when, 'HH:mm')}</td>
                        <td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-xs font-medium ${t.text}`}><span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{t.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Trophy size={18} className="text-amber-500" /> Meilleures publications</h2>
          {d.top.length === 0 ? (
            <Empty icon={<Trophy size={32} />} title="Pas encore de statistiques" text="Connectez un compte puis cliquez sur « Actualiser »." />
          ) : (
            <ol className="divide-y divide-slate-100">
              {d.top.map((t, i) => (
                <li key={i} className="flex items-center gap-3 py-3 text-sm">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <PlatformTag platform={t.platform} />
                    <p className="mt-1 truncate">{t.permalink ? <a className="hover:underline" href={t.permalink} target="_blank" rel="noreferrer">{t.caption || '(sans légende)'}</a> : t.caption || '(sans légende)'}</p>
                  </div>
                  <span className="text-right"><span className="block font-semibold">{fmtNum(t.interactions)}</span><span className="text-[10px] text-slate-400">interactions</span></span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </>
  )
}
