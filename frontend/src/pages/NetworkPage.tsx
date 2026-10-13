import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AlertTriangle, ChevronDown, ExternalLink, Link2, Loader2, MessageSquare, RefreshCw, Search, Send, Sparkles, Trophy, TrendingUp, Unplug } from 'lucide-react'
import { api, type CommentRow, type NetworkInfo, type Platform } from '../lib/api'
import { getRole } from '../lib/session'
import { Logo, PLATFORM_META } from '../lib/platforms'
import { Delta, EngagementChart, FollowersChart, Ring, Spark, pctChange, type Timeline } from '../components/charts'
import { CommentCard } from '../components/CommentCard'
import { Markdown } from '../components/Markdown'
import { METRIC_LABELS, POST_TYPE, PostCalendar, type PostItem } from '../components/PostCalendar'
import { ErrorBox, Spinner, fmtNum, useFetch, useToast } from '../components/ui'

interface Period {
  posts: number; views: number | null; reach: number | null; likes: number | null; comments: number | null
  shares: number | null; saved: number | null; engagement: { rate: number | null; basis: string | null }
}
interface NetStats {
  platform: Platform; connected: boolean; statsAvailable: boolean; statsNote: string
  current: Period; previous: Period
  followers: { latest: number | null; first: number | null; series: { at: string; value: number }[] }
  top: { remote_id: string; caption: string | null; permalink: string | null; published_at: string; interactions: number }[]
}
interface Analysis { empty: boolean; analysis: string; basedOn: { publications: number; networks: string[] }; unverified?: string[] }

const inter = (p: Period) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0)

type TabKey = 'apercu' | 'publications' | 'commentaires' | 'calendrier' | 'conseils' | 'connexion'
const QUESTIONS = [
  'Quelles publications fonctionnent le mieux, et pourquoi ?',
  'Quels jours et types de contenu obtiennent les meilleurs résultats ?',
  'Comment améliorer mon taux d’engagement ?',
  'Que faire pour gagner des abonnés ?',
]

const Section = ({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) => (
  <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
    <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
    {children}
  </section>
)

export default function NetworkPage({ platform }: { platform: Platform }) {
  const toast = useToast()
  const meta = PLATFORM_META[platform]
  const [params, setParams] = useSearchParams()
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [bucket, setBucket] = useState<'week' | 'month'>('week')
  const [refreshing, setRefreshing] = useState(false)

  const nets = useFetch(() => api<NetworkInfo[]>('/connections'))
  const ana = useFetch(() => api<{ platforms: NetStats[] }>(`/insights?days=${days}`), [days])
  const tl = useFetch(() => api<Timeline>(`/insights/timeline?bucket=${bucket}&platform=${platform}`), [bucket])
  const posts = useFetch(() => {
    const to = new Date(); const from = new Date(Date.now() - days * 86_400_000)
    return api<PostItem[]>(`/insights/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&platform=${platform}`)
  }, [days])
  const comments = useFetch(() => api<CommentRow[]>(`/comments?platform=${platform}`))

  const net = nets.data?.find((n) => n.platform === platform)
  const stats = ana.data?.platforms.find((p) => p.platform === platform)
  const account = net?.accounts[0]
  const connected = account?.status === 'active'
  const statsOK = !!connected && net?.capabilities.stats.status === 'available'
  const commentsOK = !!connected && net?.capabilities.comments.status === 'available'
  const pending = (comments.data ?? []).filter((c) => c.status === 'pending').length

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'apercu', label: 'Vue d’ensemble' },
    ...(statsOK ? [{ key: 'publications' as const, label: 'Publications' }] : []),
    ...(commentsOK ? [{ key: 'commentaires' as const, label: 'Commentaires', badge: pending }] : []),
    ...(statsOK ? [{ key: 'calendrier' as const, label: 'Calendrier' }, { key: 'conseils' as const, label: 'Conseils IA' }] : []),
    { key: 'connexion', label: 'Connexion' },
  ]
  const wanted = params.get('tab') as TabKey | null
  const tab: TabKey = tabs.some((t) => t.key === wanted) ? wanted! : 'apercu'
  const setTab = (k: TabKey) => setParams(k === 'apercu' ? {} : { tab: k }, { replace: true })

  // Retour de l'autorisation du réseau (la connexion se fait depuis cette page)
  const choose = params.get('choose') // identifiant d'une sélection de compte en attente (retour d'autorisation)
  const returned = useRef(false)
  useEffect(() => {
    if (returned.current) return // évite le double message (React exécute les effets deux fois en développement)
    returned.current = true
    const err = params.get('error')
    if (params.has('connected')) { toast('success', `Compte ${meta.label} connecté.`); nets.reload(); ana.reload(); comments.reload() }
    if (err) toast('error', `Connexion échouée : ${err}`)
    if (params.has('connected') || err) setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function refresh() {
    setRefreshing(true)
    try {
      await api('/connections/sync', { method: 'POST' })
      toast('success', 'Données actualisées.')
    } catch (e) {
      toast('error', (e as Error).message)
    }
    nets.reload(); ana.reload(); tl.reload(); posts.reload(); comments.reload()
    setRefreshing(false)
  }

  if (nets.loading && !nets.data) return <Spinner />
  if (nets.error || !net) return <ErrorBox error={nets.error ?? 'Réseau introuvable'} onRetry={nets.reload} />

  const pill = connected
    ? { t: 'Connecté', c: 'bg-emerald-50 text-emerald-700', d: 'bg-emerald-500' }
    : account?.status === 'expired'
      ? { t: 'Expiré', c: 'bg-amber-50 text-amber-700', d: 'bg-amber-500' }
      : { t: net.configured ? 'Non connecté' : 'Non configuré', c: 'bg-slate-100 text-slate-600', d: 'bg-slate-400' }

  const fit = connected && statsOK && tab === 'apercu'
  return (
    <div className={fit ? 'flex flex-col lg:h-[calc(100vh-8rem)] lg:min-h-[34rem]' : ''}>
      {/* En-tête */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200"><Logo platform={platform} size={28} /></span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{meta.label}</h1>
            <p className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              {account?.avatar_url && <img src={account.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" referrerPolicy="no-referrer" />}
              <span>{account?.account_name ?? 'Aucun compte connecté'}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${pill.c}`}><span className={`h-1.5 w-1.5 rounded-full ${pill.d}`} />{pill.t}</span>
            </p>
          </div>
        </div>
        {connected && (
          <div className="flex gap-2">
            {statsOK && (
              <label className="relative">
                <span className="sr-only">Période</span>
                <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)} className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pr-8 pl-3.5 text-sm font-medium shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500" />
              </label>
            )}
            <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Actualiser
            </button>
          </div>
        )}
      </div>

      {account?.last_error && <p className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {account.last_error}</p>}

      {/* Réseau non connecté: la connexion se fait ici, depuis la page du réseau */}
      {choose && (
        <AccountPicker
          id={choose}
          platform={platform}
          onDone={(ok) => { setParams({}, { replace: true }); nets.reload(); ana.reload(); comments.reload(); if (ok) { tl.reload(); posts.reload() } }}
        />
      )}
      {!connected && !choose && <ConnectionPanel net={net} onChanged={() => { nets.reload(); ana.reload(); comments.reload() }} />}

      {connected && (
        <>
          {/* Onglets */}
          <div className="mb-3 flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={`Sections ${meta.label}`}>
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {t.label}
                {!!t.badge && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">{t.badge}</span>}
              </button>
            ))}
          </div>

          {/* ---------- Vue d'ensemble ---------- */}
          {tab === 'apercu' && (statsOK ? (
            ana.loading && !stats ? <Spinner /> : stats ? (() => {
              const cur = stats.current
              const rate = cur.engagement.rate
              const reachLike = cur.reach !== null ? { label: 'Portée', value: cur.reach, prev: stats.previous.reach } : { label: 'Vues', value: cur.views, prev: stats.previous.views }
              const buckets = tl.data?.buckets ?? []
              const cList = comments.data ?? []
              const cDone = cList.filter((c) => c.status === 'done').length
              const cReplied = cList.filter((c) => c.status === 'replied').length
              const cPending = cList.filter((c) => c.status === 'pending').length
              const share = (n: number) => (cList.length ? Math.round((n / cList.length) * 100) : 0)
              const parts = ([['likes', 'J’aime / réactions'], ['comments', 'Commentaires'], ['shares', 'Partages'], ['saved', 'Enregistrements']] as const)
                .flatMap(([k, l]) => (cur[k] === null ? [] : [{ l: l as string, v: cur[k] as number }]))
              const partsMax = Math.max(...parts.map((x) => x.v), 1)
              const tile = 'rounded-2xl bg-white p-3.5 shadow-sm'
              const rows = [...(posts.data ?? [])].sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at)).slice(0, 4)
              return (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {/* Rangée 1: abonnés + chiffres clés */}
                  <div className="grid shrink-0 gap-3 lg:grid-cols-12">
                    <section className={`${tile} flex items-center gap-4 lg:col-span-4`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-slate-500">Abonnés</p>
                        <p className="truncate text-3xl font-semibold tracking-tight text-slate-900">{fmtNum(stats.followers.latest)}</p>
                        {stats.followers.latest !== null && stats.followers.first !== null && stats.followers.series.length > 1 && <Delta pct={pctChange(stats.followers.latest, stats.followers.first)} />}
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <Ring pct={rate === null ? 0 : rate * 100} size={52}>{rate === null ? '—' : `${(rate * 100).toFixed(1)}%`}</Ring>
                        <span className="text-[10px] text-slate-500">engagement</span>
                      </div>
                    </section>
                    <div className="grid grid-cols-2 gap-3 lg:col-span-8 lg:grid-cols-4">
                      {[
                        { l: 'Publications', v: fmtNum(cur.posts), d: pctChange(cur.posts, stats.previous.posts), s: buckets.map((b) => b.posts) },
                        { l: 'Interactions', v: cur.posts ? fmtNum(inter(cur)) : '—', d: pctChange(inter(cur), inter(stats.previous)), s: buckets.map((b) => b.interactions) },
                        { l: reachLike.label, v: fmtNum(reachLike.value), d: reachLike.value !== null && reachLike.prev !== null ? pctChange(reachLike.value, reachLike.prev) : null, s: [] as number[] },
                        { l: 'À traiter', v: commentsOK ? fmtNum(pending) : '—', d: null as number | null, s: [] as number[] },
                      ].map((k) => (
                        <section key={k.l} className={`${tile} flex flex-col justify-between`}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="text-xs text-slate-500">{k.l}</p>
                            <Spark values={k.s} className="h-6 w-14" />
                          </div>
                          <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold tracking-tight text-slate-900">{k.v}<span className="text-xs font-normal"><Delta pct={k.d} /></span></p>
                        </section>
                      ))}
                    </div>
                  </div>

                  {/* Rangée 2: engagement + détail + commentaires / meilleures publications */}
                  <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-12">
                    <section className={`${tile} flex min-h-0 flex-col lg:col-span-5`}>
                      <div className="flex shrink-0 items-center justify-between gap-2">
                        <div>
                          <h2 className="text-base font-semibold text-slate-900">Engagement</h2>
                          <p className="text-2xl font-semibold tracking-tight text-slate-900">{tl.data ? fmtNum(tl.data.total) : '—'}</p>
                        </div>
                        <div className="flex rounded-full bg-slate-100 p-0.5 text-xs" role="group" aria-label="Regroupement">
                          {([['week', 'Hebdo'], ['month', 'Mensuel']] as const).map(([k, l]) => (
                            <button key={k} onClick={() => setBucket(k)} aria-pressed={bucket === k} className={`rounded-full px-3 py-1 font-medium ${bucket === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{l}</button>
                          ))}
                        </div>
                      </div>
                      <div className="min-h-0 flex-1">
                        {tl.error ? <ErrorBox error={tl.error} onRetry={tl.reload} /> : tl.data ? <EngagementChart data={tl.data} className="h-48 lg:h-full" /> : <Spinner />}
                      </div>
                    </section>

                    <section className={`${tile} flex min-h-0 flex-col lg:col-span-3`}>
                      <h2 className="shrink-0 text-base font-semibold text-slate-900">Détail des interactions</h2>
                      {parts.length === 0 ? <p className="mt-3 text-sm text-slate-400">Pas de détail fourni.</p> : (
                        <ul className="mt-3 flex min-h-0 flex-1 flex-col justify-around gap-2 overflow-hidden">
                          {parts.map((x) => (
                            <li key={x.l}>
                              <div className="flex items-baseline justify-between text-sm"><span className="text-slate-600">{x.l}</span><span className="font-semibold tabular-nums text-slate-900">{fmtNum(x.v)}</span></div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-[#0b7a43] to-[#4fb883]" style={{ width: `${(x.v / partsMax) * 100}%` }} /></div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className={`${tile} flex min-h-0 flex-col lg:col-span-4`}>
                      {commentsOK ? (
                        <>
                          <div className="flex shrink-0 items-center justify-between">
                            <h2 className="text-base font-semibold text-slate-900">Commentaires</h2>
                            <button onClick={() => setTab('commentaires')} className="text-xs font-medium text-brand-700 hover:underline">Voir tout</button>
                          </div>
                          {cList.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucun commentaire pour le moment.</p> : (
                            <div className="mt-3 flex flex-1 items-center justify-around">
                              {([['À traiter', cPending, '#f59e0b'], ['Répondus', cReplied, '#0b7a43'], ['Traités', cDone, '#64748b']] as const).map(([l, n, col]) => (
                                <div key={l} className="flex flex-col items-center gap-1">
                                  <Ring pct={share(n)} size={56} color={col}>{share(n)}%</Ring>
                                  <span className="text-xs text-slate-600">{l}</span>
                                  <span className="text-sm font-semibold tabular-nums text-slate-900">{n}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <h2 className="flex shrink-0 items-center gap-2 text-base font-semibold text-slate-900"><Trophy size={15} className="text-amber-500" /> Meilleures publications</h2>
                          {stats.top.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucune publication sur la période.</p> : (
                            <ol className="mt-3 min-h-0 flex-1 space-y-2 overflow-hidden">
                              {stats.top.slice(0, 3).map((t, i) => (
                                <li key={t.remote_id} className="flex items-center gap-2 text-sm">
                                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">{i + 1}</span>
                                  <span className="min-w-0 flex-1 truncate">{t.permalink ? <a className="hover:underline" href={t.permalink} target="_blank" rel="noreferrer">{t.caption || '(sans légende)'}</a> : t.caption || '(sans légende)'}</span>
                                  <span className="font-semibold tabular-nums text-slate-900">{fmtNum(t.interactions)}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </>
                      )}
                    </section>
                  </div>

                  {/* Rangée 3: publications récentes + évolution des abonnés */}
                  <div className="grid shrink-0 gap-3 lg:h-40 lg:grid-cols-12">
                    <section className={`${tile} flex min-h-0 flex-col lg:col-span-7`}>
                      <div className="flex shrink-0 items-center justify-between">
                        <h2 className="text-base font-semibold text-slate-900">Publications récentes</h2>
                        <button onClick={() => setTab('publications')} className="text-xs font-medium text-brand-700 hover:underline">Voir tout</button>
                      </div>
                      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucune publication sur la période.</p> : (
                        <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                          {rows.map((p) => (
                            <li key={p.remote_id} className="flex h-[22px] items-center gap-3 text-sm">
                              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{p.permalink ? <a className="hover:underline" href={p.permalink} target="_blank" rel="noreferrer">{p.caption || '(sans légende)'}</a> : p.caption || '(sans légende)'}</span>
                              <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:inline">{format(new Date(p.published_at), 'd MMM', { locale: fr })}</span>
                              <span className="w-14 text-right font-semibold tabular-nums text-slate-900">{fmtNum(p.interactions)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section className={`${tile} flex min-h-0 flex-col lg:col-span-5`}>
                      <h2 className="shrink-0 text-base font-semibold text-slate-900">Évolution des abonnés</h2>
                      <div className="min-h-0 flex-1 overflow-hidden"><FollowersChart series={stats.followers.series} className="h-20" /></div>
                    </section>
                  </div>
                </div>
              )
            })() : <ErrorBox error={ana.error ?? 'Statistiques indisponibles'} onRetry={ana.reload} />
          ) : (
            <Section title={`Statistiques de ${meta.label}`}>
              <p className="mt-1 text-sm text-slate-600">{net.capabilities.stats.note}</p>
            </Section>
          ))}

          {/* ---------- Publications ---------- */}
          {tab === 'publications' && <PostsTable data={posts.data} loading={posts.loading} error={posts.error} reload={posts.reload} days={days} />}

          {/* ---------- Commentaires ---------- */}
          {tab === 'commentaires' && (
            comments.loading && !comments.data ? <Spinner /> : comments.error ? <ErrorBox error={comments.error} onRetry={comments.reload} /> :
            <CommentsList all={comments.data ?? []} posts={posts.data ?? []} onChange={comments.reload} />
          )}

          {/* ---------- Calendrier ---------- */}
          {tab === 'calendrier' && <PostCalendar platform={platform} />}

          {/* ---------- Conseils IA ---------- */}
          {tab === 'conseils' && <Advice platform={platform} label={meta.label} days={days} />}

          {/* ---------- Connexion et fonctionnalités ---------- */}
          {tab === 'connexion' && <ConnectionPanel net={net} onChanged={() => { nets.reload(); ana.reload(); comments.reload() }} />}
        </>
      )}
    </div>
  )
}

/** Connexion du compte, révocation et fonctionnalités de ce réseau: chaque page de réseau est indépendante. */
function ConnectionPanel({ net, onChanged }: { net: NetworkInfo; onChanged: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null)
  const meta = PLATFORM_META[net.platform]
  const account = net.accounts[0]
  const active = account?.status === 'active'
  const isAdmin = getRole() === 'admin' // connecter / déconnecter concerne toute l'équipe: réservé aux administrateurs

  async function connect() {
    setBusy('connect')
    try {
      const { url } = await api<{ url: string }>(`/connections/${net.platform}/start`, { method: 'POST' })
      window.location.href = url
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!account || !confirm(`Déconnecter ${account.account_name ?? 'ce compte'} ? Les jetons seront supprimés et l’accès révoqué quand le réseau le permet.`)) return
    setBusy('disconnect')
    try {
      const r = await api<{ revoked: boolean }>(`/connections/${account.id}`, { method: 'DELETE' })
      toast('success', r.revoked ? 'Compte déconnecté et accès révoqué.' : 'Compte déconnecté. Pour révoquer totalement l’accès, retirez l’application dans les réglages du réseau.')
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    }
    setBusy(null)
  }


  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-slate-50 ring-1 ring-slate-200"><Logo platform={net.platform} size={32} /></span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-slate-900">
              {active ? `Compte ${meta.label} connecté` : account?.status === 'expired' ? `La connexion à ${meta.label} a expiré` : `Connectez votre compte ${meta.label}`}
            </p>
            {(active || !net.configured) && (
              <p className="text-sm text-slate-500">
                {active
                  ? <>{account.account_name}{account.expires_at ? ` · valable jusqu’au ${format(new Date(account.expires_at), 'd MMMM yyyy', { locale: fr })}` : ''}</>
                  : 'Application non configurée'}
              </p>
            )}
          </div>
          {isAdmin ? <div className="flex flex-wrap gap-2">
            <button onClick={connect} disabled={!net.configured || busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
              {busy === 'connect' ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} {account ? 'Reconnecter' : 'Connecter mon compte'}
            </button>
            {account && (
              <button onClick={disconnect} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
                {busy === 'disconnect' ? <Loader2 size={15} className="animate-spin" /> : <Unplug size={15} />} Déconnecter
              </button>
            )}
          </div> : !active && <p className="text-sm text-slate-500">Un administrateur doit connecter ce compte.</p>}
        </div>

        {!net.configured && (
          <details className="group mt-4 rounded-xl bg-amber-50 text-amber-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium">
              <span className="flex items-center gap-2"><AlertTriangle size={15} /> Comment activer {meta.label} ?</span>
              <ChevronDown size={15} className="transition group-open:rotate-180" />
            </summary>
            <p className="px-3 pb-3 text-xs leading-relaxed">{net.setupHint}</p>
          </details>
        )}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function PostsTable({ data, loading, error, reload, days }: { data: PostItem[] | null; loading: boolean; error: string | null; reload: () => void; days: number }) {
  const [sort, setSort] = useState<'best' | 'worst' | 'recent'>('best')
  const cols = useMemo(() => METRIC_LABELS.filter(([k]) => (data ?? []).some((p) => typeof p.metrics[k] === 'number')), [data])
  const rows = useMemo(() => {
    const r = [...(data ?? [])]
    if (sort === 'best') r.sort((a, b) => b.interactions - a.interactions)
    else if (sort === 'worst') r.sort((a, b) => a.interactions - b.interactions)
    else r.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at))
    return r
  }, [data, sort])

  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Publications · {days} jours <span className="text-sm font-normal text-slate-400">({rows.length})</span></h2>
        <div className="flex rounded-xl bg-slate-100 p-0.5 text-sm" role="group" aria-label="Tri">
          {([['best', 'Meilleures'], ['worst', 'Moins bonnes'], ['recent', 'Récentes']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)} className={`rounded-[0.6rem] px-3 py-1.5 font-medium ${sort === k ? 'bg-white shadow-sm' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Aucune publication sur cette période.</p> : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="px-4 py-2.5 font-medium">Publication</th>{cols.map(([k, l]) => <th key={k} className="px-3 py-2.5 text-right font-medium">{l}</th>)}<th className="px-4 py-2.5 text-right font-medium">Interactions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.remote_id} className="hover:bg-slate-50/60">
                  <td className="max-w-xs px-4 py-3">
                    <p className="flex items-center gap-2 truncate font-medium text-slate-800">
                      <span className="truncate">{p.caption || '(sans légende)'}</span>
                      {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" aria-label="Voir la publication" className="shrink-0 text-brand-700"><ExternalLink size={13} /></a>}
                    </p>
                    <p className="text-xs text-slate-400">{format(new Date(p.published_at), 'd MMM yyyy HH:mm', { locale: fr })}{p.media_type ? ` · ${POST_TYPE[p.media_type] ?? p.media_type}` : ''}</p>
                  </td>
                  {cols.map(([k]) => <td key={k} className="px-3 py-3 text-right tabular-nums text-slate-600">{typeof p.metrics[k] === 'number' ? fmtNum(p.metrics[k]) : '—'}</td>)}
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">{fmtNum(p.interactions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CommentsList({ all, posts, onChange }: { all: CommentRow[]; posts: PostItem[]; onChange: () => void }) {
  const [status, setStatus] = useState<CommentRow['status'] | ''>('')
  const [q, setQ] = useState('')
  const count = (s: CommentRow['status']) => all.filter((c) => c.status === s).length
  const rows = all.filter((c) => (!status || c.status === status) && (!q.trim() || c.text.toLowerCase().includes(q.trim().toLowerCase()) || (c.author ?? '').toLowerCase().includes(q.trim().toLowerCase())))
  // Commentaires classés par publication (la plus récente d'abord)
  const groups = useMemo(() => {
    const byId = new Map(posts.map((p) => [p.remote_id, p]))
    const m = new Map<string, { key: string; post?: PostItem; comments: CommentRow[] }>()
    for (const c of rows) {
      const key = c.remote_media_id ?? 'none'
      if (!m.has(key)) m.set(key, { key, post: byId.get(key), comments: [] })
      m.get(key)!.comments.push(c)
    }
    const when = (g: { post?: PostItem; comments: CommentRow[] }) => +new Date(g.post?.published_at ?? g.comments[0].commented_at ?? 0)
    return [...m.values()].sort((a, b) => when(b) - when(a))
  }, [rows, posts])
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {([['', 'Tous', all.length], ['pending', 'À traiter', count('pending')], ['replied', 'Répondus', count('replied')], ['done', 'Traités', count('done')]] as [CommentRow['status'] | '', string, number][]).map(([k, l, n]) => (
          <button key={l} onClick={() => setStatus(k)} aria-pressed={status === k} className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${status === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>{l} <span className={status === k ? 'text-white/80' : 'text-slate-400'}>{n}</span></button>
        ))}
        <label className="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
          <span className="sr-only">Rechercher dans les commentaires</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
        </label>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center">
          <MessageSquare size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="font-medium text-slate-700">{all.length === 0 ? 'Aucun commentaire pour le moment' : 'Aucun commentaire ne correspond'}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/60">
              <header className="border-b border-slate-200 bg-white px-4 py-3 md:px-5">
                <p className="flex items-center gap-2 font-semibold text-slate-900">
                  <span className="truncate">{g.post?.caption || g.comments[0].media_caption || (g.key === 'none' ? 'Publication inconnue' : '(sans légende)')}</span>
                  {(g.post?.permalink || g.comments[0].media_url) && <a href={(g.post?.permalink || g.comments[0].media_url)!} target="_blank" rel="noreferrer" aria-label="Voir la publication" className="shrink-0 text-brand-700"><ExternalLink size={14} /></a>}
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                  {g.post && <span>{format(new Date(g.post.published_at), 'd MMM yyyy HH:mm', { locale: fr })}</span>}
                  {g.post && METRIC_LABELS.filter(([k]) => k === 'likes' || k === 'shares').filter(([k]) => typeof g.post!.metrics[k] === 'number').map(([k, l]) => <span key={k}>{l} : <b className="text-slate-700">{fmtNum(g.post!.metrics[k])}</b></span>)}
                  <span>{g.comments.length} commentaire{g.comments.length > 1 ? 's' : ''} affiché{g.comments.length > 1 ? 's' : ''}{typeof g.post?.metrics.comments === 'number' ? ` sur ${fmtNum(g.post.metrics.comments)}` : ''}</span>
                </p>
              </header>
              <ul className="space-y-3 p-3 md:p-4">{g.comments.map((c) => <li key={c.id}><CommentCard c={c} onChange={onChange} hideMedia /></li>)}</ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function Advice({ platform, label, days }: { platform: Platform; label: string; days: 7 | 30 | 90 }) {
  const toast = useToast()
  const [busy, setBusy] = useState<'analyze' | 'ask' | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ q: string; text: string } | null>(null)
  const scope = { days, network: platform }

  async function analyze() {
    setBusy('analyze')
    try { setAnalysis(await api<Analysis>('/ai/analyze', { method: 'POST', body: scope })) } catch (e) { toast('error', (e as Error).message) }
    setBusy(null)
  }
  async function ask(q: string) {
    if (q.trim().length < 3) return
    setBusy('ask')
    try { setAnswer({ q, text: (await api<{ answer: string }>('/ai/ask', { method: 'POST', body: { ...scope, question: q } })).answer }) } catch (e) { toast('error', (e as Error).message) }
    setBusy(null)
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button onClick={analyze} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
            {busy === 'analyze' ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} />} Analyser {label}
          </button>
        </div>
        <div className="mt-4 min-h-40 rounded-xl bg-slate-50/60 p-5">
          {busy === 'analyze' ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Analyse en cours…</p>
            : analysis ? (analysis.empty ? <p className="text-sm text-slate-600">{analysis.analysis}</p> : (
              <>
                <p className="mb-3 text-xs text-slate-500">Basé sur {analysis.basedOn.publications} publication(s)</p>
                <Markdown text={analysis.analysis} />
                {!!analysis.unverified?.length && <p className="mt-3 text-xs text-amber-700">Chiffres à vérifier : {analysis.unverified.join(", ")}</p>}
              </>))
            : <div className="flex flex-col items-center gap-2 py-6 text-center text-slate-300"><Sparkles size={28} /></div>}
        </div>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Sparkles size={16} className="text-brand-600" /> Poser une question</h2>
        <div className="my-3 flex flex-wrap gap-1.5">
          {QUESTIONS.map((q) => <button key={q} disabled={busy !== null} onClick={() => { setQuestion(q); ask(q) }} className="rounded-full border border-slate-200 px-2.5 py-1 text-left text-xs text-slate-600 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50">{q}</button>)}
        </div>
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); ask(question) }} className="flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} placeholder="Votre question…" aria-label="Votre question" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none" />
          <button type="submit" disabled={busy !== null || question.trim().length < 3} aria-label="Envoyer la question" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">{busy === 'ask' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button>
        </form>
        {answer && <div className="mt-4 rounded-xl bg-slate-50 p-4"><p className="mb-2 text-xs font-medium text-slate-500">« {answer.q} »</p><Markdown text={answer.text} /></div>}
      </section>
    </div>
  )
}

/** Choix du compte à connecter quand l'autorisation donne accès à plusieurs comptes (ex.: plusieurs Pages Facebook). */
function AccountPicker({ id, platform, onDone }: { id: string; platform: Platform; onDone: (connected: boolean) => void }) {
  const toast = useToast()
  const { data, error, loading } = useFetch(() =>
    api<{ platform: Platform; options: { id: string; name: string; avatar_url: string | null }[] }>(`/connections/pending/${id}`),
    [],
    0,
  )
  const [busy, setBusy] = useState<string | null>(null)
  const noun = platform === 'facebook' ? 'Page' : 'compte'

  async function pick(accountId: string, name: string) {
    setBusy(accountId)
    try {
      await api(`/connections/pending/${id}/select`, { method: 'POST', body: { account_id: accountId } })
      toast('success', `${name} connecté${noun === 'Page' ? 'e' : ''}.`)
      onDone(true)
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(null)
    }
  }

  async function cancel() {
    try { await api(`/connections/pending/${id}`, { method: 'DELETE' }) } catch { /* déjà expirée */ }
    onDone(false)
  }

  // Relance l'autorisation Facebook: la fenêtre permet de cocher d'autres Pages.
  async function reauthorize() {
    try {
      await api(`/connections/pending/${id}`, { method: 'DELETE' })
      const { url } = await api<{ url: string }>(`/connections/${platform}/start`, { method: 'POST' })
      window.location.href = url
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  if (loading && !data) return <Spinner />
  if (error || !data) return <div className="mb-5"><ErrorBox error={error ?? 'Sélection indisponible'} /><button onClick={() => onDone(false)} className="mt-2 text-sm text-slate-500 hover:text-slate-800">Fermer</button></div>

  return (
    <section className="mb-5 rounded-2xl border border-brand-100 bg-white p-5 shadow-sm" aria-label={`Choisir la ${noun} à connecter`}>
      <h2 className="text-lg font-semibold text-slate-900">Quelle {noun} voulez-vous connecter ?</h2>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.options.map((o) => (
          <li key={o.id}>
            <button
              onClick={() => pick(o.id, o.name)}
              disabled={busy !== null}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-600 hover:bg-brand-50 disabled:opacity-60"
            >
              {o.avatar_url
                ? <img src={o.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                : <span className="grid h-10 w-10 place-items-center rounded-full bg-slate-100"><Logo platform={platform} size={20} /></span>}
              <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{o.name}</span>
              {busy === o.id ? <Loader2 size={16} className="animate-spin text-slate-400" /> : <span className="text-sm font-medium text-brand-700">Connecter</span>}
            </button>
          </li>
        ))}
      </ul>
      {platform === 'facebook' && (
        <p className="mt-4 text-sm text-slate-500">
          Une Page manque ? Boussole ne voit que les Pages autorisées dans la fenêtre Facebook.{' '}
          <button onClick={reauthorize} disabled={busy !== null} className="font-medium text-brand-700 hover:underline">Autoriser d’autres Pages</button>
        </p>
      )}
      <button onClick={cancel} disabled={busy !== null} className="mt-4 text-sm text-slate-500 hover:text-slate-800">Annuler</button>
    </section>
  )
}
