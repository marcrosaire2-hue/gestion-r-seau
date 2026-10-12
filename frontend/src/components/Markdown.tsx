import { Fragment, type ReactNode } from 'react'

// Rendu minimal et sûr (aucun HTML brut): titres ##, listes, gras **…**, paragraphes.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>,
  )
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list
    const Tag = L.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={blocks.length} className={`my-2 space-y-1.5 pl-5 ${L.ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}>
        {L.items.map((it, i) => <li key={i} className="pl-1">{inline(it)}</li>)}
      </Tag>,
    )
    list = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const h = /^#{1,4}\s+(.*)$/.exec(line)
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (h) {
      flush()
      blocks.push(<h3 key={blocks.length} className="mt-5 mb-1 border-b border-slate-100 pb-1.5 text-base font-semibold text-slate-900 first:mt-0">{inline(h[1])}</h3>)
    } else if (ul || ol) {
      const ordered = !!ol
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push((ul ?? ol)![1])
    } else if (!line.trim()) {
      flush()
    } else {
      flush()
      blocks.push(<p key={blocks.length} className="my-2 leading-relaxed">{inline(line)}</p>)
    }
  }
  flush()
  return <div className="text-sm text-slate-700">{blocks}</div>
}
