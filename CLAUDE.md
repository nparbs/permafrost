# Permafrost

An original drill-and-dig game on a frozen planet, with online play planned. See README.md for the layout and ROADMAP.md for the plan and the decisions made so far.

## Working here

- Keep it original. It's in the same genre as older dig, sell and upgrade games, but don't copy their names, story, characters, art, music or level layouts.
- `src/sim` must stay free of Phaser and the DOM, because the v0.2 server runs it as-is. Anything random in generation goes through `hash3`/`valueNoise` from a seed, never `Math.random`.
- Run `npm test` after changing rules, generation, prices or upgrade tables.
- There are two looks: Graphics high (default) and low (`src/game/gfx.ts`, switched in the menu). Low must stay as plain and cheap as it is now. Put new effects behind `this.high` in `GameScene` and new art behind the `HD` flag in `textures.ts`, and never let High show more of the dark than Low does.
- All art is drawn in `src/game/textures.ts` and all sound in `src/game/audio.ts`. Don't add image or audio files.
- Headless check: start `npm run dev`, then run `npm run shots` (or `URL=http://localhost:PORT/ node scripts/screenshots.mjs desktop phone`). `window.pf` exposes `game`, `ui` and `session`.
- Phone layouts: check at 640x360 and 360x640 at the smallest. Nothing smaller needs to work.
- The Hearth arena is a second `World` (`kind: 'hearth'`). `session.world` is whichever one the rig is in, so don't cache it across frames. Online, only the server runs the fight (`hearthStep`); the page just predicts the rig.
- Tone: a lonely sci-fi mystery with dry, working-class humor from the station staff.

## Hosting (from v0.2)

This will be one container on the Debian VM, joined to Scrap Riot's `scrap-riot_default` network so Scrap Riot's Cloudflare Tunnel can route permafrost.parbs.online to it, the same way as Trailer Park Tamers and Rift Daily. Keep LAN addresses and secrets out of the repo.
