# jimmys-cms — Build Plan

Companion to [site-plan.md](./site-plan.md) (glorialan.com) and the architecture
analysis in [photo-platform-plan.md](./photo-platform-plan.md).

Branch from **`dev`** (`6037b17`), never `main` — `main` is 18 commits and seven
months behind, and its media library is unwired scaffolding.

**Role:** authoring, storage, and publishing. The CMS owns the database, the R2
credentials, the ingest pipeline, and the generator. It is the only thing that
writes. glorialan.com never reads from it directly.

**Served at:** `cms.glorialan.com` and `cms.jwwang.ca` (see §5).

---

## 0. Where it stands

Already built on `dev` and working:

| Area | Files | Lines |
|---|---|---|
| Repository layer | `lib/media/repository.ts` | 1504 |
| Service layer | `lib/media/service.ts` | 588 |
| Spreadsheet ingest (bilingual headers) | 4 files | 1139 |
| Ingest job runner + SSE progress | `lib/media/ingest-jobs.ts` + route | 566 |
| EXIF parser (hand-rolled, no library) | `lib/media/exif.ts` | 334 |
| Geocoding | `google-maps.ts`, `location-import.ts`, `location-csv.ts` | 472 |
| Admin UI | 14 components | ~1500 |
| Admin API | 10 routes | ~500 |
| Tests | 20 files | ~2200 |

Schema is 517 lines / 17 tables, with migrations committed. `photo_exif`,
`photo_cameras`, `photo_lenses`, `asset_locations`,
`asset_location_conflicts`, `media_ingest_jobs` and `media_ingest_job_items`
all exist and are wired.

**Missing, and it is the whole remaining job:** derivative generation, presigned
upload, content hashing, the build ledger, and the generator. Verified by grep —
`content_hash`, `build_state`, `revalidateTag`, `getSignedUrl` and
`s3-request-presigner` return zero hits across `src/`. `media_renditions` is the
one table in the schema with no writer, and `sharp` appears only in pnpm's
`onlyBuiltDependencies` allowlist, not in `dependencies`.

---

## 1. Security fixes — do these before anything else

- [ ] **Delete the `env` block from `next.config.ts`.** Next inlines those values
      into the **client** bundle, so the admin password ships to every visitor.
      Patch prepared: `jimmys-cms-remove-client-credential-leak.patch`.
      Verified safe — the only reader is `src/db/operations.ts:21-22`, which is
      server-side, where `process.env` works without the `env` key.
      `login/page.tsx` mentions the names only in help text; `process.env.PORT`
      has no readers at all.
- [ ] Delete `validateLogin` from `src/db/operations.ts` — it compares passwords
      with `===` in plaintext. Superseded by Better Auth, but still exported.
- [ ] `src/lib/auth-client.ts` hardcodes `baseURL: "http://localhost:3000"`.
      This breaks the moment it is deployed. Drive it from an env var (§5.3).
- [ ] Confirm `.env` is gitignored **and** that no `.env*` variant slips through.
      A `.env*.local`-style rule does **not** cover `.env.r2`; use `.env.*` with
      a `!.env.example` exception. This exact gap was found and fixed in
      glorialan.com — check for it here too.

**Done when:** `pnpm build` emits no client chunk containing `ADMIN_PASSWORD`
(`grep -r ADMIN_PASSWORD .next/static/` returns nothing).

---

## 2. Stand it up

- [ ] `pnpm install`, `pnpm db:migrate`, `pnpm test` — 20 test files must pass
      before building on this
- [ ] `.env` from `.env.example`; generate a real `SESSION_SECRET`
- [ ] Import `data/photography_v1_0.xlsx` (sheet `摄影作品信息`, ~160 rows) and
      `data/artwork_v1_0.xlsx`
- [ ] **Reconcile the row gap** — the spreadsheet holds ~160 rows against the 111
      records in glorialan.com's `photo-data.ts`

**Done when:** every spreadsheet row is either an asset row or explicitly marked
out of scope with a written reason. Do not carry an unexplained gap forward — a
count mismatch at cutover is how photos disappear silently.

---

## 3. R2 wiring

The masters are uploaded separately and first, by
`glorialan.com/scripts/upload-masters-to-r2.mjs` — the CMS does not need to
exist for that to happen, and it should not wait.

- [ ] Extend `src/lib/s3.ts` with an `endpoint` option. R2 speaks the S3 API, so
      this is a client option, not a rewrite:
      ```ts
      new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      })
      ```
- [ ] Register the buckets in `storage_locations` — the table already models
      alias, bucket name, region and CDN base URL
- [ ] Point `storage_folders` at the key layout below
- [ ] Run a `storage_objects` sync so the DB knows what the bucket already holds.
      This table exists precisely to reconcile DB-vs-bucket drift; the uploaded
      masters are its first real job.

### Bucket layout

Two buckets, because they have opposite access rules:

```
glorialan-masters   (private, no public access, no CDN)
  masters/originals/**        155 files, 1016 MB — uploaded first
  masters/orphaned/**         16 files, 25 MB

glorialan-media     (public-read via CloudFront)
  derived/photo/<uid>/<w>.avif
  derived/photo/<uid>/<w>.webp
  data/manifest.json          small, no-cache — the only mutable object
  data/photos.<hash>.json     immutable, 1y cache
```

### CDN — Cloudflare, not CloudFront *(revised 2026-08-19)*

An earlier revision paired R2 with CloudFront, on the grounds that this repo
already carried `CLOUDFRONT_DISTRIBUTION_ID` plumbing. **Superseded.** That
plumbing was ~15 lines of env parsing in `src/lib/s3.ts`, legacy from when the
CMS targeted AWS S3 — a variable name, not lock-in — and has since been
deleted (2026-08-19) along with the unused bare S3 client export.

Serve `glorialan-media` through a **custom domain on the bucket** instead:

| | Cloudflare | CloudFront |
|---|---|---|
| Egress | unmetered, $0 | 1 TB/mo free, then ~$0.085/GB |
| Origin setup | custom domain on the bucket | custom origin; **no Origin Access Control** |
| Accounts | one | two |

The OAC problem exists *because* CloudFront fronts a non-AWS origin. Removing
CloudFront removes the problem rather than working around it.

No terms-of-service obstacle: Cloudflare retired Section 2.8 (the old non-HTML
serving restriction) in 2023, and the current terms explicitly permit serving
large media through the CDN when it is hosted by a Cloudflare service such as R2.

- [ ] Attach the custom domain **`media.glorialan.com`** to `glorialan-media`
- [ ] Leave `glorialan-masters` private with no public access and no custom domain

> **Keep the media hostname one label deep.** A nested name such as
> `bucket.na.cms.jwwang.ca` was considered and rejected on three grounds:
>
> 1. **It breaks free TLS.** Cloudflare Universal SSL covers the apex and
>    `*.jwwang.ca` — one level only. Multi-level names require Advanced
>    Certificate Manager (~$10/mo), which would be the sole charge on an
>    otherwise $0.00 stack.
> 2. **It inverts the architecture.** Nesting media under `cms.` routes every
>    public image through the admin infrastructure's name, contradicting §1 of
>    the architecture doc. These URLs are embedded in artifacts served with
>    1-year immutable cache headers, so the hostname must be the *most* stable
>    name available — not one derived from a service that may be renamed or moved.
> 3. **`na` encodes something untrue.** Cloudflare's CDN is anycast; there is no
>    North America endpoint. R2 location hints and jurisdictions govern where
>    data rests, not where it is served from.
>
> `media.jwwang.ca` is an equally valid choice if the media should live on the
> infrastructure domain rather than the site's. `media.glorialan.com` is
> preferred here because the assets are that site's content, and keeping them on
> the same registrable domain avoids the cross-domain asset-host pattern that
> some privacy blockers treat with suspicion.
- [ ] Set cache rules: `data/manifest.json` no-cache; everything else immutable,
      1-year — safe because every other key is content-hashed

**Cost at current size:** 1.06–1.24 GB against R2's 10 GB perpetual free tier,
~1,400 PUTs against 1M free, egress unmetered. **$0.00.**

Do not use R2 Infrequent Access — the free tier is Standard-only, so IA bills
from the first byte plus retrieval fees, replacing something currently free.

> **Optional escape hatch.** All-Cloudflare puts Image Transformations
> (`/cdn-cgi/image/width=800,format=auto/…`) on the table, which could replace §4
> entirely. Not recommended: it needs a paid plan, and
> `glorialan.com/scripts/optimize-images.mjs` already generates derivatives for
> free. Keep it in reserve if the derive worker becomes a slog.

---

## 4. Derivatives — the critical path

Nothing downstream can be built until this exists.

- [ ] Add `sharp` to `dependencies` (it is only in the pnpm build allowlist today)
- [ ] Add a `derive` mode to `media_ingest_jobs`, reusing the existing job runner
      and its SSE progress stream — the machinery is already there
- [ ] Per master: AVIF q78 + WebP q82 at 400 / 800 / 1600 / 2400, skipping widths
      above native; write one `media_renditions` row per output
- [ ] Measure true pixel dimensions and compute an LQIP in the same pass
- [ ] Switch **master** uploads to presigned PUT. The current path
      (`api/admin/media/route.ts`) does `formData()` → `arrayBuffer()` →
      `PutObjectCommand`, buffering the whole file through Next. That will not
      survive a 33 MB original. Keep the proxy path for spreadsheets.
- [ ] Backfill from the uploaded masters, then **diff measured against declared
      dimensions and review the diff before overwriting**

> `glorialan.com/scripts/optimize-images.mjs` (273 lines) is the working encoder
> logic — lift it rather than rewriting. Note it makes the opposite call on
> widths: one source per image, letting `next/image` negotiate. Decide
> consciously which model wins (§6 of the site plan) and do not let the two
> silently diverge.

**Done when:** every published asset has ≥4 rendition rows with matching R2
objects, and the dimension diff has been reviewed rather than silently applied.

---

## 5. Domains — `cms.glorialan.com` + `cms.jwwang.ca`

Both hostnames, one instance. The CMS **must** be self-hosted: SQLite needs a
persistent filesystem, the derive jobs are long-running, and the SSE progress
stream needs a real connection. None of that fits a serverless platform.

### 5.1 Portal hostnames — decision revised (2026-08-19)

**Decision: every portal hostname serves the CMS directly.** The original
recommendation (canonical host + 301) is superseded — both names are
first-class portals, and the setup is deliberately n+1-able: a new portal
hostname is a DNS record, a `server_name` entry, a `certbot --expand`, and an
`AUTH_TRUSTED_ORIGINS` append (see DOCUMENTATION/deployment.md, "Adding
portal hostname N+1"). No rebuild.

The cost stated below still holds and is accepted: session cookies are
per-domain (the portals sit on different registrable domains, so no cookie
can span them) — each portal has its own independent login. What makes the
multiple auth surfaces safe is same-origin config: with `AUTH_BASE_URL` and
`NEXT_PUBLIC_AUTH_BASE_URL` unset, every portal talks only to itself, and
`AUTH_TRUSTED_ORIGINS` enumerates the portals for the CSRF origin check.

### 5.2 DNS and TLS

All records point at the same host. On the real droplet (do0) nginx + certbot
own 80/443, so the CMS vhost is `deploy/nginx/cms.conf` — one server block
listing every portal in `server_name`, one certbot cert covering all names,
auto-renewed by `certbot.timer`. On a fresh box, `deploy/Caddyfile` is the
equivalent (one address line listing every portal; Caddy provisions certs
itself).

**Do not expose this publicly without cause.** The CMS needs outbound access to
R2 and one webhook; it needs no inbound access from anyone but you. Prefer a
VPN, a Cloudflare Tunnel with Access in front, or an IP allowlist. A public
admin panel guarded only by a password is a much larger attack surface than this
project needs.

### 5.3 Application config

- [x] `AUTH_BASE_URL` / `NEXT_PUBLIC_AUTH_BASE_URL` stay **unset** for
      multi-portal (same-origin); `src/lib/auth-client.ts` falls back to a
      same-origin client when the var is empty (the old localhost hardcode is
      gone)
- [x] Better Auth `trustedOrigins` must list **every** portal hostname —
      `AUTH_TRUSTED_ORIGINS` in the droplet `.env`
- [ ] Session cookies: `Secure`, `HttpOnly`, `SameSite=Lax`
- [ ] Docker compose needs two volumes: one for the SQLite file, one for
      `.next/cache`
- [ ] Litestream replicating the SQLite file to R2 — the database is as
      irreplaceable as the masters, and a file copy is the whole backup story

**Done when:** every portal hostname resolves over HTTPS with a valid
certificate, serves the CMS directly, accepts its own login, and a login
survives a container restart.

---

## 6. Generator and publishing

- [ ] Materialize indexed `country_code` / `region_code` on the asset from
      geocode results. The map facets on them; `media_attributes` (EAV) is the
      wrong shape for a query that runs on every page.
- [ ] `content_hash` per asset — a hash of its semantic fields
- [ ] `build_state` ledger: artifact → hash → R2 key → built-at
- [ ] Artifact hash = `sha256(GENERATOR_VERSION ‖ sorted contributing content_hashes)`.
      No timestamps: an artifact is stale exactly when its inputs changed.
- [ ] Emit `manifest.json` plus a content-hashed columnar catalog carrying
      interned dictionaries, a precomputed chronological order, and facet
      postings — see §8.1 of the architecture doc for the exact shape
- [ ] Publish = recompute hashes, diff against the ledger, write only mismatches
- [ ] `POST` the changed ids to glorialan.com's `/api/revalidate` with a shared
      secret

**Done when:** a second publish run with no edits emits **zero** objects, and
bumping `GENERATOR_VERSION` rebuilds everything. That pair of behaviours is what
proves the ledger is correct — either one alone can pass with a broken diff.

---

## 7. Risks

| Risk | Handling |
|---|---|
| Admin password in the client bundle | §1, before deployment. Verify with a grep of `.next/static/`. |
| Public admin panel | §5.2 — VPN, Tunnel, or allowlist. Do not rely on the password alone. |
| SQLite is the only copy of the catalog | Litestream to R2 from day one |
| Hand-rolled EXIF parser meets an unknown format | Its 291-line test suite is load-bearing; treat failures as blocking |
| N portal hostnames, N session domains | §5.1 revised — accepted: per-portal logins, same-origin auth, every portal in `AUTH_TRUSTED_ORIGINS` |
| Derivative model diverges from the site's | §4 note — settle one model before stage 6 of the site plan |
| A missed revalidate leaves the site stale | Long time-based revalidate as a backstop, plus a rebuild-all admin action |

---

## 8. Order

1. §1 security fixes — nothing is deployed before these
2. §2 stand up + import + reconcile
3. §3 R2 wiring (masters are already uploaded by then)
4. §4 derivatives ← **critical path**
5. §6 generator
6. §5 domains and deployment
7. Hand off to site-plan.md §3–5

§5 sits late deliberately: there is no reason to expose the CMS publicly until it
has something to publish. Run it on localhost until §6 works.
