import { ApiError, AuthenticationError, ConnectionError, ReputifyError } from './errors.js';
import { expiresSoon, OAuth, TokenSet } from './oauth.js';
import { ListBody, Page } from './page.js';
import {
  Analysis, Awards, Catalog, Embeds, Feedback, Invites, Projects, Recordings, Reviews, Site, Surveys,
} from './resources.js';

export const VERSION = '1.0.0';
export const BASE_URL = 'https://api.reputify.io';

export type QueryValue = string | number | boolean | Date | null | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

export interface ReputifyOptions {
  /**
   * `rpf_live_…` (Team), `rpf_inv_…` (Umfrage, nur `invites.create`) —
   * oder ein `TokenSet` aus dem Verbinden-Dialog.
   */
  token: string | TokenSet;
  /** Mit `oauth` erneuert sich ein `TokenSet` selbst. */
  oauth?: OAuth;
  /**
   * Bekommt jedes neue Paar. Muss es **speichern**, bevor es zurueckkehrt —
   * der alte Erneuerungsschluessel ist verbraucht.
   */
  onRefresh?: (tokens: TokenSet) => void | Promise<void>;
  baseUrl?: string;
  /** Millisekunden, Vorgabe 30 000. */
  timeout?: number;
  /** Wiederholungen bei 429 und (fuer GET/PUT/DELETE) bei 5xx/Netzfehler. Vorgabe 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Nur fuer Tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimit {
  limit: number | null;
  remaining: number | null;
}

/**
 * Der Client fuer api.reputify.io.
 *
 * ```ts
 * const reputify = new Reputify({ token: process.env.REPUTIFY_TOKEN! });
 * const { score } = await reputify.projects.profile(12);
 * for await (const review of await reputify.reviews.list(12, { min_rating: 4 })) { … }
 * ```
 *
 * **Nie im Browser mit einer Zugangsmarke.** Eine Marke im Quelltext einer
 * Website ist ein Vollzugang fuer jeden Besucher. Was im Browser laufen
 * soll, sind die Einbettungen (`Embeds.renderUrl`, oeffentlicher `pk_…`).
 */
export class Reputify {
  readonly projects = new Projects(this);
  readonly reviews = new Reviews(this);
  readonly surveys = new Surveys(this);
  readonly invites = new Invites(this);
  readonly analysis = new Analysis(this);
  readonly embeds = new Embeds(this);
  readonly recordings = new Recordings(this);
  readonly awards = new Awards(this);
  readonly feedback = new Feedback(this);
  readonly catalog = new Catalog(this);
  readonly site = new Site(this);

  private tokenSet: TokenSet | null;
  private readonly staticToken: string | null;
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private refreshing: Promise<void> | null = null;
  private lastHeaders: Headers | null = null;

  constructor(private readonly options: ReputifyOptions) {
    if (typeof options.token === 'string') {
      this.staticToken = options.token;
      this.tokenSet = null;
    } else {
      this.staticToken = null;
      this.tokenSet = options.token;
    }
    this.baseUrl = (options.baseUrl ?? BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? 30_000;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Das aktuelle Paar — nach einer Erneuerung ein anderes als im Konstruktor. */
  get tokens(): TokenSet | null {
    return this.tokenSet;
  }

  /** Aus der letzten Antwort. */
  get rateLimit(): RateLimit {
    const num = (v: string | null | undefined) => (v == null ? null : Number(v));
    return {
      limit: num(this.lastHeaders?.get('x-ratelimit-limit')),
      remaining: num(this.lastHeaders?.get('x-ratelimit-remaining')),
    };
  }

  /**
   * Eine Anfrage an einen beliebigen Pfad — fuer Endpunkte ohne eigene
   * Methode. `null` bei 204/304.
   */
  async request<T = Record<string, unknown>>(method: string, path: string, query: Query = {}, body?: unknown): Promise<T> {
    method = method.toUpperCase();
    const url = `${this.baseUrl}/${path.replace(/^\/+/, '')}${toQuery(query)}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const retryable = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method);
    let refreshed = false;
    let attempt = 0;

    for (;;) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: 'application/json',
      };
      if (payload !== undefined) headers['Content-Type'] = 'application/json';

      let res: Response;
      try {
        res = await this.fetchFn(url, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(this.timeout) });
      } catch (e) {
        if (retryable && attempt < this.maxRetries) {
          await this.sleep(backoff(attempt++));
          continue;
        }
        throw new ConnectionError(`Request to Reputify failed: ${(e as Error)?.message ?? e}`, e);
      }

      this.lastHeaders = res.headers;

      if (res.status === 401 && !refreshed && this.canRefresh()) {
        await this.refresh();
        refreshed = true;
        continue;
      }

      if (res.status === 429 && attempt < this.maxRetries) {
        const wait = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 60) * 1000 : backoff(attempt));
        attempt++;
        continue;
      }

      if (res.status >= 500 && retryable && attempt < this.maxRetries) {
        await this.sleep(backoff(attempt++));
        continue;
      }

      const text = await res.text();
      let json: unknown = null;
      if (text !== '') {
        try {
          json = JSON.parse(text);
        } catch {
          if (res.status < 400) throw new ReputifyError(`Reputify returned a response that is not JSON (status ${res.status}).`);
        }
      }

      if (res.status >= 400) {
        throw ApiError.from(res.status, (json && typeof json === 'object' ? json : {}) as Record<string, unknown>, res.headers);
      }

      return json as T;
    }
  }

  /** Eine Liste als `Page`. */
  async page<T = Record<string, unknown>>(path: string, query: Query = {}): Promise<Page<T>> {
    const body = await this.request<ListBody<T>>('GET', path, query);
    return new Page<T>(body ?? { data: [] }, (page) => this.page<T>(path, { ...query, page }));
  }

  private async accessToken(): Promise<string> {
    if (!this.tokenSet) return this.staticToken ?? '';
    if (expiresSoon(this.tokenSet) && this.canRefresh()) await this.refresh();
    return this.tokenSet.accessToken;
  }

  private canRefresh(): boolean {
    return Boolean(this.tokenSet?.refreshToken && this.options.oauth);
  }

  /**
   * Gleichzeitige Aufrufe teilen sich eine Erneuerung: zweimal derselbe
   * Schluessel wuerde die Verbindung sperren.
   */
  private refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        if (!this.canRefresh()) {
          throw new AuthenticationError('The access token expired and cannot be refreshed.', 401, 'unauthorized', {});
        }
        const next = await this.options.oauth!.refresh(this.tokenSet!.refreshToken!);
        this.tokenSet = next;
        await this.options.onRefresh?.(next);
      })().finally(() => {
        this.refreshing = null;
      });
    }
    return this.refreshing;
  }
}

function backoff(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 8000) + Math.floor(Math.random() * 250);
}

function toQuery(query: Query): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue;
    params.append(
      key,
      typeof value === 'boolean' ? (value ? '1' : '0')
      : value instanceof Date ? value.toISOString().slice(0, 10)
      : Array.isArray(value) ? value.join(',')
      : String(value),
    );
  }
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}
