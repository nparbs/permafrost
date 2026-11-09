# Handoff

Last updated 2026-11-09 (hosting files added). Read ROADMAP.md for the plan and the decisions the user has made, and CLAUDE.md for the working rules.

## Where things stand

- **v0.1 (offline core loop)** is done and committed.
- **v0.2 (online shared world)** works locally but isn't hosted yet. Its code is in the commit after v0.1:
  - `server/` holds the Node server (ws + node:sqlite):
    - `index.ts` serves the HTTP page, `/ws`, `/health`, rate limits and a fixed 60 Hz loop.
    - `game.ts` is the shared world. The server runs `src/sim` for every rig from its inputs, owns tiles, cash and cargo, and broadcasts tile changes, rigs nearby (10 Hz) and snapshots (20 Hz).
    - `db.ts` stores accounts (16-letter codes, hashed), worlds (seed plus packed diffs) and players (per world and season).
  - `src/net/` is the client side:
    - `protocol.ts` defines the messages.
    - `connect.ts` opens the WebSocket.
    - `netSession.ts` handles prediction. It takes each server snapshot, puts back any digs it predicted after that point, and replays the unconfirmed inputs.
  - `src/sim/actions.ts` handles station services and items as data, with location checks. Offline and online play both use it.
  - `src/game/session.ts` defines the `GameSession` interface and `LocalSession`. The scene and UI only talk to the interface.
  - The UI has a title screen (name, paint, Play online / offline, Use a code), chat (T), an online count, the code in the menu, and a "Connection lost" dialog with auto-reconnect (3 tries).
- **Tests:** 37 pass (`npm test`). `tests/net.test.ts` runs the server and clients in-process over fake links with latency and jitter. On a steady link, the predicted rig matches the server exactly.
- **Two-browser check:** `scripts/mp.mjs` passes every check. It covers joining, seeing each other, the world staying in sync, chat, and moving to a phone with the code (which kicks the old screen).

## Running it locally

```sh
npm run server   # builds dist-server/ and runs on :8791 (DB in data/permafrost.db, or DB_FILE=...)
npm run dev      # page on :5173, which forwards /ws to :8791
npm run mp       # two headless browsers (URL=http://localhost:PORT/ if not 5173)
npm run shots    # screenshots (desktop, phone)
```

## Next steps (rest of v0.2)

1. **Hosting files are done and tested locally** (2026-11-09): `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.example`, `deploy/deploy-permafrost.sh`, `scripts/ship.mjs` (`npm run ship`) and `docs/hosting.md`. The image was run under Docker Desktop with the compose hardening (read-only, no capabilities, 384 MB): `/health` turned healthy, `npm run mp` passed every check against it, accounts and world changes survived a restart, and `ALLOWED_ORIGINS` refused other origins with a 403.
2. **Deploying:** the repo went public on 2026-11-09, so the VM clones it over HTTPS. The PC has `~/.ssh/permafrost-deploy` and `.deploy.local.json`. The VM side (clone, `.env`, compose up, `~/deploy-permafrost.sh`, the locked key line) was handed to the `deb-soft-haven` session. The user adds the `permafrost` public hostname (`permafrost:8791`) to Scrap Riot's tunnel in the Cloudflare dashboard. The first ship is `npm run ship -- minor` (0.1.0 → 0.2.0).
3. **Public map width:** the server uses 240 (`PUBLIC_WIDTH` in `server/game.ts`). The user never confirmed the expected player count, so 240 and 4-week seasons are defaults.
4. **Visual check:** done. Name tags and chat bubbles read fine at desktop and phone sizes (`shots/mp-03-bo-chat.png`, `mp-04-ada-phone.png`). A chat bubble can cover the layer banner's subtitle for a moment, which is acceptable.

## Known limits and notes

- On join, a client downloads all of the world's changes at once (4 bytes per changed tile). This is fine for a season. If it grows large, send it in chunks near the player instead.
- Items (`use`) aren't predicted online. The client waits for the server, so there's a round-trip delay before a charge goes off.
- Station actions are applied optimistically on the client. The fuel and hull gauges can flicker back for about one round trip until the server's snapshot catches up.
- `npm audit` reports 3 dev-dependency advisories (from vite/esbuild versions). They haven't been looked at yet.
- Docker Desktop on this PC may need starting first. It is installed per user, under AppData/Local/Programs/DockerDesktop.
