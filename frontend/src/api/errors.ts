/** A single field violation from the C1 error envelope (`errors[]`). */
export type FieldError = {
  field: string
  message: string
}

/** The C1 error envelope exactly as the backend emits it. */
export type ApiErrorBody = {
  type: string
  title: string
  status: number
  detail: string
  instance?: string
  errors?: FieldError[]
}

/**
 * Discriminated view of the C1 `type` marker, plus the two client-side-only kinds.
 * `network`/`malformed-response` never come from the server.
 */
export type ApiErrorKind =
  | 'validation-failed'
  | 'not-found'
  | 'illegal-transition'
  | 'version-conflict'
  | 'blocked-delete'
  | 'unprocessable'
  | 'method-not-allowed'
  | 'internal-error'
  | 'network'
  | 'malformed-response'

export type ApiErrorInit = {
  title: string
  status: number
  kind: ApiErrorKind
  detail?: string
  fieldErrors?: FieldError[]
  /** Defaults to the derived rule: `status >= 500 || kind === 'network' || kind === 'version-conflict'`. */
  retryable?: boolean
}

export class ApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind
  readonly detail: string
  readonly fieldErrors: FieldError[]
  readonly retryable: boolean

  constructor(init: ApiErrorInit) {
    super(init.title)
    this.name = 'ApiError'
    this.status = init.status
    this.kind = init.kind
    this.detail = init.detail ?? ''
    this.fieldErrors = init.fieldErrors ?? []
    this.retryable =
      init.retryable ??
      (init.status >= 500 || init.kind === 'network' || init.kind === 'version-conflict')
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** Field-error list → the `Record<field, message>` shape the form components consume. */
export function toFieldErrors(error: ApiError): Record<string, string> {
  return Object.fromEntries(error.fieldErrors.map((entry) => [entry.field, entry.message]))
}
