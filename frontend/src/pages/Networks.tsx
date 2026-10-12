import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleSlash, Clock, Link2, RefreshCw, Unplug } from 'lucide-react'
import { api, type CapKey, type CapStatus, type NetworkInfo } from '../lib/api'
import { Logo } from '../lib/platforms'
import { ErrorBox, Spinner, useFetch, useToast } from '../components/ui'

const CAP_LABEL: Record<CapKey, string> = {
  publish: 'Publier',
  schedule: 'Programmer',
  stats: 'Statistiques',
  comments: 'Lire les commentaires',
  reply: 'Répondre',
  reactions: 'Réactions',
  messages: 'Messages',
}
// Plateforme de suivi et d'analyse: la publication n'est pas proposée dans l'interface.
const CAPS = (Object.keys(CAP_LABEL) as CapKey[]).filter((k) => k !== 'publish' && k !== 'schedule')

const CHIP: Record<CapStatus, { box: string; icon: typeof CheckCircle2; label: string }> = {
  available: { box: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: CheckCircle2, label: 'Disponible' },
  requires_approval: { box: 'bg-amber-50 text-amber-800 ring-amber-200', icon: Clock, label: 'Soumis à validation' },
  unavailable: { box: 'bg-slate-50 text-slate-400 ring-slate-200', icon: CircleSlash, label: 'Non proposé par l’API' },
}

export default function Networks() {
  const { data, error, loading, reload } = useFetch(() => api<NetworkInfo[]>('/connections'))
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const ok = params.get('connected')
    const err = params.get('error')
    if (ok) toast('success', `Compte ${ok} connecté.`)
    if (err) toast('error', `Connexion échouée: ${err}`)
    if (ok || err) setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect(p: string) {
    setBusy(p)
    try {
      const { url } = await api<{ url: string }>(`/connections/${p}/start`, { method: 'POST' })
      window.location.href = url
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(null)
    }
  }

  async function disconnect(id: string, name: string | null) {
    if (!confirm(`Déconnecter ${name ?? 'ce compte'} ? Les jetons seront supprimés et l’accès révoqué quand le réseau le permet.`)) return
    try {
      const r = await api<{ revoked: boolean }>(`/connections/${id}`, { method: 'DELETE' })
      toast('success', r.revoked ? 'Compte déconnecté et accès révoqué.' : 'Compte déconnecté. Pour révoquer totalement l’accès, retirez l’application dans les réglages du réseau.')
      reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  async function sync() {
    setBusy('sync')
    try {
      await api('/connections/sync', { method: 'POST' })
      toast('success', 'Synchronisation terminée.')
    } catch (e) {
      toast('error', (e as Error).message)
    }
    setBusy(null)
  }

  const connected = data?.filter((n) => n.accounts.some((a) => a.status === 'active')).length ?? 0
  const expired = data?.filter((n) => n.accounts.some((a) => a.status !== 'active')).length ?? 0
  const todo = data?.filter((n) => !n.configured).length ?? 0

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Mes réseaux sociaux</h1>
          <p className="max-w-2xl text-sm text-slate-500">Connexion par les mécanismes officiels (OAuth). Aucun mot de passe n’est demandé; les jetons restent chiffrés côté serveur.</p>
        </div>
        <button onClick={sync} disabled={busy === 'sync'} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium shadow-sm hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw size={15} className={busy === 'sync' ? 'animate-spin' : ''} /> Synchroniser
        </button>
      </div>

      {loading && !data && <Spinner />}
      {error && <ErrorBox error={error} onRetry={reload} />}

      {data && (
        <>
          {/* Récapitulatif */}
          <div className="mb-5 grid grid-cols-3 gap-3">
            {[
              { v: `${connected}/${data.length}`, l: 'Connectés', c: 'text-emerald-700' },
              { v: String(expired), l: 'À reconnecter', c: expired ? 'text-amber-600' : 'text-slate-900' },
              { v: String(todo), l: 'À configurer', c: todo ? 'text-red-600' : 'text-slate-900' },
            ].map((s) => (
              <div key={s.l} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <p className={`text-2xl font-semibold tracking-tight ${s.c}`}>{s.v}</p>
                <p className="text-xs text-slate-500">{s.l}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {data.map((n) => {
              const acc = n.accounts[0]
              const active = acc?.status === 'active'
              const pill = active
                ? { t: 'Connecté', c: 'bg-emerald-50 text-emerald-700', d: 'bg-emerald-500' }
                : acc?.status === 'expired'
                  ? { t: 'Expiré', c: 'bg-amber-50 text-amber-700', d: 'bg-amber-500' }
                  : !n.configured
                    ? { t: 'Non configuré', c: 'bg-red-50 text-red-600', d: 'bg-red-500' }
                    : { t: 'Non connecté', c: 'bg-slate-100 text-slate-600', d: 'bg-slate-400' }
              return (
                <section key={n.platform} className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  {/* En-tête */}
                  <div className="flex items-center gap-3 p-5">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-50 ring-1 ring-slate-200"><Logo platform={n.platform} size={28} /></span>
                    <div className="min-w-0 flex-1">
                      <h2 className="font-semibold text-slate-900">{n.label}</h2>
                      <p className="flex items-center gap-2 truncate text-sm text-slate-500">
                        {acc?.avatar_url && <img src={acc.avatar_url} alt="" className="h-5 w-5 rounded-full object-cover" referrerPolicy="no-referrer" />}
                        <span className="truncate">{acc ? acc.account_name : 'Aucun compte autorisé'}</span>
                      </p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${pill.c}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${pill.d}`} /> {pill.t}
                    </span>
                  </div>

                  {acc?.last_error && (
                    <p className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700"><AlertTriangle size={14} className="mt-px shrink-0" /> {acc.last_error}</p>
                  )}

                  {!n.configured && (
                    <details className="group mx-5 mb-3 rounded-lg bg-amber-50 text-amber-900">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-2.5 text-xs font-medium">
                        <span className="flex items-center gap-2"><AlertTriangle size={14} /> Application non configurée — voir la démarche</span>
                        <ChevronDown size={14} className="transition group-open:rotate-180" />
                      </summary>
                      <p className="px-2.5 pb-3 text-xs leading-relaxed">{n.setupHint}</p>
                    </details>
                  )}

                  {/* Fonctionnalités */}
                  <div className="px-5 pb-4">
                    <p className="mb-2 text-[11px] font-medium tracking-wider text-slate-400">FONCTIONNALITÉS</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {CAPS.map((k) => {
                        const c = CHIP[n.capabilities[k].status]
                        return (
                          <li key={k} title={`${c.label} — ${n.capabilities[k].note}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${c.box}`}>
                            <c.icon size={13} aria-label={c.label} /> {CAP_LABEL[k]}
                          </li>
                        )
                      })}
                    </ul>
                    <details className="group mt-3">
                      <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                        Détail et limites de l’API officielle <ChevronDown size={13} className="transition group-open:rotate-180" />
                      </summary>
                      <ul className="mt-3 space-y-2.5 border-l-2 border-slate-100 pl-3">
                        {CAPS.map((k) => {
                          const c = CHIP[n.capabilities[k].status]
                          return (
                            <li key={k} className="text-xs">
                              <p className="flex items-center gap-1.5 font-medium text-slate-700"><c.icon size={13} className={n.capabilities[k].status === 'available' ? 'text-emerald-600' : n.capabilities[k].status === 'requires_approval' ? 'text-amber-600' : 'text-slate-400'} /> {CAP_LABEL[k]}</p>
                              <p className="mt-0.5 leading-relaxed text-slate-500">{n.capabilities[k].note}</p>
                            </li>
                          )
                        })}
                      </ul>
                    </details>
                  </div>

                  {/* Actions */}
                  <div className="mt-auto flex flex-wrap gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                    <button
                      onClick={() => connect(n.platform)}
                      disabled={!n.configured || busy === n.platform}
                      className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Link2 size={15} /> {acc ? 'Reconnecter' : 'Connecter mon compte'}
                    </button>
                    {acc && (
                      <button onClick={() => disconnect(acc.id, acc.account_name)} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
                        <Unplug size={15} /> Déconnecter
                      </button>
                    )}
                  </div>
                </section>
              )
            })}
          </div>

          <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-emerald-600" /> Disponible</span>
            <span className="inline-flex items-center gap-1"><Clock size={13} className="text-amber-600" /> Soumis à une validation du réseau</span>
            <span className="inline-flex items-center gap-1"><CircleSlash size={13} className="text-slate-400" /> Non proposé par l’API officielle</span>
          </p>
        </>
      )}
    </>
  )
}
