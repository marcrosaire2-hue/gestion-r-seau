import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AlertTriangle, BarChart3, CalendarDays, CheckCheck, ChevronDown, ExternalLink, Eye, FileText, Heart, Image as ImageIcon, Lightbulb, Link2, Loader2, MessageCircle, MessageSquare, MessagesSquare, RefreshCw, Search, Send, Sparkles, Trophy, TrendingUp, Unplug, Users, Video } from 'lucide-react'
import { api, type CommentRow, type NetworkInfo, type Platform } from '../lib/api'
import { getRole } from '../lib/session'
import { Logo, PLATFORM_META } from '../lib/platforms'
import { DeltaText, EngagementChart, FollowersArea, Ring, Spark, pctChange, type Timeline } from '../components/charts'
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
  <section className={`rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 ${className}`}>
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
      : { t: net.configured ? 'Non connecté' : 'Non configuré', c: 'bg-red-50 text-red-600', d: 'bg-red-500' }

  const fit = connected && statsOK && tab === 'apercu'
  const TAB_ICON: Record<TabKey, ReactNode> = {
    apercu: <BarChart3 size={17} />, publications: <FileText size={17} />, commentaires: <MessageSquare size={17} />,
    calendrier: <CalendarDays size={17} />, conseils: <Lightbulb size={17} />, connexion: <Link2 size={17} />,
  }
  return (
    <div className={fit ? `flex flex-col [@media(min-width:1280px)_and_(min-height:700px)]:h-[calc(100vh-7rem)]` : ''}>
      {/* En-tête */}
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="shrink-0"><Logo platform={platform} size={60} /></span>
          <div>
            <h1 className="text-3xl leading-tight font-bold tracking-tight text-slate-900">{meta.label}</h1>
            <p className="flex flex-wrap items-center gap-2.5 text-sm text-slate-500">
              {account?.avatar_url && <img src={account.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />}
              <span className="text-base">{account?.account_name ?? 'Aucun compte connecté'}</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ${pill.c}`}><span className={`h-2 w-2 rounded-full ${pill.d}`} />{pill.t}</span>
            </p>
          </div>
        </div>
        {connected && (
          <div className="flex flex-wrap gap-2">
            {statsOK && (
              <label className="relative">
                <span className="sr-only">Période</span>
                <CalendarDays size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-600" />
                <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)} className="appearance-none rounded-full bg-white py-2.5 pr-9 pl-10 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-slate-600" />
              </label>
            )}
            <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-100 hover:bg-slate-50 disabled:opacity-60">
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
          <div className="mb-3 flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={`Sections ${meta.label}`}>
            {tabs.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-[3px] px-3.5 py-2.5 text-[15px] font-medium transition ${tab === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900'}`}>
                {TAB_ICON[t.key]}
                {t.label}
                {!!t.badge && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{t.badge}</span>}
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
              const tile = 'min-w-0 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-100'
              const rows = [...(posts.data ?? [])].sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at)).slice(0, 3)
              const followerSeries = stats.followers.series.map((s) => s.value)
              const iconCls = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm'
              const kpis = [
                { l: 'Publications', v: fmtNum(cur.posts), d: pctChange(cur.posts, stats.previous.posts), s: buckets.map((b) => b.posts), vs: true, icon: <FileText size={20} />, ic: 'bg-blue-500', tx: 'text-blue-600', card: '', col: '#3b82f6' },
                { l: 'Interactions', v: cur.posts ? fmtNum(inter(cur)) : '—', d: pctChange(inter(cur), inter(stats.previous)), s: buckets.map((b) => b.interactions), vs: true, icon: <Heart size={20} fill="currentColor" />, ic: 'bg-pink-500', tx: 'text-pink-600', card: 'bg-gradient-to-br from-pink-50 to-white', col: '#ec4899' },
                { l: reachLike.label, v: fmtNum(reachLike.value), d: reachLike.value !== null && reachLike.prev !== null ? pctChange(reachLike.value, reachLike.prev) : null, s: [] as number[], vs: true, icon: <MessagesSquare size={20} />, ic: 'bg-violet-500', tx: 'text-violet-600', card: '', col: '#8b5cf6' },
                { l: 'À traiter', v: commentsOK ? fmtNum(pending) : '—', d: null as number | null, s: [] as number[], vs: false, icon: <CalendarDays size={20} />, ic: 'bg-teal-500', tx: 'text-teal-600', card: '', col: '#14b8a6' },
              ]
              return (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {/* Rangée 1: abonnés + chiffres clés */}
                  <div className="grid shrink-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 min-[1100px]:grid-cols-[minmax(0,1.5fr)_repeat(4,minmax(0,1fr))]">
                    <section className={`${tile} flex items-center gap-3 min-[480px]:max-[1099px]:col-span-2`}>
                      <span className={`${iconCls} bg-emerald-500`}><Users size={20} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-emerald-600">Abonnés</p>
                        <p className="truncate text-2xl leading-tight font-semibold tracking-tight text-slate-900">{fmtNum(stats.followers.latest)}</p>
                        <p className="flex min-h-6 items-center gap-2 text-xs text-slate-500">
                          {stats.followers.latest !== null && stats.followers.first !== null && stats.followers.series.length > 1 && <DeltaText pct={pctChange(stats.followers.latest, stats.followers.first)} />}
                          <Spark values={followerSeries} color="#10b981" className="h-6 w-14" />
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <Ring pct={rate === null ? 0 : rate * 100} size={48} stroke={6} color="#10b981">{rate === null ? '–' : `${(rate * 100).toFixed(1)}%`}</Ring>
                        <span className="text-[10px] text-slate-500">engagement</span>
                      </div>
                    </section>
                    {kpis.map((k) => (
                      <section key={k.l} className={`${tile} ${k.card} flex items-center gap-3`}>
                        <span className={`${iconCls} ${k.ic}`}>{k.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-xs font-medium ${k.tx}`}>{k.l}</p>
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-2xl leading-tight font-semibold tracking-tight text-slate-900">{k.v}</p>
                            <Spark values={k.s} color={k.col} className="h-6 w-12 shrink-0" />
                          </div>
                          <p className="flex min-h-6 items-center gap-1.5 whitespace-nowrap text-xs text-slate-500">{k.vs && <><DeltaText pct={k.d} /><span className="min-[1500px]:hidden">vs. {days} j</span><span className="hidden min-[1500px]:inline">vs. {days} jours</span></>}</p>
                        </div>
                      </section>
                    ))}
                  </div>

                  {/* Rangée 2: engagement + détail + commentaires */}
                  <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:max-[1279px]:grid-cols-2 min-[1280px]:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
                    <section className={`${tile} flex min-h-0 min-w-0 flex-col overflow-hidden md:max-[1279px]:col-span-2`}>
                      <div className="flex shrink-0 items-center justify-between gap-2">
                        <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-white"><TrendingUp size={17} /></span> Engagement
                        </h2>
                        <div className="flex rounded-full bg-slate-100 p-0.5 text-xs" role="group" aria-label="Regroupement">
                          {([['week', 'Hebdo'], ['month', 'Mensuel']] as const).map(([k, l]) => (
                            <button key={k} onClick={() => setBucket(k)} aria-pressed={bucket === k} className={`rounded-full px-3.5 py-1.5 font-medium ${bucket === k ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500'}`}>{l}</button>
                          ))}
                        </div>
                      </div>
                      <div className="min-h-0 flex-1">
                        {tl.error ? <ErrorBox error={tl.error} onRetry={tl.reload} /> : tl.data ? <EngagementChart data={tl.data} className={`h-56 [@media(min-width:1280px)_and_(min-height:700px)]:h-full [@media(min-width:1280px)_and_(min-height:700px)]:min-h-[6rem]`} /> : <Spinner />}
                      </div>
                    </section>

                    <section className={`${tile} flex min-h-0 min-w-0 flex-col`}>
                      <h2 className="flex shrink-0 items-center gap-3 text-base font-semibold text-slate-900"><MessagesSquare size={22} className="text-brand-700" /> Détail des interactions</h2>
                      {parts.length === 0 ? <p className="mt-3 text-sm text-slate-400">Pas de détail fourni.</p> : (
                        <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-around gap-2 overflow-hidden">
                          {parts.map((x) => (
                            <li key={x.l}>
                              <div className="flex items-baseline justify-between text-sm"><span className="text-slate-700">{x.l}</span><span className="font-semibold tabular-nums text-slate-900">{fmtNum(x.v)}</span></div>
                              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-[#0b7a43] to-[#4fc08d]" style={{ width: `${Math.max((x.v / partsMax) * 100, x.v > 0 ? 4 : 0)}%` }} /></div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className={`${tile} flex min-h-0 min-w-0 flex-col`}>
                      {commentsOK ? (
                        <>
                          <div className="flex shrink-0 items-center justify-between">
                            <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900"><MessageCircle size={22} className="text-brand-700" /> Commentaires</h2>
                            <button onClick={() => setTab('commentaires')} className="text-sm font-medium text-brand-700 hover:underline">Voir tout</button>
                          </div>
                          {cList.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucun commentaire pour le moment.</p> : (
                            <div className="mt-2 flex flex-1 items-center justify-around">
                              {([['À traiter', cPending, '#f59e0b'], ['Répondus', cReplied, '#10b981'], ['Traités', cDone, '#64748b']] as const).map(([l, n, col]) => (
                                <div key={l} className="flex flex-col items-center gap-0.5">
                                  <Ring pct={share(n)} size={52} stroke={7} color={col}>{share(n)}%</Ring>
                                  <span className="mt-1 text-xs text-slate-600">{l}</span>
                                  <span className="text-base font-semibold tabular-nums text-slate-900">{n}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <h2 className="flex shrink-0 items-center gap-3 text-base font-semibold text-slate-900"><Trophy size={20} className="text-amber-500" /> Meilleures publications</h2>
                          {stats.top.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucune publication sur la période.</p> : (
                            <ol className="mt-3 min-h-0 flex-1 space-y-2 overflow-hidden">
                              {stats.top.slice(0, 3).map((t, i) => (
                                <li key={t.remote_id} className="flex items-center gap-2 text-sm">
                                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{i + 1}</span>
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
                  <div className={`grid shrink-0 grid-cols-1 gap-3 min-[1100px]:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] [@media(min-width:1280px)_and_(min-height:700px)]:h-44`}>
                    <section className={`${tile} flex min-h-0 min-w-0 flex-col`}>
                      <div className="flex shrink-0 items-center justify-between">
                        <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900"><span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-700 text-white"><FileText size={16} /></span> Publications récentes</h2>
                        <button onClick={() => setTab('publications')} className="text-sm font-medium text-brand-700 hover:underline">Voir tout</button>
                      </div>
                      {rows.length === 0 ? <p className="mt-3 text-sm text-slate-400">Aucune publication sur la période.</p> : (
                        <ul className="mt-1 min-h-0 flex-1 divide-y divide-slate-100 overflow-hidden">
                          {rows.map((p) => {
                            const views = p.metrics.views
                            const hasViews = typeof views === 'number'
                            return (
                              <li key={p.remote_id} className="flex h-10 items-center gap-3 text-sm">
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden>{p.media_type && /VIDEO|REEL/i.test(p.media_type) ? <Video size={15} /> : <ImageIcon size={15} />}</span>
                                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{p.permalink ? <a className="hover:underline" href={p.permalink} target="_blank" rel="noreferrer">{p.caption || '(sans légende)'}</a> : p.caption || '(sans légende)'}</span>
                                <span className="hidden whitespace-nowrap text-xs text-slate-500 sm:inline">{format(new Date(p.published_at), 'd MMM', { locale: fr })}</span>
                                <span title={hasViews ? 'Vues' : 'Interactions'} className="inline-flex w-14 items-center justify-end gap-1.5 font-semibold tabular-nums text-slate-900">
                                  {hasViews ? <Eye size={15} className="text-brand-700" /> : <Heart size={14} className="text-brand-700" />}{fmtNum(hasViews ? views : p.interactions)}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </section>
                    <section className={`${tile} flex min-h-0 min-w-0 flex-col`}>
                      <h2 className="flex shrink-0 items-center gap-3 text-base font-semibold text-slate-900"><TrendingUp size={20} className="text-brand-700" /> Évolution des abonnés</h2>
                      <div className="mt-3 min-h-0 flex-1"><FollowersArea series={stats.followers.series} className={`h-36 [@media(min-width:1280px)_and_(min-height:700px)]:h-full`} /></div>
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
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
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
            <button onClick={connect} disabled={!net.configured || busy !== null} className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50">
              {busy === 'connect' ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} {account ? 'Reconnecter' : 'Connecter mon compte'}
            </button>
            {account && (
              <button onClick={disconnect} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
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

  const all = data ?? []
  const total = all.reduce((a, p) => a + p.interactions, 0)
  const best = all.reduce<PostItem | null>((b, p) => (!b || p.interactions > b.interactions ? p : b), null)
  const tile = 'flex min-w-0 items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-slate-100'
  const icon = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-3">
        <section className={tile}>
          <span className={`${icon} bg-blue-500`}><FileText size={20} /></span>
          <div className="min-w-0"><p className="text-xs font-medium text-blue-600">Publications</p><p className="text-2xl leading-tight font-semibold tracking-tight text-slate-900">{fmtNum(all.length)}</p><p className="text-xs text-slate-500">sur {days} jours</p></div>
        </section>
        <section className={`${tile} bg-gradient-to-br from-pink-50 to-white`}>
          <span className={`${icon} bg-pink-500`}><Heart size={20} fill="currentColor" /></span>
          <div className="min-w-0"><p className="text-xs font-medium text-pink-600">Interactions</p><p className="text-2xl leading-tight font-semibold tracking-tight text-slate-900">{all.length ? fmtNum(total) : '—'}</p><p className="text-xs text-slate-500">sur {days} jours</p></div>
        </section>
        <section className={tile}>
          <span className={`${icon} bg-amber-500`}><Trophy size={20} /></span>
          <div className="min-w-0 flex-1"><p className="text-xs font-medium text-amber-600">Meilleure publication</p><p className="text-2xl leading-tight font-semibold tracking-tight text-slate-900">{best ? fmtNum(best.interactions) : '—'}</p><p className="truncate text-xs text-slate-500">{best ? best.caption || '(sans légende)' : 'Aucune publication'}</p></div>
        </section>
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-white"><FileText size={17} /></span>
            Publications · {days} jours <span className="text-sm font-normal text-slate-400">({rows.length})</span>
          </h2>
          <div className="flex rounded-full bg-slate-100 p-0.5 text-xs" role="group" aria-label="Tri">
            {([['best', 'Meilleures'], ['worst', 'Moins bonnes'], ['recent', 'Récentes']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={sort === k} onClick={() => setSort(k)} className={`rounded-full px-3.5 py-1.5 font-medium ${sort === k ? 'bg-brand-700 text-white shadow-sm' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? <p className="mt-4 rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Aucune publication sur cette période.</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-slate-500">
                <tr className="border-b border-slate-100"><th className="py-2.5 pr-3 font-medium">Publication</th>{cols.map(([k, l]) => <th key={k} className="px-3 py-2.5 text-right font-medium">{l}</th>)}<th className="py-2.5 pl-3 text-right font-medium">Interactions</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.remote_id} className="hover:bg-slate-50/60">
                    <td className="max-w-xs py-3 pr-3">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500" aria-hidden>{p.media_type && /VIDEO|REEL/i.test(p.media_type) ? <Video size={17} /> : <ImageIcon size={17} />}</span>
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium text-slate-800">
                            <span className="truncate">{p.caption || '(sans légende)'}</span>
                            {p.permalink && <a href={p.permalink} target="_blank" rel="noreferrer" aria-label="Voir la publication" className="shrink-0 text-brand-700"><ExternalLink size={13} /></a>}
                          </p>
                          <p className="text-xs text-slate-500">{format(new Date(p.published_at), 'd MMM yyyy HH:mm', { locale: fr })}{p.media_type ? ` · ${POST_TYPE[p.media_type] ?? p.media_type}` : ''}</p>
                        </div>
                      </div>
                    </td>
                    {cols.map(([k]) => <td key={k} className="px-3 py-3 text-right tabular-nums text-slate-600">{typeof p.metrics[k] === 'number' ? fmtNum(p.metrics[k]) : '—'}</td>)}
                    <td className="py-3 pl-3 text-right"><span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-emerald-700"><Heart size={12} />{fmtNum(p.interactions)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
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
  const tiles = ([
    ['', 'Tous', all.length, <MessagesSquare key="t" size={20} />, 'bg-blue-500', 'text-blue-600', ''],
    ['pending', 'À traiter', count('pending'), <MessageCircle key="p" size={20} />, 'bg-amber-500', 'text-amber-600', ''],
    ['replied', 'Répondus', count('replied'), <Send key="r" size={19} />, 'bg-emerald-500', 'text-emerald-600', ''],
    ['done', 'Traités', count('done'), <CheckCheck key="d" size={20} />, 'bg-slate-500', 'text-slate-600', ''],
  ] as [CommentRow['status'] | '', string, number, ReactNode, string, string, string][])
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-4">
        {tiles.map(([k, l, n, ico, bg, tx]) => (
          <button key={l} onClick={() => setStatus(k)} aria-pressed={status === k}
            className={`flex min-w-0 items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-sm transition hover:shadow-md ${status === k ? 'ring-2 ring-brand-600' : 'ring-1 ring-slate-100'}`}>
            <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white shadow-sm ${bg}`}>{ico}</span>
            <span className="min-w-0">
              <span className={`block truncate text-xs font-medium ${tx}`}>{l}</span>
              <span className="block text-2xl leading-tight font-semibold tracking-tight text-slate-900">{n}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-3 text-base font-semibold text-slate-900">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-white"><MessageCircle size={17} /></span> Commentaires
          <span className="text-sm font-normal text-slate-400">({rows.length})</span>
        </h2>
        <label className="relative ml-auto min-w-52 flex-1 sm:max-w-xs">
          <span className="sr-only">Rechercher dans les commentaires</span>
          <Search size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher" className="w-full rounded-full bg-white py-2.5 pr-4 pl-10 text-sm shadow-sm ring-1 ring-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
        </label>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl bg-white px-4 py-12 text-center shadow-sm ring-1 ring-slate-100">
          <MessageSquare size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="font-medium text-slate-700">{all.length === 0 ? 'Aucun commentaire pour le moment' : 'Aucun commentaire ne correspond'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key} className="overflow-hidden rounded-2xl bg-slate-50/70 ring-1 ring-slate-100">
              <header className="flex items-start gap-3 bg-white px-4 py-3 md:px-5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-700 text-white"><FileText size={16} /></span>
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold text-slate-900">
                    <span className="truncate">{g.post?.caption || g.comments[0].media_caption || (g.key === 'none' ? 'Publication inconnue' : '(sans légende)')}</span>
                    {(g.post?.permalink || g.comments[0].media_url) && <a href={(g.post?.permalink || g.comments[0].media_url)!} target="_blank" rel="noreferrer" aria-label="Voir la publication" className="shrink-0 text-brand-700"><ExternalLink size={14} /></a>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                    {g.post && <span>{format(new Date(g.post.published_at), 'd MMM yyyy HH:mm', { locale: fr })}</span>}
                    {g.post && METRIC_LABELS.filter(([k]) => k === 'likes' || k === 'shares').filter(([k]) => typeof g.post!.metrics[k] === 'number').map(([k, l]) => <span key={k}>{l} : <b className="text-slate-700">{fmtNum(g.post!.metrics[k])}</b></span>)}
                    <span>{g.comments.length} commentaire{g.comments.length > 1 ? 's' : ''} affiché{g.comments.length > 1 ? 's' : ''}{typeof g.post?.metrics.comments === 'number' ? ` sur ${fmtNum(g.post.metrics.comments)}` : ''}</span>
                  </p>
                </div>
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
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button onClick={analyze} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-full bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-600 disabled:opacity-60">
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
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
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
