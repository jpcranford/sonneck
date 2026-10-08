// Thin fetch wrapper implementing the backend's {data}/{error} contract
// (CLAUDE.md > API response contract). Every call site gets either the
// unwrapped `data` payload or a thrown ApiError — no handler ever has to
// re-parse the envelope itself.

export class ApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

interface SuccessEnvelope<T> {
  data: T
}

interface ErrorEnvelope {
  error: { code: string; message: string }
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  return typeof body === 'object' && body !== null && 'error' in body
}

// An authenticating reverse proxy in front of the app (Cloudflare Access,
// Authelia…) answers a request whose sign-in has expired with a redirect to
// its own login page on another site — which a background fetch can't
// follow (it fails as a CORS error, indistinguishable from the server being
// down) — or, for a request carrying X-Requested-With: XMLHttpRequest (sent
// on every call below; Access is reported to honor it), with a bare 401.
// Either way the fix is a full page load, which the proxy answers with its
// sign-in page. This app's own API never redirects, and its own 401/403
// always carry the {error} envelope, so neither can be mistaken for it.
const SIGN_IN_RELOAD_KEY = 'sonneck-sign-in-reload'
const SIGN_IN_RELOAD_GUARD_MS = 30_000

function isProxySignInAnswer(status: number, type: ResponseType, body: unknown): boolean {
  if (type === 'opaqueredirect') return true
  return (status === 401 || status === 403) && !isErrorEnvelope(body)
}

// Reloads the page so the proxy can ask the user to sign in again, and
// returns a promise that never settles (the page is going away). If it
// already reloaded for this within the last 30 seconds, it throws instead
// of looping, for when the proxy keeps refusing even after a fresh load.
async function reloadToSignIn(): Promise<never> {
  let last = 0
  try {
    last = Number(sessionStorage.getItem(SIGN_IN_RELOAD_KEY)) || 0
  } catch {
    // Storage unavailable: fall through and reload once.
  }
  if (Date.now() - last < SIGN_IN_RELOAD_GUARD_MS) {
    throw new ApiError(
      'SIGN_IN_EXPIRED',
      'Your sign-in has expired. Reload the page to sign in again.',
      // Not 401: that reads as "use Sonneck's own login" (AuthGate).
      0,
    )
  }
  try {
    sessionStorage.setItem(SIGN_IN_RELOAD_KEY, String(Date.now()))
  } catch {
    // Storage unavailable: reload anyway.
  }
  window.location.reload()
  return new Promise<never>(() => {})
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    redirect: 'manual',
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...init?.headers },
  })
  if (res.type === 'opaqueredirect') return reloadToSignIn()

  let body: unknown
  try {
    body = await res.json()
  } catch {
    if (isProxySignInAnswer(res.status, res.type, undefined)) return reloadToSignIn()
    throw new ApiError('INTERNAL_ERROR', 'The server returned an unreadable response.', res.status)
  }
  if (isProxySignInAnswer(res.status, res.type, body)) return reloadToSignIn()

  if (!res.ok || isErrorEnvelope(body)) {
    if (isErrorEnvelope(body)) {
      throw new ApiError(body.error.code, body.error.message, res.status)
    }
    throw new ApiError('INTERNAL_ERROR', 'Something went wrong.', res.status)
  }

  return (body as SuccessEnvelope<T>).data
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// The Setlists reorder endpoint (PUT .../entries/order) is this app's first
// PUT — a full-replacement semantic (the complete new ordering, not a
// partial patch) is what PUT means here, same body-shape convention as
// apiPatch otherwise.
export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// body is optional — most DELETE endpoints take none, but the merge-or-
// delete-outright endpoints (Lookup Tables, Your Tags/Practice Status) read
// an optional mergeIntoId from a real JSON body, same as the backend's own
// `if r.ContentLength != 0` check expects (internal/handlers/lookup.go).
export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'DELETE',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

/**
 * Uploads a file with progress reporting. Uses XHR rather than fetch
 * specifically because fetch has no upload-progress API — and design doc
 * §2 requires real progress bars for uploads, not a spinner, for anything
 * as large as a scanned book PDF.
 *
 * Resolves with the HTTP status alongside the unwrapped data — some upload
 * endpoints (e.g. POST /api/pieces) use 200 vs 201 to signal "reused an
 * existing record" vs "created a new one" (CLAUDE.md > File handling's
 * dedupe rule) without changing the response body shape, so callers that
 * care about that distinction need the status; apiUpload below discards it
 * for the common case that doesn't.
 */
function uploadRequest<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ data: T; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', path)

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable) {
        onProgress((event.loaded / event.total) * 100)
      }
    }

    xhr.onload = () => {
      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        if (isProxySignInAnswer(xhr.status, 'basic', undefined)) {
          reloadToSignIn().catch(reject)
          return
        }
        reject(
          new ApiError('INTERNAL_ERROR', 'The server returned an unreadable response.', xhr.status),
        )
        return
      }

      if (isProxySignInAnswer(xhr.status, 'basic', body)) {
        reloadToSignIn().catch(reject)
        return
      }
      if (xhr.status >= 200 && xhr.status < 300 && !isErrorEnvelope(body)) {
        resolve({ data: (body as SuccessEnvelope<T>).data, status: xhr.status })
      } else if (isErrorEnvelope(body)) {
        reject(new ApiError(body.error.code, body.error.message, xhr.status))
      } else {
        reject(new ApiError('INTERNAL_ERROR', 'Something went wrong.', xhr.status))
      }
    }

    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', 'Could not reach the server.', 0))

    // Required by the backend (internal/handlers/helpers.go's
    // requireMultipartFile): a plain HTML form can never set a custom
    // header, so this is what lets
    // the server tell a real XHR upload apart from a forged cross-origin
    // form submission. A same-origin request like this one never triggers
    // a CORS preflight regardless of the header, so it costs nothing here.
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')

    const formData = new FormData()
    formData.append('file', file)
    xhr.send(formData)
  })
}

export function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<T> {
  return uploadRequest<T>(path, file, onProgress).then((r) => r.data)
}

export function apiUploadWithStatus<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ data: T; status: number }> {
  return uploadRequest<T>(path, file, onProgress)
}
