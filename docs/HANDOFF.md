# Handoff

Last updated 2026-11-09 (v0.2.0 live). Read ROADMAP.md for the plan and the decisions the user has made, and CLAUDE.md for the working rules.

## Where things stand

- **v0.1 (offline core loop)** is done and committed.
- **v0.2 (online shared world)** is live at https://permafrost.parbs.online (v0.2.0, shipped 2026-11-09). Ship updates with `npm run ship` (see docs/hosting.md). The code:
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

## Next steps

1. **v0.2 is done.** The repo went public on 2026-11-09. The VM runs `~/permafrost` with `~/deploy-permafrost.sh`, and the PC's `~/.ssh/permafrost-deploy` key plus `.deploy.local.json` (git-ignored) drive `npm run ship`. The first ship passed every check: the page and assets load through Cloudflare, `/ws` opens from the real origin, and other origins are refused. Nightly backups: `~/backup-permafrost.sh` runs from cron at 04:30 into `~/permafrost-backups` and keeps 14 days, set up by `deb-soft-haven` and the same as TPT's.
2. **Public map width:** the server uses 240 (`PUBLIC_WIDTH` in `server/game.ts`). The user never confirmed the expected player count, so 240 and 4-week seasons are defaults. Season rollover isn't written yet: `worlds.season` stays at 1.
3. **Next milestone:** v0.3, The living ice (see ROADMAP.md).

## Known limits and notes

- On join, a client downloads all of the world's changes at once (4 bytes per changed tile). This is fine for a season. If it grows large, send it in chunks near the player instead.
- Items (`use`) aren't predicted online. The client waits for the server, so there's a round-trip delay before a charge goes off.
- Station actions are applied optimistically on the client. The fuel and hull gauges can flicker back for about one round trip until the server's snapshot catches up.
- `npm audit` reports 3 dev-dependency advisories (from vite/esbuild versions). They haven't been looked at yet.
- Docker Desktop on this PC may need starting first. It is installed per user, under AppData/Local/Programs/DockerDesktop.
