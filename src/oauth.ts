import { OAuthError } from './errors.js';

/**
 * Zugangs- und Erneuerungsschluessel aus dem Verbinden-Dialog.
 *
 * Die Zugangsmarke gilt eine Stunde. Der Erneuerungsschluessel (`rpf_rt_…`)
 * **rotiert**: jede Erneuerung liefert einen neuen, der alte ist verbraucht.
 * Ein zweites Vorlegen sperrt die ganze Verbindung — deshalb muss jedes
 * neue Paar gespeichert sein, bevor der naechste Aufruf hinausgeht.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Unix-Zeit in Sekunden. */
  expiresAt: number;
  scope: string;
  project?: { id: number; name: string } | null;
}

export interface OAuthOptions {
  clientId: string;
  redirectUri: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  resource?: string;
  fetch?: typeof fetch;
}

export const AUTHORIZE_URL = 'https://app.reputify.io/oauth/authorize';
export const TOKEN_URL = 'https://app.reputify.io/oauth/token';
export const REGISTER_URL = 'https://app.reputify.io/oauth/register';
export const RESOURCE = 'https://api.reputify.io';

const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** PKCE S256 — `verifier` bis zum Rueckweg aufheben, `challenge` geht in die Adresse. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  return { verifier, challenge: await pkceChallenge(verifier) };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}

export function expiresSoon(tokens: TokenSet, leewaySeconds = 60, now = Date.now() / 1000): boolean {
  return now + leewaySeconds >= tokens.expiresAt;
}

/**
 * Der Verbinden-Dialog (OAuth 2.1, oeffentlicher Client, PKCE S256, kein
 * Client-Secret).
 */
export class OAuth {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: OAuthOptions) {
    this.fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  authorizeUrl(scopes: string[], state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      scope: scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      resource: this.options.resource ?? RESOURCE,
    });
    return `${this.options.authorizeUrl ?? AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Der Code ist fuenf Minuten gueltig und genau einmal einloesbar. */
  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
    return this.token({
      grant_type: 'authorization_code',
      code,
      client_id: this.options.clientId,
      redirect_uri: this.options.redirectUri,
      code_verifier: codeVerifier,
    });
  }

  /** Neues Paar gegen den Erneuerungsschluessel — Ergebnis sofort speichern. */
  refresh(refreshToken: string): Promise<TokenSet> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.options.clientId });
  }

  /** Einen Client anmelden (RFC 7591). Liefert u. a. `client_id`. */
  static async register(
    clientName: string,
    redirectUris: string[],
    extra: { logo_uri?: string; client_uri?: string; registerUrl?: string; fetch?: typeof fetch } = {},
  ): Promise<Record<string, unknown> & { client_id: string }> {
    const f = extra.fetch ?? globalThis.fetch.bind(globalThis);
    const res = await f(extra.registerUrl ?? REGISTER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_name: clientName, redirect_uris: redirectUris, logo_uri: extra.logo_uri, client_uri: extra.client_uri }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof body.client_id !== 'string') {
      throw new OAuthError(String(body.error_description ?? 'Client registration failed.'), String(body.error ?? 'invalid_client_metadata'), res.status);
    }
    return body as Record<string, unknown> & { client_id: string };
  }

  private async token(params: Record<string, string>): Promise<TokenSet> {
    const res = await this.fetchFn(this.options.tokenUrl ?? TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || typeof body.access_token !== 'string') {
      throw new OAuthError(String(body.error_description ?? body.message ?? 'Token request failed.'), String(body.error ?? 'invalid_request'), res.status);
    }

    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresAt: Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 3600),
      scope: String(body.scope ?? ''),
      project: (body.project as TokenSet['project']) ?? null,
    };
  }
}
