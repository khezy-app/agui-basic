import { config } from '@/config'

import { ApiError, type ApiErrorKind, type FieldError } from './errors'

export type QueryValue = string | number | boolean | string[] | null | undefined

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
}

const KIND_FROM_TYPE = new Set<string>([
  'validation-failed',
  'not-found',
  'illegal-transition',
  'version-conflict',
  'blocked-delete',
  'unprocessable',
  'method-not-allowed',
  'internal-error',
])

/** `null`/`undefined`/empty-string params are dropped; arrays become repeated keys. */
export function buildQuery(query: Record<string, QueryValue> | undefined): string {
  if (!query) return ''

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== '') search.append(key, entry)
      }
      continue
    }

    if (typeof value === 'boolean') {
      search.append(key, value ? 'true' : 'false')
      continue
    }

    if (value === '') continue
    search.append(key, String(value))
  }

  const serialised = search.toString()
  return serialised === '' ? '' : `?${serialised}`
}

/** Last `/` segment of the C1 `type` URI, when it names a marker we know. */
function kindFromType(type: unknown): ApiErrorKind | undefined {
  if (typeof type !== 'string') return undefined
  const segment = type.split('/').filter(Boolean).pop()
  return segment !== undefined && KIND_FROM_TYPE.has(segment)
    ? (segment as ApiErrorKind)
    : undefined
}

/**
 * Fallback for responses that are not a C1 envelope (e.g. a proxy HTML page). A 409
 * without a marker is assumed to be the more common illegal transition; the envelope's
 * marker always wins when present.
 */
function kindFromStatus(status: number): ApiErrorKind {
  if (status === 400) return 'validation-failed'
  if (status === 404) return 'not-found'
  if (status === 405) return 'method-not-allowed'
  if (status === 409) return 'illegal-transition'
  return 'internal-error'
}

function readFieldErrors(value: unknown): FieldError[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { field, message } = entry as Record<string, unknown>
    return typeof field === 'string' && typeof message === 'string' ? [{ field, message }] : []
  })
}

function readEnvelope(body: unknown): {
  type: unknown
  title: string
  status: number
  detail: string
  errors: FieldError[]
} | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  if (typeof record.title !== 'string' || typeof record.status !== 'number') return null
  return {
    type: record.type,
    title: record.title,
    status: record.status,
    detail: typeof record.detail === 'string' ? record.detail : '',
    errors: readFieldErrors(record.errors),
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const text = await response.text().catch(() => '')

  let body: unknown
  try {
    body = text.trim() === '' ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }

  const envelope = readEnvelope(body)
  if (envelope === null) {
    // Never echo a non-C1 body (it may be a proxy's HTML error page) into the message.
    const statusText = response.statusText.trim()
    return new ApiError({
      title: statusText === '' ? `Request failed with status ${response.status}` : statusText,
      status: response.status,
      kind: kindFromStatus(response.status),
    })
  }

  return new ApiError({
    title: envelope.title,
    status: envelope.status,
    kind: kindFromType(envelope.type) ?? kindFromStatus(envelope.status),
    detail: envelope.detail,
    fieldErrors: envelope.errors,
  })
}

/**
 * The single network boundary: the only place in the app that knows backend URLs and
 * error shapes. Never throws anything but {@link ApiError}.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = `${config.apiBaseUrl}${path}${buildQuery(options.query)}`
  const hasBody = options.body !== undefined

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (hasBody) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      // No auth in Phase 1; keeps BE-06's no-credentials CORS setup valid.
      credentials: 'omit',
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiError({
        title: 'Request cancelled',
        status: 0,
        kind: 'network',
        detail: 'Request cancelled',
        retryable: false,
      })
    }

    throw new ApiError({
      title: 'Network request failed',
      status: 0,
      kind: 'network',
      detail: error instanceof Error ? error.message : 'The request could not be sent.',
    })
  }

  if (!response.ok) throw await toApiError(response)

  if (response.status === 204) return undefined as T

  const text = await response.text()
  if (text.trim() === '') return undefined as T

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError({
      title: 'Malformed response',
      status: response.status,
      kind: 'malformed-response',
      detail: 'The server returned a body that is not valid JSON.',
    })
  }
}
