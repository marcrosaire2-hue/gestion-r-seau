import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react'
import { PLATFORM_META, Logo } from '../lib/platforms'
import type { Platform } from '../lib/api'

/* ---------- Toasts ---------- */
type ToastKind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random()
    setItems((l) => [...l, { id, kind, text }])
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 9000 : 4500)
  }, [])
  const Icon = { success: CheckCircle2, error: AlertCircle, info: Info }
  const tone = { success: 'border-emerald-200 text-emerald-800', error: 'border-red-200 text-red-800', info: 'border-slate-200 text-slate-700' }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-20 z-50 flex flex-col items-end gap-2 md:bottom-6 md:right-6 md:left-auto" aria-live="polite">
        {items.map((t) => {
          const I = Icon[t.kind]
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg ${tone[t.kind]}`}>
              <I size={18} className="mt-0.5 shrink-0" />
              <span className="flex-1">{t.text}</span>
              <button aria-label="Fermer" onClick={() => setItems((l) => l.filter((x) => x.id !== t.id))}><X size={16} /></button>
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

/* ---------- Éléments de base ---------- */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:p-5 ${className}`}>{children}</section>
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; loading?: boolean }
export function Button({ variant = 'secondary', loading, className = '', children, disabled, ...rest }: BtnProps) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
    danger: 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) {
  const t = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-sky-50 text-sky-700',
  }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t[tone]}`}>{children}</span>
}

export function PlatformTag({ platform }: { platform: Platform }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${PLATFORM_META[platform].soft}`}>
      <Logo platform={platform} size={14} />
      {PLATFORM_META[platform].label}
    </span>
  )
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      <div className="text-slate-300">{icon}</div>
      <p className="font-medium text-slate-700">{title}</p>
      {text && <p className="max-w-md text-sm text-slate-500">{text}</p>}
      {action}
    </div>
  )
}

export function Spinner() {
  return <div className="flex justify-center py-12 text-slate-400"><Loader2 className="animate-spin" /></div>
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertCircle size={18} className="mt-0.5 shrink-0" />
      <div className="flex-1">{error}</div>
      {onRetry && <Button onClick={onRetry}>Réessayer</Button>}
    </div>
  )
}

/* ---------- Chargement de données ---------- */
/** `refreshMs`: rafraîchissement silencieux en arrière-plan (sans écran de chargement); 0 pour le désactiver. */
export function useFetch<T>(loader: () => Promise<T>, deps: unknown[] = [], refreshMs = 20_000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setLoading(true)
    loader()
      .then((d) => { if (alive) { setData(d); setError(null) } })
      .catch((e: Error) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  // Mise à jour automatique: les nouveaux chiffres apparaissent sans recharger la page.
  useEffect(() => {
    if (!refreshMs) return
    let alive = true
    const refresh = () => {
      if (document.hidden) return
      loader().then((d) => { if (alive) { setData(d); setError(null) } }).catch(() => { /* on garde les données affichées */ })
    }
    const id = setInterval(refresh, refreshMs)
    document.addEventListener('visibilitychange', refresh)
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', refresh) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshMs])
  return { data, error, loading, reload: () => setTick((t) => t + 1) }
}

export const fmtNum = (n: number | null | undefined) => (n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(n))
