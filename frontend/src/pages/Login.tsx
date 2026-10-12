import { useEffect, useState, type FormEvent } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { api } from '../lib/api'
import { setStoredRole, setToken, setUser } from '../lib/session'
import { BlurredFronds, LoginPanelArt } from '../components/LoginArt'

// Tailles fluides: elles suivent la largeur ET la hauteur de l'écran (vmin / vh) pour que le formulaire
// tienne toujours sans défilement, du petit téléphone en paysage au grand écran.
const LABEL = 'mb-[0.25em] ml-[1.4em] block text-[clamp(0.65rem,1.5vmin,0.8rem)] font-medium text-slate-600'
const INPUT =
  'w-full rounded-full border border-slate-400/70 bg-white/80 px-[1.4em] py-[clamp(0.45rem,1.5vh,0.8rem)] text-[clamp(0.85rem,2vmin,1.05rem)] text-slate-900 outline-none transition focus:border-[#44604f] focus:ring-2 focus:ring-[#44604f]/25'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Aucune barre de défilement sur cette page.
  useEffect(() => {
    const { documentElement: html, body } = document
    const prev = [html.style.overflow, body.style.overflow]
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => { html.style.overflow = prev[0]; body.style.overflow = prev[1] }
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ token: string; username: string; role: string }>('/auth/login', { method: 'POST', body: { username, password } })
      setUser(r.username)
      setStoredRole(r.role)
      setToken(r.token)
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 grid place-items-center overflow-hidden overscroll-none bg-[#e9ebe7] p-[clamp(0.5rem,2.2vmin,2rem)]">
      <BlurredFronds />

      {/* La carte occupe tout l'espace disponible (avec un plafond sur les très grands écrans) */}
      <div className="relative flex h-full max-h-[1000px] w-full max-w-[1700px] overflow-hidden rounded-[clamp(1.25rem,4vmin,2.75rem)] bg-white shadow-[0_30px_80px_-20px_rgba(36,58,47,0.35)]">
        {/* Décor: à droite sur ordinateur/tablette, en fond sur petit écran */}
        <div className="absolute inset-y-0 right-0 w-full md:w-[60%] lg:w-[62%]">
          <LoginPanelArt />
        </div>

        <div className="relative z-10 flex h-full w-full items-center justify-center p-[clamp(0.75rem,3vmin,2rem)] md:w-[42%] md:p-[2vmin]">
          <form
            onSubmit={submit}
            className="flex max-h-full w-full max-w-[min(100%,22rem)] flex-col justify-center rounded-[1.75rem] bg-white/60 p-[clamp(1.1rem,4vmin,2rem)] shadow-lg ring-1 ring-white/70 backdrop-blur-md md:max-w-[min(100%,clamp(15rem,24vw,24rem))] md:bg-transparent md:p-0 md:shadow-none md:ring-0 md:backdrop-blur-none"
          >
            <p className="mb-[0.3em] text-center text-[clamp(0.7rem,1.6vmin,0.9rem)] font-semibold tracking-[0.25em] text-[#44604f] uppercase">Boussole</p>
            <h1 className="mb-[clamp(0.8rem,4vh,2.25rem)] text-center text-[clamp(1.4rem,3.6vmin,2.6rem)] font-medium tracking-wide text-slate-900">
              Connexion
            </h1>

            <label className={LABEL} htmlFor="username">Identifiant</label>
            <input
              id="username"
              className={`${INPUT} mb-[clamp(0.6rem,2.6vh,1.5rem)]`}
              type="text"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />

            <label className={LABEL} htmlFor="password">Mot de passe</label>
            <div className="relative mb-[clamp(0.75rem,3.4vh,1.75rem)]">
              <input
                id="password"
                className={`${INPUT} pr-[3em]`}
                type={show ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                className="absolute top-1/2 right-[1.1em] -translate-y-1/2 text-slate-500 hover:text-slate-800"
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error && <p role="alert" className="mb-[0.8em] text-center text-[clamp(0.75rem,1.8vmin,0.95rem)] text-red-700">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#44604f] py-[clamp(0.5rem,1.7vh,0.9rem)] text-[clamp(0.85rem,2vmin,1.05rem)] font-medium text-white shadow-md transition hover:bg-[#385042] disabled:opacity-60"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Se connecter
            </button>

          </form>
        </div>
      </div>
    </div>
  )
}
