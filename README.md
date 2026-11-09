# Permafrost

An original drill-and-dig game on a frozen planet. You drill down through snow, glacier ice, permafrost and bedrock into the hot Hollow below. You haul ore back up to Rime Station, sell it, and upgrade your rig. Cold is the danger near the surface, and heat is the danger deep down.

It runs in the browser and on phones. v0.1 is single player and saves to the browser. The online shared world is next; see [ROADMAP.md](ROADMAP.md).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests
npm run build      # typecheck and build to dist/
npm run shots      # headless screenshots to shots/ (needs the dev server; URL=... to change)
```

## Controls

| | Keyboard | Touch |
| --- | --- | --- |
| Drive, and drill sideways into a wall | ← → or A D | ◀ ▶ |
| Drill down | ↓ or S | ▼ |
| Thrust | ↑, W or Space | ▲ |
| Enter a building | E or Enter | tap the prompt |
| Items | 1 to 5 | item buttons |
| Menu and mute | Esc and M | Menu button |

## Layout

- `src/sim/` is the game rules as plain TypeScript with no Phaser: world generation, tiles and minerals, rig physics and digging, temperature, upgrades, items and station services. The server will run this same code in v0.2.
- `src/game/` is the client: the Phaser scene, textures drawn in code, Web Audio sound effects, the session clock and local saves.
- `src/ui/` is the HTML layer: HUD, station panels, dialogs, title screen and touch controls.
- `tests/` holds the Vitest tests for `src/sim`.
- `scripts/screenshots.mjs` drives the game in headless Chrome.
