import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Copy, Loader2, MessageSquareText, Send, Sparkles, TrendingUp } from 'lucide-react'
import { api, type Platform } from '../lib/api'
import { PLATFORM_LIST, PLATFORM_META } from '../lib/platforms'
import { Markdown } from '../components/Markdown'
import { useToast } from '../components/ui'

interface Analysis { empty: boolean; analysis: string; basedOn: { publications: number; networks: string[] }; unverified?: string[] }
interface Answer { empty: boolean; answer: string }

const QUESTIONS = [
  'Quel réseau performe le mieux, et pourquoi ?',
  'Quel type de contenu génère le plus d’interactions ?',
  'Quels jours obtiennent les meilleurs résultats ?',
  'Comment améliorer mon taux d’engagement ?',
  'Que faire pour gagner des abonnés ?',
  'Pourquoi mes résultats ont-ils baissé ou augmenté ?',
]

export default function Assistant() {
  const toast = useToast()
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [network, setNetwork] = useState<Platform | ''>('')
  const [busy, setBusy] = useState<'analyze' | 'ask' | 'feedback' | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ q: string; text: string } | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const scope = { days, network: network || undefined }

  async function analyze() {
    setBusy('analyze')
    try { setAnalysis(await api<Analysis>('/ai/analyze', { method: 'POST', body: scope })) }
    catch (e) { toast('error', (e as Error).message) }
    setBusy(null)
  }

  async function ask(q: string) {
    if (q.trim().length < 3) return
    setBusy('ask')
    try {
      const r = await api<Answer>('/ai/ask', { method: 'POST', body: { ...scope, question: q } })
      setAnswer({ q, text: r.answer })
    } catch (e) { toast('error', (e as Error).message) }
    setBusy(null)
  }

  async function summarize() {
    setBusy('feedback')
    try { setFeedback((await api<{ summary: string }>('/ai/summarize-feedback', { method: 'POST', body: {} })).summary) }
    catch (e) { toast('error', (e as Error).message) }
    setBusy(null)
  }

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast('success', 'Copié.'))

  return (
    <>
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Assistant IA</h1>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ---------- Analyse ---------- */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs font-medium text-slate-500">Période
              <span className="relative mt-1 block">
                <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)} className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pr-8 pl-3 text-sm font-medium text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500" />
              </span>
            </label>
            <label className="text-xs font-medium text-slate-500">Réseau
              <span className="relative mt-1 block">
                <select value={network} onChange={(e) => setNetwork(e.target.value as Platform | '')} className="appearance-none rounded-xl border border-slate-200 bg-white py-2 pr-8 pl-3 text-sm font-medium text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                  <option value="">Tous les réseaux</option>
                  {PLATFORM_LIST.map((p) => <option key={p} value={p}>{PLATFORM_META[p].label}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-500" />
              </span>
            </label>
            <button onClick={analyze} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60">
              {busy === 'analyze' ? <Loader2 size={16} className="animate-spin" /> : <TrendingUp size={16} />} Analyser mes résultats
            </button>
          </div>

          <div className="mt-5 min-h-48 rounded-xl bg-slate-50/60 p-5">
            {busy === 'analyze' ? (
              <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" /> Analyse de vos données en cours…</p>
            ) : analysis ? (
              <>
                {analysis.empty ? (
                  <div className="text-sm text-slate-600">
                    <p>{analysis.analysis}</p>
                    <Link to="/facebook" className="mt-3 inline-flex rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-brand-700">Connecter un réseau</Link>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>Basé sur {analysis.basedOn.publications} publication(s) · {analysis.basedOn.networks.join(', ')}</span>
                      <button onClick={() => copy(analysis.analysis)} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><Copy size={12} /> Copier</button>
                    </div>
                    <Markdown text={analysis.analysis} />
                    {!!analysis.unverified?.length && <p className="mt-3 text-xs text-amber-700">Chiffres à vérifier : {analysis.unverified.join(", ")}</p>}
                  </>
                )}
              </>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center text-slate-400">
                <Sparkles size={30} />
              </div>
            )}
          </div>
        </section>

        {/* ---------- Questions + retours ---------- */}
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><Sparkles size={16} className="text-brand-600" /> Poser une question</h2>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {QUESTIONS.map((q) => (
                <button key={q} disabled={busy !== null} onClick={() => { setQuestion(q); ask(q) }} className="rounded-full border border-slate-200 px-2.5 py-1 text-left text-xs text-slate-600 hover:border-brand-600 hover:text-brand-700 disabled:opacity-50">{q}</button>
              ))}
            </div>
            <form onSubmit={(e: FormEvent) => { e.preventDefault(); ask(question) }} className="flex gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} placeholder="Votre question…" aria-label="Votre question" className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none" />
              <button type="submit" disabled={busy !== null || question.trim().length < 3} aria-label="Envoyer la question" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
                {busy === 'ask' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
            {answer && (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="mb-2 text-xs font-medium text-slate-500">« {answer.q} »</p>
                <Markdown text={answer.text} />
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-1 flex items-center gap-2 text-base font-semibold"><MessageSquareText size={16} className="text-brand-600" /> Analyser les retours</h2>
            <button onClick={summarize} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60">
              {busy === 'feedback' && <Loader2 size={14} className="animate-spin" />} Analyser les commentaires
            </button>
            {feedback && <div className="mt-4 rounded-xl bg-slate-50 p-4"><Markdown text={feedback} /></div>}
          </section>

        </div>
      </div>
    </>
  )
}
