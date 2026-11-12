# Handoff

Last updated 2026-11-11 (v0.5 "The Halvorsen story and the Hearth" and v0.4 "Friendly rivalry" shipped together on 2026-11-11. Live is v0.5.0). Read ROADMAP.md for the plan and the decisions the user has made, and CLAUDE.md for the working rules.

## Where things stand

- **v0.5 is live** at https://permafrost.parbs.online (shipped 2026-11-11 with v0.4). See the v0.5 section of ROADMAP.md for what it does. The details:
  - Story: `src/sim/story.ts` has `LOGS` (20), `RADIO_DEPTH`, `RADIO_LOGS` and `CREDITS`. `World.placeLogs` picks each recorder's tile from the seed (three are fixed on the tunnel route). `T.LOG` isn't solid; `collectLogs` in `rig.ts` adds its id to `player.logs` when the rig is within 0.2 tiles and emits `log`. Old saves can't delete a recorder, the gate or a pad (`applyDiffs` skips them).
  - Radio lines are said by the page: `main.ts` watches `stats.deepest` cross each `RADIO_DEPTH` line, and the recorder count after each `log` event. Nothing is stored, so a line is only said if the page sees the crossing.
  - The Hollow: `World.builtAt` makes the straight tunnel (`SHAFT`), the antechamber (`ANTE`) with `T.GATE`, and the halls (`RUINS`). `world.shaftX` is the tunnel's left column.
  - The Hearth: `new World(seed, ARENA.w, 'hearth')` is the arena (layout in `ARENA` in `world.ts`). `hearth.ts` has `enterHearth`, `hearthStep`, `leaveHearth` and `winHearth`, and `HearthRun` holds the fight. Vents are `T.HVENT` tiles that only a blast clears; the heart is `T.HCORE` until the vents are gone, then `T.HEART`. Ice is a real `T.SLAB` hung in the air and handed to the arena's own `Environment`.
  - Who runs it: offline, `LocalSession` (its `world` getter returns the arena while `run` is set). Online, only the server: `Client.hearth`, `Game.apply` (the gate, and anything that takes a rig out), `Game.tickHearth` and `Game.won`. A rig in the arena is left out of `rigs`, `map`, the shared environment and shared effects. The page keeps its own copy of the arena to predict the rig (`NetSession.arena`), gets arena tiles as `tiles` with `h: 1`, the fight's state as `h` on each snapshot, and `hearth` in/out messages. A snapshot from the other side of the gate is skipped.
  - The scene is restarted whenever `session.world` changes (`reshow()` in `main.ts`, on `hearth-enter`, `hearth-leave` and a win). `GameScene.syncHearth` draws the frost and the heat front.
  - Prestige: `accounts.prestige` on the server (added on start-up), copied onto the player at hello; `player.prestige` in the offline save. `starBonus` in `market.ts` is the sale perk.
  - Checked: 105 tests (`tests/hearth.test.ts` is new), typecheck, `npm run hearthcheck` (24 checks, desktop and phone), `seasoncheck`, `mp`, `uicheck`, `soscheck`, `cinecheck` and `gfxcheck` against a local build. The Hearth was never played in a browser online (the server-side fight is covered by tests only), and nobody has played any of it by hand.
  - Open: see the "Not built" and "Not decided" lines in ROADMAP.md.

- **v0.4 is live** (shipped 2026-11-11 with v0.5). The details:
  - Market: `src/sim/market.ts`. `world.market` is `Record<key, { g, at }>` (glut in units as of the last sale, in wall-clock seconds), or null offline. `priceOf(world, mineral)` is the one place a price comes from; `saleLines`, `sellAll` and `cargoValue` now take the world. `sellAll` records the sale when `world.market` exists. The server sends the market in the welcome and broadcasts `market` after every sale; the page predicts its own sale, then takes the server's copy. The numbers are in `MARKET`, `glutScale` and `BOUNTY_BONUS`.
  - Bounty: `bountyOf(seed, time)` hashes the seed and the UTC day. No messages. `main.ts` toasts it once per session and when it changes.
  - Finds: `Game.found` runs on every `pickup` event in the tick. It keeps `firsts` (one per mineral per season) and broadcasts `find` for a first, a relic or a Heartshard.
  - Leaderboards: `server/boards.ts` ranks `Entry` lists. `Game.entries()` reads every saved player of the season (`Store.seasonPlayers`) and overlays the live stats of those online. A page asks with `boards` (answered at most once a second per client, recomputed at most every 3 s). UI: `openBoards`, `boardsPanel` and `boardTable` in `ui.ts`; L opens and closes it.
  - Seasons: `worlds.started` is the season's start, and `Game.ends` is `started + seasonMs` (`SEASON_DAYS` env, 28 by default). `Game.tick` checks once a second and calls `rollover()`: save, write the final boards and every miner's ranks to the `seasons` table, send everyone `error` with code `season` and drop them, `Store.rollWorld` (new seed, season + 1, no diffs, day clock and `extra` cleared), then `Game.open` loads the new world. Players' rows keep the old season number, so `loadPlayer` returns nothing and they start over. The page reconnects by itself. `recapFor` puts a `recap` in the welcome while the account's saved row is still from the season before; the row is rewritten on the first save, so it shows once. `main.ts` opens it after the arrival scene (`ui.showRecap`).
  - Storage: `worlds.extra` (JSON: market and firsts) and the `seasons` table are added on start-up. The live database needs no manual step.
  - The live world was created on 2026-11-09, so season 1 ends on 2026-12-07. `/health` reports `seasonEnds`.
  - Checked: 86 tests, typecheck, `npm run seasoncheck` (Standings on desktop and phone, Assay Office tags, a real rollover with two browsers, the summary screen), and `mp`, `uicheck`, `soscheck`, `cinecheck` and `gfxcheck` against a local v0.4 server. Not checked on a real phone, and nobody has sold into the market with real players.
  - Open: towing and trading are not built. The market numbers and the bounty pool are guesses to tune.

- **v0.3.4 is live** at https://permafrost.parbs.online (shipped 2026-11-11). See the v0.3.4 section of ROADMAP.md. The details:
  - Graphics: `src/game/gfx.ts` holds the setting (`permafrost.gfx` in localStorage, high by default). `makeTextures(scene, high)` builds a second tileset and rig set (`tiles-hd`, `righd0..5`) the first time High is used; painters check the `HD` flag, and `tilesKey()`/`rigKey()` pick the art in use. In `GameScene`, everything extra sits behind `this.high`: the `glow` RenderTexture (ADD blend, above the dark) for coloured light, the halo, shadow, exhaust, glints, sun and moon, and a camera vignette. Switching restarts the scene with the same session; the scene only subscribes to a session once (`heard`). Low must stay as it is, and High must not show more of the dark than Low.
  - Day and night: `src/sim/daytime.ts` (40 min day, 20 min night, 3 min twilights) works from `world.time - world.dayStart`. `GameScene.syncSky` fades the day sky, dusk colours and day mountains over the night ones, and a `night` rectangle dims the surface. The HUD line and the sunrise toast are in `ui.ts` and `main.ts`.
  - Days only count while somebody plays. Server: `Game.dayClock()` is `played` (saved in `worlds.played`, a column added on start-up) plus the time since the world was last occupied; the welcome's `world.started` is `now - dayClock()`. Offline: the save stores `dayStart`, and loading moves it forward by the time the game was closed.
  - Checked: 78 tests, typecheck, builds, `npm run gfxcheck`, `npm run cinecheck`, `npm run mp` (before the day-clock change), and screenshots (`node scripts/screenshots.mjs daynight`). Not checked on a real phone.
  - Open: whether night should affect play; whether phones should default to Low.

- **v0.3.3 was live** at https://permafrost.parbs.online (shipped 2026-11-11). It only changes two numbers in `src/sim/items.ts`: `ITEM_STACK` is 5 (was 9) and the Recall Beacon costs $2,500 (was $800). Saved rigs holding more than 5 of something keep them; `buyItem` just answers `max` until they're under the limit. No protocol change.

- **v0.3.2 is live** at https://permafrost.parbs.online (shipped 2026-11-10, commit 2a3ba64; /health reports 0.3.2). See the v0.3.2 section of ROADMAP.md for what it does and the choices the user made. The details:
  - Rules: `step()` in `rig.ts` handles an empty tank underground: burn a Fuel Cell (`reserve` event), else wreck with cause `fuel` if `world.rescue` is false, else stall. `world.rescue` is "another miner is online": the server sets it each tick, `NetSession` sets it from the online count, and offline it stays false. A stalled rig's fall speed is capped at `PHYS.chute`. `respawn()` in `station.ts` replaced `tow()`; `rescueFee` replaced `towFee`. `Rig.wreckedBy` carries the cause.
  - Online: snapshots now carry `items`, because the page predicts the Fuel Cell burn and a replay would otherwise burn a second one. The server sends the SOS itself when a rig stalls (the page's prediction stalls a few ticks early, so its own `sos` message used to be refused).
  - Cutscenes: `GameScene.playDeath`, `playArrival` and `skipCutscene`; `die()` and `arrive()` in `main.ts` run them. `main.ts` starts a death when it sees `rig.wrecked` in `onFrame`, not from the event, so a wreck the page didn't predict still plays. While one runs, `ui.busy` is on and the session is paused. The sky crane and parachute are in `textures.ts`, the sounds (`sputter`, `freeze`, `rotor`) in `audio.ts`.
  - Station keys: each panel sets `ui.confirm` (Space or Enter) and the shops set `ui.nav` (arrows). Buttons no longer take keyboard focus, so Space can't re-press the last one clicked. Keys used by a panel or cutscene are ignored by the rig until released (`eaten` in `main.ts`).
  - Checked: 72 tests pass, typecheck, `npm run cinecheck`, `npm run soscheck`, `npm run uicheck` and `npm run mp` against a local server and dev build.
  - Other miners' wrecks: the server broadcasts the `wrecked` event as an `fx` with `by`; `NetSession` turns it into `peer-wrecked` with the peer's position; `GameScene.wreckBurst` and `wreckLook` draw it. A new player starts with one Fuel Cell (`newPlayer`); `revivePlayer` doesn't add one to saved players.
  - Not done: nobody has played it by hand, the sounds were never heard (headless), and other miners' arrivals have no sky crane.

- **v0.3.1 is live** at https://permafrost.parbs.online (shipped 2026-11-09, commit 4fb5830). The ship passed typecheck, tests and both builds, /health reports 0.3.1, and the page's script and stylesheet through Cloudflare match the build. See the v0.3.1 section of ROADMAP.md for the list. The details:
  - Phone panels: `.panel` is now a flex box (it was a grid, whose auto row can grow past the screen in some engines), the card is `max-height: 100%`, and `.card .body` scrolls with `touch-action: pan-y`. The page itself is `touch-action: pan-y` instead of `none` (some phone browsers carry a page-wide `none` into every scroll box); `#game` and `.tbtn` still block every gesture. `rerender()` keeps the body's scroll position. Headless Chrome scrolled even with the old CSS, so the real-phone cause couldn't be reproduced here; both likely causes are fixed. `npm run uicheck` swipes the shop with real touch events (CDP `synthesizeScrollGesture` does nothing headless).
  - Map: `src/ui/minimap.ts` has `Minimap` (HUD, 64x44 tiles around you, arrows for miners outside it, shown only online with someone else on) and `WorldMap` (the Map panel: a list plus the world from the sky down to below the deepest miner). The server broadcasts `{ t: 'map', p: [id, x, y, flags][] }` every 60 ticks when 2+ are online, and `NetSession.mapPeers()` mixes it with the smoothed nearby rigs. Ore is never drawn on either.
  - Meltwater: `T.MELT` is fuel (`MELT_FUEL` in `rig.ts`: 40% of the tank, at least 4 L, emits a `refill` event). `MELT_CHANCE` is 0.011 from 32 tiles down (was 0.008 from 36), a superset of the old pockets. The flood code is gone. `T.WATER` is never made now; any left in the live world's diffs freezes into rime after a restart, as before.
  - SOS: client messages `sos` and `aid`; server messages `sos` and `rescue`; rig flags `RIG_STALLED` and `RIG_SOS`. `aid()` in `station.ts` is the rule (helper needs a Fuel Cell and to be within `AID_REACH` = 2.5 tiles; the stalled miner gets half a tank and pays the helper `towFee`). `PlayerStats.rescues` is new. The client checks the rules before sending, and the server ignores a refused `aid` (only a race can cause one).
  - `PROTOCOL_VERSION` is 3 and the package version 0.3.1.
  - Checked: 62 tests pass, typecheck, `npm run uicheck` (phone shop at 640x360 and 360x640, stall panel, minimap and map with two miners) and `npm run mp` all pass against a local build.
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
- **v0.3.0 is live** at https://permafrost.parbs.online (shipped 2026-11-09, commit 5efa73d). It includes everything below. The ship passed its checks: typecheck, tests, both builds, and /health reporting 0.3.0 through Cloudflare.
- **Phone UI (shipped in v0.3.0):** in `src/ui/ui.ts` and `style.css`. Touch mode is the `touch-on` class on `#ui`, set by `(pointer: coarse)` or the first touch.
  - Every `kbd` is hidden on touch, and the title shows `.help-touch` instead of the keyboard help. The chat placeholder drops "Enter to send, Esc to cancel".
  - The building prompt becomes a 74x64 Enter button right above the ▲ thrust button. In portrait the item row is left-aligned so the right column stays free for it.
  - On screens under 420px tall the title has a smaller logo and the three buttons in one row, so it fits 640x360 with a save. `.title` can also scroll (`touch-action: pan-y`).
  - Checked in headless Chrome at 640x360, 360x640 and desktop: nothing overlaps, tapping Enter opens the building, no errors.
- **Rounded tunnels (shipped in v0.3.0):** a second tilemap layer, offset by half a tile, draws the edge where four tiles meet (`overIndex` and `paintOver` in `src/game/textures.ts`). Rock corners that face tunnel on both sides get cut round, closed tunnel corners get filled round, and a dark rim runs along every edge. It uses 16 shapes per layer, plus a set for the surface row where the sky counts as open but gets no rim. The layer uses `insertNull`, so it costs nothing where there's no tunnel. While a rig drills, `syncBites` in the scene carves a round hole around it in the target tile.
- **v0.3, The living ice (shipped in v0.3.0):**
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
npm run uicheck  # phone panel scrolling, stall panel, minimap and map (URL=... like mp)
npm run seasoncheck  # builds, starts its own server on :8797 with a 75-second season, and checks v0.4
npm run hearthcheck  # builds, starts its own server on :8798, and plays v0.5 offline: recorder, gate, fight, climb, credits
```

If port 8791 is already taken by an old local server, build with `npx vite build` and run `PORT=8795 DB_FILE=... node dist-server/index.mjs`, which serves the page too, then point `URL=http://localhost:8795/` at it.

## Next steps

- **Now:** v0.4 and v0.5 are live. Ask the user how the Hearth plays (nobody has played it by hand) and tune it. Next on the roadmap: v0.6 private rooms, or the two v0.4 items left (tow cable, trading). The live season 1 ends on 2026-12-07 and rolls over by itself.

Older notes:

0. **v0.3.1 is live.** Ask the user whether the shop now scrolls on their phone: the bug couldn't be reproduced in headless Chrome, so this is the real test. Nobody has used the minimap or an SOS with real players yet.
1. **v0.3 is shipped.** The public world kept its seed and diffs, so tunnels dug before v0.3 start their refreeze clocks from the deploy. Nobody has played v0.3 online with real players yet, so watch for feedback on the tuning items in step 5.
2. **v0.2 is done.** The repo went public on 2026-11-09. The VM runs `~/permafrost` with `~/deploy-permafrost.sh`, and the PC's `~/.ssh/permafrost-deploy` key plus `.deploy.local.json` (git-ignored) drive `npm run ship`. The first ship passed every check: the page and assets load through Cloudflare, `/ws` opens from the real origin, and other origins are refused. Nightly backups: `~/backup-permafrost.sh` runs from cron at 04:30 into `~/permafrost-backups` and keeps 14 days, set up by `deb-soft-haven` and the same as TPT's.
3. **Public map width:** the server uses 240 (`PUBLIC_WIDTH` in `server/game.ts`). The user never confirmed the expected player count, so 240 and 4-week seasons are defaults. Season rollover is written (v0.4) and needs to ship before 2026-12-07, when the live season 1 ends.
4. **v0.4 and v0.5** are live (see the top of this file).
5. **Tuning to watch once v0.3 is live:** refreeze times (`ENV.refreeze`), rockfall damage, blizzard frequency (`BLIZZARD.chance`), and how dark the glacier is with the stock lamp (`darkness()` in `GameScene.ts`).

## Known limits and notes

- On join, a client downloads all of the world's changes at once (4 bytes per changed tile). This is fine for a season. If it grows large, send it in chunks near the player instead.
- Items (`use`) aren't predicted online. The client waits for the server, so there's a round-trip delay before a charge goes off.
- Station actions are applied optimistically on the client. The fuel and hull gauges can flicker back for about one round trip until the server's snapshot catches up.
- `npm audit` reports 3 dev-dependency advisories (from vite/esbuild versions). They haven't been looked at yet.
- Docker Desktop on this PC may need starting first. It is installed per user, under AppData/Local/Programs/DockerDesktop.
