const KEY = 'sd_token'
const EVENT = 'sd:session'

export const getToken = (): string | null => {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch { /* stockage indisponible: la session ne survivra pas au rechargement */ }
  window.dispatchEvent(new Event(EVENT))
}

export function onSessionChange(fn: () => void) {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

const USER = 'sd_user'
export const getUser = (): string => {
  try { return localStorage.getItem(USER) ?? '' } catch { return '' }
}
export const setUser = (name: string) => {
  try { localStorage.setItem(USER, name) } catch { /* ignoré */ }
}
