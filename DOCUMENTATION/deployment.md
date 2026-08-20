# CI/CD: GitHub Actions → Docker → DigitalOcean droplet

## Shape

```
push to main
  └─ test      pnpm lint + jest
  └─ build     buildx → image → smoke test (/api/health) → push to GHCR
  └─ deploy    scp compose file → ssh: docker compose pull && up -d
                 └─ wait for healthy, else roll back to previous tag
```

Image registry is **GHCR** (free, no extra DigitalOcean cost). The droplet only
pulls; nothing is built on it, so a 1 GB droplet is plenty.

## Why the image is small

- `output: "standalone"` — Next traces only the modules the server actually
  imports; the runner stage never sees `node_modules`, pnpm, or source.
- Three stages: `deps` (has python3/make/g++ to compile `better-sqlite3` on
  musl) → `build` → `runner` (bare `node:22-alpine`). Toolchain is discarded.
- Result is roughly 180–250 MB, most of which is the Node base image.

## State

SQLite is the whole database. It lives in a **named Docker volume** (`cms-data`)
mounted at `/data`, and `SQLITE_URL=/data/sqlite.db`. Containers are disposable;
the volume is not. Drizzle migrations run at process start from the `drizzle/`
folder baked into the image, so a deploy migrates automatically.

Because one SQLite file cannot have two writers, the update is a **stop-start
swap**, not blue/green. Expect ~2–5 seconds of downtime per deploy.

## One-time droplet setup

The target droplet (`web-droplet-0` / `do0`, Ubuntu 24.04) already has Docker
28 + the compose plugin, and the login user `wjw` is in the `docker` group, so
no root-level Docker setup is needed. Create the app directory once:

```bash
ssh web-droplet-0
sudo mkdir -p /opt/jimmys-cms && sudo chown wjw:wjw /opt/jimmys-cms
```

CI connects as the same user with a **dedicated** SSH keypair (generate one
just for GitHub Actions; don't reuse your personal key). A separate
`deploy` user works too if you'd rather CI not log in as you.

Then create `/opt/jimmys-cms/.env` from `.env.example` with real production
values — this file is **never** written by CI (CI only appends/updates the
`IMAGE`/`IMAGE_TAG` lines), only read:

```
SESSION_SECRET=<long random, e.g. openssl rand -hex 32>
ADMIN_USERNAME=...
ADMIN_PASSWORD=<long random>
# Multi-portal: leave AUTH_BASE_URL / NEXT_PUBLIC_AUTH_BASE_URL unset
# (same-origin) and list EVERY portal hostname here.
AUTH_TRUSTED_ORIGINS=https://cms.jwwang.ca,https://cms.glorialan.com

R2_ACCOUNT_ID=...
R2_BUCKET_MASTERS=jimmys-cms-masters
R2_ACCESS_KEY_ID_MASTERS=...
R2_SECRET_ACCESS_KEY_MASTERS=...
R2_BUCKET_MEDIA=jimmys-cms-media
R2_ACCESS_KEY_ID_MEDIA=...
R2_SECRET_ACCESS_KEY_MEDIA=...
R2_CDN_BASE_URL_MEDIA=https://media.jwwang.ca
```

### TLS: nginx, not Caddy, on this droplet

`do0` already runs nginx + certbot for jwwang.ca, glorialan.com,
homeassistant.jwwang.ca, and frigate.jwwang.ca — ports 80/443 are taken, so
installing Caddy would conflict. The CMS gets a vhost in the same pattern
(`deploy/Caddyfile` remains as the alternative for a fresh box):

```bash
sudo cp deploy/nginx/cms.conf /etc/nginx/sites-available/cms
sudo ln -s /etc/nginx/sites-available/cms /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d cms.jwwang.ca -d cms.glorialan.com
```

Certbot renews automatically (`certbot.timer` runs twice daily and reloads
nginx after a renewal) — no manual cert maintenance.

### Multi-portal: every hostname serves the CMS directly

`cms.jwwang.ca` and `cms.glorialan.com` are both first-class portals — one
nginx block, one cert covering both names, no canonical redirect. The
accepted tradeoff: sessions are per-domain (different registrable domains
cannot share a cookie — a browser rule, not an app choice), so each portal
has its own independent login.

Config that makes this work:

- `AUTH_BASE_URL` and `NEXT_PUBLIC_AUTH_BASE_URL` stay **unset** — empty
  means same-origin, so each portal talks to itself. Pinning either to one
  hostname would send the other portal's browser cross-origin, where its
  cookie won't follow.
- `AUTH_TRUSTED_ORIGINS` lists **every** portal hostname.
- nginx forwards `Host` per-request, so Next's server-action origin check
  and all relative redirects behave identically on every portal.

#### Adding portal hostname N+1

1. **DNS**: point `cms.<new-domain>` at `146.190.246.3` (Cloudflare proxied
   is fine; SSL mode Full (strict) in that zone).
2. **nginx**: append the hostname to both `server_name` lines in
   `/etc/nginx/sites-available/cms`.
3. **Cert**: re-run certbot listing **every** name so the one cert expands:
   `sudo certbot --nginx --expand -d cms.jwwang.ca -d cms.glorialan.com -d cms.<new-domain>`
   then `sudo nginx -t && sudo systemctl reload nginx`.
4. **App**: append `https://cms.<new-domain>` to `AUTH_TRUSTED_ORIGINS` in
   `/opt/jimmys-cms/.env`, then `docker compose up -d cms`.

No image rebuild is needed — trusted origins are read at runtime.

### Cloudflare sits in front

`cms.jwwang.ca` and `cms.glorialan.com` currently resolve to Cloudflare's
proxy (orange cloud). That means:

- Point both DNS records at `146.190.246.3`. Set **each zone's** SSL mode to
  **Full (strict)** once the certbot cert exists; if the `--nginx` HTTP-01
  challenge fails through the proxy, grey-cloud the record for a minute,
  issue, then re-enable.
- Cloudflare's free plan caps request bodies at ~100 MB. Camera originals
  dodge this by design: the browser uploads them straight to R2 with a
  presigned PUT, so only spreadsheets and API calls traverse the proxy.
- SSE (batch-import progress) passes through Cloudflare fine; the nginx vhost
  already disables proxy buffering for that route.

## Secrets and variables (GitHub repo settings)

| Name | Kind | Value |
| --- | --- | --- |
| `DROPLET_HOST` | secret | `146.190.246.3` |
| `DROPLET_USER` | secret | `wjw` |
| `DROPLET_SSH_KEY` | secret | private half of a keypair generated just for CI; public half appended to `~wjw/.ssh/authorized_keys` |
| `NEXT_PUBLIC_AUTH_BASE_URL` | variable | **leave empty / don't create** — empty inlines a same-origin auth client, which multi-portal serving requires. Only set it when pinning a single canonical hostname. |

`GITHUB_TOKEN` is automatic — it both pushes to GHCR and is forwarded over SSH
so the droplet can `docker login` for the pull. No PAT needed.

`NEXT_PUBLIC_*` is a **build arg**, not a runtime env: Next inlines it into the
client bundle at image-build time. In the multi-portal setup it stays empty on
purpose (same-origin client); if you ever pin a canonical hostname instead, a
change to this variable needs a rebuild, not just a redeploy.

## Rollback

The workflow keeps the previous tag in `/opt/jimmys-cms/.env.previous` and rolls
back automatically if the new container never reports healthy. Manual rollback:

```bash
cd /opt/jimmys-cms && sed -i 's|^IMAGE_TAG=.*|IMAGE_TAG=sha-<old-sha>|' .env && docker compose up -d cms
```

## Alternatives considered

- **DigitalOcean Container Registry** instead of GHCR — works identically; swap
  the login step for `digitalocean/action-doctl` and `doctl registry login`.
  Costs $5/mo past the free 500 MB tier, so GHCR wins for a private repo.
- **Build on the droplet** (`git pull && docker compose up --build`) — simplest,
  but a Next build on a small droplet is slow and can OOM. Rejected.
- **DigitalOcean App Platform** — no droplet management, but a SQLite file on
  local disk doesn't survive it. Rejected given the current data layer.

## Backups — Litestream to R2

The SQLite catalog is the one piece of state a container replacement cannot
rebuild. Masters and derivatives live in R2; the database holds everything
authored on top of them — tags, locations, geocoding, the build ledger — and
`docker compose up -d` destroys a container routinely. So replication runs from
day one rather than being added after the first loss.

`deploy/litestream.yml` replicates `/data/sqlite.db` continuously. It ships the
WAL, so a restore lands within seconds of the failure rather than at the last
snapshot. It shares the `cms-data` volume rather than talking over the network,
because SQLite replication needs filesystem access to the database and its WAL.

**Use a third bucket.** Backups are private and must not sit behind the media
bucket's public custom domain. Create `jimmys-cms-backups` and a token scoped to
it, then add to `/opt/jimmys-cms/.env`:

```
R2_ENDPOINT=https://<account id>.r2.cloudflarestorage.com
R2_BUCKET_BACKUPS=jimmys-cms-backups
R2_ACCESS_KEY_ID_BACKUPS=...
R2_SECRET_ACCESS_KEY_BACKUPS=...
COMPOSE_PROFILES=backup
```

The litestream service sits behind the compose profile `backup`
(`COMPOSE_PROFILES=backup` enables it). Until the bucket and token exist,
`docker compose up -d` simply skips litestream instead of crash-looping on
empty credentials. CI ships `deploy/litestream.yml` to the droplet alongside
the compose file on every deploy.

Restore:

```bash
docker compose stop cms
docker run --rm -v jimmys-cms_cms-data:/data -v /opt/jimmys-cms/litestream.yml:/etc/litestream.yml:ro \
  --env-file /opt/jimmys-cms/.env litestream/litestream:0.3 \
  restore -config /etc/litestream.yml /data/sqlite.db
docker compose start cms
```

Verify the replica is live rather than assuming it — a backup nobody has
restored is a hypothesis:

```bash
docker compose logs litestream | tail
docker compose exec litestream litestream snapshots /data/sqlite.db
```

## The .next/cache volume

Next's build cache is mounted as `cms-next-cache`. Without it the cache is cold
after every container replacement, which a stop-start deploy does on every
release.

## R2 buckets — required setup for production

Three buckets, three tokens, each token scoped to exactly one bucket
(**Object Read & Write on the specific bucket**, never an account-wide token).
A leak of any one credential then exposes one bucket, not the estate:

| Bucket | Access | Token env vars |
| --- | --- | --- |
| `jimmys-cms-masters` | fully private | `R2_ACCESS_KEY_ID_MASTERS` / `R2_SECRET_ACCESS_KEY_MASTERS` |
| `jimmys-cms-media` | public via custom domain only | `R2_ACCESS_KEY_ID_MEDIA` / `R2_SECRET_ACCESS_KEY_MEDIA` |
| `jimmys-cms-backups` | fully private | `R2_ACCESS_KEY_ID_BACKUPS` / `R2_SECRET_ACCESS_KEY_BACKUPS` |

Checklist in the Cloudflare dashboard:

1. **CORS on the masters bucket** — without this, every browser upload fails,
   because the presigned PUT from `/admin/media` is a cross-origin request:

   ```json
   [
     {
       "AllowedOrigins": [
         "https://cms.jwwang.ca",
         "https://cms.glorialan.com",
         "http://localhost:3000"
       ],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Every portal hostname belongs in `AllowedOrigins` — uploads start from
   whichever portal the editor is signed into. Portal N+1 therefore has a
   fifth step: add the new origin here too.

2. **Media bucket**: connect the custom domain (`media.jwwang.ca`) and leave
   the `*.r2.dev` development URL **disabled**. The custom domain rides
   Cloudflare's CDN and respects the long-lived cache headers the publish
   pipeline sets; r2.dev does neither.
3. **Masters + backups buckets**: no public access, no custom domain, r2.dev
   disabled. Masters are reached only through the app's short-lived presigned
   URLs; backups only by litestream.
4. The app itself never needs an account-level R2 API token, and no R2
   credential is ever exposed to the browser — uploads get a signed URL, reads
   go through the public media domain or a signed redirect.

## Seeding the production catalog

A fresh volume starts as an empty database (migrations run at boot). To carry
over the locally-built catalog instead of re-importing spreadsheets:

```bash
# from the repo on your machine
scp sqlite.db web-droplet-0:/tmp/sqlite.db
ssh web-droplet-0
docker compose -f /opt/jimmys-cms/docker-compose.yml stop cms
docker run --rm -v jimmys-cms_cms-data:/data -v /tmp:/src alpine \
  sh -c 'cp /src/sqlite.db /data/sqlite.db && chown 1001:1001 /data/sqlite.db'
rm /tmp/sqlite.db
docker compose -f /opt/jimmys-cms/docker-compose.yml start cms
```

(`1001` is the `nextjs` user the container runs as.)

**The copied file carries your local accounts**, including the dev admin's
password hash — `ADMIN_PASSWORD` in the droplet `.env` only applies when the
admin row is first created. After seeding, drop the dev admin so it is
re-bootstrapped from the production secret on next login:

```bash
docker compose exec cms node -e "const db=require('better-sqlite3')(process.env.SQLITE_URL); console.log(db.prepare(\"delete from user where username='admin'\").run())"
```
