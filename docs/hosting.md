# Hosting at permafrost.parbs.online

One Docker container serves the game page, the WebSocket the page talks to and the shared world. It runs on the Debian VM next to Scrap Riot and reaches the internet through Scrap Riot's existing Cloudflare Tunnel, the same way as Trailer Park Tamers and Rift Daily.

```
player ──https──> Cloudflare ──tunnel──> cloudflared (Scrap Riot's) ──> permafrost:8791 (this container)
                                                                         ├─ /        the game page
                                                                         ├─ /ws      shared world
                                                                         └─ /health  status
```

## What it stores

Everything lives in SQLite at `/data/permafrost.db`, in the `permafrost_data` Docker volume:

- **Accounts:** a random 16-letter code kept in the browser. The server keeps only a hash of the code, the player's name and paint. Players see their code in the menu and enter it under "Use a code" on the title screen to play on another device. There are no passwords or emails.
- **Worlds:** the seed, the width and the season, plus every tile that's been dug or changed (4 bytes each).
- **Players:** one rig, cash and cargo per account, world and season.

The world and rigs are written every 30 seconds and when the server shuts down. A rebuild stops the server cleanly, so nothing is lost; a crash could lose up to 30 seconds of digging.

## First-time setup on the VM

1. **Clone the repo.** It's public, so plain HTTPS works:

   ```sh
   git clone https://github.com/nparbs/permafrost.git ~/permafrost
   cd ~/permafrost
   cp .env.example .env
   ```

2. **Check the tunnel network name.** The container joins the network Scrap Riot's `cloudflared` is on. It's normally `scrap-riot_default`:

   ```sh
   sg docker -c "docker network ls" | grep scrap
   ```

   If it's different, set `TUNNEL_NETWORK` in `.env`.

3. **Start it.**

   ```sh
   sg docker -c "docker compose up -d --build"
   sg docker -c "docker compose ps"
   sg docker -c "docker compose exec permafrost node -e \"fetch('http://127.0.0.1:8791/health').then(r=>r.text()).then(console.log)\""
   ```

4. **Add the hostname in Cloudflare.** In the Cloudflare dashboard, open Zero Trust, then Networks, then Tunnels, and edit the tunnel Scrap Riot uses. Under Public Hostnames, add:

   | Field | Value |
   | --- | --- |
   | Subdomain | `permafrost` |
   | Domain | `parbs.online` |
   | Service | `HTTP`, `permafrost:8791` |

   Cloudflare creates the DNS record itself. WebSockets work through tunnels by default.

5. **Check from anywhere:** `curl https://permafrost.parbs.online/health` should return something like `{"ok":true,"version":"0.2.0","online":0,"season":1}`.

## Deploying updates

Same pattern as Scrap Riot: a key on the PC that can only run the deploy script.

```sh
cp deploy/deploy-permafrost.sh ~/deploy-permafrost.sh && chmod +x ~/deploy-permafrost.sh
# In ~/.ssh/authorized_keys, one line for the PC's permafrost-deploy key:
# command="/home/deb/deploy-permafrost.sh",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... permafrost-deploy
```

Then from the PC, `npm run ship` checks, pushes, deploys and waits for `/health` to report the new version. It reads the VM address and key from `.deploy.local.json`, which git ignores (see the top of `scripts/ship.mjs`). `npm run ship -- patch` bumps the version first.

A rebuild drops everyone's connection for a few seconds. The page reconnects by itself (3 tries), and rigs, cash and the world are kept. When `PROTOCOL_VERSION` in `src/net/protocol.ts` changes, open pages are told to refresh.

## Backups

```sh
0 4 * * * cd ~/permafrost && sg docker -c "docker compose exec -T permafrost node -e \"const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/permafrost.db').exec(\\\"VACUUM INTO '/data/backup.db'\\\")\"" && sg docker -c "docker compose cp permafrost:/data/backup.db ~/permafrost-backups/permafrost-$(date +\%F).db"
```

## Limits and notes

- 6 connections per IP address, 60 players online at once (`MAX_ONLINE`), and a message rate limit per connection.
- A season lasts 28 days (`SEASON_DAYS`). When it ends the server regenerates the map by itself and keeps the final leaderboards in the `seasons` table. `/health` reports the season and when it ends.
- Chat is world-wide, 90 characters, one message a second. There's no filter or report button yet.
- The server runs the game rules for every rig from its inputs, so cash, cargo and digging can't be edited from the browser.
- The container is on Scrap Riot's Docker network, so it could reach Scrap Riot's database port. That database has a password, but a dedicated tunnel network would be tidier later.

## Running it locally

```sh
npm run server   # builds and runs the server on :8791, world in data/permafrost.db
npm run dev      # the page on :5173, which forwards /ws to the server
npm run mp       # two headless browsers against each other
```

To try the production image: `docker network create scrap-riot_default` once, then `ALLOWED_ORIGINS= docker compose up --build` and reach it from another container on that network, or temporarily add `ports: ["8791:8791"]`.
