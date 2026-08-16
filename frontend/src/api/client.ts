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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new ApiError('INTERNAL_ERROR', 'The server returned an unreadable response.', res.status)
  }

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

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' })
}

/**
 * Uploads a file with progress reporting. Uses XHR rather than fetch
 * specifically because fetch has no upload-progress API — and design doc
 * §2 requires real progress bars for uploads, not a spinner, for anything
 * as large as a scanned book PDF.
 */
export function apiUpload<T>(
  path: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<T> {
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
        reject(
          new ApiError('INTERNAL_ERROR', 'The server returned an unreadable response.', xhr.status),
        )
        return
      }

      if (xhr.status >= 200 && xhr.status < 300 && !isErrorEnvelope(body)) {
        resolve((body as SuccessEnvelope<T>).data)
      } else if (isErrorEnvelope(body)) {
        reject(new ApiError(body.error.code, body.error.message, xhr.status))
      } else {
        reject(new ApiError('INTERNAL_ERROR', 'Something went wrong.', xhr.status))
      }
    }

    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', 'Could not reach the server.', 0))

    const formData = new FormData()
    formData.append('file', file)
    xhr.send(formData)
  })
}
