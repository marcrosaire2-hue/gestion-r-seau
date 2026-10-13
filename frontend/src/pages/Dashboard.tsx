import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Activity, BarChart3, CalendarDays, ChevronDown, Heart, MessageSquare, RefreshCw, Trophy, Users } from 'lucide-react'
import { api, type Platform } from '../lib/api'
import { Logo } from '../lib/platforms'
import { getUser } from '../lib/session'
import { Delta, EngagementChart, pctChange, type Timeline } from '../components/charts'
import { ErrorBox, PlatformTag, Spinner, fmtNum, useFetch, useToast } from '../components/ui'

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
function tone(action: string): { label: string; dot: string; text: string; pill: string } {
  if (action.endsWith('failed')) return { label: 'Échec', dot: 'bg-red-500', text: 'text-red-600', pill: 'bg-red-50' }
  if (action === 'post.processing' || action === 'post.publish_requested' || action === 'post.retry') return { label: 'En cours', dot: 'bg-amber-500', text: 'text-amber-700', pill: 'bg-amber-50' }
  if (/published|replied|done|connected$/.test(action)) return { label: 'Terminé', dot: 'bg-emerald-500', text: 'text-emerald-700', pill: 'bg-emerald-50' }
  return { label: 'Enregistré', dot: 'bg-slate-400', text: 'text-slate-600', pill: 'bg-slate-100' }
}

const inter = (p: Period) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0)

/** Chiffre clé, sur une seule ligne compacte. */
function Kpi({ icon, title, value, note }: { icon: React.ReactNode; title: string; value: string; note?: React.ReactNode }) {
  return (
    <section className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-brand-700">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-slate-500">{title}</p>
        <p className="flex items-baseline gap-2 truncate text-xl font-semibold tracking-tight text-slate-900">{value}<span className="text-xs font-normal text-slate-500">{note}</span></p>
      </div>
    </section>
  )
}

/** Tableau de bord sur une seule page (sans défilement sur ordinateur): l'essentiel, rien de plus. */
export default function Dashboard() {
  const toast = useToast()
  const user = getUser() || 'Utilisateur'
  const [days, setDays] = useState(30)
  const [bucket, setBucket] = useState<'week' | 'month'>('week')
  const [refreshing, setRefreshing] = useState(false)

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
  const followerList = stats.map((p) => p.followers.latest).filter((n): n is number => typeof n === 'number')
  const totalFollowers = followerList.length ? followerList.reduce((a, b) => a + b, 0) : null

  if (dash.loading && !dash.data) return <Spinner />
  if (dash.error || !dash.data) return <ErrorBox error={dash.error ?? 'Données indisponibles'} onRetry={dash.reload} />
  const d = dash.data
  const connected = d.networks.filter((n) => n.status === 'connected')
  const firstConnected = connected[0]?.platform
  const firstPending = d.networks.find((n) => (n.pendingComments ?? 0) > 0)?.platform
  const followers = (p: Platform) => ana.data?.platforms.find((x) => x.platform === p)?.followers.latest ?? null
  const today = format(new Date(), 'EEE d MMMM yyyy', { locale: fr })
  const card = 'flex min-h-0 flex-col rounded-2xl bg-white p-4 shadow-sm'

  return (
    <div className="flex flex-col gap-3 lg:h-[calc(100vh-8rem)] lg:min-h-[36rem] lg:overflow-hidden">
      {/* En-tête */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">Bienvenue <span className="capitalize">{user}</span></h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 shadow-sm"><CalendarDays size={14} className="text-slate-500" /> <span className="first-letter:capitalize">{today}</span></span>
          <label className="relative">
            <span className="sr-only">Période</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="appearance-none rounded-full bg-white py-1.5 pr-8 pl-3.5 text-sm font-medium text-slate-700 shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <option value={7}>7 jours</option><option value={30}>30 jours</option><option value={90}>90 jours</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-500" />
          </label>
          <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-neutral-700 disabled:opacity-60">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Actualiser
          </button>
        </div>
      </div>

      {connected.length === 0 && (
        <div className="shrink-0 rounded-xl border border-brand-100 bg-brand-50 px-4 py-2 text-sm text-brand-700">
          Aucun réseau connecté. <Link to="/facebook" className="font-semibold underline">Connecter un réseau</Link>
        </div>
      )}

      {/* Chiffres clés */}
      <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<Users size={18} />} title="Abonnés" value={fmtNum(totalFollowers)} />
        <Kpi icon={<BarChart3 size={18} />} title={`Publications · ${days} j`} value={stats.length ? fmtNum(posts) : '—'} />
        <Kpi icon={<Heart size={18} />} title="Interactions" value={stats.length ? fmtNum(cur) : '—'} note={stats.length ? <Delta pct={delta} /> : null} />
        <Kpi
          icon={<MessageSquare size={18} />}
          title="Commentaires à traiter"
          value={fmtNum(d.totals.pendingComments)}
          note={<Link to={firstPending ? `/${firstPending}?tab=commentaires` : firstConnected ? `/${firstConnected}?tab=commentaires` : '/facebook'} className="font-medium text-brand-700 hover:underline">Ouvrir</Link>}
        />
      </div>

      {/* Graphique + réseaux */}
      <div className="grid min-h-0 flex-1 gap-3 lg:min-h-[16.5rem] lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <div className="flex shrink-0 items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">Engagement</h2>
            <div className="flex rounded-full bg-slate-100 p-0.5 text-xs" role="group" aria-label="Regroupement">
              {([['week', 'Hebdo'], ['month', 'Mensuel']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setBucket(k)} aria-pressed={bucket === k} className={`rounded-full px-3 py-1 font-medium ${bucket === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            {tl.error ? <ErrorBox error={tl.error} onRetry={tl.reload} /> : tl.data ? <EngagementChart data={tl.data} className="h-60 lg:h-full" /> : <Spinner />}
          </div>
        </section>

        <section className={card}>
          <h2 className="shrink-0 text-base font-semibold text-slate-900">Réseaux</h2>
          <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-between gap-1 overflow-hidden">
            {d.networks.map((n) => {
              const st = n.status === 'connected' ? { t: 'Connecté', c: 'bg-emerald-500' } : n.status === 'expired' ? { t: 'Expiré', c: 'bg-amber-500' } : { t: n.configured ? 'Non connecté' : 'Non configuré', c: 'bg-red-400' }
              return (
                <li key={n.platform}>
                  <Link to={`/${n.platform}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1 hover:bg-slate-50" title={n.lastError ?? n.account ?? undefined}>
                    <Logo platform={n.platform} size={18} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{n.label}</span>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{n.status === 'connected' ? fmtNum(followers(n.platform)) : '—'}</span>
                    <span className="inline-flex w-24 items-center gap-1.5 text-[11px] text-slate-500"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.c}`} />{st.t}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      {/* Publications et activités */}
      <div className="grid shrink-0 gap-3 lg:h-36 lg:grid-cols-3">
        <section className={card}>
          <h2 className="flex shrink-0 items-center gap-2 text-base font-semibold text-slate-900"><Trophy size={15} className="text-amber-500" /> Meilleures publications</h2>
          {d.top.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Pas encore de statistiques.</p>
          ) : (
            <ol className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-hidden">
              {d.top.slice(0, 3).map((t, i) => (
                <li key={i} className="flex h-6 items-center gap-2 text-sm">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
                  <PlatformTag platform={t.platform} />
                  <span className="min-w-0 flex-1 truncate">{t.permalink ? <a className="hover:underline" href={t.permalink} target="_blank" rel="noreferrer">{t.caption || '(sans légende)'}</a> : t.caption || '(sans légende)'}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{fmtNum(t.interactions)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={`${card} lg:col-span-2`}>
          <h2 className="flex shrink-0 items-center gap-2 text-base font-semibold text-slate-900"><Activity size={15} className="text-brand-700" /> Activités récentes</h2>
          {d.activity.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Aucune activité.</p>
          ) : (
            <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-hidden">
              {d.activity.slice(0, 3).map((a) => {
                const t = tone(a.action)
                const when = new Date(a.created_at)
                return (
                  <li key={a.id} className="flex h-6 items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={typeof a.detail?.error === 'string' ? a.detail.error : undefined}>{ACTION[a.action] ?? a.action}</span>
                    {a.platform && <PlatformTag platform={a.platform} />}
                    <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:inline">{format(when, 'd MMM HH:mm', { locale: fr })}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${t.pill} ${t.text}`}><span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />{t.label}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
