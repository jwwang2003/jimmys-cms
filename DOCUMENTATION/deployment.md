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

```bash
ssh root@YOUR_DROPLET
adduser --disabled-password deploy && usermod -aG docker deploy
mkdir -p /opt/jimmys-cms && chown deploy:deploy /opt/jimmys-cms
```

Install Docker Engine + compose plugin (DigitalOcean's Docker marketplace image
already has both). Then create `/opt/jimmys-cms/.env` from `.env.example` with
real production values — this file is **never** written by CI, only read:

```
S3_BUCKET=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-2
SESSION_SECRET=<long random>
ADMIN_USERNAME=...
ADMIN_PASSWORD=...
AUTH_BASE_URL=https://cms.jwwang.ca
AUTH_TRUSTED_ORIGINS=https://cms.jwwang.ca
```

The container only listens on `127.0.0.1:3000`. Put Caddy in front for TLS —
`deploy/Caddyfile` is a working config; `apt install caddy` and drop it at
`/etc/caddy/Caddyfile`.

## Secrets and variables (GitHub repo settings)

| Name | Kind | Value |
| --- | --- | --- |
| `DROPLET_HOST` | secret | droplet IP |
| `DROPLET_USER` | secret | `deploy` |
| `DROPLET_SSH_KEY` | secret | private key whose public half is in `~deploy/.ssh/authorized_keys` |
| `NEXT_PUBLIC_AUTH_BASE_URL` | variable | `https://cms.jwwang.ca` |

`GITHUB_TOKEN` is automatic — it both pushes to GHCR and is forwarded over SSH
so the droplet can `docker login` for the pull. No PAT needed.

`NEXT_PUBLIC_*` is a **build arg**, not a runtime env: Next inlines it into the
client bundle, so it must be set when the image is built.

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
```

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
