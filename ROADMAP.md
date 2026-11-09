# Roadmap

**Permafrost** is an original drill-and-dig game on a frozen planet, played online. You drill down through snow, glacier ice, permafrost and bedrock into a hot, hollow underworld. You haul ore back up to Rime Station, sell it, upgrade your rig, and find out what has been pulling the heat out of the planet.

It belongs to the dig, sell and upgrade genre, but it is its own game. Don't copy names, story, characters, art, music or level layouts from existing games in the genre.

Each milestone below should be playable start to finish before the next one starts.

## Decisions so far (2026-11-08)

| Topic | Decision |
| --- | --- |
| Setting | Frozen planet. The cold is the enemy near the surface and heat is the enemy deep down |
| Platform | Browser and phone. Phaser 3, TypeScript and Vite, with all art and audio generated in code |
| Multiplayer | A shared public world with seasons, plus private rooms with a code |
| Player interaction | Friendly rivalry: no direct harm, but racing for finds, rescues, trading and leaderboards |
| Endgame | A story with a boss at the bottom. Beating it ends your run with credits and a prestige restart, and the world keeps going |
| Season reset | Rigs, cash and upgrades reset with the map. Cosmetics, titles, prestige stars and season history stay |
| Boss | No guns. You plant charges on the machine's weak points while dodging, then race to the surface as the Hollow collapses |
| Tone | A lonely sci-fi mystery, with dry, working-class humor from the station staff over the radio |
| Hosting | permafrost.parbs.online on the Debian VM, behind Scrap Riot's Cloudflare Tunnel |

## What makes it its own game

- **Two-sided temperature.** The rig only works inside a temperature range. The glacier's core (about -78°C) is the first wall, so you need a heater. The geothermal zone and the Hollow (up to 360°C) are the second, so you need a radiator. Too cold burns extra fuel and slows the drill. Too hot damages the hull.
- **A shared, changing world.** Everyone digs the same map. Tunnels near the surface slowly refreeze (v0.3), so the map never turns to Swiss cheese and shallow ore comes back.
- **A live market.** Ore prices drop as players sell the same thing and recover over time (v0.4).
- **The mystery.** Why is a planet with a molten core frozen solid?

## Story outline (v0.5)

Rime Station is run by the Boreal Combine on an ice world that should not be frozen. Forty years ago the Halvorsen Expedition dug here first and never came back. Their caches and recorder logs are scattered through the glacier, the permafrost and the bedrock. Read in order, they tell how the crew found warm rock under cold ice, then a straight tunnel nobody had dug, then the Hollow.

At the bottom sits the Hearth: an ancient machine that has been drawing the planet's heat down into itself, and growing Heartshards (crystallized heat) as it does. The Combine knew. The station radio crew (a fuel-depot attendant, an assayer and a mechanic) start out as dry comic relief and slowly work out what the company is paying miners to dig up.

The finale: plant charges on the Hearth's heat vents while it pulses freezing waves and drops ice from the ceiling. Once it breaks, the Hollow starts to collapse, and you drill and fly back to the surface against a heat wave rising behind you. The credits play over the first thaw at Rime Station. Prestige restarts the run with a star on your rig.

## v0.1: Core loop, offline ✅

- [x] Phaser 3 + TypeScript + Vite. The simulation (`src/sim`) is pure TypeScript so the server can run it unchanged
- [x] All art generated in code: seven ground layers, tunnel backs with shading, 12 ores and gems, 3 relics, gas, boulders, magma, the rig, five station buildings, a polar sky with aurora and parallax mountains, and falling snow
- [x] A seeded world 80 tiles wide and 3,000 m deep: Snowpack, Firn, Glacier (with ice caverns), Permafrost, Bedrock, the Geothermal Zone and the Hollow
- [x] Rig physics: drive, fly with thrust, fall damage, and drilling left, right and down, which slides you over to line up with the column
- [x] Fuel, hull, a cargo bay and a temperature range, with cold and heat penalties
- [x] Hazards: gas pockets that blow, magma, and boulders you can only clear with charges
- [x] Rime Station: Fuel Depot, Assay Office (with a price list of what you've found), Machine Shop (7 upgrade lines, 4 to 7 tiers each), Repair Bay and Supply Store
- [x] Items: Fuel Cell, Repair Kit, Thermal Charge, Shaped Charge and Recall Beacon
- [x] Running out of fuel or wrecking the rig: a tow home for a fee, and the cargo is lost
- [x] A headlamp: the deeper you go, the darker it gets outside the rig's light
- [x] Layer banners, toasts, a frost or heat glow at the screen edges, and a low-fuel alarm
- [x] Sound effects synthesized with Web Audio
- [x] Keyboard, and touch controls for phones in portrait and landscape
- [x] Autosave in the browser
- [x] Tests for world generation, physics, digging, temperature, upgrades and the station economy

## v0.2: Online shared world (live at permafrost.parbs.online since 2026-11-09)

- [x] One Node server (ws + node:sqlite) serves the page and `/ws`, using the same pattern as Trailer Park Tamers, packed as one Docker container (`Dockerfile`, `docker-compose.yml`, see docs/hosting.md)
- [x] Hosted at permafrost.parbs.online: joins the `scrap-riot_default` Docker network, gets a Cloudflare Tunnel hostname, a locked deploy key (`~/.ssh/permafrost-deploy` → `~/deploy-permafrost.sh`) and an `npm run ship` script
- [x] Accounts as 16-letter codes, with USE CODE to move to another device
- [x] The server owns the world. It is stored in SQLite as seed plus changed tiles; clients download the changes on join, then get each tile change as it happens (send chunks near the player if this grows large)
- [x] The server runs `src/sim` for every rig from their inputs. Clients predict their own rig and correct towards the server; other rigs are smoothed
- [x] The server owns cargo, cash and every purchase, and runs the same station functions as single player
- [x] Two rigs can't take the same tile: the first to finish gets the ore
- [x] Other miners show up with name tags and paint colors, plus chat and speech bubbles
- [x] A wider public map (240 tiles)
- [x] Rate limits, origin checks, and input checks on the server, plus a cap on how fast a client can run
- [x] Offline single player keeps working
- [x] Phone polish (2026-11-09, not shipped yet): no keyboard hints on touch screens, a big Enter button right above thrust when parked at a building, and a title screen that fits 640x360

## v0.3: The living ice (built 2026-11-09, not shipped yet)

- [x] Rounded tunnels: dug edges and corners are drawn round on a second tile grid offset by half a tile, and the drill carves a round bite as it goes
- [x] Refreeze: tunnels in the snow, firn and glacier frost over into thin rime (8, 12 and 18 minutes), never near a rig. Thrusting up into rime breaks it, so a refrozen shaft can't trap anyone. Some ore grows back, but only where it has solid ground under it, so it never caps a shaft
- [x] Loose boulders and ice slabs shake, then fall when the space under them or beside them opens up. Slabs hang over the ice caverns. A falling one that lands on a rig hurts it and breaks
- [x] Headlamp upgrade line (5 tiers) and flares (item 6, seen by other miners too). It gets darker with depth and is pitch black by the bedrock; magma and vents glow
- [x] Blizzards at the surface on a shared clock (about 3 in 10 seven-minute slots): 25°C colder, a whiteout, wind, and flying burns 60% more fuel
- [x] Meltwater pockets in the glacier flood the lowest tunnel tiles nearby, slow the rig, and freeze into rime after about 7 seconds (never around a rig)
- [x] Steam vents in the Geothermal Zone blow every 6 seconds, scalding and lifting anything above them. Magma pours into a tunnel opened beside it, runs up to 3 tiles, and cools into diggable slag after 30 seconds
- [x] Music: an ambient mood for each layer, all synthesized, with a Music on/off switch in the menu

## v0.4: Friendly rivalry

- [ ] Live ore market: each sale pushes that ore's price down server-wide, and it recovers over time. The Assay Office shows the trend
- [ ] Daily bounties: the Combine pays extra for one ore today
- [ ] Server-wide announcements for big finds such as relics and Heartshards, plus a "first to find it" board for the season
- [ ] SOS: a stalled miner sends a beacon, and anyone who brings fuel or tows them earns a share of the fee
- [ ] Trading ore between players at the station
- [ ] Leaderboards for the season: deepest, most earned, relics found, rescues and fastest Hearth
- [ ] Seasons (4 weeks by default): the map regenerates, and rigs, cash and upgrades reset. Cosmetics, titles, prestige stars and history stay. There's a season summary screen

## v0.5: The Halvorsen story and the Hearth

- [ ] About 20 recorder logs and caches, placed by depth and read at the Comms Tower
- [ ] Radio lines from the three station characters, tied to depth records and story beats
- [ ] The Hollow: ruins, the straight tunnel, and Hearth machinery
- [ ] The Hearth: charges on its heat vents, freezing pulses, falling ice and a weak-point phase, with no weapons
- [ ] The escape: the Hollow collapses and a heat wave chases you to the surface
- [ ] Credits over the thaw, then prestige: a restart with a star, a title and a small permanent perk
- [ ] Online, each player's Hearth is their own instance, so nobody "uses up" the ending

## v0.6: Private rooms

- [ ] Create a room with a 6-letter code for 2 to 6 friends: its own seed, a smaller map, saved per room
- [ ] Room settings: map width, hazard level, refreeze on or off, and market on or off
- [ ] The title screen offers Public World, My Rooms and Join with code

## v0.7: Polish and full release

- [ ] `npm run balance`: a bot plays the economy and reports money per hour against upgrade costs at each depth
- [ ] Cosmetics: paint colors (6 already drawn), decals, horn sounds, and titles from achievements
- [ ] Achievements
- [ ] Settings: volume, screen shake, touch button size and controller support
- [ ] A promo clip and an entry on parbs.online

## Ideas, not yet decided

- A community deep outpost: everyone donates cash during a season to build a fuel and repair stop at 1,500 m
- A tow cable so two rigs can pull a stranded third
- Survey drones: a consumable that scans a radius and marks ore for a few seconds
- A rig-painting garage with live previews (the paint colors already exist as textures)
