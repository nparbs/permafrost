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
- **A live market.** Ore prices drop as players sell the same thing and recover over time, and the Combine puts a bounty on one ore each day (v0.4).
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
- [x] Running out of fuel or wrecking the rig: a tow home for a fee, and the cargo is lost (changed in v0.3.2: see below)
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
- [x] Phone polish (shipped in v0.3.0): no keyboard hints on touch screens, a big Enter button right above thrust when parked at a building, and a title screen that fits 640x360

## v0.3: The living ice (live since 2026-11-09) ✅

- [x] Rounded tunnels: dug edges and corners are drawn round on a second tile grid offset by half a tile, and the drill carves a round bite as it goes
- [x] Refreeze: tunnels in the snow, firn and glacier frost over into thin rime (8, 12 and 18 minutes), never near a rig. Thrusting up into rime breaks it, so a refrozen shaft can't trap anyone. Some ore grows back, but only where it has solid ground under it, so it never caps a shaft
- [x] Loose boulders and ice slabs shake, then fall when the space under them or beside them opens up. Slabs hang over the ice caverns. A falling one that lands on a rig hurts it and breaks
- [x] Headlamp upgrade line (5 tiers) and flares (item 6, seen by other miners too). It gets darker with depth and is pitch black by the bedrock; magma and vents glow
- [x] Blizzards at the surface on a shared clock (about 3 in 10 seven-minute slots): 25°C colder, a whiteout, wind, and flying burns 60% more fuel
- [x] ~~Meltwater pockets in the glacier flood the lowest tunnel tiles nearby, slow the rig, and freeze into rime~~ Replaced in v0.3.1: the flooding had no point, so pockets are now fuel
- [x] Steam vents in the Geothermal Zone blow every 6 seconds, scalding and lifting anything above them. Magma pours into a tunnel opened beside it, runs up to 3 tiles, and cools into diggable slag after 30 seconds
- [x] Music: an ambient mood for each layer, all synthesized, with a Music on/off switch in the menu

## v0.3.1: Finding each other (live since 2026-11-09) ✅

- [x] Phone fix: station panels (the Machine Shop most of all) scroll with a finger, so every upgrade can be reached. The panel is a flex box sized to the screen, the page no longer blocks touch scrolling everywhere (only the game canvas and touch buttons do), and buying something keeps your place in the list
- [x] Upgrade cards show what each line does (it was only a hover tooltip, which phones never show)
- [x] Minimap in the HUD while other miners are online: a window around your rig, with arrows at the edge pointing to miners outside it. Tap it, or press N, for the full map: everyone listed with depth and direction ("140 m down, 90 m left"), over the whole dug-out world. Ore isn't drawn, so it's no ore scanner. The server sends everyone's position once a second (`map`)
- [x] Meltwater pockets are fuel: drilling one tops up 40% of your tank (at least 4 L), they're a bit more common (from 160 m down), and they glint in the dark so you can find them. No more floods
- [x] SOS (from v0.4, the fuel half): a stalled miner can send an SOS from the Out of fuel panel. Everyone hears it, the miner blinks red on the map and gets an SOS tag. Anyone with a Fuel Cell who parks within 2.5 tiles gets a Refuel prompt: the stalled miner gets half a tank and keeps their ore, and pays the helper what a tow would have cost. Rescues count in your stats
- [x] The Out of fuel panel also offers a Recall Beacon if you carry one, since it keeps your ore and a tow doesn't
- [x] Fixes: an item the server refuses now says "Can't use a Flare right now" instead of "The station says no"
- [x] `PROTOCOL_VERSION` is 3 (generation changed), so open pages are told to refresh when this ships

## v0.3.2: Softer landings (live since 2026-11-10) ✅

The early game was tough and deaths cost too much. Most deaths were a dry tank on the flight home, then a fall. The user's choices: a death costs the ore on board and nothing else, a carried Fuel Cell fires by itself, and SOS only exists while another miner is online.

- [x] An empty tank underground ends the rig (cause `fuel`), offline or alone online. No more stall, tow panel and fall. A dry tank on the surface still lets you crawl to the depot
- [x] A carried Fuel Cell is a reserve tank: it cuts in by itself at 0 L, with a warning
- [x] Online with another miner on: an empty tank stalls the rig as before. In the air it comes down on a parachute, unhurt. The SOS goes out by itself (the server sends it), other miners get a red arrow at the edge of the screen pointing to the rig, and the Out of fuel panel has Keep waiting, Recall Beacon and Give up and respawn. If the last other miner leaves, the stalled rig is lost
- [x] Death costs the ore on board only: no fee, and cash, upgrades and items are kept. The new rig has a full tank and full hull. `respawn` replaced `tow`
- [x] Death scenes by cause: out of fuel (the engine coughs, the lamp flickers out, the rig frosts over), hard landing and rockfall (crushed), gas (blown apart), magma, heat and steam (melts down). A wreck in mid-air drops first. A card names the cause, the depth, what was lost, and a line from the station crew. Black bars, HUD hidden, Space or a tap skips
- [x] Arrival scene at the start of a new game and after every death: the station's sky crane lowers the rig onto the pad and flies off
- [x] Station keys: E enters, Space (or Enter) does the main thing and the panel closes: fill up, sell everything, repair. In the Machine Shop and Supply Store the arrows pick a card and Space buys it; the shop closes once nothing else is affordable. A "+$120", "+7.0 L" or "+Carbide Auger" floats up from the rig
- [x] Cheaper early upgrades: tier 1 is $100 to $200 (was $300 to $500), tier 2 about half, tier 3 about a third off, and later tiers 5 to 20% off, so the first trips buy something
- [x] A new rig starts with one Fuel Cell, so the first dry tank is a warning and not a death (rigs that already exist don't get one)
- [x] Other miners see a rig's end: a burst by cause where it happened, the wreck left frozen, crushed, charred or melted until its miner respawns, and a line in the feed ("Ada lost a rig at 300 m: gas pocket"). The server shares the `wrecked` event as an `fx`
- [x] The fuel gauge has a white tick for the fuel the flight home takes from here (`fuelToSurface`), blinks below it, and there's one "head up now" warning per trip
- [x] `PROTOCOL_VERSION` is 4 (snapshots carry items, `respawn` action). `PlayerStats.deaths` counts rigs lost
- [ ] Not built: the sky crane isn't shown for other miners' arrivals; they just appear on the pad
- [ ] Not decided: what refuelling another miner unlocks (the user wants it to unlock something). Rescues are already counted

## v0.3.3: Supply limits (live since 2026-11-11) ✅

- [x] A rig carries at most 5 of each item (was 9). A rig that already holds more keeps them but can't buy more until it's under 5
- [x] The Recall Beacon costs $2,500 (was $800), so getting home with your ore for free is no longer the cheap option

## v0.3.4: A sharper picture, day and night (live since 2026-11-11) ✅

The rig was hard to pick out from the ground. There are now two looks, switched with **Graphics: high / low** in the menu (saved per browser, high by default). Low is the v0.3.3 look, pixel for pixel, for phones and older computers.

High adds, on the same 16-pixel grid:

- [x] The rig: a dark outline, brighter three-tone paint, a lit headlamp and an amber roof beacon that blinks, a soft light behind it, a shadow on the ground, and exhaust puffs from the stack while it works. Other miners' rigs get the same sprite
- [x] Darker tunnel backs (24%), a dark edge around every ore and gem, and a lit lip on tunnel floors
- [x] Coloured light on top of the dark: a warm lamp pool and a headlamp beam, orange around magma, vents and the burner, blue around meltwater, red around flares. It never lights more than Low does, so neither setting sees further
- [x] Ore glints now and then, and hard rock throws sparks off the bit
- [x] Sky: a moon with a halo, bright stars that twinkle, and warm light from the station windows
- [x] Darker screen corners (WebGL only)
- [x] `npm run gfxcheck` switches the setting mid-game and checks the art, the rig's position and that the setting sticks. `GFX=low npm run shots` takes the screenshots in Low
- [ ] Not done: the buildings, the sky crane and the ground textures are the same art in both settings

Day and night, in both settings:

- [x] A day is an hour: 40 minutes of daylight and 20 of night, with 3 minutes each of dawn and dusk across the changeovers (`DAY_SECONDS`, `NIGHT_SECONDS` and `TWILIGHT_SECONDS` in `src/sim/daytime.ts`). The first version had 5-minute days; the user asked for 40 and 20
- [x] The sky fades between a pale polar day, a warm dawn and dusk, and the old night sky. Stars and the aurora only show at night, the mountains lighten by day, and night dims the surface. In High the sun and the moon cross the sky and set behind the mountains
- [x] A day counter in the HUD under the temperature ("Day 3 · Night"), and a "Sunrise. Day 4" note as each day starts
- [x] Days only count while somebody is playing. Online, the server keeps a day clock that runs while at least one miner is connected and stops when the world is empty (`played` in the `worlds` table, added on start-up; `started` in the welcome message is "now minus the day clock"). Everyone online sees the same day and the same sky. The live world starts at day 1 when this ships. Offline, day 1 starts with a new game and days only pass while the game is open (old saves start at day 1)
- [x] No protocol bump: an older page just doesn't get `started`
- [x] It's looks only: temperature, fuel and the dark underground are the same by day and by night
- [ ] Not decided: whether night should do anything (colder surface, pricier fuel, better aurora-lit finds)

## v0.4: Friendly rivalry (live since 2026-11-11, shipped together with v0.5)

- [x] Live ore market (online only): every unit sold adds to that ore's glut, which pushes its price down for everyone, to 45% of list at worst. The glut halves every 20 minutes. Common ores take more to flood than rare ones, and relics always pay in full. The Assay Office tags each price: "▼ 71%" just after a sale, "▲ 87%" while it climbs back (`src/sim/market.ts`). Offline, ore sells at list price
- [x] Daily bounty: the Combine pays 50% extra for one ore or gem each day, online and offline. It changes at midnight UTC and comes from the seed and the date, so nothing is sent. The Assay Office shows it, and the assayer announces it. An ore you haven't dug up yet shows as "???"
- [x] Server-wide announcements: everyone hears about the season's first find of each mineral, and about every relic and Heartshard. A mineral you haven't dug up yourself is called "something new", so the deep finds stay a mystery
- [x] A "first to find it" board for the season (Standings → First finds)
- [x] SOS: a stalled miner sends a beacon, and anyone who brings fuel earns the tow fee (done early, in v0.3.1)
- [x] Leaderboards for the season: deepest, most earned, relics found and rescues, top 10 each, with your own row marked. Press L, or Menu → Standings. Miners who are offline count too. "Fastest Hearth" waits for the Hearth (v0.5)
- [x] Seasons (4 weeks; `SEASON_DAYS` on the server changes it): when the season ends the server keeps the final boards, picks a new seed, and regenerates the map. Rigs, cash, upgrades, the market and the day count start over. Anyone online is flown in to the new map within a few seconds. A miner who played the season that ended gets a summary screen once: the final boards, and their own numbers and ranks. Standings keeps a tab for the season before. A warning shows on joining in the last 3 days. The live season 1 ends on 2026-12-07
- [x] `PROTOCOL_VERSION` is 5 (welcome carries the market and the season's end; new `market`, `find` and `boards` messages). `PlayerStats.relics` counts relics dug up. `npm run seasoncheck` runs a one-minute season in headless Chrome
- [ ] Not built: towing a stalled miner with a cable, for the rescue fee (see the tow cable idea below)
- [ ] Not built: trading ore between players at the station
- [ ] Not built: only the last season's boards can be looked at. Older ones are kept in the database (`seasons` table) but have no screen. Nothing cosmetic is carried over yet, because cosmetics, titles and prestige stars don't exist until v0.5 and v0.7
- [ ] Not decided: the market's numbers (45% floor, 20-minute half-life), the size of the bounty, and whether the bounty should only pick ores the season's miners can reach

## v0.5: The Halvorsen story and the Hearth (live since 2026-11-11) ✅

- [x] 20 Halvorsen recorders, placed by depth from 40 m down to the Hearth's door (`src/sim/story.ts`). A recorder is a tile that isn't solid: a rig that touches it has the log, and it stays there for the next miner, so nobody can use one up. It blinks red in the dark
- [x] The Comms Tower, a sixth station building past the Supply Store (the other five didn't move). It plays back the recorders you've found and lists the signals of the three shallowest you haven't: depth, and how far left or right of the tower
- [x] Radio lines from the fuel-depot attendant, the assayer and the mechanic: nine tied to how deep you've been, five to how many recorders you've found, and a few in the finale. They start as dry comic relief and work out what the Combine is paying for
- [x] The Hollow: halls of cut stone with pillars (about one in six has a Hollow Relic on the floor), and the straight tunnel, two tiles wide, from 1,725 m down to an antechamber at the bottom with the Hearth's gate in it. Three recorders sit on that route
- [x] The Hearth (`src/sim/hearth.ts`). No weapons. Break four heat vents with charges, then the heart, from on top of the machine. It sends a freezing pulse every 8 seconds (5.5 once the heart is exposed) with a warning first: a rig on the ground loses 30 hull, a rig in the air loses nothing. Ice comes off the roof near the rig. It takes five charges, and the gate says how many you carry
- [x] The escape: when the heart breaks, the way out shuts, thin ice plugs the shaft, rubble falls, and a wall of heat climbs behind you at 82% of your own top climbing speed. Reach the surface to win
- [x] Credits over a warm sky, then prestige: a star, a new stock rig, no cash, items or upgrades. Stats, the price list and the recorders are kept. Each star adds 5% to every sale, up to five stars. Stars show on your name tag, and they belong to the account, so they outlast a season
- [x] Each miner's Hearth is their own. Going through the gate moves the rig into a private arena: other miners can't see it, and nothing in it touches the shared map. You can come back out through the gate until the heart breaks, a Recall Beacon works until then too, and a rig lost inside costs the ore on board, as anywhere
- [x] Everyone hears when a miner breaks the Hearth, and Standings has a Fastest Hearth board (gate to surface)
- [x] `PROTOCOL_VERSION` is 6. `npm run hearthcheck` plays the whole thing offline in headless Chrome
- [ ] Not built: a title to go with the star, and anything to show for stars beyond the name tag
- [ ] Not decided: the fight's numbers (pulse damage and timing, how fast the heat climbs), whether dying in the Hearth should put you back at the gate, and whether prestige should keep anything more
- [ ] Known: the generated map changed (tunnel, halls, recorders, the tower's pad), so the live world's untouched ground shifted a little when this shipped. Dug tunnels were kept

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
