/**
 * Jede Fehlerantwort der API traegt `error` (fuer die Maschine) und
 * `message` (fuer den Menschen). Verzweigt wird auf `code`, nie auf den Text.
 */

export class ReputifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Das Netz, nicht die API: Zeitueberschreitung, DNS, TLS, Abbruch. */
export class ConnectionError extends ReputifyError {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

export class ApiError extends ReputifyError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body: Record<string, unknown>,
    public readonly headers: Headers = new Headers(),
  ) {
    super(message);
  }

  static from(status: number, body: Record<string, unknown>, headers: Headers): ApiError {
    const code =
      typeof body.error === 'string' ? body.error : body.errors ? 'validation_failed' : `http_${status}`;
    const message =
      typeof body.message === 'string' ? body.message : `Reputify API error (${status}).`;
    const Ctor =
      status === 401 ? AuthenticationError
      : status === 403 ? PermissionError
      : status === 404 ? NotFoundError
      : status === 409 ? ConflictError
      : status === 422 ? ValidationError
      : status === 429 ? RateLimitError
      : status >= 500 ? ServerError
      : ApiError;

    return new Ctor(message, status, code, body, headers);
  }
}

/** 401 — Marke fehlt, ist falsch, abgelaufen oder widerrufen. */
export class AuthenticationError extends ApiError {}

/** 403 — `insufficient_scope` (Recht fehlt, siehe `required`) oder `plan_required`. */
export class PermissionError extends ApiError {
  get required(): string[] {
    const r = this.body.required;
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : [];
  }

  get isPlanRequired(): boolean {
    return this.code === 'plan_required';
  }
}

export class NotFoundError extends ApiError {}

/** 409 — z. B. `survey_closed` oder `reply_on_platform`. */
export class ConflictError extends ApiError {}

/** 422 — Eingaben abgelehnt; `errors` je Feld. */
export class ValidationError extends ApiError {
  get errors(): Record<string, string[]> {
    const e = this.body.errors;
    return e && typeof e === 'object' ? (e as Record<string, string[]>) : {};
  }
}

/** 429 — Grenze des Tarifs je Minute erreicht, auch nach den Wiederholungen. */
export class RateLimitError extends ApiError {
  get retryAfter(): number | null {
    const v = this.headers.get('retry-after');
    return v !== null && !Number.isNaN(Number(v)) ? Number(v) : null;
  }
}

export class ServerError extends ApiError {}

/**
 * Der Token-Endpunkt hat abgelehnt. `invalid_grant` beim Erneuern heisst:
 * die Verbindung ist weg — neu verbinden, nicht wiederholen.
 */
export class OAuthError extends ReputifyError {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message);
  }
}

/** Signatur oder Zeitstempel eines Webhooks passen nicht — nicht verarbeiten. */
export class WebhookError extends ReputifyError {}
