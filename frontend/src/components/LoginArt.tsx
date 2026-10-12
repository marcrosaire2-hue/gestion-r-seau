// Décor de l'écran de connexion: strates de papier découpé et feuillage, généré en SVG (sans image externe).

// Générateur pseudo-aléatoire déterministe: le dessin est identique à chaque rendu.
function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const W = 600
const H = 700

/** Bord ondulé de gauche à droite, fermé à droite (une « strate » de papier). */
function layer(base: number, phase: number, amp: number) {
  const pts: [number, number][] = []
  for (let i = 0; i <= 36; i++) {
    const t = i / 36
    const y = t * H
    const x = base + amp * Math.sin(t * Math.PI * 3 + phase) + amp * 0.45 * Math.sin(t * Math.PI * 7 + phase * 1.7)
    pts.push([x, y])
  }
  let d = `M${W + 40},-20 L${pts[0][0]},-20 L${pts[0][0]},${pts[0][1]}`
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]
    const [x, y] = pts[i]
    d += ` Q${px},${(py + y) / 2} ${(px + x) / 2},${(py + y) / 2}`
  }
  return `${d} L${pts[pts.length - 1][0]},${H + 20} L${W + 40},${H + 20} Z`
}

interface FrondProps { x: number; y: number; angle: number; len: number; color: string; seed: number; opacity?: number }

/** Palme: tige courbe + folioles de chaque côté. */
function Frond({ x, y, angle, len, color, seed, opacity = 1 }: FrondProps) {
  const r = rng(seed)
  const n = 22
  const leaves: string[] = []
  for (let i = 1; i <= n; i++) {
    const t = i / n
    const px = t * len
    const py = -Math.sin(t * 1.4) * len * 0.08
    const l = len * 0.2 * (1 - t * 0.7) * (0.85 + r() * 0.3)
    const w = l * 0.16
    for (const side of [-1, 1]) {
      const a = side * (0.95 - t * 0.35)
      const ex = px + Math.cos(a) * l
      const ey = py + Math.sin(a) * l
      leaves.push(`M${px},${py} Q${(px + ex) / 2 + side * w},${(py + ey) / 2 - w} ${ex},${ey} Q${(px + ex) / 2 - side * w},${(py + ey) / 2 + w} ${px},${py}Z`)
    }
  }
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity={opacity}>
      <path d={`M0,0 Q${len * 0.5},${-len * 0.1} ${len},${-len * 0.08}`} stroke={color} strokeWidth="2" fill="none" />
      <path d={leaves.join(' ')} fill={color} />
    </g>
  )
}

/** Grande feuille lobée (monstera simplifiée). */
function Leaf({ x, y, rot, size, color, opacity = 1 }: { x: number; y: number; rot: number; size: number; color: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${size})`} opacity={opacity}>
      <path d="M0,0 C30,-30 90,-30 120,0 C90,34 40,40 0,0 Z" fill={color} />
      <path d="M8,0 L112,0" stroke="rgba(255,255,255,.12)" strokeWidth="1.5" />
      {[0.2, 0.4, 0.6, 0.8].map((t) => (
        <g key={t}>
          <path d={`M${t * 112},0 L${t * 112 + 12},-20`} stroke="rgba(255,255,255,.1)" strokeWidth="1" />
          <path d={`M${t * 112},0 L${t * 112 + 12},20`} stroke="rgba(255,255,255,.1)" strokeWidth="1" />
        </g>
      ))}
    </g>
  )
}

const DARK = '#243a2f'
const MID = '#34503f'
const LIGHT = '#4a6b58'

export function LoginPanelArt() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden="true">
      <defs>
        <filter id="paper" x="-20%" y="-5%" width="140%" height="110%">
          <feDropShadow dx="-7" dy="5" stdDeviation="7" floodColor="#000" floodOpacity="0.28" />
        </filter>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="-3" dy="3" stdDeviation="5" floodColor="#000" floodOpacity="0.35" />
        </filter>
      </defs>
      {/* strates de papier: du clair vers le vert profond */}
      <path d={layer(150, 0.2, 38)} fill="#f4f4f2" filter="url(#paper)" />
      <path d={layer(190, 0.9, 40)} fill="#dcdcd8" filter="url(#paper)" />
      <path d={layer(235, 1.6, 42)} fill="#b9bdb8" filter="url(#paper)" />
      <path d={layer(285, 2.3, 44)} fill="#7f8f84" filter="url(#paper)" />
      <path d={layer(330, 3.0, 46)} fill={DARK} filter="url(#paper)" />
      {/* feuillage */}
      <g filter="url(#soft)">
        <Leaf x={470} y={90} rot={25} size={1.5} color={MID} opacity={0.75} />
        <Leaf x={400} y={250} rot={-35} size={1.7} color={LIGHT} opacity={0.55} />
        <Leaf x={540} y={330} rot={70} size={1.4} color={MID} opacity={0.7} />
        <Frond x={365} y={505} angle={-48} len={300} color={DARK} seed={11} />
        <Frond x={395} y={540} angle={-10} len={290} color={MID} seed={23} />
        <Frond x={380} y={470} angle={-85} len={250} color={LIGHT} seed={37} opacity={0.9} />
        <Frond x={410} y={600} angle={-28} len={260} color={DARK} seed={41} />
        <Frond x={350} y={430} angle={-120} len={210} color={MID} seed={53} opacity={0.85} />
        <Frond x={430} y={640} angle={-60} len={230} color={LIGHT} seed={67} opacity={0.85} />
        <Frond x={440} y={520} angle={-155} len={260} color={DARK} seed={71} />
        <Frond x={470} y={560} angle={-100} len={300} color={MID} seed={73} opacity={0.9} />
        <Frond x={500} y={450} angle={-170} len={280} color={LIGHT} seed={79} opacity={0.8} />
        <Frond x={455} y={400} angle={-135} len={240} color={DARK} seed={83} />
        <Frond x={520} y={600} angle={-125} len={250} color={MID} seed={89} />
        <Frond x={400} y={380} angle={-75} len={220} color={DARK} seed={97} opacity={0.9} />
        <Frond x={480} y={660} angle={-85} len={220} color={LIGHT} seed={101} opacity={0.85} />
      </g>
    </svg>
  )
}

/** Palmes floues en coin de page, pour l'ambiance. */
export function BlurredFronds() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <svg viewBox="0 0 400 400" className="absolute -top-16 -left-10 h-96 w-96 opacity-60 blur-xl">
        <Frond x={20} y={230} angle={-25} len={340} color="#2f6b3a" seed={5} />
        <Frond x={40} y={300} angle={-60} len={260} color="#5e9a5d" seed={9} />
      </svg>
      <svg viewBox="0 0 400 400" className="absolute -right-10 -bottom-20 h-[26rem] w-[26rem] opacity-60 blur-lg">
        <Frond x={380} y={380} angle={-155} len={340} color="#2f6b3a" seed={13} />
        <Frond x={400} y={300} angle={-190} len={260} color="#4f8a4f" seed={17} />
      </svg>
      <svg viewBox="0 0 400 400" className="absolute -top-10 -right-16 h-80 w-80 opacity-50 blur-xl">
        <Frond x={380} y={60} angle={150} len={300} color="#3f7a45" seed={19} />
      </svg>
    </div>
  )
}
