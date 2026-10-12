import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Reputify, OAuth, Embeds, pkceChallenge, verifyWebhook, signWebhook,
  PermissionError, ConflictError, ValidationError, RateLimitError, ConnectionError, WebhookError,
} from '../dist/esm/index.js';

function fake(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    const next = responses.shift();
    if (!next) throw new Error('No more fake responses');
    if (next instanceof Error) throw next;
    const [status, body, headers = {}] = next;
    return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  };
  fn.calls = calls;
  return fn;
}

const slept = [];
const opts = (f, extra = {}) => ({ token: 'rpf_live_test', fetch: f, sleep: async (ms) => { slept.push(ms); }, ...extra });

test('sends the bearer token and builds the query', async () => {
  const f = fake([[200, { data: [], meta: { page: 1 }, links: { next: null } }]]);
  await new Reputify(opts(f)).reviews.list(12, { min_rating: 4, has_text: true, date_from: new Date('2026-01-02T00:00:00Z'), sentiment: undefined });
  assert.equal(f.calls[0].url, 'https://api.reputify.io/v1/projects/12/reviews?min_rating=4&has_text=1&date_from=2026-01-02');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer rpf_live_test');
  assert.equal(f.calls[0].body, undefined);
});

test('single items come back unwrapped, PUT carries JSON', async () => {
  const f = fake([[200, { id: 7, rating: 4.0, reply: { text: 'Danke' } }]]);
  const review = await new Reputify(opts(f)).reviews.reply(12, 7, 'Danke');
  assert.equal(review.reply.text, 'Danke');
  assert.equal(f.calls[0].method, 'PUT');
  assert.equal(f.calls[0].body, '{"text":"Danke"}');
});

test('for await walks all pages', async () => {
  const f = fake([
    [200, { data: [{ id: 1 }, { id: 2 }], meta: { page: 1 }, links: { next: 'x?page=2' } }],
    [200, { data: [{ id: 3 }], meta: { page: 2 }, links: { next: null } }],
  ]);
  const ids = [];
  for await (const p of await new Reputify(opts(f)).projects.list({ per_page: 2 })) ids.push(p.id);
  assert.deepEqual(ids, [1, 2, 3]);
  assert.match(f.calls[1].url, /per_page=2&page=2/);
});

test('recordings page by total when there are no links', async () => {
  const f = fake([
    [200, { data: [{ id: 1 }], meta: { current_page: 1, per_page: 1, total: 2 } }],
    [200, { data: [{ id: 2 }], meta: { current_page: 2, per_page: 1, total: 2 } }],
  ]);
  const all = await (await new Reputify(opts(f)).recordings.list(5, { per_page: 1 })).all();
  assert.equal(all.length, 2);
});

test('errors become typed', async () => {
  const f = fake([
    [403, { error: 'insufficient_scope', message: 'Insufficient permissions.', required: ['reviews:reply'] }],
    [409, { error: 'survey_closed' }],
    [422, { message: 'too short', errors: { text: ['too short'] } }],
  ]);
  const c = new Reputify(opts(f));
  await assert.rejects(c.reviews.reply(1, 2, 'Hallo'), (e) => e instanceof PermissionError && e.code === 'insufficient_scope' && e.required[0] === 'reviews:reply');
  await assert.rejects(c.invites.create({ name: 'Anna', email: 'anna@example.at' }), (e) => e instanceof ConflictError && e.code === 'survey_closed');
  await assert.rejects(c.reviews.reply(1, 2, 'x'), (e) => e instanceof ValidationError && e.code === 'validation_failed' && e.errors.text[0] === 'too short');
});

test('429 waits for Retry-After, then gives up', async () => {
  slept.length = 0;
  const r = () => [429, { error: 'rate_limited', message: 'Too many.' }, { 'retry-after': '3' }];
  const f = fake([r(), r(), r()]);
  await assert.rejects(new Reputify(opts(f)).projects.get(1), (e) => e instanceof RateLimitError && e.retryAfter === 3);
  assert.deepEqual(slept, [3000, 3000]);
  assert.equal(f.calls.length, 3);
});

test('5xx retried for GET; POST is not retried on network errors', async () => {
  const f = fake([[503, null], [200, { id: 1 }]]);
  assert.deepEqual(await new Reputify(opts(f)).projects.get(1), { id: 1 });

  const g = fake([new TypeError('fetch failed')]);
  await assert.rejects(new Reputify(opts(g)).invites.create({ name: 'A', email: 'a@example.at' }), ConnectionError);
  assert.equal(g.calls.length, 1);
});

test('expiring token: refreshed once for parallel calls and handed to onRefresh', async () => {
  const api = fake([[200, { a: 1 }], [200, { b: 2 }]]);
  const auth = fake([[200, { access_token: 'rpf_live_new', refresh_token: 'rpf_rt_2', expires_in: 3600, scope: 'widgets:read' }]]);
  let saved = null;
  const c = new Reputify(opts(api, {
    token: { accessToken: 'old', refreshToken: 'rpf_rt_1', expiresAt: Date.now() / 1000 + 10, scope: '' },
    oauth: new OAuth({ clientId: 'rpc_x', redirectUri: 'https://shop.example/cb', fetch: auth }),
    onRefresh: (t) => { saved = t; },
  }));
  await Promise.all([c.site.get(), c.site.surveys()]);
  assert.equal(auth.calls.length, 1);
  assert.equal(auth.calls[0].body, 'grant_type=refresh_token&refresh_token=rpf_rt_1&client_id=rpc_x');
  assert.equal(saved.refreshToken, 'rpf_rt_2');
  assert.equal(api.calls[0].headers.Authorization, 'Bearer rpf_live_new');
});

test('authorize url and PKCE (RFC 7636 appendix B)', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const url = new URL(new OAuth({ clientId: 'rpc_x', redirectUri: 'https://shop.example/cb' }).authorizeUrl(['widgets:read', 'invites:write'], 'st', 'ch'));
  assert.equal(url.origin + url.pathname, 'https://app.reputify.io/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'widgets:read invites:write');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('resource'), 'https://api.reputify.io');
});

test('render url', () => {
  assert.equal(Embeds.renderUrl('pk_abc', '1a', 'svg', { theme: 'dark', loc: undefined }), 'https://cdn.reputify.io/w/v1/pk_abc/1a.svg?theme=dark');
});

test('webhooks: same formula as the server, replay and tamper refused', async () => {
  const { createHmac } = await import('node:crypto');
  assert.equal(await signWebhook('abc', 'k'), 'sha256=' + createHmac('sha256', 'k').update('abc').digest('hex'));

  const body = JSON.stringify({ event: 'review.submitted', occurred_at: '2026-10-12T10:00:00+02:00' });
  const sig = await signWebhook(body, 's');
  const now = Date.parse('2026-10-12T10:01:00+02:00') / 1000;
  assert.equal((await verifyWebhook(body, sig, 's', { now })).event, 'review.submitted');
  await assert.rejects(verifyWebhook(body + ' ', sig, 's', { now }), WebhookError);
  await assert.rejects(verifyWebhook(body, sig, 's', { now: now + 86400 }), /too old/);
});
