import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays, ChevronDown, Inbox, LayoutDashboard, ListChecks, LogOut,
  Search, Share2, Sparkles,
} from 'lucide-react'
import { api } from '../lib/api'
import { getUser, setToken } from '../lib/session'

interface Item { to: string; label: string; icon: typeof Inbox; end?: boolean; badge?: 'scheduled' | 'pendingComments' | 'failed' }
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'MENU PRINCIPAL',
    items: [
      { to: '/', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
      { to: '/networks', label: 'Mes réseaux', icon: Share2 },
      { to: '/posts', label: 'Publications', icon: ListChecks, badge: 'failed' },
    ],
  },
  {
    title: 'FONCTIONNALITÉS',
    items: [
      { to: '/calendar', label: 'Calendrier', icon: CalendarDays, badge: 'scheduled' },
      { to: '/inbox', label: 'Commentaires', icon: Inbox, badge: 'pendingComments' },
      { to: '/analytics', label: 'Statistiques', icon: BarChart3 },
      { to: '/assistant', label: 'Assistant IA', icon: Sparkles },
    ],
  },
]
const ALL = GROUPS.flatMap((g) => g.items)
const TITLES: Record<string, string> = Object.fromEntries(ALL.map((i) => [i.to, i.label]))

interface Totals { scheduled: number; pendingComments: number; failed: number }

export default function Layout() {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [totals, setTotals] = useState<Totals | null>(null)
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  const user = getUser() || 'Utilisateur'

  // Compteurs réels des badges (rafraîchis chaque minute et à chaque changement de page)
  useEffect(() => {
    let alive = true
    const load = () =>
      api<{ totals: Totals }>('/insights/dashboard').then((d) => alive && setTotals(d.totals)).catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [pathname])

  const matches = (i: Item) => i.label.toLowerCase().includes(q.trim().toLowerCase())
  const badge = (i: Item) => (i.badge && totals ? totals[i.badge] : 0)
  const title = TITLES[pathname] ?? ALL.find((i) => !i.end && pathname.startsWith(i.to))?.label ?? ''
  const alerts = (totals?.pendingComments ?? 0) + (totals?.failed ?? 0)

  return (
    <div className="min-h-screen bg-white md:flex">
      {/* Barre latérale (ordinateur) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-4 py-5 md:flex">
        <div className="mb-5 flex items-center gap-2.5 px-1">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-[#0b7a43] to-[#16a05a] text-white shadow-sm"><Share2 size={20} /></span>
          <span className="text-xl font-semibold tracking-tight text-slate-900">Boussole</span>
        </div>

        <div className="relative mb-5">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
          <input
            ref={search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { const m = ALL.find(matches); if (m) { nav(m.to); setQ('') } }
              if (e.key === 'Escape') { setQ(''); search.current?.blur() }
            }}
            placeholder="Rechercher une page"
            aria-label="Rechercher une page"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-3 pl-9 text-sm placeholder:text-slate-500 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/20 focus:outline-none"
          />
        </div>

        <nav aria-label="Navigation principale" className="flex-1 space-y-5 overflow-y-auto">
          {GROUPS.map((g) => {
            const items = g.items.filter(matches)
            if (!items.length) return null
            return (
              <div key={g.title}>
                <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-slate-400">{g.title}</p>
                <div className="space-y-0.5">
                  {items.map((i) => {
                    const n = badge(i)
                    return (
                      <NavLink
                        key={i.to}
                        to={i.to}
                        end={i.end}
                        onClick={() => setQ('')}
                        className={({ isActive }) =>
                          `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                            isActive ? 'bg-gradient-to-b from-neutral-900 to-neutral-700 text-white shadow-md' : 'text-slate-600 hover:bg-slate-100'
                          }`
                        }
                      >
                        <i.icon size={18} />
                        <span className="flex-1">{i.label}</span>
                        {n > 0 && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${i.badge === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-200/80 text-slate-700'}`}>{n}</span>
                        )}
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {q && !ALL.some(matches) && <p className="px-3 text-sm text-slate-400">Aucune page trouvée.</p>}

          <div>
            <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wider text-slate-400">GÉNÉRAL</p>
            <button
              onClick={() => setToken(null)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <LogOut size={18} /> Déconnexion
            </button>
          </div>
        </nav>

      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre du haut */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 bg-white px-4 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#0b7a43] to-[#16a05a] text-white"><Share2 size={16} /></span>
          </div>
          <button onClick={() => nav(-1)} aria-label="Page précédente" className="hidden h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 md:grid"><ArrowLeft size={16} /></button>
          <button onClick={() => nav(1)} aria-label="Page suivante" className="hidden h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 md:grid"><ArrowRight size={16} /></button>
          <p className="ml-1 truncate text-sm text-slate-500">
            <span className="hidden sm:inline">Boussole <span className="mx-1 text-slate-300">›</span></span>
            <span className="font-medium text-slate-800">{title || 'Page'}</span>
          </p>

          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/inbox"
              aria-label={alerts ? `${alerts} élément(s) à traiter` : 'Aucune notification'}
              title={alerts ? `${totals?.pendingComments ?? 0} commentaire(s) à traiter · ${totals?.failed ?? 0} échec(s) de publication` : 'Rien à traiter'}
              className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
            >
              <Bell size={17} />
              {alerts > 0 && <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">{alerts > 9 ? '9+' : alerts}</span>}
            </Link>

            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu} className="flex items-center gap-1.5 rounded-full py-0.5 pr-1 pl-0.5 hover:bg-slate-100">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#0b7a43] to-[#16a05a] text-sm font-semibold text-white uppercase">{user[0]}</span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {menu && (
                <div role="menu" className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" onMouseLeave={() => setMenu(false)}>
                  <p className="truncate px-3 py-1.5 text-xs text-slate-500">Connecté en tant que <strong className="text-slate-800">{user}</strong></p>
                  <button role="menuitem" onClick={() => setToken(null)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"><LogOut size={15} /> Déconnexion</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Zone de contenu grise, angle supérieur gauche arrondi (comme le modèle) */}
        <main className="min-w-0 flex-1 bg-[#f5f6f7] px-4 pt-6 pb-24 md:rounded-tl-[1.75rem] md:px-8 md:pb-10">
          <div className="mx-auto max-w-6xl"><Outlet /></div>
        </main>
      </div>

      {/* Navigation téléphone */}
      <nav aria-label="Navigation mobile" className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-slate-200 bg-white md:hidden">
        {ALL.map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.end}
            className={({ isActive }) =>
              `relative flex min-w-[4.5rem] flex-1 flex-col items-center gap-0.5 px-2 py-2 text-[11px] font-medium ${isActive ? 'text-brand-700' : 'text-slate-500'}`
            }
          >
            <i.icon size={20} />
            {i.label === 'Tableau de bord' ? 'Accueil' : i.label}
            {badge(i) > 0 && <span className="absolute top-1 right-3 h-2 w-2 rounded-full bg-red-500" />}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
