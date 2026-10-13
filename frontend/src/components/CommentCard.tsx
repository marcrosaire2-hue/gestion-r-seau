import { useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CheckCheck, ExternalLink, Loader2, RotateCcw, Send, Sparkles } from 'lucide-react'
import { api, type CommentRow } from '../lib/api'
import { PLATFORM_META } from '../lib/platforms'
import { PlatformTag, useToast } from './ui'

export const COMMENT_STATUS: Record<CommentRow['status'], { label: string; pill: string; dot: string }> = {
  pending: { label: 'À traiter', pill: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  replied: { label: 'Répondu', pill: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  done: { label: 'Traité', pill: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
}

export function CommentCard({ c, onChange, hideMedia = false }: { c: CommentRow; onChange: () => void; hideMedia?: boolean }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sugg, setSugg] = useState<string[]>([])
  const st = COMMENT_STATUS[c.status]
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
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold uppercase ring-1 ${meta.soft}`} aria-hidden>{(c.author ?? '?').replace('@', '')[0] || '?'}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-semibold text-slate-900">{c.author ?? 'Anonyme'}</span>
            <PlatformTag platform={c.platform} />
            {when && <time dateTime={c.commented_at!} title={format(when, "d MMMM yyyy 'à' HH:mm", { locale: fr })} className="text-xs text-slate-400">{formatDistanceToNow(when, { addSuffix: true, locale: fr })}</time>}
            <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${st.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</span>
          </div>

          {!hideMedia && (c.media_caption || c.media_url) && (
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
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
