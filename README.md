# Permafrost

An original drill-and-dig game on a frozen planet. You drill down through snow, glacier ice, permafrost and bedrock into the hot Hollow below. You haul ore back up to Rime Station, sell it, and upgrade your rig. Cold is the danger near the surface, and heat is the danger deep down.

It runs in the browser and on phones, in a shared online world at https://permafrost.parbs.online or offline in single player. The ice is alive: loose boulders and slabs fall, tunnels near the surface refreeze, magma pours into fresh tunnels, steam vents blow, and blizzards roll over the station. Meltwater pockets in the glacier are free fuel. Online, a minimap shows where the other miners are, and a miner who runs dry can send an SOS for someone to bring them fuel. See [ROADMAP.md](ROADMAP.md) for what's next.

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
```

## Controls

| | Keyboard | Touch |
| --- | --- | --- |
| Drive, and drill sideways into a wall | ← → or A D | ◀ ▶ |
| Drill down | ↓ or S | ▼ |
| Thrust (and break up through rime) | ↑, W or Space | ▲ |
| Enter a building, or refuel a stalled miner next to you | E or Enter | tap the prompt |
| Items | 1 to 6 | item buttons |
| Map | N | tap the minimap (online), or Menu → Map |
| Chat (online) | T | Chat button |
| Menu and mute | Esc and M | Menu button |

## Layout

- `src/sim/` is the game rules as plain TypeScript with no Phaser: world generation, tiles and minerals, rig physics and digging, temperature, upgrades, items and station services. `env.ts` is the living ice (falls, refreeze, magma), and `weather.ts` is blizzards and steam vents, which run off a shared clock. The server runs this same code.
- `src/game/` is the client: the Phaser scene (with rounded tunnel edges on a half-tile overlay grid, and lighting), textures drawn in code, Web Audio sound effects and music, the session clock and local saves.
- `src/net/` is the client side of online play, and `server/` is the Node server.
- `src/ui/` is the HTML layer: HUD, station panels, dialogs, title screen and touch controls. `minimap.ts` draws the HUD minimap and the full map.
- `tests/` holds the Vitest tests: the rules, the living ice, and the server with clients over fake links.
- `scripts/screenshots.mjs` drives the game in headless Chrome.
