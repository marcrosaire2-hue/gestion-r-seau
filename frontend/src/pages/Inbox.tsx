import { useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { AlertTriangle, CheckCheck, ChevronDown, ExternalLink, Loader2, MessageSquare, RefreshCw, RotateCcw, Search, Send, Sparkles } from 'lucide-react'
import { api, type CommentRow, type NetworkInfo, type Platform } from '../lib/api'
import { PLATFORM_LIST, PLATFORM_META } from '../lib/platforms'
import { ErrorBox, PlatformTag, Spinner, fmtNum, useFetch, useToast } from '../components/ui'

type Status = CommentRow['status']
const ST: Record<Status, { label: string; pill: string; dot: string }> = {
  pending: { label: 'À traiter', pill: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  replied: { label: 'Répondu', pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  done: { label: 'Traité', pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
}

export default function Inbox() {
  const toast = useToast()
  const [status, setStatus] = useState<Status | ''>('')
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const [syncing, setSyncing] = useState(false)

  const { data, error, loading, reload } = useFetch(() => api<CommentRow[]>('/comments'))
  const { data: nets } = useFetch(() => api<NetworkInfo[]>('/connections'))
  const limited = nets?.filter((n) => n.capabilities.comments.status !== 'available') ?? []

  const all = data ?? []
  const count = (s: Status) => all.filter((c) => c.status === s).length

  const rows = useMemo(() => {
    const f = from ? new Date(from + 'T00:00:00').getTime() : -Infinity
    const t = to ? new Date(to + 'T23:59:59').getTime() : Infinity
    const s = q.trim().toLowerCase()
    return all.filter((c) => {
      const at = c.commented_at ? new Date(c.commented_at).getTime() : 0
      return (!status || c.status === status) && (!platform || c.platform === platform) && at >= f && at <= t &&
        (!s || c.text.toLowerCase().includes(s) || (c.author ?? '').toLowerCase().includes(s))
    })
  }, [all, status, platform, from, to, q])

  async function sync() {
    setSyncing(true)
    try {
      await api('/comments/sync', { method: 'POST' })
      toast('success', 'Commentaires synchronisés.')
      reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
    setSyncing(false)
  }

  const filtered = !!(status || platform || from || to || q)
  const reset = () => { setStatus(''); setPlatform(''); setFrom(''); setTo(''); setQ('') }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Commentaires</h1>
          <p className="max-w-2xl text-sm text-slate-500">Les commentaires accessibles avec vos permissions. Les réactions sont des compteurs : les personnes qui réagissent ne sont pas identifiables.</p>
        </div>
        <button onClick={sync} disabled={syncing} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} /> Actualiser
        </button>
      </div>

      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && (
        <>
          {/* Bilan cliquable */}
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {([['', 'Tous', all.length], ['pending', 'À traiter', count('pending')], ['replied', 'Répondus', count('replied')], ['done', 'Traités', count('done')]] as [Status | '', string, number][]).map(([k, l, n]) => (
              <button key={l} onClick={() => setStatus(k)} aria-pressed={status === k}
                className={`rounded-2xl border bg-white px-4 py-3 text-left shadow-sm transition hover:border-brand-500 ${status === k ? 'border-brand-600 ring-1 ring-brand-600' : 'border-slate-200'}`}>
                <p className={`text-2xl font-semibold tracking-tight ${k === 'pending' && n > 0 ? 'text-amber-600' : 'text-slate-900'}`}>{fmtNum(n)}</p>
                <p className="text-xs text-slate-500">{l}</p>
              </button>
            ))}
          </div>

          {limited.length > 0 && (
            <details className="group mb-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3.5 text-sm font-medium">
                <span className="flex items-center gap-2"><AlertTriangle size={16} /> Limites des API officielles : {limited.map((n) => n.label).join(', ')}</span>
                <ChevronDown size={15} className="transition group-open:rotate-180" />
              </summary>
              <ul className="space-y-1 px-3.5 pb-3.5 text-xs">
                {limited.map((n) => <li key={n.platform}><strong>{n.label} :</strong> {n.capabilities.comments.note}</li>)}
              </ul>
            </details>
          )}

          {/* Filtres */}
          <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
            <label className="relative">
              <span className="sr-only">Rechercher dans les commentaires</span>
              <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un auteur ou un mot" className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" />
            </label>
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Réseau" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')}>
              <option value="">Tous les réseaux</option>
              {PLATFORM_LIST.map((p) => <option key={p} value={p}>{PLATFORM_META[p].label}</option>)}
            </select>
            <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" type="date" aria-label="Depuis le" value={from} onChange={(e) => setFrom(e.target.value)} />
            <input className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" type="date" aria-label="Jusqu’au" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {filtered && (
            <p className="mb-3 flex items-center gap-2 text-xs text-slate-500">{rows.length} résultat(s) sur {all.length} <button onClick={reset} className="font-medium text-brand-700 hover:underline">Réinitialiser les filtres</button></p>
          )}

          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-14 text-center">
              <MessageSquare size={34} className="mx-auto mb-2 text-slate-300" />
              <p className="font-medium text-slate-700">{all.length === 0 ? 'Aucun commentaire pour le moment' : 'Aucun commentaire ne correspond aux filtres'}</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                {all.length === 0 ? 'Connectez un compte compatible puis cliquez sur « Actualiser ». Seuls les commentaires des publications récentes sont synchronisés.' : 'Modifiez ou réinitialisez les filtres.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {rows.map((c) => <li key={c.id}><CommentCard c={c} onChange={reload} /></li>)}
            </ul>
          )}
        </>
      )}
    </>
  )
}

function CommentCard({ c, onChange }: { c: CommentRow; onChange: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sugg, setSugg] = useState<string[]>([])
  const st = ST[c.status]
  const when = c.commented_at ? new Date(c.commented_at) : null
  const meta = PLATFORM_META[c.platform]

  async function run(kind: 'reply' | 'done' | 'reopen' | 'ai') {
    setBusy(kind)
    try {
      if (kind === 'reply') { await api(`/comments/${c.id}/reply`, { method: 'POST', body: { text } }); toast('success', 'Réponse envoyée sur le réseau.'); setText(''); setOpen(false) }
      if (kind === 'done') await api(`/comments/${c.id}/done`, { method: 'POST' })
      if (kind === 'reopen') await api(`/comments/${c.id}/reopen`, { method: 'POST' })
      if (kind === 'ai') setSugg((await api<{ suggestions: string[] }>('/ai/reply-suggestions', { method: 'POST', body: { comment_id: c.id } })).suggestions)
      if (kind !== 'ai') onChange()
    } catch (e) {
      toast('error', (e as Error).message)
    }
    setBusy(null)
  }

  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-sm md:p-5 ${c.status === 'pending' ? 'border-slate-200' : 'border-slate-200/70'}`}>
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold uppercase ring-1 ${meta.soft}`} aria-hidden>{(c.author ?? '?').replace('@', '')[0] || '?'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-semibold text-slate-900">{c.author ?? 'Anonyme'}</span>
            <PlatformTag platform={c.platform} />
            {when && <time dateTime={c.commented_at!} title={format(when, "d MMMM yyyy 'à' HH:mm", { locale: fr })} className="text-xs text-slate-400">{formatDistanceToNow(when, { addSuffix: true, locale: fr })}</time>}
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</span>
          </div>

          {(c.media_caption || c.media_url) && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
              <span className="truncate">Sur : « {c.media_caption || 'publication'} »</span>
              {c.media_url && <a href={c.media_url} target="_blank" rel="noreferrer" aria-label="Voir la publication" className="shrink-0 text-brand-700 hover:text-brand-600"><ExternalLink size={12} /></a>}
            </p>
          )}

          <p className="mt-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-slate-800">{c.text}</p>

          {c.reply_text && (
            <div className="mt-3 rounded-xl border-l-4 border-brand-600 bg-brand-50/60 p-3 text-sm text-slate-700">
              <p className="mb-0.5 text-xs font-medium text-brand-700">Votre réponse</p>
              {c.reply_text}
            </div>
          )}

          {/* Actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {c.status === 'pending' ? (
              <>
                <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-700"><Send size={14} /> Répondre</button>
                <button onClick={() => run('done')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
                  {busy === 'done' ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Marquer comme traité
                </button>
              </>
            ) : (
              <button onClick={() => run('reopen')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
                {busy === 'reopen' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Rouvrir
              </button>
            )}
          </div>

          {open && c.status === 'pending' && (
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <textarea className="w-full resize-y rounded-lg border border-slate-200 bg-white p-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none" rows={3} autoFocus aria-label="Votre réponse" placeholder="Votre réponse…" value={text} onChange={(e) => setText(e.target.value)} />
              {sugg.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {sugg.map((s, i) => <button key={i} onClick={() => setText(s)} className="rounded-full bg-white px-3 py-1 text-left text-xs text-brand-700 ring-1 ring-brand-100 hover:bg-brand-50">{s}</button>)}
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button onClick={() => run('reply')} disabled={!text.trim() || busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
                  {busy === 'reply' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Envoyer la réponse
                </button>
                <button onClick={() => run('ai')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
                  {busy === 'ai' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} className="text-brand-600" />} Suggérer (IA)
                </button>
                <button onClick={() => setOpen(false)} className="ml-auto text-sm text-slate-500 hover:text-slate-800">Annuler</button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">La réponse n’est envoyée sur le réseau qu’au clic sur « Envoyer la réponse ».</p>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
