# Reputify JavaScript SDK

TypeScript/JavaScript client for the [Reputify API](https://api.reputify.io/):
reviews, scores, surveys, invitations, embeds, video and audio reviews — plus
OAuth ("Connect with Reputify") and webhook verification.

- Zero dependencies. Uses `fetch` and Web Crypto: Node 18+, Deno, Bun,
  Cloudflare Workers.
- ESM and CommonJS, full types.
- Retries rate limits (`429`, honouring `Retry-After`) and, for idempotent
  calls only, server and network errors.

```bash
npm install @reputify/sdk
```

## Quick start

```ts
import { Reputify } from '@reputify/sdk';

const reputify = new Reputify({ token: process.env.REPUTIFY_TOKEN! });

const { score } = await reputify.projects.profile(12);
console.log(score.value); // 88.8 — the same number as the seal

for await (const review of await reputify.reviews.list(12, { min_rating: 4, has_text: true })) {
  console.log(review.reviewer_name, review.text);
}

await reputify.reviews.reply(12, 9182, 'Thank you, Anna!');
```

> **Server only.** A token in a web page is full access for every visitor.
> In the browser, use embeds — they have their own public key:
> `Embeds.renderUrl('pk_…', '1a', 'svg')`.

## Tokens

| Token | What it can do |
|---|---|
| `rpf_live_…` (team) | Everything the scopes on the token allow. |
| `rpf_inv_…` (survey) | `invites.create()` and nothing else. |
| OAuth (`TokenSet`) | What the customer granted in the connect dialog. One hour, refreshes itself. |

## Invite a customer after an order

```ts
const reputify = new Reputify({ token: 'rpf_inv_…' });

const result = await reputify.invites.create({
  name: 'Anna Bauer',
  email: 'anna@example.at',
  order_ref: '2026-1188',                 // twice = still one invitation
  product_items: ['SKU-4711', { ref: 'SKU-12', name: 'Mug' }],
});
result.status; // 'invited' | 'already_invited'
```

## Errors

```ts
import { ConflictError, PermissionError, RateLimitError, ValidationError, ApiError } from '@reputify/sdk';

try {
  await reputify.reviews.reply(12, 9182, 'Thanks!');
} catch (e) {
  if (e instanceof ConflictError) { /* reply_on_platform */ }
  else if (e instanceof PermissionError) { e.required; e.isPlanRequired; }
  else if (e instanceof ValidationError) { e.errors; }
  else if (e instanceof RateLimitError) { e.retryAfter; }
  else if (e instanceof ApiError) { e.status; e.code; e.body; }
  else throw e;
}
```

Branch on `e.code`, never on the message. Network failures throw
`ConnectionError`; everything extends `ReputifyError`.

## OAuth: "Connect with Reputify"

```ts
import { OAuth, Reputify, pkce } from '@reputify/sdk';

// Once per installation:
const { client_id } = await OAuth.register('My Shop App', ['https://shop.example/reputify/callback']);
const oauth = new OAuth({ clientId: client_id, redirectUri: 'https://shop.example/reputify/callback' });

// 1. Send the customer off — keep verifier and state in the session
const { verifier, challenge } = await pkce();
const state = crypto.randomUUID();
redirect(oauth.authorizeUrl(['widgets:read', 'invites:write'], state, challenge));

// 2. On the way back (check state first!)
const tokens = await oauth.exchangeCode(code, verifier);
await save(tokens);

// 3. Use it
const reputify = new Reputify({ token: await load(), oauth, onRefresh: save });
await reputify.site.get();
```

**The refresh key rotates.** Each refresh spends the old key; presenting it
again revokes the connection. `onRefresh` must persist the new pair before
it resolves. Parallel calls in one client share a single refresh; across
processes, use a lock.

## Webhooks

```ts
import express from 'express';
import { verifyWebhook, WEBHOOK_EVENTS } from '@reputify/sdk';

app.post('/reputify', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = await verifyWebhook(req.body, req.get('X-Reputify-Signature'), process.env.REPUTIFY_WEBHOOK_SECRET!);
  if (event.event === WEBHOOK_EVENTS.submitted) { /* … */ }
  res.sendStatus(200);
});
```

Verify the **raw** body — `express.json()` re-serialises and breaks the signature.

## Resources

| Property | Methods |
|---|---|
| `projects` | `list`, `get`, `profile`, `scoreHistory` |
| `reviews` | `list`, `get`, `reply`, `deleteReply` |
| `surveys` | `list`, `get`, `create`, `update`, `insights`, `recipients` |
| `invites` | `create` |
| `analysis` | `sentiment`, `findings`, `summary`, `figures` |
| `embeds` | `catalog`, `list`, `create`, `update`, `Embeds.renderUrl` (static) |
| `recordings` | `list`, `get`, `feature`, `exports`, `createExport`, `prompts` |
| `awards` | `list` |
| `feedback` | `list` |
| `catalog` | `platformTypes`, `industries` |
| `site` | `get`, `surveys`, `invites`, `setIndustry`, `loginLink` |

Lists return a `Page`: `page.data`, `page.meta`, `await page.next()`,
`for await (…)` over all pages, or `await page.all()`.

Anything else: `reputify.request('GET', 'v1/…', query, body)`. Rate limit of
the last call: `reputify.rateLimit`. Full reference: <https://api.reputify.io/>.

## Development

```bash
npm install
npm test
```
