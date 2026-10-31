# SHIVNEE — quiet, end-to-end encrypted chat

A soft, dark messenger with **direct** and **group** chats, an **English / Монгол** switch, and a
small relay server that never sees what you write — or who wrote it.

**How the encryption works, step by step (in Mongolian):** [docs/HOW-IT-WORKS.md](docs/HOW-IT-WORKS.md)

## Run it

You need [Node.js](https://nodejs.org) **20.19+**.

```bash
npm install
npm run dev
```

This starts the relay on <http://localhost:8787> and the web app on <http://localhost:5173>.
To try it with two people, open a normal window and an **incognito** window, create two identities,
and add each other by handle.

| Command | What it does |
| --- | --- |
| `npm run dev` | Relay server + web app with hot reload |
| `npm run server` | Relay server only (port 8787, `PORT=` to change) |
| `npm run dev:client` | Web app only |
| `npm start` | Build the web app and serve everything from the relay on port 8787 |
| `npm test` | Protocol tests (key agreement, ratchet, tampering, sealed sender…) |
| `npm run build` | Type-check client + server + Worker and build `dist/` |
| `npm run cf:dev` | Run the Cloudflare version locally (Worker + Durable Object) |
| `npm run deploy` | Build and deploy to Cloudflare — see [docs/DEPLOY.md](docs/DEPLOY.md) |

Server data (public keys + sealed envelopes waiting for delivery) lives in `server/data/store.json`
for the Node relay, or in the Durable Object's SQLite database on Cloudflare.

## Deploy to Cloudflare

The whole app runs on Cloudflare Workers: static files for the web app, plus one Durable Object
that holds the WebSockets and the relay data. Both relays share the same rules (`server/relay.ts`).

```bash
npx wrangler login
npm run deploy
```

Full guide (in Mongolian): [docs/DEPLOY.md](docs/DEPLOY.md)

## Security model in one screen

- **Keys are made on your device.** Ed25519 identity, X25519 identity, a signed prekey and 100
  one-time prekeys. Only the public halves are uploaded.
- **No passwords on the server.** You log in by signing a random challenge with your identity key.
- **X3DH** to start a conversation (even while the other person is offline), then the
  **Double Ratchet**: every message has its own key, keys are deleted after use (forward secrecy),
  and every reply mixes in fresh randomness (recovery after compromise).
- **Sealed sender:** the server sees only the recipient and an opaque blob.
- **Safety numbers** (60 digits from both identity keys) detect a server swapping keys.
- **Local vault:** everything on the device is encrypted with AES-256-GCM using a key derived from
  your passphrase (PBKDF2-SHA-256, 310 000 rounds). Data is saved before the server is told it can
  delete a message, so a crash can't lose messages or desync the ratchets.
- Groups: messages are encrypted separately for each member; the server doesn't know groups exist.

Primitives come from the audited [`@noble`](https://paulmillr.com/noble/) libraries. This project
itself has not been audited — see the limitations section of the how-it-works doc.

## Features

- Direct and group chats, search, unread counts, hide previews, privacy screen, cover-on-blur.
- Text and files (≤ 0.5 MB, image previews), copy/delete, disappearing messages with live countdown.
- Pending / sent / delivered / read, typing indicator, offline queue with automatic resend.
- Groups: create, rename, describe, recolor, invite, remove, leave, renew keys with everyone.
- Contacts: add by handle (optionally checked against their contact code), nickname, verify.
- Profile shared over the encrypted channel: display name, status, presence, photo or pattern.
- Appearance: accent (any color), text size, bubble shape, spacing, binary background.
- Security settings: auto-lock, change passphrase, erase vault (also deletes the server account).

## Project layout

```
shared/        code used by both sides: e2ee.ts (crypto), protocol.ts (wire types), encoding.ts
server/        relay.ts (relay rules, shared), index.ts (Node HTTP + WebSocket), store.ts (JSON file)
cloudflare/    worker.ts (Cloudflare Worker + Durable Object with SQLite)
src/net/       connection.ts (WebSocket + signed login), engine.ts (encrypt / decrypt / deliver)
src/state/     chat.ts (reducer), init.ts (new identity state, vault checks)
src/lib/       vault.ts (encrypted storage), time, toast, identicons
src/components UI
src/i18n/      en.ts (base) and mn.ts
tests/         e2ee.test.ts
docs/          HOW-IT-WORKS.md, DEPLOY.md
```
