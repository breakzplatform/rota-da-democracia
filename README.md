# Rota da Democracia

Non-partisan volunteer site for Brazil's presidential runoff (Sunday, 25 Oct 2026): free public transport info, how to reach your polling place, and free solidarity rides between neighbours. UI in Brazilian Portuguese.

## Stack

- Cloudflare Worker (`src/`) with Workers Static Assets (`public/`) and D1 (`migrations/`).
- Turnstile on offer/group creation, contact and invite-link reveal, and reports.
- Reports never hide anything on their own: they are queued for moderation, and a Telegram notice goes out per report (plus a burst alert at 10 reports in 10 minutes) when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set.
- Polling places from TSE open data, built by `scripts/build-data.py` into `public/data/m/<cd>.json`.
- Hourly cron cleans up; at `ELECTION.purgeAt` (`src/config.ts`) everything is deleted and the API returns 410.

## Develop

```sh
npm ci
npx wrangler d1 migrations apply carona --local
npx wrangler dev --var TURNSTILE_SITE_KEY:1x00000000000000000000AA
npm test && npx tsc --noEmit
npm run test:data
```

`.dev.vars` (not committed) needs `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` and `IP_SALT`.

## Deploy

```sh
npx wrangler d1 migrations apply carona --remote
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put IP_SALT
npx wrangler deploy
```

When adding a custom domain: add it to the Turnstile widget hostnames and to `ALLOWED_HOSTNAMES` in `wrangler.jsonc`, or every POST fails with 403.

## Moderation

Needs the `ADMIN_TOKEN` secret (`npx wrangler secret put ADMIN_TOKEN`); without it the admin API answers 404. Keep the token in a shell variable, never on the command line history or in the repo.

```sh
BASE=https://rota-da-democracia.joselito.workers.dev
AUTH="Authorization: Bearer $ADMIN_TOKEN"
curl -H "$AUTH" "$BASE/api/admin/denuncias"             # pending reports, no contact or invite link
curl -H "$AUTH" "$BASE/api/admin/denuncias?detalhe=1"   # same, with contact / invite link
curl -X POST -H "$AUTH" "$BASE/api/admin/ofertas/<id>/ocultar"    # hide an offer (also marks its reports reviewed)
curl -X POST -H "$AUTH" "$BASE/api/admin/ofertas/<id>/restaurar"  # restore it
curl -X POST -H "$AUTH" "$BASE/api/admin/grupos/<id>/ocultar"     # same for WhatsApp groups
curl -X POST -H "$AUTH" "$BASE/api/admin/grupos/<id>/restaurar"
```

## Data

- `npm run data` rebuilds polling places from the TSE CSV (`--download` fetches it).
- `public/data/tarifa-zero.json` lists free-transport announcements per município with sources; `turno2: true` only when the source explicitly covers 25 Oct.
- Content of the FAQ lives in `content/faq.md` (the page is `public/faq.html`).
