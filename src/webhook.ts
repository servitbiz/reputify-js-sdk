import { WebhookError } from './errors.js';

/**
 * Webhooks einer Umfrage pruefen.
 *
 * Reputify signiert den **rohen Body** mit dem Webhook-Schluessel der
 * Umfrage: `X-Reputify-Signature: sha256=<hex>`. Der Zeitpunkt steht als
 * `occurred_at` im (mitsignierten) Body.
 *
 * Den Body so pruefen, wie er ankam — in Express `express.raw()`, nicht
 * `express.json()`: ein erneutes `JSON.stringify` aendert die Bytes.
 *
 * Laeuft ueber Web Crypto: Node 18+, Deno, Bun, Cloudflare Workers.
 */

export const WEBHOOK_EVENTS = {
  submitted: 'review.submitted',
  handover: 'review.handover',
  feedback: 'feedback.received',
} as const;

export interface WebhookEvent {
  event: string;
  survey: { id: number; name: string };
  project: { id: number; name: string | null };
  occurred_at: string;
  [key: string]: unknown;
}

const enc = new TextEncoder();

function toBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === 'string' ? enc.encode(payload) : payload;
}

/** Die Signatur, wie Reputify sie setzt. */
export async function signWebhook(payload: string | Uint8Array, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, toBytes(payload) as BufferSource));
  return 'sha256=' + Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidWebhookSignature(payload: string | Uint8Array, signature: string | null | undefined, secret: string): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) return false;
  return timingSafeEqual(await signWebhook(payload, secret), signature);
}

/**
 * @param toleranceSeconds Hoechstalter von `occurred_at`; 0 = nicht pruefen.
 *   Wiederholte Zustellungen (bis zu 25 Minuten spaeter) tragen den
 *   urspruenglichen Zeitpunkt — die Vorgabe laesst ihnen Platz.
 */
export async function verifyWebhook(
  payload: string | Uint8Array,
  signature: string | null | undefined,
  secret: string,
  { toleranceSeconds = 3600, now = Date.now() / 1000 }: { toleranceSeconds?: number; now?: number } = {},
): Promise<WebhookEvent> {
  if (!secret) throw new WebhookError('No webhook secret configured.');
  if (!(await isValidWebhookSignature(payload, signature, secret))) throw new WebhookError('Invalid webhook signature.');

  let event: WebhookEvent;
  try {
    event = JSON.parse(typeof payload === 'string' ? payload : new TextDecoder().decode(payload));
  } catch {
    throw new WebhookError('Webhook body is not JSON.');
  }

  if (toleranceSeconds > 0) {
    const at = Date.parse(String(event.occurred_at ?? '')) / 1000;
    if (Number.isNaN(at)) throw new WebhookError('Webhook has no occurred_at.');
    if (Math.abs(now - at) > toleranceSeconds) throw new WebhookError('Webhook is too old (replay?).');
  }

  return event;
}
