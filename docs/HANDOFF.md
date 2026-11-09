# Handoff

Last updated 2026-11-09 (v0.2.0 live; the phone UI, rounded tunnels and v0.3 are built locally but not committed or shipped). Read ROADMAP.md for the plan and the decisions the user has made, and CLAUDE.md for the working rules.

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
- **Phone UI (after v0.2.0, not committed or shipped yet):** in `src/ui/ui.ts` and `style.css`. Touch mode is the `touch-on` class on `#ui`, set by `(pointer: coarse)` or the first touch.
  - Every `kbd` is hidden on touch, and the title shows `.help-touch` instead of the keyboard help. The chat placeholder drops "Enter to send, Esc to cancel".
  - The building prompt becomes a 74x64 Enter button right above the ▲ thrust button. In portrait the item row is left-aligned so the right column stays free for it.
  - On screens under 420px tall the title has a smaller logo and the three buttons in one row, so it fits 640x360 with a save. `.title` can also scroll (`touch-action: pan-y`).
  - Checked in headless Chrome at 640x360, 360x640 and desktop: nothing overlaps, tapping Enter opens the building, no errors.
- **Rounded tunnels (after v0.2.0, not shipped):** a second tilemap layer, offset by half a tile, draws the edge where four tiles meet (`overIndex` and `paintOver` in `src/game/textures.ts`). Rock corners that face tunnel on both sides get cut round, closed tunnel corners get filled round, and a dark rim runs along every edge. It uses 16 shapes per layer, plus a set for the surface row where the sky counts as open but gets no rim. The layer uses `insertNull`, so it costs nothing where there's no tunnel. While a rig drills, `syncBites` in the scene carves a round hole around it in the target tile.
- **v0.3, The living ice (built, not shipped):**
  - `src/sim/env.ts` (`Environment`) listens to `world.onSet` and runs timed jobs from a heap. It handles loose boulders and slabs (shake for 0.55 s, then fall, and break on a rig for 16 or 9 hull), refreeze into `T.RIME` (snow, firn and glacier only, never within 2.5 tiles of a rig), ore regrowth (only with solid non-rime ground under it), meltwater floods from `T.MELT` into `T.WATER` that freezes into rime, and magma pours that cool to `T.SLAG`. Offline, `LocalSession` runs it. Online, only the server does (`Game.tick`): it broadcasts `fx` with `by: ''`, and sends hits only to the miner who was hit. Clients run no environment, so they just see tiles change.
  - `src/sim/weather.ts` handles blizzards and steam vents from `world.time` (wall-clock seconds) and the seed, so prediction agrees without new messages. The welcome now carries the server's `now`, so clients correct their clock. `PROTOCOL_VERSION` is 2, so old pages get told to refresh.
  - In `src/sim/rig.ts`, thrusting up into rime breaks it and emits a `dug` event, which online prediction already handles. Water drags the rig. Vents scald and lift (`rig.scald`). Blizzards chill the surface, push the rig with wind and add thrust burn.
  - New tiles are `RIME` 13, `SLAB` 14 and `MELT` 15, plus `WATER` 48, `VENT` 49 and `SLAG` 50. The ids above the minerals mean `t >= MINERAL_BASE` no longer means "mineral", so use `isMineral`. Generation adds slabs over ice caverns, meltwater pockets in the glacier and vents in the basalt, so the live world's generated tiles shift a little when this ships. Existing diffs still apply.
  - There's a Headlamp upgrade line (`lamp`, 5 tiers, 4 to 10 tiles) and a Flare item (key 6). The scene draws darkness as a RenderTexture covering the camera view and stamps lights out of it. It recreates the texture on resize, because a resized RenderTexture stops filling in Phaser 3.90.
  - `src/game/music.ts` holds the ambient music for each layer. The menu has a Music on/off switch (`permafrost.music` in localStorage).
  - On phones, the item bar is 6 buttons: smaller in portrait, and a 2-column grid in landscape.
- **Tests:** 55 pass (`npm test`). `tests/env.test.ts` covers the living ice, weather, vents and flares. `tests/net.test.ts` has a rockfall and a flare seen by two clients. `tests/net.test.ts` runs the server and clients in-process over fake links with latency and jitter. On a steady link, the predicted rig matches the server exactly.
- **Two-browser check:** `scripts/mp.mjs` passes every check. It covers joining, seeing each other, the world staying in sync, chat, and moving to a phone with the code (which kicks the old screen).

## Running it locally

```sh
npm run server   # builds dist-server/ and runs on :8791 (DB in data/permafrost.db, or DB_FILE=...)
npm run dev      # page on :5173, which forwards /ws to :8791
npm run mp       # two headless browsers (URL=http://localhost:PORT/ if not 5173)
npm run shots    # screenshots (desktop, phone)
```

## Next steps

1. **Ship v0.3** when the user says so. It includes the phone UI, rounded tunnels and the living ice. Commit, then `npm run ship -- minor` (0.2.0 → 0.3.0). It bumps the protocol, so open pages will be asked to refresh. Run `npm run mp` against the dev server first: it passed on 2026-11-09.
2. **v0.2 is done.** The repo went public on 2026-11-09. The VM runs `~/permafrost` with `~/deploy-permafrost.sh`, and the PC's `~/.ssh/permafrost-deploy` key plus `.deploy.local.json` (git-ignored) drive `npm run ship`. The first ship passed every check: the page and assets load through Cloudflare, `/ws` opens from the real origin, and other origins are refused. Nightly backups: `~/backup-permafrost.sh` runs from cron at 04:30 into `~/permafrost-backups` and keeps 14 days, set up by `deb-soft-haven` and the same as TPT's.
3. **Public map width:** the server uses 240 (`PUBLIC_WIDTH` in `server/game.ts`). The user never confirmed the expected player count, so 240 and 4-week seasons are defaults. Season rollover isn't written yet: `worlds.season` stays at 1. It's planned under the Seasons item in ROADMAP.md, and should land before 4 weeks pass on the live world (from 2026-11-09).
4. **Next milestone:** v0.4, Friendly rivalry (see ROADMAP.md). Season rollover is part of it and is the most urgent item, because of the 4-week clock on the live world.
5. **Tuning to watch once v0.3 is live:** refreeze times (`ENV.refreeze`), rockfall damage, blizzard frequency (`BLIZZARD.chance`), and how dark the glacier is with the stock lamp (`darkness()` in `GameScene.ts`).

## Known limits and notes

- On join, a client downloads all of the world's changes at once (4 bytes per changed tile). This is fine for a season. If it grows large, send it in chunks near the player instead.
- Items (`use`) aren't predicted online. The client waits for the server, so there's a round-trip delay before a charge goes off.
- Station actions are applied optimistically on the client. The fuel and hull gauges can flicker back for about one round trip until the server's snapshot catches up.
- `npm audit` reports 3 dev-dependency advisories (from vite/esbuild versions). They haven't been looked at yet.
- Docker Desktop on this PC may need starting first. It is installed per user, under AppData/Local/Programs/DockerDesktop.
