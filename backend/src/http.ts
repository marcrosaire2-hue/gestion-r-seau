export class ApiError extends Error {
  constructor(message: string, public status = 502, public detail?: unknown) {
    super(message);
  }
}

/** Extrait un message lisible des formats d'erreur Meta / LinkedIn / TikTok. */
function extractMessage(body: any, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  return (
    body.error?.message ??
    body.error_description ??
    body.error?.error_user_msg ??
    body.message ??
    (typeof body.error === 'string' ? body.error : undefined) ??
    fallback
  );
}

export async function httpJson<T = any>(url: string, init: RequestInit = {}): Promise<{ data: T; headers: Headers; status: number }> {
  const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(60_000) });
  const text = await res.text();
  let data: any = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  // TikTok renvoie HTTP 200 avec error.code != "ok"
  const tiktokErr = data?.error?.code && data.error.code !== 'ok' ? data.error : null;
  if (!res.ok || tiktokErr) {
    throw new ApiError(extractMessage(data, `HTTP ${res.status}`), res.status, data);
  }
  return { data: data as T, headers: res.headers, status: res.status };
}

export const form = (obj: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined) as [string, string][]);
