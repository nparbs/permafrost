# Permafrost

An original drill-and-dig game on a frozen planet. You drill down through snow, glacier ice, permafrost and bedrock into the hot Hollow below. You haul ore back up to Rime Station, sell it, and upgrade your rig. Cold is the danger near the surface, and heat is the danger deep down.

It runs in the browser and on phones, in a shared online world at https://permafrost.parbs.online or offline in single player. The ice is alive: loose boulders and slabs fall, tunnels near the surface refreeze, magma pours into fresh tunnels, steam vents blow, and blizzards roll over the station. Meltwater pockets in the glacier are free fuel. Online, a minimap shows where the other miners are, and a miner who runs dry while others are on gets a parachute and an SOS, so someone can bring them fuel. Alone, an empty tank is the end of the rig: you lose the ore on board and start again from the station. Online, ore prices fall as miners sell the same thing and climb back over time, the Combine puts a bounty on one ore each day, and each four-week season has leaderboards before the map resets. Forty-year-old recorders from a lost expedition are scattered down the map, and at the bottom, past a straight tunnel nobody dug, is the Hearth. See [ROADMAP.md](ROADMAP.md) for what's next.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation and network tests
npm run build      # typecheck and build to dist/
npm run server     # the online server on :8791 (npm run dev forwards /ws to it)
npm run shots      # headless screenshots to shots/ (needs the dev server; URL=... to change)
                   # scenarios: desktop, phone, dig (rounded tunnels), living (v0.3 hazards and light)
npm run uicheck    # phone panels scroll by finger, stall options, minimap and map with two miners
npm run cinecheck  # death and arrival scenes, respawns, Space at the station (offline)
npm run gfxcheck   # the Graphics high/low switch, mid-game (offline; GFX=low npm run shots for Low screenshots)
npm run soscheck   # two miners: stall, SOS arrow, give up; then an empty tank alone (needs the server)
npm run seasoncheck # builds, runs its own server with a one-minute season: market tags, Standings, rollover
npm run hearthcheck # builds, then plays the story and the Hearth offline: recorder, gate, fight, climb, credits
```

## Controls

| | Keyboard | Touch |
| --- | --- | --- |
| Drive, and drill sideways into a wall | ← → or A D | ◀ ▶ |
| Drill down | ↓ or S | ▼ |
| Thrust (and break up through rime) | ↑, W or Space | ▲ |
| Enter a building, or refuel a stalled miner next to you | E or Enter | tap the prompt |
| In a building: fill up, sell, repair or buy the highlighted card | Space or Enter (arrows pick a card) | tap the button |
| Skip a cutscene | Space, Enter, E or Esc | tap |
| Items | 1 to 6 | item buttons |
| Map | N | tap the minimap (online), or Menu → Map |
| Standings (online) | L | Menu → Standings |
| Chat (online) | T | Chat button |
| Menu and mute | Esc and M | Menu button |

## Layout

- `src/sim/` is the game rules as plain TypeScript with no Phaser: world generation, tiles and minerals, rig physics and digging, temperature, upgrades, items and station services. `market.ts` is ore prices: the shared market and the daily bounty. `story.ts` is the recorder logs and radio lines, and `hearth.ts` is the fight at the bottom. `env.ts` is the living ice (falls, refreeze, magma), and `weather.ts` is blizzards and steam vents, which run off a shared clock. The server runs this same code.
- `src/game/` is the client: the Phaser scene (with rounded tunnel edges on a half-tile overlay grid, and lighting), textures drawn in code, Web Audio sound effects and music, the session clock and local saves.
- `src/net/` is the client side of online play, and `server/` is the Node server.
- `src/ui/` is the HTML layer: HUD, station panels, dialogs, title screen and touch controls. `minimap.ts` draws the HUD minimap and the full map.
- `tests/` holds the Vitest tests: the rules, the living ice, and the server with clients over fake links.
- `scripts/screenshots.mjs` drives the game in headless Chrome.
