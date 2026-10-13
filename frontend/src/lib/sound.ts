/** Sonnerie de notification, synthétisée (aucun fichier audio). Les navigateurs n'autorisent le son qu'après une action de l'utilisateur. */
let ctx: AudioContext | null = null
let wantsSound = false

function context(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx ??= new AC()
    return ctx
  } catch {
    return null
  }
}

function chime(c: AudioContext) {
  // Trois notes montantes (mi, la, mi aigu), deux fois: net et agréable, facile à entendre.
  const notes = [659.25, 880, 1318.5, 659.25, 880, 1318.5]
  notes.forEach((freq, i) => {
    const t = c.currentTime + i * 0.17 + (i >= 3 ? 0.25 : 0)
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.6)
  })
}

/** À appeler lors du premier clic ou de la première touche: autorise le son et joue celui qui était en attente. */
export function unlockAudio() {
  const c = context()
  if (!c) return
  c.resume().then(() => {
    if (wantsSound && c.state === 'running') { wantsSound = false; chime(c) }
  }).catch(() => {})
}

/** Joue la sonnerie; si le navigateur la bloque encore, elle sera jouée dès la prochaine action de l'utilisateur. */
export function playNotification() {
  const c = context()
  if (!c) return
  if (c.state === 'running') { chime(c); return }
  wantsSound = true
  c.resume().then(() => { if (c.state === 'running' && wantsSound) { wantsSound = false; chime(c) } }).catch(() => {})
}
