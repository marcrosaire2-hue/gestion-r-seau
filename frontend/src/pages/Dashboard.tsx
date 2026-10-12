import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Activity, ArrowRight, BarChart3, ChevronDown, Filter, Heart, MessageSquare, RefreshCw, Search, Trophy } from 'lucide-react'
import { api, type Platform } from '../lib/api'
import { Logo, PLATFORM_LIST, PLATFORM_META } from '../lib/platforms'
import { Delta, EngagementChart, pctChange, type Timeline } from '../components/charts'
import { Empty, ErrorBox, PlatformTag, Spinner, fmtNum, useFetch, useToast } from '../components/ui'

interface Net {
  platform: Platform; label: string; configured: boolean; status: 'connected' | 'expired' | 'disconnected'
  account: string | null; lastError: string | null; remotePosts: number | null; likes: number | null
  pendingComments: number | null; commentsNote: string | null; messagesNote: string
}
interface Dash {
  networks: Net[]
  totals: { pendingComments: number }
  activity: { id: string; action: string; platform: Platform | null; detail: Record<string, unknown>; created_at: string }[]
  top: { platform: Platform; caption: string | null; permalink: string | null; published_at: string | null; interactions: number }[]
}
interface Period { posts: number; likes: number | null; comments: number | null; shares: number | null; saved: number | null }
interface Analytics {
  platforms: { platform: Platform; connected: boolean; followers: { latest: number | null }; current: Period; previous: Period }[]
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

  const stats = useMemo(() => (ana.data?.platforms ?? []).filter((p) => p.connected), [ana.data])
  const cur = stats.reduce((a, p) => a + inter(p.current), 0)
  const prev = stats.reduce((a, p) => a + inter(p.previous), 0)
  const posts = stats.reduce((a, p) => a + p.current.posts, 0)
  const delta = prev > 0 ? pctChange(cur, prev) : null // pas de pourcentage sans base de comparaison

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
  const connected = d.networks.filter((n) => n.status === 'connected')
  const firstConnected = connected[0]?.platform
  const firstPending = d.networks.find((n) => (n.pendingComments ?? 0) > 0)?.platform
  const followers = (p: Platform) => ana.data?.platforms.find((x) => x.platform === p)?.followers.latest ?? null

  return (
    <>
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

      {connected.length === 0 && (
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
          value={stats.length ? fmtNum(cur) : '—'}
          pill={stats.length ? <Delta pct={delta} onDark /> : null}
          footer="Voir le détail par réseau"
          to={firstConnected ? `/${firstConnected}` : '/networks'}
        />
        <SummaryCard
          icon={<BarChart3 size={20} />}
          title="Publications suivies"
          subtitle={`Des comptes connectés · ${days} jours`}
          value={stats.length ? fmtNum(posts) : '—'}
          footer="Voir les publications"
          to={firstConnected ? `/${firstConnected}?tab=publications` : '/networks'}
        />
        <SummaryCard
          icon={<MessageSquare size={20} />}
          title="Commentaires à traiter"
          subtitle="Tous réseaux confondus"
          value={fmtNum(d.totals.pendingComments)}
          footer="Ouvrir les commentaires"
          to={firstPending ? `/${firstPending}?tab=commentaires` : firstConnected ? `/${firstConnected}?tab=commentaires` : '/networks'}
        />
      </div>

      {/* Réseaux + graphique */}
      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div>
            <h2 className="text-lg font-semibold">Mes réseaux</h2>
            <p className="text-sm text-slate-500">{connected.length} connecté{connected.length > 1 ? 's' : ''} sur {d.networks.length}</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {d.networks.map((n) => {
              const st = n.status === 'connected' ? { t: 'Connecté', c: 'text-emerald-600' } : n.status === 'expired' ? { t: 'Expiré', c: 'text-amber-600' } : { t: n.configured ? 'Non connecté' : 'Non configuré', c: 'text-red-500' }
              return (
                <Link key={n.platform} to={n.status === 'connected' ? `/${n.platform}` : '/networks'} className="rounded-xl bg-slate-50 p-3.5 transition hover:bg-slate-100" title={n.lastError ?? n.account ?? undefined}>
                  <div className="flex items-center gap-2 text-sm font-medium"><Logo platform={n.platform} size={20} /> {n.label}</div>
                  <p className="mt-3 text-xl font-semibold tracking-tight">{n.status === 'connected' ? fmtNum(followers(n.platform)) : '—'}</p>
                  <p className="text-[11px] text-slate-500">abonnés</p>
                  <p className="mt-1.5 truncate text-[11px] text-slate-500">
                    {n.status === 'connected' ? `${fmtNum(n.remotePosts)} publication(s) · ${n.pendingComments === null ? 'commentaires N/D' : `${n.pendingComments} commentaire(s)`}` : n.commentsNote ? 'Voir les limites' : 'À connecter'}
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
          {tl.error ? <div className="mt-4"><ErrorBox error={tl.error} onRetry={tl.reload} /></div> : tl.data ? <EngagementChart data={tl.data} /> : <Spinner />}
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
            <Empty icon={<Activity size={32} />} title={d.activity.length ? 'Aucun résultat' : 'Aucune activité'} text={d.activity.length ? 'Modifiez la recherche ou le filtre.' : 'Les connexions, réponses et traitements apparaîtront ici.'} />
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
