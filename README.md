# jimmys-cms

- Built using the NextJS Framework
    > This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
- Mantine UI
- Amazon AWS
    - S3 Buckets (for storing static content)
- Hosted on DigitalOcean
- Testing framework(s):
    - Jtest
- Other:
    - [Better Auth]() provides authentication
    - Uses [Drizzle ORM]() for managing the SQL side of things
    - And maybe other things

## Getting Started

Set up your local AWS environment:
```bash
aws configure
```

### Development

```bash
# Dev server
pnpm dev

# Test
pnpm test
pnpm test:dev
pnpm test:prod
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

---

#### SQL Schema

**[Drizzle ORM](https://orm.drizzle.team/)** is used for the storage backend

- Make sure Drizzle Kit is installed: `pnpm add -D drizzle-kit`

The following commands are available:
```
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
pnpm drizzle-kit push
pnpm drizzle-kit pull
pnpm drizzle-kit check
pnpm drizzle-kit up
pnpm drizzle-kit studio
```

Project shortcuts:
```
pnpm run db:generate
pnpm run db:migrate
pnpm run db:push
pnpm run db:studio
```

Use `db:migrate` for normal schema evolution from the versioned files in `drizzle/`. Use `db:push` only for fast local schema sync when you intentionally want Drizzle Kit to reconcile the current database directly.

---

#### Auth

**[Better Auth](https://www.better-auth.com/)** is used for implementing the authentication backend (it works with Drizzle ORM).

In the project root, run `npx @better-auth/cli@latest generate` to generate a auth schema called `auth-schema.ts`.

Make sure that this schema file is included in the `drizzle.config.ts`.

---

### Production

```bash
pnpm start

pnpm build
```

## Amazon AWS

So far the only AWS service used are the S3 buckets.

- Ensure that AWS CLI is installed a login via SSO \(Access key & Secret access key\). Refer to the following links:
    - [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
    - [Logging in via the CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)

## Simple CMS Login

The app now includes a simple signed-cookie login flow separate from Better Auth's stock UI.

- `admin` is bootstrapped automatically from `ADMIN_USERNAME` and `ADMIN_PASSWORD`
- `user` accounts can register with a password
- `guest` accounts can register with or without a password
- `/login` also supports one-click passwordless guest access
- Guests are read-only inside the CMS; admins and users can upload, sync, and edit media

The session cookie is signed with `SESSION_SECRET`. Set this in production.

## Geolocation Import

Locations can now be imported from the admin sync workspace using pasted CSV data.

- Route: `/admin/media/sync`
- Import API: `/api/admin/media/location-import`
- Supported CSV columns: `asset_id`, `object_key`, `address`, `label`, `formatted_address`, `lat`, `lng`
- Matching prefers `asset_id`, then falls back to `object_key`
- Images replace their primary location on import
- Videos can accumulate multiple imported locations, with the latest import marked primary

If `GOOGLE_MAPS_API_KEY` is configured, imported rows without coordinates are geocoded through Google Maps. If the key is missing,
rows still import and are stored as `pending` so the workflow stays tolerant.

When local network access needs a proxy, set `GOOGLE_MAPS_PROXY_URL` such as `http://127.0.0.1:7890`. Server-side imports and
manual geocode refreshes will route Google Maps requests through that proxy.

## Media Library Schema

All CMS media metadata is modeled with Drizzle (see `src/db/schema/schema.ts`). The binary objects live in S3, while SQLite only
tracks metadata and relationships:

- `storage_locations` keeps the known bucket aliases, regions, and CDN base URLs.
- `media_assets` represents every uploaded file (images, videos, docs, etc.) along with S3 keys, MIME type, dimensions, duration,
  visibility, and publication status.
- `media_renditions` stores optional derived variants (thumbnails, bitrate versions).
- `storage_folders` defines canonical prefixes for images, videos, GIFs, and misc content per bucket; `storage_objects` snapshots
  each raw S3 object (key, size, folder, checksum) so you can audit bucket contents.
- `tags` and `media_tags` provide a reusable tagging vocabulary with many-to-many links.
- `media_attributes` captures arbitrary key/value metadata (namespaced) for future frontends to query without schema churn.
- `collections` and `collection_assets` let you curate playlists/boards tied to assets.
- `asset_locations` stores normalized geolocation records for assets, preserving imported address text and primary-location state.

These tables are intentionally metadata-only. Each row references the S3 object via `storage_id` + `object_key`, so multiple
frontends can render content while S3 holds the raw binaries.

## Admin Routes

- `/admin` dashboard with media, warning, invalid, and missing-location counts
- `/admin/media` asset browser plus upload flow
- `/admin/media/[id]` asset editor for tags, collections, visibility, status, and primary location
- `/admin/media/sync` tolerant S3 sync workspace and review queue
- `/dev/storage` remains a dev-only bucket browser for debugging and operations

# References
