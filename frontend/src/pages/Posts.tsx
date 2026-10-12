import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { ExternalLink, FileText, RotateCw, Send, Trash2 } from 'lucide-react'
import { api, type Post } from '../lib/api'
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, PlatformTag, Spinner, useFetch, useToast } from '../components/ui'

const STATUS: Record<Post['status'], { label: string; tone: 'slate' | 'blue' | 'amber' | 'green' | 'red' }> = {
  draft: { label: 'Brouillon', tone: 'slate' },
  scheduled: { label: 'Programmée', tone: 'blue' },
  publishing: { label: 'En cours', tone: 'amber' },
  published: { label: 'Publiée', tone: 'green' },
  partial: { label: 'Partielle', tone: 'amber' },
  failed: { label: 'Échec', tone: 'red' },
}
const TARGET: Record<string, string> = { pending: 'En attente', publishing: 'Envoi…', processing: 'Traitement par le réseau', published: 'Publié', failed: 'Échec' }

export default function Posts() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? ''
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const { data, error, loading, reload } = useFetch(() => api<Post[]>(`/posts${status ? `?status=${status}` : ''}`), [status])

  // Rafraîchit automatiquement tant qu'une publication est en cours.
  const inFlight = data?.some((p) => p.status === 'publishing')
  useFetchPoll(inFlight ?? false, reload)

  async function act(id: string, kind: 'retry' | 'publish' | 'delete') {
    if (kind === 'delete' && !confirm('Supprimer définitivement ?')) return
    setBusy(id + kind)
    try {
      if (kind === 'delete') await api(`/posts/${id}`, { method: 'DELETE' })
      else await api(`/posts/${id}/${kind}`, { method: 'POST' })
      toast('success', kind === 'delete' ? 'Supprimée.' : 'Lancé. Le résultat réel s’affichera ici.')
      reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
    setBusy(null)
  }

  return (
    <>
      <PageHeader
        title="Publications"
        subtitle="Historique et statut réel par réseau. Une publication n’est « Publiée » qu’après confirmation du réseau."
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
        {[['', 'Toutes'], ...Object.entries(STATUS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <button key={k} onClick={() => setParams(k ? { status: k } : {})} aria-pressed={status === k} className={`rounded-full px-3 py-1 text-sm ${status === k ? 'bg-slate-900 text-white' : 'bg-white ring-1 ring-slate-300'}`}>{l}</button>
        ))}
      </div>
      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && data.length === 0 && (
        <Card><Empty icon={<FileText size={36} />} title="Aucune publication" text="Les publications enregistrées par le tableau de bord apparaîtront ici." /></Card>
      )}
      <div className="space-y-3">
        {data?.map((p) => {
          const s = STATUS[p.status]
          return (
            <Card key={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    {p.scheduled_at && <span className="text-xs text-slate-500">{format(new Date(p.scheduled_at), "EEEE d MMM 'à' HH:mm", { locale: fr })}</span>}
                    {p.platforms.map((pl) => <PlatformTag key={pl} platform={pl} />)}
                  </div>
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap">{p.content || <span className="text-slate-400">(sans texte)</span>}</p>
                  {p.media.length > 0 && <p className="mt-1 text-xs text-slate-400">{p.media.length} média(s)</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(p.status === 'draft' || p.status === 'scheduled') && p.platforms.length > 0 && <Button onClick={() => act(p.id, 'publish')} loading={busy === p.id + 'publish'}><Send size={14} /> Publier</Button>}
                  {(p.status === 'failed' || p.status === 'partial') && <Button variant="primary" onClick={() => act(p.id, 'retry')} loading={busy === p.id + 'retry'}><RotateCw size={14} /> Réessayer</Button>}
                  {!['publishing', 'published', 'partial'].includes(p.status) && <Button variant="danger" aria-label="Supprimer" onClick={() => act(p.id, 'delete')}><Trash2 size={14} /></Button>}
                </div>
              </div>
              {p.post_targets.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                  {p.post_targets.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <PlatformTag platform={t.platform} />
                      <Badge tone={t.status === 'published' ? 'green' : t.status === 'failed' ? 'red' : t.status === 'pending' ? 'slate' : 'amber'}>{TARGET[t.status]}</Badge>
                      {t.remote_url && <a className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" href={t.remote_url} target="_blank" rel="noreferrer">Voir <ExternalLink size={12} /></a>}
                      {t.error && <span className="text-xs text-red-700">{t.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}

import { useEffect } from 'react'
function useFetchPoll(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return
    const id = setInterval(fn, 5000)
    return () => clearInterval(id)
  }, [active, fn])
}
