import { useState, type FormEvent } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, Shuffle, Trash2, UserPlus } from 'lucide-react'
import { api } from '../lib/api'
import { getUser } from '../lib/session'
import { ErrorBox, Spinner, useFetch, useToast } from '../components/ui'

interface UserRow { id: string; username: string; role: 'admin' | 'user'; created_at: string }

/** Mot de passe aléatoire lisible (sans caractères ambigus), format xxxx-xxxx-xxxx-xxxx. */
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return [s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12, 16)].join('-')
}

const INPUT = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none'

export default function Users() {
  const toast = useToast()
  const me = getUser()
  const { data, error, loading, reload } = useFetch(() => api<UserRow[]>('/users'))

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // Réinitialisation du mot de passe d'un utilisateur
  const [resetId, setResetId] = useState<string | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await api('/users', { method: 'POST', body: { username, password, role } })
      setCreated({ username: username.trim().toLowerCase(), password })
      setUsername(''); setPassword(''); setRole('user'); setShow(false); setCopied(false)
      reload()
    } catch (err) {
      toast('error', (err as Error).message)
    }
    setBusy(false)
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { toast('error', 'Copie impossible: sélectionnez le texte manuellement.') }
  }

  async function resetPassword(id: string) {
    setResetBusy(true)
    try {
      await api(`/users/${id}/password`, { method: 'PATCH', body: { password: resetPw } })
      const u = data?.find((x) => x.id === id)
      setCreated({ username: u?.username ?? '', password: resetPw })
      setCopied(false); setResetId(null); setResetPw('')
      toast('success', 'Mot de passe modifié.')
    } catch (err) {
      toast('error', (err as Error).message)
    }
    setResetBusy(false)
  }

  async function remove(u: UserRow) {
    if (!confirm(`Supprimer « ${u.username} » ?\n\nSes comptes de réseaux seront déconnectés et toutes ses données supprimées. Cette action est définitive.`)) return
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' })
      toast('success', `${u.username} supprimé.`)
      reload()
    } catch (err) {
      toast('error', (err as Error).message)
    }
  }

  if (loading && !data) return <Spinner />
  if (error?.includes('administrateurs')) return <ErrorBox error="Cette page est réservée aux administrateurs." />
  if (error || !data) return <ErrorBox error={error ?? 'Indisponible'} onRetry={reload} />

  return (
    <>
      <h1 className="mb-5 text-2xl font-semibold tracking-tight text-slate-900">Utilisateurs</h1>

      {created && (
        <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="mb-3 flex items-center gap-2 font-semibold text-emerald-900"><Check size={18} /> Identifiants de {created.username}</p>
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-lg bg-white px-3 py-2 text-sm text-slate-800 ring-1 ring-emerald-200 select-all">Identifiant : <strong>{created.username}</strong> · Mot de passe : <strong>{created.password}</strong></code>
            <button onClick={() => copy(`Identifiant : ${created.username}\nMot de passe : ${created.password}`)} className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-white px-3.5 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
              {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copié' : 'Copier'}
            </button>
            <button onClick={() => setCreated(null)} className="text-sm text-emerald-800 hover:underline">Masquer</button>
          </div>
          <p className="mt-3 text-xs text-emerald-800">Le mot de passe ne pourra plus être affiché après avoir masqué ce message.</p>
        </div>
      )}

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><UserPlus size={18} className="text-brand-600" /> Nouvel utilisateur</h2>
        <form onSubmit={create} className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto_auto] md:items-end">
          <label className="text-sm font-medium text-slate-700">Identifiant
            <input className={`${INPUT} mt-1`} value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} maxLength={50} pattern="[A-Za-z0-9._\-]{3,50}" autoComplete="off" autoCapitalize="none" spellCheck={false} title="3 à 50 caractères : lettres, chiffres, . _ -" />
          </label>
          <label className="text-sm font-medium text-slate-700">Mot de passe
            <span className="relative mt-1 flex gap-2">
              <span className="relative flex-1">
                <input className={`${INPUT} pr-10`} type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} maxLength={200} autoComplete="new-password" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} className="absolute top-1/2 right-3 -translate-y-1/2 text-slate-400 hover:text-slate-700">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </span>
              <button type="button" onClick={() => { setPassword(generatePassword()); setShow(true) }} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" title="Générer un mot de passe solide"><Shuffle size={15} /> Générer</button>
            </span>
          </label>
          <label className="text-sm font-medium text-slate-700">Rôle
            <select className={`${INPUT} mt-1`} value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')}>
              <option value="user">Utilisateur</option>
              <option value="admin">Administrateur</option>
            </select>
          </label>
          <button type="submit" disabled={busy} className="inline-flex h-[38px] items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />} Créer
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold">Comptes <span className="text-sm font-normal text-slate-400">({data.length})</span></h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr><th className="px-4 py-2.5 font-medium">Identifiant</th><th className="px-4 py-2.5 font-medium">Rôle</th><th className="px-4 py-2.5 font-medium">Créé le</th><th className="px-4 py-2.5 text-right font-medium">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="px-4 py-3 font-medium text-slate-800">{u.username}{u.username === me && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">vous</span>}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.role === 'admin' ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>{u.role === 'admin' ? 'Administrateur' : 'Utilisateur'}</span></td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-500">{u.created_at ? format(new Date(u.created_at), 'd MMM yyyy', { locale: fr }) : '—'}</td>
                  <td className="px-4 py-3">
                    {resetId === u.id ? (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <input className={`${INPUT} w-48`} type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="Nouveau mot de passe" minLength={10} autoFocus autoComplete="off" />
                        <button onClick={() => setResetPw(generatePassword())} className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50" aria-label="Générer un mot de passe" title="Générer"><Shuffle size={14} /></button>
                        <button onClick={() => resetPassword(u.id)} disabled={resetBusy || resetPw.length < 10} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{resetBusy ? '…' : 'Valider'}</button>
                        <button onClick={() => { setResetId(null); setResetPw('') }} className="text-xs text-slate-500 hover:text-slate-800">Annuler</button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <button onClick={() => { setResetId(u.id); setResetPw('') }} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"><KeyRound size={13} /> Mot de passe</button>
                        <button onClick={() => remove(u)} disabled={u.username === me} title={u.username === me ? 'Vous ne pouvez pas supprimer votre propre compte' : undefined} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={13} /> Supprimer</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}
